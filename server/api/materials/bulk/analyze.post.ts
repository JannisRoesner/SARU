import { readMultipartParts } from '../../../utils/multipart'
import { analyzeBulkPdfUpload } from '../../../services/bulk-upload/bulk-upload.service'
import type { BulkUploadMapping } from '../../../services/bulk-upload/types'
import { recordAudit } from '../../../services/audit.service'
import { requireEditor } from '../../../utils/auth'
import { invalidInput } from '../../../utils/errors'
import { bulkUploadMappingSchema } from '../../../utils/schemas'
import { parseOrThrow } from '../../../utils/validation'

/** Stapel hochladen (PDF, Office, ZIP), clustern, Metadaten vorschlagen. */
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

  const result = await analyzeBulkPdfUpload(files, user.id, mapping)

  await recordAudit(
    {
      userId: user.id,
      action: 'material.stapel.analysiert',
      entityType: 'import',
      entityId: result.runId,
      details: { dateien: result.fileCount, buendel: result.clusterCount, ki: result.aiEnabled },
    },
    event,
  )

  setResponseStatus(event, 201)
  return result
})
