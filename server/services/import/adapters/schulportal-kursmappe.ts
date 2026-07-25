import { unzipSync } from 'fflate'
import type {
  DetectionResult,
  ImportAdapter,
  ImportSource,
  ParsedAttachment,
  ParsedExport,
  ParsedLesson,
} from '../types'

/**
 * Adapter für den Kursmappen-Export aus „mein Unterricht“ im Schulportal Hessen.
 *
 * Nachgewiesene Struktur (aus einem realen Export):
 *   <Kursname>.json         – maßgebliche Datenquelle
 *   Hinweis.txt             – Herkunftsvermerk
 *   YYYYMMDD_<Thema>/       – je Termin ein Ordner mit den Anlagen und
 *                             „1 Thema.txt“, „2 Inhalt.txt“, „3 Hausaufgaben.txt“
 *
 * Die JSON-Datei enthält ein Objekt mit den Schlüsseln
 * `Name`, `Schuljahr`, `Halbjahr`, `Export` und `Termine`.
 * Ein Termin führt `Tag`, `VonStunde`, `BisStunde`, `Stunden`, `Thema`,
 * `Inhalt`, `Hausaufgaben`, `Vertretungslehrkraft` und optional `Anhaenge`.
 */

interface RawTermin {
  Tag?: string | null
  VonStunde?: string | number | null
  BisStunde?: string | number | null
  Stunden?: string | number | null
  Thema?: string | null
  Inhalt?: string | null
  Hausaufgaben?: string | null
  Vertretungslehrkraft?: string | null
  Anhaenge?: string[] | null
}

interface RawKursmappe {
  Name?: string
  Schuljahr?: string
  Halbjahr?: string
  Export?: { Datum?: string; User?: string }
  Termine?: RawTermin[]
}

const TEXT_SIDECARS = new Set(['1 Thema.txt', '2 Inhalt.txt', '3 Hausaufgaben.txt', 'Hinweis.txt'])

function readZip(buffer: Buffer): Record<string, Uint8Array> {
  return unzipSync(new Uint8Array(buffer))
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes)
}

function findManifest(entries: Record<string, Uint8Array>): { name: string; data: RawKursmappe } | null {
  for (const [name, bytes] of Object.entries(entries)) {
    // Die Manifestdatei liegt auf oberster Ebene und endet auf .json.
    if (!name.toLowerCase().endsWith('.json') || name.includes('/')) continue
    try {
      const parsed = JSON.parse(decode(bytes)) as RawKursmappe
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.Termine)) {
        return { name, data: parsed }
      }
    } catch {
      // Keine gültige JSON-Datei – nächste versuchen.
    }
  }
  return null
}

/** „Biologie 09b“ → Fach „Biologie“, Lerngruppe „09b“, Jahrgangsstufe 9. */
export function parseCourseName(rawName: string): {
  subjectName: string | null
  groupName: string | null
  gradeLevel: number | null
} {
  const trimmed = rawName.trim()
  // Die Klassenbezeichnung steht am Ende, z. B. „09b“, „10“, „Q3“, „5a“.
  const match = trimmed.match(/^(.*?)[\s-]+((?:\d{1,2}[a-zA-Z]?)|(?:[EQ]\d))$/)

  if (!match) {
    return { subjectName: trimmed || null, groupName: null, gradeLevel: null }
  }

  const subjectName = match[1]!.trim() || null
  const groupName = match[2]!.trim()
  const gradeMatch = groupName.match(/^(\d{1,2})/)
  const gradeLevel = gradeMatch ? Number(gradeMatch[1]) : null

  return {
    subjectName,
    groupName,
    gradeLevel: gradeLevel && gradeLevel >= 1 && gradeLevel <= 13 ? gradeLevel : null,
  }
}

/** „2024“ → „2024/25“. */
export function normalizeSchoolYear(value: string | undefined | null): string | null {
  if (!value) return null
  const year = Number(String(value).trim().slice(0, 4))
  if (!Number.isFinite(year) || year < 1990 || year > 2100) return null
  return `${year}/${String((year + 1) % 100).padStart(2, '0')}`
}

function toInt(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function cleanText(value: string | null | undefined): string | null {
  if (!value) return null
  const normalized = value.replace(/\r\n/g, '\n').trim()
  return normalized || null
}

function isValidDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
}

export const schulportalKursmappeAdapter: ImportAdapter = {
  id: 'schulportal-hessen-kursmappe',
  version: '1',
  label: 'Schulportal Hessen – Kursmappe („mein Unterricht“)',
  description:
    'Verarbeitet ZIP-Exporte einer Kursmappe mit Terminen, Themen, Inhalten, Hausaufgaben und Anhängen.',
  extensions: ['zip'],

  async detect(source: ImportSource): Promise<DetectionResult> {
    if (!source.fileName.toLowerCase().endsWith('.zip')) {
      return { confidence: 0, reason: 'Es wird eine ZIP-Datei erwartet.' }
    }

    let entries: Record<string, Uint8Array>
    try {
      entries = readZip(source.buffer)
    } catch {
      return { confidence: 0, reason: 'Die Datei konnte nicht als ZIP-Archiv gelesen werden.' }
    }

    const manifest = findManifest(entries)
    if (manifest) {
      const hasHint = Object.keys(entries).some((name) => name === 'Hinweis.txt')
      const termine = manifest.data.Termine?.length ?? 0
      return {
        confidence: hasHint ? 1 : 0.9,
        reason: `Kursmappen-Manifest „${manifest.name}“ mit ${termine} Terminen erkannt.`,
      }
    }

    // Ohne Manifest: an der typischen Ordnerstruktur erkennen.
    const folderMatches = Object.keys(entries).filter((name) => /^\d{8}_[^/]+\/.+/.test(name))
    if (folderMatches.length > 0) {
      return {
        confidence: 0.55,
        reason: `Kein Manifest gefunden, aber ${
          new Set(folderMatches.map((n) => n.split('/')[0])).size
        } Terminordner im Format JJJJMMTT_Thema erkannt.`,
      }
    }

    return { confidence: 0, reason: 'Keine bekannte Schulportal-Struktur erkannt.' }
  },

  async parse(source: ImportSource): Promise<ParsedExport> {
    const entries = readZip(source.buffer)
    const manifest = findManifest(entries)
    const warnings: string[] = []

    const fileIndex = new Map<string, number>()
    for (const [name, bytes] of Object.entries(entries)) {
      if (name.endsWith('/')) continue
      fileIndex.set(name, bytes.length)
    }

    const lessons: ParsedLesson[] = manifest
      ? parseFromManifest(manifest.data, fileIndex, warnings)
      : parseFromFolders(entries, fileIndex, warnings)

    if (!manifest) {
      warnings.push(
        'Der Export enthält keine JSON-Manifestdatei. Die Daten wurden aus der Ordnerstruktur und den Textdateien gelesen; Angaben zu Schulstunden fehlen dadurch.',
      )
    }

    const rawName = manifest?.data.Name?.trim() || deriveNameFromFileName(source.fileName)
    const course = {
      rawName,
      ...parseCourseName(rawName),
      schoolYear: normalizeSchoolYear(manifest?.data.Schuljahr),
      halfYear: toInt(manifest?.data.Halbjahr),
    }

    // Dateien ermitteln, die keiner Stunde zugeordnet wurden.
    const referenced = new Set(lessons.flatMap((l) => l.attachments.map((a) => a.path)))
    const orphanFiles: ParsedAttachment[] = []
    for (const [path, sizeBytes] of fileIndex) {
      const leaf = path.split('/').pop() ?? path
      if (referenced.has(path)) continue
      if (TEXT_SIDECARS.has(leaf)) continue
      if (manifest && path === manifest.name) continue
      orphanFiles.push({ path, fileName: leaf, sizeBytes })
    }

    if (orphanFiles.length > 0) {
      warnings.push(
        `${orphanFiles.length} Datei(en) im Archiv sind keinem Termin zugeordnet und können separat übernommen werden.`,
      )
    }

    return {
      adapterId: schulportalKursmappeAdapter.id,
      adapterVersion: schulportalKursmappeAdapter.version,
      course,
      exportedAt: manifest?.data.Export?.Datum ?? null,
      exportedBy: manifest?.data.Export?.User ?? null,
      lessons,
      orphanFiles,
      warnings,
    }
  },

  async readAttachment(source: ImportSource, path: string): Promise<Buffer | null> {
    const entries = readZip(source.buffer)
    const bytes = entries[path]
    return bytes ? Buffer.from(bytes) : null
  },
}

function parseFromManifest(
  data: RawKursmappe,
  fileIndex: Map<string, number>,
  warnings: string[],
): ParsedLesson[] {
  const lessons: ParsedLesson[] = []
  const seen = new Map<string, number>()

  for (const [index, termin] of (data.Termine ?? []).entries()) {
    const lessonWarnings: string[] = []
    const rawDate = cleanText(termin.Tag)
    const date = rawDate && isValidDate(rawDate) ? rawDate : null

    if (rawDate && !date) {
      lessonWarnings.push(`Das Datum „${rawDate}“ konnte nicht gelesen werden.`)
    }

    const topic = cleanText(termin.Thema) ?? 'Ohne Thema'
    if (!cleanText(termin.Thema)) {
      lessonWarnings.push('Im Export ist kein Thema hinterlegt.')
    }

    // Mehrere Termine am selben Tag erhalten fortlaufende Referenzen.
    const baseRef = `termin:${date ?? `ohne-datum-${index}`}`
    const occurrence = (seen.get(baseRef) ?? 0) + 1
    seen.set(baseRef, occurrence)
    const sourceRef = occurrence > 1 ? `${baseRef}#${occurrence}` : baseRef

    const attachments: ParsedAttachment[] = []
    for (const raw of termin.Anhaenge ?? []) {
      const path = String(raw).replace(/^\.?\//, '')
      const sizeBytes = fileIndex.get(path)
      if (sizeBytes === undefined) {
        lessonWarnings.push(`Die Anlage „${path}“ ist im Archiv nicht enthalten.`)
        continue
      }
      attachments.push({ path, fileName: path.split('/').pop() ?? path, sizeBytes })
    }

    lessons.push({
      sourceRef,
      date,
      periodFrom: toInt(termin.VonStunde),
      periodTo: toInt(termin.BisStunde),
      periods: toInt(termin.Stunden),
      topic,
      content: cleanText(termin.Inhalt),
      homework: cleanText(termin.Hausaufgaben),
      substituteTeacher: cleanText(termin.Vertretungslehrkraft),
      attachments,
      warnings: lessonWarnings,
    })
  }

  if (lessons.length === 0) warnings.push('Der Export enthält keine Termine.')

  // Chronologisch aufsteigend – der Export liefert absteigend.
  return lessons.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
}

/** Ersatzweg, wenn kein Manifest vorhanden ist: aus Ordnern und Textdateien lesen. */
function parseFromFolders(
  entries: Record<string, Uint8Array>,
  fileIndex: Map<string, number>,
  warnings: string[],
): ParsedLesson[] {
  const folders = new Set<string>()
  for (const name of Object.keys(entries)) {
    const match = name.match(/^(\d{8}_[^/]+)\//)
    if (match) folders.add(match[1]!)
  }

  const lessons: ParsedLesson[] = []

  for (const folder of [...folders].sort()) {
    const raw = folder.slice(0, 8)
    const date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
    const valid = isValidDate(date)

    const read = (leaf: string): string | null => {
      const bytes = entries[`${folder}/${leaf}`]
      return bytes ? cleanText(decode(bytes)) : null
    }

    const attachments: ParsedAttachment[] = []
    for (const [path, sizeBytes] of fileIndex) {
      if (!path.startsWith(`${folder}/`)) continue
      const leaf = path.split('/').pop() ?? path
      if (TEXT_SIDECARS.has(leaf)) continue
      attachments.push({ path, fileName: leaf, sizeBytes })
    }

    lessons.push({
      sourceRef: `ordner:${folder}`,
      date: valid ? date : null,
      periodFrom: null,
      periodTo: null,
      periods: null,
      // Der Ordnername enthält den Themen-Slug als Rückfallebene.
      topic: read('1 Thema.txt') ?? folder.slice(9).replace(/_/g, ' '),
      content: read('2 Inhalt.txt'),
      homework: read('3 Hausaufgaben.txt'),
      substituteTeacher: null,
      attachments,
      warnings: valid ? [] : [`Aus dem Ordnernamen „${folder}“ ließ sich kein Datum ableiten.`],
    })
  }

  if (lessons.length === 0) warnings.push('Es konnten keine Terminordner gelesen werden.')
  return lessons
}

function deriveNameFromFileName(fileName: string): string {
  return fileName
    .replace(/\.zip$/i, '')
    .replace(/[-–]\s*Stunden und Anh(ä|ae)nge$/i, '')
    .trim()
}
