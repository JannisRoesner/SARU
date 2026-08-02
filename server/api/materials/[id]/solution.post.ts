import { z } from 'zod'
import { enqueueSolutionGeneration } from '../../../services/ai/solutions'
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

  const job = await enqueueSolutionGeneration(id, user.id, options)
  setResponseStatus(event, 202)
  return job
})
