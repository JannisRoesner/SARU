import { readMultipartFormData } from 'h3'
import { analyzeBulkPdfUpload } from '../../../services/bulk-upload/bulk-upload.service'
import type { BulkUploadMapping } from '../../../services/bulk-upload/types'
import { recordAudit } from '../../../services/audit.service'
import { requireEditor } from '../../../utils/auth'
import { invalidInput } from '../../../utils/errors'
import { bulkUploadMappingSchema } from '../../../utils/schemas'
import { parseOrThrow } from '../../../utils/validation'

/** PDF-Stapel hochladen, Text extrahieren, Metadaten vorschlagen. */
export default defineEventHandler(async (event) => {
  const user = await requireEditor(event)

  const parts = await readMultipartFormData(event)
  if (!parts?.length) throw invalidInput('Es wurden keine Dateien übermittelt.')

  const files = parts
    .filter((part) => part.filename && part.data?.length)
    .map((part) => ({
      buffer: Buffer.from(part.data),
      fileName: part.filename!,
    }))

  if (!files.length) throw invalidInput('Bitte mindestens eine PDF-Datei auswählen.')

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

  const result = await analyzeBulkPdfUpload(files, user.id, mapping)

  await recordAudit(
    {
      userId: user.id,
      action: 'material.stapel.analysiert',
      entityType: 'import',
      entityId: result.runId,
      details: { dateien: result.fileCount, ki: result.aiEnabled },
    },
    event,
  )

  setResponseStatus(event, 201)
  return result
})
