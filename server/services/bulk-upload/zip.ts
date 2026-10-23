import { unzipSync } from 'fflate'
import { isBulkDocumentFileName } from '#shared/utils/ai-material-formats'
import { invalidInput } from '../../utils/errors'
import { extensionOf, formatBytes, sanitizeFileName } from '../storage.service'
import { MAX_BULK_FILES, type BulkUploadInputFile } from './types'

const SKIP_ENTRY = /(^|\/)(\.ds_store|thumbs\.db|__macosx)(\/|$)/i

export interface ExpandedBulkFiles {
  files: BulkUploadInputFile[]
  archiveNames: string[]
  skipped: string[]
  /** Summe der (entpackten) Dokumentgrößen. */
  totalBytes: number
}

export interface ExpandBulkLimits {
  /** Obergrenze für die entpackte Gesamtgröße des Stapels. */
  maxTotalBytes: number
  maxFiles?: number
}

function normalizeEntryPath(entryName: string): string | null {
  const path = entryName.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!path || path.endsWith('/')) return null
  if (path.split('/').includes('..')) return null
  if (SKIP_ENTRY.test(path)) return null
  return path
}

function tooLarge(totalBytes: number, maxTotalBytes: number) {
  return invalidInput(
    `Das Paket ist entpackt mit ${formatBytes(totalBytes)} größer als das Limit von ${formatBytes(maxTotalBytes)}.`,
  )
}

function tooMany(maxFiles: number) {
  return invalidInput(`Maximal ${maxFiles.toLocaleString('de-DE')} Dateien pro Stapel sind erlaubt.`)
}

/**
 * Entpackt ZIP-Container; lose Dateien bleiben unverändert.
 *
 * Größe und Anzahl werden aus dem ZIP-Verzeichnis geprüft, bevor etwas entpackt
 * wird (Schutz gegen ZIP-Bomben). fflate entpackt jeden Eintrag in einen Puffer
 * der angegebenen Originalgröße, ein gefälschter Eintrag kann also nicht mehr
 * Speicher belegen als angekündigt.
 */
export function expandBulkArchives(
  files: BulkUploadInputFile[],
  { maxTotalBytes, maxFiles = MAX_BULK_FILES }: ExpandBulkLimits,
): ExpandedBulkFiles {
  const out: BulkUploadInputFile[] = []
  const archiveNames: string[] = []
  const skipped: string[] = []
  let totalBytes = 0
  let fileCount = 0

  const count = (bytes: number) => {
    totalBytes += bytes
    fileCount += 1
    if (totalBytes > maxTotalBytes) throw tooLarge(totalBytes, maxTotalBytes)
    if (fileCount > maxFiles) throw tooMany(maxFiles)
  }

  for (const file of files) {
    const storedName = file.relativePath || file.fileName
    const extension = extensionOf(sanitizeFileName(storedName))
    if (extension !== 'zip') {
      count(file.buffer.length)
      out.push(file)
      continue
    }

    archiveNames.push(sanitizeFileName(file.fileName))
    let entries: Record<string, Uint8Array>
    try {
      entries = unzipSync(new Uint8Array(file.buffer), {
        filter: (entry) => {
          const path = normalizeEntryPath(entry.name)
          if (!path) return false
          // Unkomprimierte Einträge werden 1:1 aus dem Archiv kopiert.
          const bytes = entry.compression === 0 ? entry.size : entry.originalSize
          if (!isBulkDocumentFileName(path) || !bytes) {
            skipped.push(path)
            return false
          }
          count(bytes)
          return true
        },
      })
    } catch (error) {
      if (error && typeof error === 'object' && 'statusCode' in error) throw error
      throw invalidInput(`Die ZIP-Datei „${sanitizeFileName(file.fileName)}“ konnte nicht gelesen werden.`)
    }

    for (const [entryName, data] of Object.entries(entries)) {
      const path = normalizeEntryPath(entryName)!
      out.push({
        buffer: Buffer.from(data),
        fileName: path.split('/').pop() ?? path,
        relativePath: path,
      })
    }
  }

  return { files: out, archiveNames, skipped, totalBytes }
}
