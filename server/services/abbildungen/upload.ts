import {
  ABBILDUNGEN_MANIFEST_MAX_BYTES,
  istAbbildungenManifest,
  istAbbildungsBildDatei,
  istAbgelehntesBildformat,
  parseAbbildungenManifest,
  planeAbbildungssammlung,
} from '#shared/utils/abbildungen'
import { invalidInput } from '../../utils/errors'
import type { MultipartPart } from '../../utils/multipart'
import { sanitizeFileName } from '../storage.service'
import { abbildungenHinzufuegen, type HinzufuegenErgebnis } from './abbildung.service'

export interface UploadErgebnis extends HinzufuegenErgebnis {
  warnungen: string[]
}

/**
 * Bilder (und optional eine `abbildungen.json`) aus einem Upload in eine bestehende Sammlung
 * übernehmen – dieselben Regeln wie im Stapel-Upload. Gemeinsam für angemeldete Nutzer und
 * Freigabe-Links mit Bearbeitungsrecht.
 */
export async function abbildungenAusUploadHinzufuegen(materialId: string, parts: MultipartPart[]): Promise<UploadErgebnis> {
  const dateien = parts.filter((part) => part.filename && part.data?.length)
  if (!dateien.length) throw invalidInput('Es wurde keine Datei übermittelt.')

  const warnungen: string[] = []
  const manifestTeil = dateien.find((part) => istAbbildungenManifest(part.filename))
  let manifest = null
  if (manifestTeil) {
    if (manifestTeil.data.length > ABBILDUNGEN_MANIFEST_MAX_BYTES) {
      throw invalidInput('abbildungen.json ist zu groß.')
    }
    const gelesen = parseAbbildungenManifest(manifestTeil.data.toString('utf8'))
    if (gelesen.fehler.length) throw invalidInput(gelesen.fehler.join(' '))
    warnungen.push(...gelesen.warnungen)
    manifest = gelesen.manifest
  }

  const uebersprungen: HinzufuegenErgebnis['uebersprungen'] = []
  const bilder: { ref: string; dateiName: string; data: Buffer }[] = []
  for (const [index, part] of dateien.entries()) {
    if (part === manifestTeil) continue
    const dateiName = sanitizeFileName(part.filename!)
    if (!istAbbildungsBildDatei(dateiName)) {
      uebersprungen.push({
        ref: `upload:${index}`,
        dateiName,
        grund: istAbgelehntesBildformat(dateiName)
          ? 'TIFF/BMP wird nicht unterstützt – bitte vorher in PNG oder JPEG wandeln.'
          : 'Nur Bilder (PNG, JPEG, WebP, GIF) gehören in eine Abbildungssammlung.',
      })
      continue
    }
    bilder.push({ ref: `upload:${index}`, dateiName, data: part.data })
  }
  if (!bilder.length) {
    throw invalidInput(uebersprungen[0]?.grund ?? 'Es wurde kein Bild übermittelt.')
  }

  const plan = planeAbbildungssammlung(
    bilder.map((bild) => ({ ref: bild.ref, dateiName: bild.dateiName })),
    manifest,
  )
  // Beim Nachladen gehören auch Bilder ohne Eintrag dazu – die Warnung dazu ist hier nur Rauschen.
  warnungen.push(...plan.warnungen.filter((warnung) => !warnung.includes('ohne Eintrag in abbildungen.json')))
  const nachRef = new Map(bilder.map((bild) => [bild.ref, bild]))
  const ergebnis = await abbildungenHinzufuegen(
    materialId,
    plan.eintraege.map((eintrag) => ({
      ref: eintrag.ref,
      dateiName: eintrag.dateiName,
      laden: async () => nachRef.get(eintrag.ref)!.data,
      metadaten: eintrag.metadaten,
      varianteVonRef: eintrag.varianteVonRef,
      herkunft: eintrag.herkunft,
    })),
    { ohneDubletten: true },
  )
  return {
    angelegt: ergebnis.angelegt,
    uebersprungen: [...uebersprungen, ...ergebnis.uebersprungen],
    warnungen,
  }
}
