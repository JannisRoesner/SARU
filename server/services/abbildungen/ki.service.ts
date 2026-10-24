import { readFile } from 'node:fs/promises'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { normalisiereSchlagwoerter } from '#shared/utils/abbildungen'
import { useDatabase } from '../../database/client'
import { materialAbbildungen, materialAssets, materials, type AbbildungKiMeta } from '../../database/schema'
import { appError } from '../../utils/errors'
import { extractJsonObject } from '../../utils/json-parse'
import { createLogger } from '../../utils/logger'
import { chatCompletion, type ChatPart } from '../ai/client'
import { visionExtractionAvailable } from '../ai/document-text'
import { queueReindex } from '../search/indexer'
import { getAiSettings, type AiSettings } from '../settings.service'
import { resolveStoragePath } from '../storage.service'

const log = createLogger('abbildungen:ki')

export const ABBILDUNG_KI_PROMPT_VERSION = 'abbildung-v1'
/** Bilder je Anfrage – spart Grundkosten je Aufruf, ohne das Modell zu überfordern. */
const BILDER_JE_ANFRAGE = 4
/** Längste Bildkante, die an das Modell geht. */
const MAX_KANTE = 768
/** Parallele Anfragen je Sammlung. */
const PARALLEL = 2
/** Nach so vielen Fehlschlägen in Folge hört der Lauf auf (Anbieter nicht erreichbar o. Ä.). */
const MAX_FEHLER_IN_FOLGE = 3

export interface AbbildungKiFortschritt {
  gesamt: number
  fertig: number
  ergaenzt: number
  fehler: number
  laeuft: boolean
  abgebrochen: boolean
  meldung: string | null
}

interface Lauf extends AbbildungKiFortschritt {
  abbruch: AbortController
}

/** Laufende und zuletzt beendete Läufe je Sammlung (nur in diesem Prozess). */
const laeufe = new Map<string, Lauf>()

export function abbildungenKiFortschritt(materialId: string): AbbildungKiFortschritt | null {
  const lauf = laeufe.get(materialId)
  if (!lauf) return null
  const { abbruch: _abbruch, ...fortschritt } = lauf
  return fortschritt
}

export function abbildungenKiVerfuegbar(settings: AiSettings): boolean {
  return visionExtractionAvailable(settings)
}

export function abbildungenKiAbbrechen(materialId: string): boolean {
  const lauf = laeufe.get(materialId)
  if (!lauf?.laeuft) return false
  lauf.abbruch.abort()
  lauf.abgebrochen = true
  return true
}

/**
 * Startet im Hintergrund die Ergänzung fehlender Bildangaben (Titel, Beschreibung, Schlagwörter)
 * per Vision-KI. Nur Hauptbilder ohne Angaben aus Paket, Bearbeitung oder früherem KI-Lauf.
 * Gibt die Zahl der Bilder zurück, die bearbeitet werden.
 */
export async function startAbbildungenKi(materialId: string): Promise<number> {
  const bestehend = laeufe.get(materialId)
  if (bestehend?.laeuft) throw appError('KONFLIKT', 'Für diese Sammlung läuft die KI-Ergänzung bereits.')
  const lauf: Lauf = {
    gesamt: 0,
    fertig: 0,
    ergaenzt: 0,
    fehler: 0,
    laeuft: true,
    abgebrochen: false,
    meldung: null,
    abbruch: new AbortController(),
  }
  laeufe.set(materialId, lauf)
  let ids: string[]
  try {
    ids = await vorbereiten(materialId, lauf)
  } catch (error) {
    laeufe.delete(materialId)
    throw error
  }
  void ausfuehren(materialId, ids, lauf)
    .catch((error) => {
      lauf.meldung = error instanceof Error ? error.message : 'Die KI-Ergänzung ist fehlgeschlagen.'
      log.warn('KI-Ergänzung der Abbildungen fehlgeschlagen', { materialId, error })
    })
    .finally(() => {
      lauf.laeuft = false
    })
  return ids.length
}

async function vorbereiten(materialId: string, lauf: Lauf): Promise<string[]> {
  const settings = await getAiSettings()
  if (!abbildungenKiVerfuegbar(settings)) {
    throw appError('KI_NICHT_KONFIGURIERT', 'Die Bildanalyse (Vision) ist in den KI-Einstellungen nicht aktiviert.')
  }
  const offen = await useDatabase()
    .select({ id: materialAbbildungen.id })
    .from(materialAbbildungen)
    .where(
      and(
        eq(materialAbbildungen.materialId, materialId),
        eq(materialAbbildungen.herkunft, 'dateiname'),
        isNull(materialAbbildungen.varianteVon),
      ),
    )
    .orderBy(asc(materialAbbildungen.sortOrder))
  lauf.gesamt = offen.length
  return offen.map((zeile) => zeile.id)
}

/** Verkleinert ein Bild auf höchstens MAX_KANTE Pixel und kodiert es als JPEG. */
async function verkleinern(buffer: Buffer): Promise<{ base64: string; mimeType: string }> {
  const { createCanvas, loadImage } = await import('@napi-rs/canvas')
  const bild = await loadImage(buffer)
  const faktor = Math.min(1, MAX_KANTE / Math.max(bild.width, bild.height))
  const breite = Math.max(1, Math.round(bild.width * faktor))
  const hoehe = Math.max(1, Math.round(bild.height * faktor))
  const canvas = createCanvas(breite, hoehe)
  const ctx = canvas.getContext('2d')
  // Transparente PNGs bekommen einen weißen Grund, sonst sieht das Modell Schwarz.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, breite, hoehe)
  ctx.drawImage(bild, 0, 0, breite, hoehe)
  return { base64: canvas.toBuffer('image/jpeg', 80).toString('base64'), mimeType: 'image/jpeg' }
}

interface Kandidat {
  id: string
  titel: string
  fileName: string | null
  storageKey: string | null
  seite: string | null
  abbildung: string | null
  kapitel: string | null
  schlagwoerter: string[]
  beschreibung: string | null
  beschriftet: boolean | null
}

interface KiAntwort {
  titel?: string
  beschreibung?: string
  schlagwoerter?: string[]
  beschriftet?: boolean
}

function prompt(sammlung: string, fach: string | null, bilder: Kandidat[]): string {
  const liste = bilder
    .map((bild, index) =>
      [
        `Bild ${index + 1}: Datei „${bild.fileName ?? 'unbekannt'}“`,
        bild.titel ? `bisheriger Titel „${bild.titel}“` : null,
        bild.kapitel ? `Kapitel ${bild.kapitel}` : null,
        bild.seite ? `Seite ${bild.seite}` : null,
        bild.abbildung ? `Abb. ${bild.abbildung}` : null,
      ]
        .filter(Boolean)
        .join(', '),
    )
    .join('\n')
  return [
    'Du beschreibst Abbildungen aus deutschen Schulbüchern für eine Bilddatenbank von Lehrkräften.',
    `Sammlung: ${sammlung}${fach ? ` (Fach: ${fach})` : ''}.`,
    'Für jedes Bild in der gegebenen Reihenfolge:',
    '- "titel": kurzer, fachlich korrekter Titel (höchstens 8 Wörter, ohne „Abbildung“).',
    '- "beschreibung": 1–2 Sätze, was zu sehen ist (Motiv, dargestellte Strukturen/Vorgänge, Art: Foto, Zeichnung, Schema, Diagramm).',
    '- "schlagwoerter": 3–8 fachliche Suchbegriffe auf Deutsch.',
    '- "beschriftet": true, wenn das Bild Text-Beschriftungen oder Pfeile mit Benennungen enthält, sonst false.',
    'Erfinde nichts, was nicht zu sehen ist. Antworte ausschließlich als JSON:',
    '{"bilder":[{"nr":1,"titel":"…","beschreibung":"…","schlagwoerter":["…"],"beschriftet":true}]}',
    '',
    liste,
  ].join('\n')
}

/** Ein bloßer Dateiname als Titel („012_1B“) wird ersetzt, ein sprechender bleibt. */
function titelIstSprechend(titel: string): boolean {
  return titel.split(/\s+/).filter((wort) => /\p{L}{3,}/u.test(wort)).length >= 2
}

async function ausfuehren(materialId: string, ids: string[], lauf: Lauf): Promise<void> {
  if (!ids.length) return
  const db = useDatabase()
  const settings = await getAiSettings()
  const [material] = await db
    .select({ title: materials.title })
    .from(materials)
    .where(eq(materials.id, materialId))
    .limit(1)
  const fachZeilen = (await db.execute(
    // Erstes Fach der Sammlung als Kontext.
    sql`select s.name from material_subjects ms join subjects s on s.id = ms.subject_id
      where ms.material_id = ${materialId}::uuid order by s.name limit 1`,
  )) as unknown as { name: string }[]
  const fach = fachZeilen[0]?.name ?? null
  const modell = (settings.visionModel || settings.chatModel).trim()

  const stapel: string[][] = []
  for (let i = 0; i < ids.length; i += BILDER_JE_ANFRAGE) stapel.push(ids.slice(i, i + BILDER_JE_ANFRAGE))
  let fehlerInFolge = 0
  let naechster = 0

  const bearbeite = async (teil: string[]): Promise<void> => {
    const kandidaten = (await db
      .select({
        id: materialAbbildungen.id,
        titel: materialAbbildungen.titel,
        fileName: materialAssets.fileName,
        storageKey: materialAssets.storageKey,
        seite: materialAbbildungen.seite,
        abbildung: materialAbbildungen.abbildung,
        kapitel: materialAbbildungen.kapitel,
        schlagwoerter: materialAbbildungen.schlagwoerter,
        beschreibung: materialAbbildungen.beschreibung,
        beschriftet: materialAbbildungen.beschriftet,
        herkunft: materialAbbildungen.herkunft,
      })
      .from(materialAbbildungen)
      .innerJoin(materialAssets, eq(materialAssets.id, materialAbbildungen.assetId))
      .where(inArray(materialAbbildungen.id, teil))
      .orderBy(asc(materialAbbildungen.sortOrder)))
      // Inzwischen von Hand bearbeitete Bilder nicht mehr anfassen.
      .filter((k) => k.herkunft === 'dateiname')
    if (!kandidaten.length) return

    const parts: ChatPart[] = [{ type: 'text', text: prompt(material?.title ?? 'Abbildungen', fach, kandidaten) }]
    const dabei: Kandidat[] = []
    for (const kandidat of kandidaten) {
      if (!kandidat.storageKey) continue
      try {
        const bild = await verkleinern(await readFile(resolveStoragePath(kandidat.storageKey)))
        parts.push({ type: 'text', text: `Bild ${dabei.length + 1}:` }, { type: 'image', ...bild })
        dabei.push(kandidat)
      } catch (error) {
        log.warn('Bild konnte nicht für die KI vorbereitet werden', { abbildungId: kandidat.id, error })
      }
    }
    if (!dabei.length) return
    if (dabei.length !== kandidaten.length) {
      // Nummern im Text müssen zu den mitgeschickten Bildern passen.
      parts[0] = { type: 'text', text: prompt(material?.title ?? 'Abbildungen', fach, dabei) }
    }

    const ergebnis = await chatCompletion(settings, [{ role: 'user', parts }], {
      rolle: 'vision',
      model: modell || undefined,
      temperature: 0.2,
      maxOutputTokens: Math.min(Math.max(settings.maxOutputTokens || 1200, 600), 2000),
      jsonMode: true,
    })
    const json = extractJsonObject(ergebnis.text)
    const antworten = Array.isArray(json?.bilder) ? (json.bilder as KiAntwort[]) : []
    if (!antworten.length) throw new Error('Die KI hat keine verwertbare Antwort geliefert.')

    const meta: AbbildungKiMeta = {
      model: ergebnis.model,
      generatedAt: new Date().toISOString(),
      promptVersion: ABBILDUNG_KI_PROMPT_VERSION,
    }
    for (const [index, kandidat] of dabei.entries()) {
      const antwort = antworten.find((a) => Number((a as { nr?: unknown }).nr) === index + 1) ?? antworten[index]
      if (!antwort) continue
      const felder: string[] = []
      const werte: Partial<typeof materialAbbildungen.$inferInsert> = {}
      const titel = typeof antwort.titel === 'string' ? antwort.titel.replace(/\s+/g, ' ').trim().slice(0, 300) : ''
      if (titel && !titelIstSprechend(kandidat.titel)) {
        werte.titel = titel
        felder.push('titel')
      }
      const beschreibung = typeof antwort.beschreibung === 'string' ? antwort.beschreibung.trim().slice(0, 4000) : ''
      if (beschreibung && !kandidat.beschreibung) {
        werte.beschreibung = beschreibung
        felder.push('beschreibung')
      }
      const woerter = normalisiereSchlagwoerter([...kandidat.schlagwoerter, ...normalisiereSchlagwoerter(antwort.schlagwoerter)])
      if (woerter.length > kandidat.schlagwoerter.length) {
        werte.schlagwoerter = woerter
        felder.push('schlagwoerter')
      }
      if (typeof antwort.beschriftet === 'boolean' && kandidat.beschriftet === null) {
        werte.beschriftet = antwort.beschriftet
        felder.push('beschriftet')
      }
      await db
        .update(materialAbbildungen)
        .set({ ...werte, herkunft: 'ki', kiMeta: { ...meta, felder }, updatedAt: new Date() })
        .where(and(eq(materialAbbildungen.id, kandidat.id), eq(materialAbbildungen.herkunft, 'dateiname')))
      // Varianten zeigen dasselbe Motiv und übernehmen fehlende Angaben.
      const varianten = await db
        .select({ id: materialAbbildungen.id, beschreibung: materialAbbildungen.beschreibung, schlagwoerter: materialAbbildungen.schlagwoerter })
        .from(materialAbbildungen)
        .where(and(eq(materialAbbildungen.varianteVon, kandidat.id), eq(materialAbbildungen.herkunft, 'dateiname')))
      for (const variante of varianten) {
        await db
          .update(materialAbbildungen)
          .set({
            ...(werte.titel ? { titel: werte.titel } : {}),
            ...(werte.beschreibung && !variante.beschreibung ? { beschreibung: werte.beschreibung } : {}),
            ...(werte.schlagwoerter && !variante.schlagwoerter.length ? { schlagwoerter: werte.schlagwoerter } : {}),
            herkunft: 'ki',
            kiMeta: { ...meta, felder },
            updatedAt: new Date(),
          })
          .where(eq(materialAbbildungen.id, variante.id))
      }
      queueReindex('abbildung', kandidat.id)
      lauf.ergaenzt += 1
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(PARALLEL, stapel.length) }, async () => {
      while (naechster < stapel.length) {
        if (lauf.abbruch.signal.aborted || fehlerInFolge >= MAX_FEHLER_IN_FOLGE) return
        const teil = stapel[naechster++]!
        try {
          await bearbeite(teil)
          fehlerInFolge = 0
        } catch (error) {
          fehlerInFolge += 1
          lauf.fehler += teil.length
          lauf.meldung = error instanceof Error ? error.message : 'Unbekannter Fehler'
          log.warn('KI-Ergänzung für einen Bildstapel fehlgeschlagen', { materialId, error })
        }
        lauf.fertig += teil.length
      }
    }),
  )
  if (fehlerInFolge >= MAX_FEHLER_IN_FOLGE) {
    lauf.meldung = `Abgebrochen nach ${MAX_FEHLER_IN_FOLGE} Fehlschlägen in Folge: ${lauf.meldung ?? ''}`.trim()
  }
  queueReindex('material', materialId)
  log.info('KI-Ergänzung der Abbildungen beendet', {
    materialId,
    gesamt: lauf.gesamt,
    ergaenzt: lauf.ergaenzt,
    fehler: lauf.fehler,
    abgebrochen: lauf.abgebrochen,
  })
}
