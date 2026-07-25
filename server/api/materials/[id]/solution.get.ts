import { prepareEditableSolutionStructure } from '../../../services/ai/solutions'
import { requireUser } from '../../../utils/auth'
import { notFound } from '../../../utils/errors'
import { parseOrThrow, uuidSchema } from '../../../utils/validation'

/**
 * Strukturierte KI-Lösung für den Korrektur-Editor:
 * bboxes an erkannte PDF-Lücken ausgerichtet (wie beim Overlay-Zeichnen).
 */
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  const structuredSolution = await prepareEditableSolutionStructure(id)
  if (!structuredSolution) throw notFound('Die strukturierte Lösung')
  return { structuredSolution }
})
