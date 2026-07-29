import { readMultipartFormData } from 'h3'
import { analyzeAiMaterialCreate } from '../../../services/ai/material-create'
import { recordAudit } from '../../../services/audit.service'
import { requireEditor } from '../../../utils/auth'
import { invalidInput } from '../../../utils/errors'
import { normalizeGradeLevel } from '#shared/utils/jahrgangsstufen'
import type { MaterialType } from '#shared/types/domain'

/** Einzeldatei analysieren: Text einmal extrahieren, Metadaten vorschlagen. */
export default defineEventHandler(async (event) => {
  const user = await requireEditor(event)

  const parts = await readMultipartFormData(event)
  if (!parts?.length) throw invalidInput('Es wurde keine Datei übermittelt.')

  const filePart = parts.find((part) => part.filename && part.data?.length)
  if (!filePart?.filename) throw invalidInput('Bitte eine Datei auswählen.')

  const contextRaw = parts.find((p) => p.name === 'context' && !p.filename)?.data.toString()
  let context: {
    subjectId?: string | null
    subjectName?: string | null
    gradeLevel?: ReturnType<typeof normalizeGradeLevel>
    schoolForm?: string | null
    defaultMaterialType?: MaterialType
  } = {}

  if (contextRaw) {
    try {
      const parsed = JSON.parse(contextRaw) as Record<string, unknown>
      context = {
        subjectId: typeof parsed.subjectId === 'string' ? parsed.subjectId : null,
        subjectName: typeof parsed.subjectName === 'string' ? parsed.subjectName : null,
        gradeLevel: normalizeGradeLevel(parsed.gradeLevel as never) ?? null,
        schoolForm: typeof parsed.schoolForm === 'string' ? parsed.schoolForm : null,
        defaultMaterialType:
          typeof parsed.defaultMaterialType === 'string'
            ? (parsed.defaultMaterialType as MaterialType)
            : 'arbeitsblatt',
      }
    } catch {
      throw invalidInput('Der Analyse-Kontext ist ungültig.')
    }
  }

  const result = await analyzeAiMaterialCreate(
    { buffer: Buffer.from(filePart.data), fileName: filePart.filename },
    user.id,
    context,
  )

  await recordAudit(
    {
      userId: user.id,
      action: 'material.ki.analysiert',
      entityType: 'import',
      entityId: result.analyzeId,
      details: {
        datei: result.fileName,
        ki: result.aiEnabled,
        methode: result.extractionMethod,
      },
    },
    event,
  )

  setResponseStatus(event, 201)
  return result
})
