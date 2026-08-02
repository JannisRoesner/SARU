import { z } from 'zod'
import { getMaterialDetail } from '../../../repositories/material.repository'
import { generateSolution } from '../../../services/ai/solutions'
import { recordAudit } from '../../../services/audit.service'
import { requireEditor } from '../../../utils/auth'
import { checkRateLimit } from '../../../utils/rate-limit'
import { parseOrThrow, readZodBody, uuidSchema } from '../../../utils/validation'

/**
 * Erzeugt eine dokumentbasierte Musterlösung (DOCX-Lücken / PDF-AcroForm /
 * PDF-Text-Overlay auf Originalseiten). Ergebnis = verknüpftes KI-Material mit Datei.
 */
export default defineEventHandler(async (event) => {
  const user = await requireEditor(event)
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  const options = await readZodBody(
    event,
    z.object({
      variantId: uuidSchema.nullish(),
      userInstructions: z.string().max(4000).nullish(),
      useVision: z.boolean().optional(),
      model: z.string().max(200).optional(),
    }),
  )

  // KI-Aufrufe kosten Geld und Zeit – pro Nutzer begrenzen.
  checkRateLimit(`ki:${user.id}`, {
    limit: 20,
    windowMs: 60 * 60 * 1000,
    message: 'Es wurden zu viele KI-Anfragen gestellt. Bitte später erneut versuchen.',
  })

  const result = await generateSolution(id, user.id, options)
  await recordAudit(
    {
      userId: user.id,
      action: 'ki.musterloesung_erzeugt',
      entityType: 'material',
      entityId: id,
      details: {
        modell: result.model,
        loesung: result.solutionMaterialId,
        strategie: result.fillStrategy,
        hermes: result.hermesUsed,
      },
    },
    event,
  )

  setResponseStatus(event, 201)
  return { ...result, loesung: await getMaterialDetail(result.solutionMaterialId) }
})
