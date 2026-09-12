import { unzipSync } from 'fflate'
import { isAiMaterialFileName } from '#shared/utils/ai-material-formats'
import { invalidInput } from '../../utils/errors'
import { extensionOf, sanitizeFileName } from '../storage.service'
import type { BulkUploadInputFile } from './types'

const SKIP_ENTRY = /(^|\/)(\.ds_store|thumbs\.db|__macosx)(\/|$)/i

export interface ExpandedBulkFiles {
  files: BulkUploadInputFile[]
  archiveNames: string[]
  skipped: string[]
}

function normalizeEntryPath(entryName: string): string | null {
  const path = entryName.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!path || path.endsWith('/')) return null
  if (path.split('/').includes('..')) return null
  if (SKIP_ENTRY.test(path)) return null
  return path
}

/** Entpackt ZIP-Container; lose Dateien bleiben unverändert. */
export function expandBulkArchives(files: BulkUploadInputFile[]): ExpandedBulkFiles {
  const out: BulkUploadInputFile[] = []
  const archiveNames: string[] = []
  const skipped: string[] = []

  for (const file of files) {
    const storedName = file.relativePath || file.fileName
    const extension = extensionOf(sanitizeFileName(storedName))
    if (extension !== 'zip') {
      out.push(file)
      continue
    }

    archiveNames.push(sanitizeFileName(file.fileName))
    let entries: Record<string, Uint8Array>
    try {
      entries = unzipSync(new Uint8Array(file.buffer))
    } catch {
      throw invalidInput(`Die ZIP-Datei „${sanitizeFileName(file.fileName)}“ konnte nicht gelesen werden.`)
    }

    for (const [entryName, data] of Object.entries(entries)) {
      const path = normalizeEntryPath(entryName)
      if (!path) continue
      if (!isAiMaterialFileName(path)) {
        skipped.push(path)
        continue
      }
      if (!data?.length) {
        skipped.push(path)
        continue
      }
      out.push({
        buffer: Buffer.from(data),
        fileName: path.split('/').pop() ?? path,
        relativePath: path,
      })
    }
  }

  return { files: out, archiveNames, skipped }
}
