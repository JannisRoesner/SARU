import type { AiSettings } from '../../settings.service'
import { chatCompletion, type ChatPart } from '../client'
import { matchAnswerToCandidate } from '../solutions/candidate-bank'
import { maximumWeightAssignment } from '../solutions/solvers/bipartite-matching'
import {
  buildCandidateAssignmentVerifierPrompt,
  buildTaskSolverPrompt,
  buildSemanticVerifierPrompt,
  CANDIDATE_ASSIGNMENT_VERIFIER_SYSTEM_PROMPT,
  SEMANTIC_VERIFIER_SYSTEM_PROMPT,
  TASK_SOLVER_SYSTEM_PROMPT,
} from './prompts'
import { parseSemanticVerdict, parseTaskSolutionJson, type ParsedTaskSolution } from './model-json'
import { validateSolutionPlanV2 } from './plan-validator'
import { projectSolutionForRenderV2, validateRenderManifestV2 } from './renderer-projection'
import { validateSolvedTaskV2 } from './solution-validator'
import type {
  CanonicalPlanBuildV2,
  PipelineV2Result,
  QualityIssueV2,
  QualityReportV2,
  SolvedAnswer,
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

export function taskSolutionSchema(task: TaskSpec): Record<string, unknown> {
  const targetIds = task.answerSlots.map((slot) => slot.targetId)
  return {
    type: 'object',
    additionalProperties: false,
    required: ['taskId', 'answers', 'uncertainties'],
    properties: {
      taskId: { type: 'string', enum: [task.taskId] },
      answers: {
        type: 'array',
        minItems: targetIds.length,
        maxItems: targetIds.length,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['targetId', 'value'],
          properties: {
            targetId: { type: 'string', enum: targetIds },
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
}

function semanticVerdictSchema(task: TaskSpec): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['taskId', 'verdict', 'issues'],
    properties: {
      taskId: { type: 'string', enum: [task.taskId] },
      verdict: { type: 'string', enum: ['pass', 'repair', 'uncertain'] },
      issues: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['targetId', 'code', 'message'],
          properties: {
            targetId: { type: ['string', 'null'], enum: [null, ...task.answerSlots.map((slot) => slot.targetId)] },
            code: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
  }
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

interface CandidateRepairV2 {
  repairTask: TaskSpec
  fixedAnswers: SolvedAnswer[]
}

/**
 * Reduziert einen fehlgeschlagenen bijektiven Lückentext auf die tatsächlich
 * strittigen Ziele. Bereits eindeutige Zuordnungen werden nicht erneut vom
 * Modell entschieden.
 */
export function buildTargetedCandidateRepairV2(
  task: TaskSpec,
  solved: SolvedTask,
): CandidateRepairV2 | null {
  const bank = task.candidateBank
  if (bank?.reusePolicy !== 'once' || bank.candidates.length !== task.answerSlots.length) return null

  const byTarget = new Map<string, SolvedAnswer[]>()
  for (const answer of solved.answers) {
    byTarget.set(answer.targetId, [...(byTarget.get(answer.targetId) ?? []), answer])
  }
  const candidateUse = new Map<string, number>()
  for (const answer of solved.answers) {
    const candidate = matchAnswerToCandidate(answer.value, bank)
    if (candidate) candidateUse.set(candidate.id, (candidateUse.get(candidate.id) ?? 0) + 1)
  }

  const fixedAnswers: SolvedAnswer[] = []
  const affectedSlots = []
  for (const slot of task.answerSlots) {
    const answers = byTarget.get(slot.targetId) ?? []
    const candidate = answers.length === 1 ? matchAnswerToCandidate(answers[0]!.value, bank) : null
    if (candidate && candidateUse.get(candidate.id) === 1) {
      fixedAnswers.push({ targetId: slot.targetId, value: candidate.value })
    } else {
      affectedSlots.push(slot)
    }
  }
  if (affectedSlots.length === 0) return null

  const fixedCandidateIds = new Set(
    fixedAnswers
      .map((answer) => matchAnswerToCandidate(answer.value, bank)?.id)
      .filter((id): id is string => Boolean(id)),
  )
  const remainingCandidates = bank.candidates.filter((candidate) => !fixedCandidateIds.has(candidate.id))
  if (remainingCandidates.length !== affectedSlots.length) return null

  return {
    fixedAnswers,
    repairTask: {
      ...task,
      answerSlots: affectedSlots,
      candidateBank: { ...bank, candidates: remainingCandidates },
    },
  }
}

/** Erstlösung und unabhängige Kontrolllösung: Nur übereinstimmende Slots bleiben fest. */
export function buildCandidateDisagreementRepairV2(
  task: TaskSpec,
  primary: SolvedTask,
  independent: SolvedTask,
): CandidateRepairV2 | null {
  const bank = task.candidateBank
  if (bank?.reusePolicy !== 'once' || bank.candidates.length !== task.answerSlots.length) return null
  const primaryByTarget = new Map(primary.answers.map((answer) => [answer.targetId, answer]))
  const independentByTarget = new Map(independent.answers.map((answer) => [answer.targetId, answer]))
  const fixedAnswers: SolvedAnswer[] = []
  const affectedSlots = []

  for (const slot of task.answerSlots) {
    const first = primaryByTarget.get(slot.targetId)
    const second = independentByTarget.get(slot.targetId)
    const firstCandidate = first ? matchAnswerToCandidate(first.value, bank) : null
    const secondCandidate = second ? matchAnswerToCandidate(second.value, bank) : null
    if (firstCandidate && secondCandidate && firstCandidate.id === secondCandidate.id) {
      fixedAnswers.push({ targetId: slot.targetId, value: firstCandidate.value })
    } else {
      affectedSlots.push(slot)
    }
  }
  if (affectedSlots.length === 0) return null
  const fixedIds = new Set(
    fixedAnswers
      .map((answer) => matchAnswerToCandidate(answer.value, bank)?.id)
      .filter((id): id is string => Boolean(id)),
  )
  const remainingCandidates = bank.candidates.filter((candidate) => !fixedIds.has(candidate.id))
  if (remainingCandidates.length !== affectedSlots.length) return null
  return {
    fixedAnswers,
    repairTask: {
      ...task,
      answerSlots: affectedSlots,
      candidateBank: { ...bank, candidates: remainingCandidates },
    },
  }
}

function mergeCandidateRepair(
  task: TaskSpec,
  repair: CandidateRepairV2,
  repairedAnswers: SolvedAnswer[],
  uncertainties: string[],
): SolvedTask {
  const byTarget = new Map([...repair.fixedAnswers, ...repairedAnswers].map((answer) => [answer.targetId, answer]))
  return {
    taskId: task.taskId,
    answers: task.answerSlots.flatMap((slot) => {
      const answer = byTarget.get(slot.targetId)
      return answer ? [answer] : []
    }),
    uncertainties,
  }
}

async function solveTask(
  task: TaskSpec,
  settings: AiSettings,
  model: string,
  pagePart: ChatPart | undefined,
  totals: CompletionTotals,
  repairIssues: string[] = [],
  initialCandidateRepair: CandidateRepairV2 | null = null,
): Promise<{ solved: SolvedTask | null; issues: QualityIssueV2[] }> {
  let lastIssues: QualityIssueV2[] = []
  let candidateRepair: CandidateRepairV2 | null = initialCandidateRepair
  for (let attempt = 0; attempt < 2; attempt++) {
    const promptTask = candidateRepair?.repairTask ?? task
    let completion
    try {
      completion = await chatCompletion(
        settings,
        [
          { role: 'system', parts: [{ type: 'text', text: TASK_SOLVER_SYSTEM_PROMPT }] },
          {
            role: 'user',
            parts: [
              { type: 'text', text: buildTaskSolverPrompt(promptTask, {
                repairIssues: [
                  ...repairIssues,
                  ...(candidateRepair
                    ? ['Repariere nur die aufgeführten offenen Lücken mit den verbleibenden Wörtern. Bereits gelöste Lücken sind verbindlich und nicht Teil dieser Antwort.']
                    : attempt > 0
                      ? lastIssues.map((issue) => issue.message)
                      : []),
                ],
              }) },
              ...(pagePart ? [pagePart] : []),
            ],
          },
        ],
        {
          model,
          temperature: 0,
          maxOutputTokens: Math.min(6000, Math.max(900, 350 + promptTask.answerSlots.length * 180)),
          jsonMode: true,
          jsonSchema: { name: 'solution_task_v2', schema: taskSolutionSchema(promptTask) },
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
    const parsedSolved = applyCandidateRankings(promptTask, parsed)
    const solved = candidateRepair
      ? mergeCandidateRepair(task, candidateRepair, parsedSolved.answers, parsedSolved.uncertainties)
      : parsedSolved
    lastIssues = validateSolvedTaskV2(task, solved)
    if (!blocking(lastIssues)) return { solved, issues: lastIssues }
    if (attempt === 0) candidateRepair = buildTargetedCandidateRepairV2(task, solved)
  }
  return { solved: null, issues: lastIssues }
}

interface CandidateAssignmentVerificationV2 {
  verdict: 'pass' | 'repair' | 'uncertain'
  issues: QualityIssueV2[]
  independent: SolvedTask | null
}

function requiresIndependentCandidateAssignment(task: TaskSpec): boolean {
  return Boolean(
    ['cloze', 'matching', 'table_completion', 'diagram_labeling'].includes(task.kind) &&
    task.candidateBank?.reusePolicy === 'once' &&
    task.candidateBank.candidates.length === task.answerSlots.length,
  )
}

async function verifyCandidateAssignment(
  task: TaskSpec,
  solved: SolvedTask,
  settings: AiSettings,
  model: string,
  pagePart: ChatPart | undefined,
  totals: CompletionTotals,
): Promise<CandidateAssignmentVerificationV2 | null> {
  if (!requiresIndependentCandidateAssignment(task)) return null

  const missingContext = task.kind === 'cloze' ? task.answerSlots.filter((slot) => {
    const context = slot.promptContext.trim()
    return !context.includes('___') || !/\p{L}/u.test(context.replace('___', ''))
  }) : []
  if (missingContext.length > 0) {
    return {
      verdict: 'uncertain',
      independent: null,
      issues: [{
        code: 'TASK_CONTEXT_MISSING',
        message: `Für ${missingContext.length} Lücke(n) fehlt ein eindeutig rekonstruierter Satzkontext.`,
        taskId: task.taskId,
        targetIds: missingContext.map((slot) => slot.targetId),
        blocking: true,
      }],
    }
  }

  let independent: SolvedTask | null = null
  let lastFailure = 'Die unabhängige Kandidatenzuordnung lieferte kein vollständiges Ergebnis.'
  const retryIssues: string[] = []
  for (let attempt = 0; attempt < 2; attempt++) {
    let completion
    try {
      completion = await chatCompletion(
        settings,
        [
          { role: 'system', parts: [{ type: 'text', text: CANDIDATE_ASSIGNMENT_VERIFIER_SYSTEM_PROMPT }] },
          {
            role: 'user',
            parts: [
              {
                type: 'text',
                text: buildCandidateAssignmentVerifierPrompt(task, {
                  repairIssues: attempt > 0 ? retryIssues : [],
                }),
              },
              ...(pagePart ? [pagePart] : []),
            ],
          },
        ],
        {
          model,
          temperature: 0,
          maxOutputTokens: Math.min(5000, Math.max(900, 350 + task.answerSlots.length * 140)),
          jsonMode: true,
          jsonSchema: { name: 'solution_candidate_assignment_v2', schema: taskSolutionSchema(task) },
        },
      )
    } catch (error) {
      lastFailure = error instanceof Error
        ? `Die unabhängige Kandidatenzuordnung konnte nicht gelesen werden: ${error.message}`
        : 'Die unabhängige Kandidatenzuordnung konnte nicht gelesen werden.'
      retryIssues.splice(0, retryIssues.length, lastFailure)
      continue
    }
    totals.model = completion.model
    totals.inputTokens += completion.inputTokens ?? 0
    totals.outputTokens += completion.outputTokens ?? 0
    const parsed = completion.finishReason === 'length'
      ? null
      : parseTaskSolutionJson(completion.text)
    if (!parsed) {
      lastFailure = 'Die unabhängige Kandidatenzuordnung lieferte kein vollständiges Ergebnis.'
      retryIssues.splice(0, retryIssues.length, lastFailure)
      continue
    }
    const candidate = applyCandidateRankings(task, parsed)
    const validationIssues = validateSolvedTaskV2(task, candidate)
    if (blocking(validationIssues)) {
      lastFailure = `Die unabhängige Kandidatenzuordnung war strukturell ungültig: ${validationIssues.map((issue) => issue.message).join(' ')}`
      retryIssues.splice(0, retryIssues.length, ...validationIssues.map((issue) => issue.message))
      continue
    }
    independent = candidate
    break
  }
  if (!independent) {
    return {
      verdict: 'uncertain',
      independent: null,
      issues: [{
        code: 'SEMANTIC_QA_UNCERTAIN',
        message: lastFailure,
        taskId: task.taskId,
        blocking: true,
      }],
    }
  }

  const primaryByTarget = new Map(solved.answers.map((answer) => [answer.targetId, answer.value]))
  const mismatches = task.answerSlots.filter((slot) => {
    const primary = matchAnswerToCandidate(primaryByTarget.get(slot.targetId) ?? '', task.candidateBank!)
    const checked = matchAnswerToCandidate(
      independent.answers.find((answer) => answer.targetId === slot.targetId)?.value ?? '',
      task.candidateBank!,
    )
    return !primary || !checked || primary.id !== checked.id
  })
  if (mismatches.length === 0) return { verdict: 'pass', issues: [], independent }
  return {
    verdict: 'repair',
    independent,
    issues: [{
      code: 'CANDIDATE_ASSIGNMENT_DISAGREEMENT',
      message: `Erstlösung und unabhängige Kontrolle widersprechen sich bei ${mismatches.length} Ziel(en).`,
      taskId: task.taskId,
      targetIds: mismatches.map((slot) => slot.targetId),
      blocking: true,
    }],
  }
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
        jsonSchema: { name: 'solution_semantic_verdict_v2', schema: semanticVerdictSchema(task) },
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
  // Globale Planfehler verhindern den gesamten Lauf. Aufgabenbezogene Fehler
  // (z. B. fünf nicht lokalisierte Diagrammziele) sperren nur diese Aufgabe;
  // alle übrigen Teilaufgaben bleiben lösbar und im Prüfentwurf editierbar.
  if (planIssues.some((issue) => issue.blocking && !issue.taskId)) {
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
    if (planIssues.some((issue) => issue.blocking && issue.taskId === task.taskId)) continue
    const pagePart = args.pageParts.find((candidate) => candidate.page === task.page)?.part
    let result = await solveTask(task, args.settings, args.model, pagePart, totals)
    if (!result.solved) {
      structuralIssues.push(...result.issues)
      continue
    }

    // Cloze-Wortlisten werden unabhängig ein zweites Mal gelöst. Der zweite
    // Aufruf sieht die Erstlösung nicht; Unterschiede gehen ausschließlich in
    // einen gezielten Repair der strittigen Slots.
    let candidateCheck = await verifyCandidateAssignment(
      task,
      result.solved,
      args.settings,
      args.model,
      pagePart,
      totals,
    )
    let repairUsed = false
    if (candidateCheck?.verdict === 'repair' && candidateCheck.independent) {
      const disagreementRepair = buildCandidateDisagreementRepairV2(
        task,
        result.solved,
        candidateCheck.independent,
      )
      if (disagreementRepair) {
        result = await solveTask(
          task,
          args.settings,
          args.model,
          pagePart,
          totals,
          candidateCheck.issues.map((issue) => issue.message),
          disagreementRepair,
        )
        repairUsed = true
        if (result.solved) {
          candidateCheck = await verifyCandidateAssignment(
            task,
            result.solved,
            args.settings,
            args.model,
            pagePart,
            totals,
          )
        }
      } else {
        candidateCheck = {
          verdict: 'uncertain',
          independent: candidateCheck.independent,
          issues: [{
            code: 'SEMANTIC_QA_UNCERTAIN',
            message: 'Die widersprüchliche Kandidatenzuordnung konnte nicht gezielt repariert werden.',
            taskId: task.taskId,
            blocking: true,
          }],
        }
      }
    }
    if (!result.solved) {
      structuralIssues.push(...result.issues)
      continue
    }
    if (candidateCheck && candidateCheck.verdict !== 'pass') {
      solvedTasks.push(result.solved)
      semanticIssues.push(...candidateCheck.issues)
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
    if (verification.verdict === 'repair' && !repairUsed) {
      result = await solveTask(
        task,
        args.settings,
        args.model,
        pagePart,
        totals,
        verification.issues.map((issue) => issue.message),
      )
      if (result.solved) {
        candidateCheck = await verifyCandidateAssignment(
          task,
          result.solved,
          args.settings,
          args.model,
          pagePart,
          totals,
        )
        if (!candidateCheck || candidateCheck.verdict === 'pass') {
          verification = await verifyTask(
            task,
            result.solved,
            args.settings,
            args.model,
            pagePart,
            totals,
            args.requireVision ?? false,
          )
        } else {
          verification = {
            verdict: candidateCheck.verdict,
            issues: candidateCheck.issues,
          }
        }
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
    plan: blocking(planIssues) ? 'failed' : 'passed',
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
