import type { AiSettings } from '../../settings.service'
import { chatCompletion, type ChatPart } from '../client'
import { maximumWeightAssignment } from '../solutions/solvers/bipartite-matching'
import { buildTaskSolverPrompt, buildSemanticVerifierPrompt, SEMANTIC_VERIFIER_SYSTEM_PROMPT, TASK_SOLVER_SYSTEM_PROMPT } from './prompts'
import { parseSemanticVerdict, parseTaskSolutionJson, type ParsedTaskSolution } from './model-json'
import { validateSolutionPlanV2 } from './plan-validator'
import { projectSolutionForRenderV2, validateRenderManifestV2 } from './renderer-projection'
import { validateSolvedTaskV2 } from './solution-validator'
import type {
  CanonicalPlanBuildV2,
  PipelineV2Result,
  QualityIssueV2,
  QualityReportV2,
  SolvedTask,
  TaskSpec,
} from './types'

export interface PageVisionPart {
  page: number
  part: ChatPart
}

interface CompletionTotals {
  model: string
  inputTokens: number
  outputTokens: number
}

const TASK_SOLUTION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['taskId', 'answers', 'uncertainties'],
  properties: {
    taskId: { type: 'string' },
    answers: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['targetId', 'value', 'rankings'],
        properties: {
          targetId: { type: 'string' },
          value: { type: 'string' },
          rankings: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['candidateId', 'score'],
              properties: {
                candidateId: { type: 'string' },
                score: { type: 'number', minimum: 0, maximum: 1 },
              },
            },
          },
        },
      },
    },
    uncertainties: { type: 'array', items: { type: 'string' } },
  },
}

const SEMANTIC_VERDICT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['taskId', 'verdict', 'issues'],
  properties: {
    taskId: { type: 'string' },
    verdict: { type: 'string', enum: ['pass', 'repair', 'uncertain'] },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['targetId', 'code', 'message'],
        properties: {
          targetId: { type: ['string', 'null'] },
          code: { type: 'string' },
          message: { type: 'string' },
        },
      },
    },
  },
}

function blocking(issues: QualityIssueV2[]): boolean {
  return issues.some((issue) => issue.blocking)
}

function applyCandidateRankings(task: TaskSpec, parsed: ParsedTaskSolution): SolvedTask {
  const bank = task.candidateBank
  if (
    bank?.reusePolicy !== 'once' ||
    bank.candidates.length !== task.answerSlots.length ||
    parsed.parsedAnswers.length !== task.answerSlots.length
  ) {
    return parsed
  }
  const complete = parsed.parsedAnswers.every((answer) => {
    const ids = new Set(answer.rankings.map((ranking) => ranking.candidateId))
    return bank.candidates.every((candidate) => ids.has(candidate.id))
  })
  if (!complete) return parsed

  const scores = task.answerSlots.map((slot) => {
    const answer = parsed.parsedAnswers.find((candidate) => candidate.targetId === slot.targetId)
    return bank.candidates.map(
      (candidate) => answer?.rankings.find((ranking) => ranking.candidateId === candidate.id)?.score ?? 0,
    )
  })
  const assignment = maximumWeightAssignment(scores).assignment
  return {
    taskId: task.taskId,
    answers: task.answerSlots.map((slot, index) => ({
      targetId: slot.targetId,
      value: bank.candidates[assignment[index] ?? -1]?.value ?? '',
    })),
    uncertainties: parsed.uncertainties,
  }
}

function requiresCompleteRankings(task: TaskSpec, parsed: ParsedTaskSolution): boolean {
  const bank = task.candidateBank
  if (bank?.reusePolicy !== 'once' || bank.candidates.length !== task.answerSlots.length) return false
  return !parsed.parsedAnswers.every((answer) => {
    const ids = new Set(answer.rankings.map((ranking) => ranking.candidateId))
    return bank.candidates.every((candidate) => ids.has(candidate.id))
  })
}

async function solveTask(
  task: TaskSpec,
  settings: AiSettings,
  model: string,
  pagePart: ChatPart | undefined,
  totals: CompletionTotals,
  repairIssues: string[] = [],
): Promise<{ solved: SolvedTask | null; issues: QualityIssueV2[] }> {
  let lastIssues: QualityIssueV2[] = []
  for (let attempt = 0; attempt < 2; attempt++) {
    let completion
    try {
      completion = await chatCompletion(
        settings,
        [
          { role: 'system', parts: [{ type: 'text', text: TASK_SOLVER_SYSTEM_PROMPT }] },
          {
            role: 'user',
            parts: [
              { type: 'text', text: buildTaskSolverPrompt(task, { repairIssues: attempt > 0 ? [...repairIssues, ...lastIssues.map((issue) => issue.message)] : repairIssues }) },
              ...(pagePart ? [pagePart] : []),
            ],
          },
        ],
        {
          model,
          temperature: 0,
          maxOutputTokens: Math.min(6000, Math.max(900, 350 + task.answerSlots.length * 180)),
          jsonMode: true,
          jsonSchema: { name: 'solution_task_v2', schema: TASK_SOLUTION_SCHEMA },
        },
      )
    } catch (error) {
      lastIssues = [{
        code: 'MODEL_OUTPUT_INCOMPLETE',
        message: error instanceof Error
          ? `Das Modell lieferte keine verwertbare Antwort: ${error.message}`
          : 'Das Modell lieferte keine verwertbare Antwort.',
        taskId: task.taskId,
        blocking: true,
      }]
      continue
    }
    totals.model = completion.model
    totals.inputTokens += completion.inputTokens ?? 0
    totals.outputTokens += completion.outputTokens ?? 0
    if (completion.finishReason === 'length') {
      lastIssues = [{
        code: 'MODEL_OUTPUT_INCOMPLETE',
        message: 'Die Modellantwort wurde wegen des Tokenlimits abgeschnitten.',
        taskId: task.taskId,
        blocking: true,
      }]
      continue
    }
    const parsed = parseTaskSolutionJson(completion.text)
    if (!parsed) {
      lastIssues = [{
        code: 'MODEL_OUTPUT_INCOMPLETE',
        message: 'Das Modell hat kein vollständiges, schema-konformes JSON geliefert.',
        taskId: task.taskId,
        blocking: true,
      }]
      continue
    }
    if (requiresCompleteRankings(task, parsed)) {
      lastIssues = [{
        code: 'CANDIDATE_RANKINGS_INCOMPLETE',
        message: 'Für die bijektive Lückenzuordnung fehlen vollständige Kandidatenbewertungen.',
        taskId: task.taskId,
        blocking: true,
      }]
      continue
    }
    const solved = applyCandidateRankings(task, parsed)
    lastIssues = validateSolvedTaskV2(task, solved)
    if (!blocking(lastIssues)) return { solved, issues: lastIssues }
  }
  return { solved: null, issues: lastIssues }
}

async function verifyTask(
  task: TaskSpec,
  solved: SolvedTask,
  settings: AiSettings,
  model: string,
  pagePart: ChatPart | undefined,
  totals: CompletionTotals,
  requireVision: boolean,
): Promise<{ verdict: 'pass' | 'repair' | 'uncertain'; issues: QualityIssueV2[] }> {
  if (!pagePart && requireVision) {
    return {
      verdict: 'uncertain',
      issues: [{
        code: 'VISION_UNAVAILABLE',
        message: 'Für die verpflichtende semantische Sichtprüfung war kein Seitenbild verfügbar.',
        taskId: task.taskId,
        blocking: true,
      }],
    }
  }
  let completion
  try {
    completion = await chatCompletion(
      settings,
      [
        { role: 'system', parts: [{ type: 'text', text: SEMANTIC_VERIFIER_SYSTEM_PROMPT }] },
        {
          role: 'user',
          parts: [
            { type: 'text', text: buildSemanticVerifierPrompt(task, solved) },
            ...(pagePart ? [pagePart] : []),
          ],
        },
      ],
      {
        model,
        temperature: 0,
        maxOutputTokens: 1200,
        jsonMode: true,
        jsonSchema: { name: 'solution_semantic_verdict_v2', schema: SEMANTIC_VERDICT_SCHEMA },
      },
    )
  } catch (error) {
    return {
      verdict: 'uncertain',
      issues: [{
        code: 'SEMANTIC_QA_UNCERTAIN',
        message: error instanceof Error
          ? `Die semantische Prüfung konnte nicht gelesen werden: ${error.message}`
          : 'Die semantische Prüfung konnte nicht gelesen werden.',
        taskId: task.taskId,
        blocking: true,
      }],
    }
  }
  totals.model = completion.model
  totals.inputTokens += completion.inputTokens ?? 0
  totals.outputTokens += completion.outputTokens ?? 0
  const verdict = completion.finishReason === 'length' ? null : parseSemanticVerdict(completion.text)
  if (!verdict || verdict.taskId !== task.taskId) {
    return {
      verdict: 'uncertain',
      issues: [{
        code: 'SEMANTIC_QA_UNCERTAIN',
        message: 'Die semantische Prüfung lieferte kein verlässliches Ergebnis.',
        taskId: task.taskId,
        blocking: true,
      }],
    }
  }
  return {
    verdict: verdict.verdict,
    issues: verdict.issues.map((issue) => ({
      code: issue.code,
      message: issue.message,
      taskId: task.taskId,
      targetIds: issue.targetId ? [issue.targetId] : undefined,
      blocking: verdict.verdict !== 'pass',
    })),
  }
}

function emptyReport(planIssues: QualityIssueV2[]): QualityReportV2 {
  return {
    plan: blocking(planIssues) ? 'failed' : 'passed',
    structure: 'failed',
    semantic: 'unavailable',
    render: 'unavailable',
    issues: planIssues,
  }
}

export async function runSolutionPipelineV2(args: {
  build: CanonicalPlanBuildV2
  settings: AiSettings
  model: string
  pageParts: PageVisionPart[]
  /** Bei visuellen Quelldokumenten ist ein Seitenbild für jede Semantikprüfung Pflicht. */
  requireVision?: boolean
}): Promise<PipelineV2Result> {
  const planIssues = validateSolutionPlanV2(args.build.plan)
  const totals: CompletionTotals = { model: args.model, inputTokens: 0, outputTokens: 0 }
  if (blocking(planIssues)) {
    const projection = projectSolutionForRenderV2({
      plan: args.build.plan,
      rendererTasks: args.build.rendererTasks,
      solvedTasks: [],
    })
    return {
      plan: args.build.plan,
      solvedTasks: [],
      projection,
      qualityReport: emptyReport(planIssues),
      model: totals.model,
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
    }
  }

  const solvedTasks: SolvedTask[] = []
  const structuralIssues: QualityIssueV2[] = []
  const semanticIssues: QualityIssueV2[] = []
  for (const task of args.build.plan.tasks) {
    const pagePart = args.pageParts.find((candidate) => candidate.page === task.page)?.part
    let result = await solveTask(task, args.settings, args.model, pagePart, totals)
    if (!result.solved) {
      structuralIssues.push(...result.issues)
      continue
    }
    let verification = await verifyTask(
      task,
      result.solved,
      args.settings,
      args.model,
      pagePart,
      totals,
      args.requireVision ?? false,
    )
    if (verification.verdict === 'repair') {
      result = await solveTask(
        task,
        args.settings,
        args.model,
        pagePart,
        totals,
        verification.issues.map((issue) => issue.message),
      )
      if (result.solved) {
        verification = await verifyTask(
          task,
          result.solved,
          args.settings,
          args.model,
          pagePart,
          totals,
          args.requireVision ?? false,
        )
      }
    }
    if (!result.solved) {
      structuralIssues.push(...result.issues)
      continue
    }
    solvedTasks.push(result.solved)
    if (verification.verdict !== 'pass') semanticIssues.push(...verification.issues)
  }

  const projection = projectSolutionForRenderV2({
    plan: args.build.plan,
    rendererTasks: args.build.rendererTasks,
    solvedTasks,
  })
  const renderIssues = validateRenderManifestV2(projection).map((issue) => ({
    ...issue,
    blocking: true,
  }))
  const qualityReport: QualityReportV2 = {
    plan: 'passed',
    structure: structuralIssues.length > 0 ? 'failed' : 'passed',
    semantic: semanticIssues.length > 0 ? 'failed' : 'passed',
    render: renderIssues.length > 0 ? 'failed' : 'passed',
    issues: [...planIssues, ...structuralIssues, ...semanticIssues, ...renderIssues],
  }
  return {
    plan: args.build.plan,
    solvedTasks,
    projection,
    qualityReport,
    model: totals.model,
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
  }
}
