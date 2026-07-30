import { createReadStream } from 'node:fs'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, normalize, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileTypeFromBuffer } from 'file-type'
import { appError } from '../utils/errors'
import { sha256 } from '../utils/crypto'
import { createLogger } from '../utils/logger'
import { getUploadSettings } from './settings.service'

const log = createLogger('storage')

export interface AllowedType {
  extensions: string[]
  mimeTypes: string[]
  /** Wird der Inhalt zuverlässig durch Magic Bytes erkannt? */
  sniffable: boolean
  label: string
}

/**
 * Positivliste erlaubter Dateitypen. Alles, was hier nicht steht, wird abgelehnt –
 * insbesondere ausführbare Dateien, Skripte und HTML (XSS über Downloads).
 */
export const ALLOWED_TYPES: AllowedType[] = [
  { label: 'PDF', extensions: ['pdf'], mimeTypes: ['application/pdf'], sniffable: true },
  {
    label: 'Word-Dokument',
    extensions: ['docx'],
    mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    sniffable: true,
  },
  { label: 'Word-Dokument (alt)', extensions: ['doc'], mimeTypes: ['application/msword'], sniffable: true },
  {
    label: 'Präsentation',
    extensions: ['pptx'],
    mimeTypes: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    sniffable: true,
  },
  {
    label: 'Präsentation (alt)',
    extensions: ['ppt'],
    mimeTypes: ['application/vnd.ms-powerpoint'],
    sniffable: true,
  },
  {
    label: 'Tabelle',
    extensions: ['xlsx'],
    mimeTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    sniffable: true,
  },
  {
    label: 'Tabelle (alt)',
    extensions: ['xls'],
    mimeTypes: ['application/vnd.ms-excel'],
    sniffable: true,
  },
  {
    label: 'OpenDocument',
    extensions: ['odt', 'odp', 'ods'],
    mimeTypes: [
      'application/vnd.oasis.opendocument.text',
      'application/vnd.oasis.opendocument.presentation',
      'application/vnd.oasis.opendocument.spreadsheet',
    ],
    sniffable: true,
  },
  {
    label: 'Bild',
    extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif'],
    mimeTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'],
    sniffable: true,
  },
  { label: 'SVG-Grafik', extensions: ['svg'], mimeTypes: ['image/svg+xml'], sniffable: false },
  {
    label: 'Audio',
    extensions: ['mp3', 'm4a', 'ogg', 'wav'],
    mimeTypes: ['audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/x-wav'],
    sniffable: true,
  },
  {
    label: 'Video',
    extensions: ['mp4', 'webm', 'mov'],
    mimeTypes: ['video/mp4', 'video/webm', 'video/quicktime'],
    sniffable: true,
  },
  {
    label: 'Textdatei',
    extensions: ['txt', 'md', 'csv'],
    mimeTypes: ['text/plain', 'text/markdown', 'text/csv'],
    sniffable: false,
  },
  { label: 'ZIP-Archiv', extensions: ['zip'], mimeTypes: ['application/zip'], sniffable: true },
  { label: 'GeoGebra', extensions: ['ggb'], mimeTypes: ['application/zip'], sniffable: true },
  {
    label: 'Kursarchiv',
    extensions: ['mbz', 'imscc'],
    mimeTypes: ['application/gzip', 'application/x-gzip', 'application/zip'],
    sniffable: false,
  },
  {
    label: 'H5P-Paket',
    extensions: ['h5p'],
    mimeTypes: ['application/zip'],
    sniffable: false,
  },
]

export function uploadRoot(): string {
  const configured = process.env.NUXT_UPLOAD_DIR ?? './data/uploads'
  return isAbsolute(configured) ? configured : resolve(process.cwd(), configured)
}

export async function ensureUploadRoot(): Promise<void> {
  await mkdir(uploadRoot(), { recursive: true })
  await mkdir(join(uploadRoot(), '.staging'), { recursive: true })
}

/**
 * Löst einen gespeicherten Schlüssel in einen absoluten Pfad auf und stellt sicher,
 * dass er das Upload-Verzeichnis nicht verlässt (Schutz vor Path Traversal).
 */
export function resolveStoragePath(storageKey: string): string {
  const root = uploadRoot()
  const target = resolve(root, normalize(storageKey).replace(/^([/\\])+/, ''))
  if (target !== root && !target.startsWith(root + sep)) {
    throw appError('KEINE_BERECHTIGUNG', 'Ungültiger Dateipfad.')
  }
  return target
}

/** Entfernt Pfadanteile und gefährliche Zeichen aus einem hochgeladenen Dateinamen. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? 'datei'
  const cleaned = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F<>:"|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return (cleaned || 'datei').slice(0, 180)
}

export function extensionOf(fileName: string): string {
  return extname(fileName).replace('.', '').toLowerCase()
}

export function findAllowedType(extension: string): AllowedType | undefined {
  return ALLOWED_TYPES.find((t) => t.extensions.includes(extension))
}

export interface ValidatedUpload {
  fileName: string
  extension: string
  mimeType: string
  sizeBytes: number
  checksum: string
}

/**
 * Prüft Größe, Endung und – wo möglich – den tatsächlichen Dateiinhalt.
 * Der vom Browser gemeldete MIME-Typ wird bewusst nicht vertraut.
 */
export async function validateUpload(
  buffer: Buffer,
  originalName: string,
): Promise<ValidatedUpload> {
  const settings = await getUploadSettings()
  const fileName = sanitizeFileName(originalName)
  const extension = extensionOf(fileName)

  if (buffer.length === 0) {
    throw appError('UNGUELTIGE_EINGABE', `Die Datei „${fileName}“ ist leer.`)
  }
  if (buffer.length > settings.maxBytes) {
    throw appError(
      'DATEI_ZU_GROSS',
      `Die Datei „${fileName}“ ist ${formatBytes(buffer.length)} groß. Erlaubt sind höchstens ${formatBytes(settings.maxBytes)}.`,
    )
  }

  const allowedExtensions =
    settings.allowedExtensions.length > 0
      ? settings.allowedExtensions
      : ALLOWED_TYPES.flatMap((t) => t.extensions)

  if (!extension || !allowedExtensions.includes(extension)) {
    throw appError(
      'DATEITYP_NICHT_ERLAUBT',
      `Dateien vom Typ „${extension || 'ohne Endung'}“ sind nicht zugelassen.`,
    )
  }

  const declared = findAllowedType(extension)
  const sniffed = await fileTypeFromBuffer(buffer)

  if (declared?.sniffable) {
    if (!sniffed) {
      throw appError(
        'DATEITYP_NICHT_ERLAUBT',
        `Der Inhalt von „${fileName}“ passt nicht zur Dateiendung.`,
      )
    }
    // Office- und GeoGebra-Dateien sind ZIP-Container; die Erkennung meldet je
    // nach Datei den Container- oder den spezifischen Typ.
    const acceptable = new Set([...declared.mimeTypes, 'application/zip', 'application/x-cfb'])
    if (!acceptable.has(sniffed.mime)) {
      throw appError(
        'DATEITYP_NICHT_ERLAUBT',
        `Der Inhalt von „${fileName}“ (${sniffed.mime}) passt nicht zur Endung „.${extension}“.`,
      )
    }
  }

  return {
    fileName,
    extension,
    mimeType: sniffed?.mime ?? declared?.mimeTypes[0] ?? 'application/octet-stream',
    sizeBytes: buffer.length,
    checksum: sha256(buffer),
  }
}

export interface StoredFile extends ValidatedUpload {
  storageKey: string
}

/** Schreibt die Datei unter einem zufälligen Namen; der Klarname bleibt nur Metadatum. */
export async function storeFile(buffer: Buffer, originalName: string): Promise<StoredFile> {
  const validated = await validateUpload(buffer, originalName)
  const now = new Date()
  const storageKey = join(
    String(now.getFullYear()),
    String(now.getMonth() + 1).padStart(2, '0'),
    `${randomUUID()}.${validated.extension}`,
  ).replaceAll(sep, '/')

  const target = resolveStoragePath(storageKey)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, buffer, { mode: 0o640 })

  log.debug('Datei gespeichert', { storageKey, sizeBytes: validated.sizeBytes })
  return { ...validated, storageKey }
}

/** Ablage für Importdateien, die erst nach Bestätigung übernommen werden. */
export async function storeStagingFile(buffer: Buffer, originalName: string): Promise<string> {
  const key = `.staging/${randomUUID()}-${sanitizeFileName(originalName)}`
  const target = resolveStoragePath(key)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, buffer, { mode: 0o640 })
  return key
}

export async function deleteFile(storageKey: string): Promise<void> {
  try {
    await rm(resolveStoragePath(storageKey), { force: true })
  } catch (error) {
    log.warn('Datei konnte nicht gelöscht werden', { storageKey, error })
  }
}

export async function fileExists(storageKey: string): Promise<boolean> {
  try {
    return (await stat(resolveStoragePath(storageKey))).isFile()
  } catch {
    return false
  }
}

/** Datei-mtime (ISO), z. B. für WOPI LastModifiedTime. */
export async function fileModifiedAt(storageKey: string): Promise<Date | null> {
  try {
    const info = await stat(resolveStoragePath(storageKey))
    return info.isFile() ? info.mtime : null
  } catch {
    return null
  }
}

/**
 * Überschreibt eine bestehende Datei (WOPI PutFile). Keine neue storageKey,
 * Metadaten (Größe/Checksum) liefert der Rückgabewert.
 */
export async function overwriteFile(
  storageKey: string,
  buffer: Buffer,
): Promise<{ sizeBytes: number; checksum: string; modifiedAt: Date }> {
  if (buffer.length === 0) {
    throw appError('UNGUELTIGE_EINGABE', 'Die Datei ist leer.')
  }
  const settings = await getUploadSettings()
  if (buffer.length > settings.maxBytes) {
    throw appError(
      'DATEI_ZU_GROSS',
      `Die Datei ist ${formatBytes(buffer.length)} groß. Erlaubt sind höchstens ${formatBytes(settings.maxBytes)}.`,
    )
  }
  const target = resolveStoragePath(storageKey)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, buffer, { mode: 0o640 })
  const modifiedAt = (await stat(target)).mtime
  log.debug('Datei überschrieben', { storageKey, sizeBytes: buffer.length })
  return {
    sizeBytes: buffer.length,
    checksum: sha256(buffer),
    modifiedAt,
  }
}

export function readFileStream(storageKey: string) {
  return createReadStream(resolveStoragePath(storageKey))
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`
}

/**
 * Erzwingt einen Download statt einer Inline-Darstellung für Typen, bei denen
 * eine Inline-Anzeige zu Script-Ausführung im Origin führen könnte.
 */
export function isInlineSafe(mimeType: string | null | undefined): boolean {
  if (!mimeType) return false
  return (
    mimeType === 'application/pdf' ||
    (mimeType.startsWith('image/') && mimeType !== 'image/svg+xml') ||
    mimeType.startsWith('audio/') ||
    mimeType.startsWith('video/') ||
    mimeType === 'text/plain'
  )
}
