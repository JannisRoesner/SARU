import { z } from 'zod'
import { updateSolutionDraft } from '../../../services/ai/solutions-v2/draft-service'
import { requireEditor } from '../../../utils/auth'
import { parseOrThrow, readZodBody, uuidSchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  const user = await requireEditor(event)
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  const body = await readZodBody(
    event,
    z.object({
      solvedTasks: z.array(z.object({
        taskId: z.string().min(1).max(300),
        answers: z.array(z.object({
          targetId: z.string().min(1).max(300),
          value: z.string().min(1).max(8000),
        })).max(200),
        uncertainties: z.array(z.string().max(1000)).max(20).default([]),
      })).max(100),
    }),
  )
  return updateSolutionDraft(id, user.id, body.solvedTasks)
})

