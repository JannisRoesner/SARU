import { readMultipartParts } from '../../../utils/multipart'
import {
  processBulkPdfUpload,
  startBulkPdfUpload,
} from '../../../services/bulk-upload/bulk-upload.service'
import {
  MAX_UEBERSPRUNGEN_LISTE,
  type BulkUebersprungeneDatei,
  type BulkUploadMapping,
} from '../../../services/bulk-upload/types'
import { recordAudit } from '../../../services/audit.service'
import { requireRecht } from '../../../utils/permissions'
import { invalidInput } from '../../../utils/errors'
import { bulkUploadMappingSchema } from '../../../utils/schemas'
import { parseOrThrow } from '../../../utils/validation'
import { createLogger } from '../../../utils/logger'

const log = createLogger('bulk-analyze')

/** Stapel entgegennehmen; Textextraktion und KI laufen im Hintergrund (kein Proxy-504). */
export default defineEventHandler(async (event) => {
  const user = await requireRecht(event, 'anlegen')

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

  // Vom Browser schon aussortierte Dateien (z. B. Einzelbilder außerhalb von Abbildungsordnern).
  const skippedRaw = parts.find((p) => p.name === 'skipped' && !p.filename)?.data.toString()
  let clientSkipped: BulkUebersprungeneDatei[] = []
  if (skippedRaw) {
    try {
      const parsed = JSON.parse(skippedRaw) as unknown
      if (Array.isArray(parsed)) {
        clientSkipped = parsed
          .slice(0, MAX_UEBERSPRUNGEN_LISTE)
          .map((eintrag) => ({
            pfad: String((eintrag as { pfad?: unknown })?.pfad ?? '').slice(0, 500),
            grund: String((eintrag as { grund?: unknown })?.grund ?? '').slice(0, 300),
          }))
          .filter((eintrag) => eintrag.pfad)
      }
    } catch {
      clientSkipped = []
    }
  }

  const result = await startBulkPdfUpload(files, user.id, mapping, clientSkipped)
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
