import { readMultipartParts } from '../../../utils/multipart'
import {
  processBulkPdfUpload,
  startBulkPdfUpload,
} from '../../../services/bulk-upload/bulk-upload.service'
import type { BulkUploadMapping } from '../../../services/bulk-upload/types'
import { recordAudit } from '../../../services/audit.service'
import { requireEditor } from '../../../utils/auth'
import { invalidInput } from '../../../utils/errors'
import { bulkUploadMappingSchema } from '../../../utils/schemas'
import { parseOrThrow } from '../../../utils/validation'
import { createLogger } from '../../../utils/logger'

const log = createLogger('bulk-analyze')

/** Stapel entgegennehmen; Textextraktion und KI laufen im Hintergrund (kein Proxy-504). */
export default defineEventHandler(async (event) => {
  const user = await requireEditor(event)

  const parts = await readMultipartParts(event)
  if (!parts?.length) throw invalidInput('Es wurden keine Dateien übermittelt.')

  const fileParts = parts.filter((part) => part.filename && part.data?.length)
  if (!fileParts.length) throw invalidInput('Bitte mindestens eine Datei auswählen.')

  const pathsRaw = parts.find((p) => p.name === 'relativePaths' && !p.filename)?.data.toString()
  let relativePaths: string[] = []
  if (pathsRaw) {
    try {
      const parsed = JSON.parse(pathsRaw) as unknown
      if (Array.isArray(parsed)) relativePaths = parsed.map((entry) => String(entry))
    } catch {
      relativePaths = []
    }
  }

  const files = fileParts.map((part, index) => ({
    buffer: Buffer.from(part.data),
    fileName: part.filename!,
    relativePath: relativePaths[index] || part.filename!,
  }))

  const mappingRaw = parts.find((p) => p.name === 'mapping' && !p.filename)?.data.toString()
  let mapping: BulkUploadMapping = {}
  if (mappingRaw) {
    try {
      mapping = parseOrThrow(bulkUploadMappingSchema, JSON.parse(mappingRaw))
    } catch (error) {
      if (error && typeof error === 'object' && 'statusCode' in error) throw error
      throw invalidInput('Die gemeinsame Zuordnung ist ungültig.')
    }
  }

  const result = await startBulkPdfUpload(files, user.id, mapping)
  void processBulkPdfUpload(result.runId).catch((error) => {
    log.warn('Hintergrund-Analyse des Stapels fehlgeschlagen', { runId: result.runId, error })
  })

  await recordAudit(
    {
      userId: user.id,
      action: 'material.stapel.gestartet',
      entityType: 'import',
      entityId: result.runId,
      details: { dateien: result.fileCount, ki: result.aiEnabled },
    },
    event,
  )

  setResponseStatus(event, 202)
  return result
})
