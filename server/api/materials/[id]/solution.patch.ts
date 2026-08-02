import { z } from 'zod'
import { getMaterialDetail } from '../../../repositories/material.repository'
import { updateSolutionStructure } from '../../../services/ai/solutions'
import { recordAudit } from '../../../services/audit.service'
import { requireEditor } from '../../../utils/auth'
import { parseOrThrow, readZodBody, uuidSchema } from '../../../utils/validation'

const bboxSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    w: z.number().min(0).max(1).optional(),
    h: z.number().min(0).max(1).optional(),
  })
  .nullable()
  .optional()

const answerSchema = z.object({
  id: z.string().min(1).max(80),
  label: z.string().min(1).max(300),
  answer: z.string().min(1).max(8000),
  page: z.number().int().min(1).max(500).nullish(),
  blankIndex: z.number().int().min(0).max(2000).nullish(),
  leftContext: z.string().max(500).nullish(),
  rightContext: z.string().max(500).nullish(),
  bbox: bboxSchema,
  fieldType: z.enum(['luecke', 'freitext']).nullish(),
})

const structuredSolutionSchema = z.object({
  summary: z.string().max(8000).default(''),
  answers: z.array(answerSchema).max(500),
  formFields: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        value: z.string().min(1).max(4000),
      }),
    )
    .max(500)
    .default([]),
  notesForTeacher: z.string().max(8000).nullish(),
  uncertainties: z.string().max(8000).nullish(),
})

/**
 * Speichert korrigierte KI-Antworten und zeichnet das Overlay-PDF neu.
 */
export default defineEventHandler(async (event) => {
  const user = await requireEditor(event)
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  const body = await readZodBody(
    event,
    z.object({
      structuredSolution: structuredSolutionSchema,
      reRender: z.boolean().optional(),
      reviewed: z.boolean().optional(),
    }),
  )

  const result = await updateSolutionStructure(id, user.id, {
    structuredSolution: body.structuredSolution,
    reRender: body.reRender,
    reviewed: body.reviewed,
  })

  await recordAudit(
    {
      userId: user.id,
      action: 'ki.musterloesung_korrigiert',
      entityType: 'material',
      entityId: id,
      details: {
        reRendered: result.reRendered,
        strategie: result.fillStrategy,
        antworten: body.structuredSolution.answers.length,
      },
    },
    event,
  )

  return {
    ...result,
    material: await getMaterialDetail(id),
  }
})
