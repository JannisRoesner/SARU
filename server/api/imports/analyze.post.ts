import { readMultipartFormData } from 'h3'
import { analyzeImport } from '../../services/import/importer'
import { getUploadSettings } from '../../services/settings.service'
import { recordAudit } from '../../services/audit.service'
import { requireEditor } from '../../utils/auth'
import { invalidInput } from '../../utils/errors'
import { formatBytes } from '../../services/storage.service'

/** Schritt 1–3 des Assistenten: Datei annehmen, Format erkennen, Vorschau erzeugen. */
export default defineEventHandler(async (event) => {
  const user = await requireEditor(event)

  const parts = await readMultipartFormData(event)
  const file = parts?.find((part) => part.filename && part.data?.length)
  if (!file) throw invalidInput('Es wurde keine Exportdatei übermittelt.')

  const { maxImportBytes } = await getUploadSettings()
  if (file.data.length > maxImportBytes) {
    throw invalidInput(
      `Die Exportdatei ist mit ${formatBytes(file.data.length)} größer als das Limit von ${formatBytes(maxImportBytes)}.`,
    )
  }

  const adapterId = parts?.find((p) => p.name === 'adapterId' && !p.filename)?.data.toString()

  const analysis = await analyzeImport(
    { buffer: Buffer.from(file.data), fileName: file.filename! },
    user.id,
    { adapterId: adapterId || undefined },
  )

  await recordAudit(
    {
      userId: user.id,
      action: 'import.analysiert',
      entityType: 'import',
      entityId: analysis.runId,
      details: { datei: file.filename, adapter: analysis.adapterId },
    },
    event,
  )

  setResponseStatus(event, 201)
  return analysis
})
