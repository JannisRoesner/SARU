import { z } from 'zod'
import { retrySolutionDraftTask } from '../../../../../services/ai/solutions-v2/draft-service'
import { requireEditor } from '../../../../../utils/auth'
import { parseOrThrow, readZodBody, uuidSchema } from '../../../../../utils/validation'

const bboxSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().positive().max(1),
  h: z.number().positive().max(1),
}).refine((box) => box.x + box.w <= 1.001 && box.y + box.h <= 1.001, {
  message: 'Der Zielbereich muss vollständig innerhalb der Seite liegen.',
})

export default defineEventHandler(async (event) => {
  const user = await requireEditor(event)
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  const taskId = parseOrThrow(
    z.string().min(1).max(300),
    decodeURIComponent(getRouterParam(event, 'taskId') ?? ''),
  )
  const body = await readZodBody(
    event,
    z.object({
      kind: z.enum([
        'cloze',
        'free_text',
        'single_choice',
        'multi_choice',
        'matching',
        'table_completion',
        'diagram_labeling',
      ]),
      instruction: z.string().trim().min(1).max(4000),
      candidateValues: z.array(z.string().trim().min(1).max(300)).max(100).optional(),
      redetectTargets: z.boolean().default(false),
      answerSlots: z.array(z.object({
        targetId: z.string().min(1).max(300).optional(),
        page: z.number().int().min(1).max(500),
        bbox: bboxSchema.nullable(),
        promptContext: z.string().max(2000).optional(),
      })).min(1).max(200).optional(),
    }),
  )
  return retrySolutionDraftTask(id, user.id, taskId, body)
})
