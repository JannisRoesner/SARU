import type { SolutionBBox } from '../document-fill'
import type { AnswerTarget, TaskBlock } from '../solutions/types'
import { markedRowContextForTarget, nearbyTextForTarget } from './layout-document'
import {
  SOLUTION_PIPELINE_VERSION,
  type AnswerSlot,
  type CanonicalPlanBuildV2,
  type LayoutDocumentV2,
  type LayoutObservation,
  type RenderPolicy,
  type TaskKindV2,
  type TaskSpec,
} from './types'

function q(value: number | undefined): number {
  return Math.round((value ?? 0) * 10_000)
}

function geometryKey(page: number, kind: string, bbox: SolutionBBox | null | undefined): string {
  return `p${page}-${kind}-${q(bbox?.x)}-${q(bbox?.y)}-${q(bbox?.w)}-${q(bbox?.h)}`
}

function canonicalTaskKind(task: TaskBlock): TaskKindV2 {
  if (task.kind === 'cloze') return 'cloze'
  if (task.kind === 'free_text_inplace' || task.kind === 'free_text_separate') return 'free_text'
  if (task.kind === 'matching_inline') return 'matching'
  if (task.kind === 'diagram_completion') return 'diagram_labeling'
  if (task.kind === 'matching_table') {
    const choices = task.targets.filter((target) => target.kind === 'choice_cell')
    if (choices.length > 0) return 'single_choice'
    return 'table_completion'
  }
  return 'unsupported'
}

function renderPolicyFor(
  task: TaskBlock,
  target: AnswerTarget | null,
  sourceFormat: 'pdf' | 'docx' | 'other',
): RenderPolicy {
  if (!target || task.renderMode === 'appendix') return 'appendix'
  const isMark = target.kind === 'choice_cell'
  if (sourceFormat === 'docx' && task.renderMode === 'native') {
    return isMark ? 'docx_native_mark' : 'docx_native_text'
  }
  return isMark ? 'pdf_mark_overlay' : 'pdf_text_overlay'
}

function capacityFor(target: AnswerTarget | null): AnswerSlot['capacity'] {
  if (!target?.bbox) return { maxChars: 1200, maxLines: 20 }
  const lines = Math.max(1, Math.floor((target.bbox.h ?? 0.025) / 0.025))
  return {
    maxLines: Math.min(20, lines),
    maxChars: Math.max(12, Math.floor((target.bbox.w ?? 0.1) * 105 * lines)),
  }
}

function promptContextFor(
  document: LayoutDocumentV2,
  task: TaskBlock,
  target: AnswerTarget | null,
): string {
  if (!target) return task.instruction.trim()
  const explicit = `${target.leftText ?? ''} ___ ${target.rightText ?? ''}`.trim()
  const markedRow = markedRowContextForTarget(document, target.page, target.bbox)
  const nearby = nearbyTextForTarget(document, target.page, target.bbox)
  return [explicit !== '___' ? explicit : '', markedRow, nearby, target.cellRef ? `Zelle ${target.cellRef}` : '']
    .filter(Boolean)
    .join(' | ')
    .slice(0, 900)
}

function slotsForTask(
  task: TaskBlock,
  document: LayoutDocumentV2,
  sourceFormat: 'pdf' | 'docx' | 'other',
): { slots: AnswerSlot[]; targets: AnswerTarget[] } {
  if (task.targets.some((target) => target.kind === 'choice_cell')) {
    const canonicalTargets = task.targets.map((target) => ({
      ...target,
      id: geometryKey(target.page, target.kind, target.bbox),
    }))
    const rows = new Map<string, AnswerTarget[]>()
    for (const target of canonicalTargets.filter((candidate) => candidate.kind === 'choice_cell')) {
      const rowKey = (target.cellRef ?? target.id).split(':').slice(0, 2).join(':')
      rows.set(rowKey, [...(rows.get(rowKey) ?? []), target])
    }
    const slots = [...rows.entries()]
      .sort(([a], [b]) => a.localeCompare(b, 'de', { numeric: true }))
      .map(([rowKey, row]) => {
        const first = row[0]!
        const context = row
          .map((target) => promptContextFor(document, task, target))
          .sort((a, b) => b.length - a.length)[0] ?? task.instruction
        return {
          targetId: `${geometryKey(first.page, 'choice-row', first.bbox)}-${rowKey.replace(/[^\w-]/g, '-')}`,
          page: first.page,
          bbox: null,
          promptContext: context,
          targetKind: 'choice_cell' as const,
          blankIndex: null,
          nativeRef: null,
          cellRef: rowKey,
          choiceValue: null,
          choiceTargets: row.map((target) => ({
            value: target.choiceValue ?? 'ausgewaehlt',
            targetId: target.id,
            bbox: target.bbox ?? null,
          })),
          valueType: 'choice' as const,
          allowedValues: row.map((target) => target.choiceValue ?? 'ausgewaehlt'),
          renderPolicy: renderPolicyFor(task, first, sourceFormat),
          capacity: { maxChars: 20, maxLines: 1 },
          provenance: row.map((target) => ({
            source: target.source === 'vision'
              ? 'vision' as const
              : sourceFormat === 'docx'
                ? 'docx_xml' as const
                : 'pdf_vector' as const,
            sourceRef: target.id,
          })),
        }
      })
    return { slots, targets: canonicalTargets }
  }

  const rawTargets = task.targets.length > 0 ? task.targets : [null]
  const seen = new Map<string, number>()
  const targets: AnswerTarget[] = []
  const slots = rawTargets.map((target, index) => {
    const base = target
      ? geometryKey(target.page, target.kind, target.bbox)
      : `${geometryKey(task.page, 'appendix', task.bbox)}-${index}`
    const duplicate = seen.get(base) ?? 0
    seen.set(base, duplicate + 1)
    const targetId = duplicate === 0 ? base : `${base}-${duplicate}`
    if (target) targets.push({ ...target, id: targetId })
    const allowedValues = target?.kind === 'choice_cell'
      ? [target.choiceValue ?? 'ausgewaehlt']
      : undefined
    return {
      targetId,
      page: target?.page ?? task.page,
      bbox: target?.bbox ?? null,
      promptContext: promptContextFor(document, task, target),
      targetKind: (target?.kind ?? 'appendix') as AnswerSlot['targetKind'],
      blankIndex: target?.blankIndex ?? null,
      nativeRef: target?.nativeRef ?? null,
      cellRef: target?.cellRef ?? null,
      choiceValue: target?.choiceValue ?? null,
      valueType:
        target?.kind === 'choice_cell'
          ? 'choice' as const
          : /^\d+$/.test(task.candidateBank?.candidates[0]?.value ?? '')
            ? 'number' as const
            : task.kind === 'diagram_completion'
              ? 'label' as const
              : 'text' as const,
      allowedValues,
      candidateIds: task.candidateBank?.candidates.map((candidate) => candidate.id),
      renderPolicy: renderPolicyFor(task, target, sourceFormat),
      capacity: capacityFor(target),
      provenance: [
        {
          source: target?.source === 'vision'
            ? 'vision' as const
            : sourceFormat === 'docx'
              ? 'docx_xml' as const
              : target?.kind === 'blank'
                ? 'pdf_text' as const
                : 'pdf_vector' as const,
          sourceRef: target?.id ?? task.id,
        },
      ],
    }
  })
  return { slots, targets }
}

function observationKind(target: AnswerTarget): LayoutObservation['kind'] {
  if (target.kind === 'blank') return 'blank'
  if (target.kind === 'answer_line') return 'answer_line'
  if (target.kind === 'table_cell') return 'table_cell'
  if (target.kind === 'choice_cell') return 'choice_cell'
  if (target.kind === 'shape_box' || target.kind === 'shape_oval') return 'diagram_target'
  return 'native_field'
}

export function buildSolutionPlanV2(args: {
  document: LayoutDocumentV2
  tasks: TaskBlock[]
  sourceFormat: 'pdf' | 'docx' | 'other'
}): CanonicalPlanBuildV2 {
  const observations: LayoutObservation[] = []
  const rendererTasks: TaskBlock[] = []
  const tasks: TaskSpec[] = []
  const taskIds = new Map<string, number>()

  for (const legacyTask of args.tasks) {
    const taskBaseId = geometryKey(legacyTask.page, canonicalTaskKind(legacyTask), legacyTask.bbox)
    const duplicateIndex = taskIds.get(taskBaseId) ?? 0
    taskIds.set(taskBaseId, duplicateIndex + 1)
    const taskId = duplicateIndex === 0 ? taskBaseId : `${taskBaseId}-${duplicateIndex}`
    const { slots, targets } = slotsForTask(legacyTask, args.document, args.sourceFormat)
    const canonicalTask: TaskBlock = { ...legacyTask, id: taskId, targets }
    rendererTasks.push(canonicalTask)
    tasks.push({
      taskId,
      kind: canonicalTaskKind(legacyTask),
      page: legacyTask.page,
      instruction: legacyTask.instruction,
      instructionBBox: legacyTask.bbox,
      confidence: legacyTask.confidence,
      issues: legacyTask.evidence.filter((entry) => /missing|malformed|uncertain|insufficient|conflict/i.test(entry)),
      candidateBank: legacyTask.candidateBank ?? null,
      answerSlots: slots,
    })
    observations.push({
      id: `${taskId}-instruction`,
      kind: 'instruction',
      source: args.sourceFormat === 'docx' ? 'docx_xml' : 'pdf_text',
      page: legacyTask.page,
      bbox: legacyTask.bbox,
      confidence: legacyTask.confidence,
      text: legacyTask.instruction,
      sourceRef: legacyTask.id,
    })
    for (const [index, target] of targets.entries()) {
      const slot = slots.find((candidate) =>
        candidate.provenance.some((entry) => entry.sourceRef === target.id),
      ) ?? slots[index]
      observations.push({
        id: target.id,
        kind: observationKind(target),
        source: slot?.provenance[0]?.source ?? (target.source === 'vision' ? 'vision' : 'pdf_vector'),
        page: target.page,
        bbox: target.bbox ?? null,
        confidence: target.source === 'vision' ? 0.65 : 0.95,
        text: slot?.promptContext ?? '',
        sourceRef: slot?.provenance.find((entry) => entry.sourceRef === target.id)?.sourceRef ?? target.id,
      })
    }
  }

  return {
    rendererTasks,
    plan: {
      schemaVersion: 2,
      pipelineVersion: SOLUTION_PIPELINE_VERSION,
      sourceHash: args.document.sourceHash,
      document: args.document,
      observations,
      tasks,
    },
  }
}

/** Rekonstruiert den deterministischen Renderer-Vertrag aus einem gespeicherten V2-Plan. */
export function rendererTasksFromPlanV2(plan: import('./types').SolutionPlanV2): TaskBlock[] {
  return plan.tasks.map((task) => {
    const targets: AnswerTarget[] = []
    for (const slot of task.answerSlots) {
      if (slot.choiceTargets?.length) {
        for (const choice of slot.choiceTargets) {
          targets.push({
            id: choice.targetId,
            kind: 'choice_cell',
            page: slot.page,
            bbox: choice.bbox,
            cellRef: slot.cellRef ?? null,
            choiceValue: choice.value,
            source: slot.provenance.some((entry) => entry.source === 'vision') ? 'vision' : 'native',
          })
        }
        continue
      }
      if (slot.targetKind === 'appendix') continue
      targets.push({
        id: slot.targetId,
        kind: slot.targetKind,
        page: slot.page,
        bbox: slot.bbox,
        blankIndex: slot.blankIndex ?? null,
        leftText: slot.promptContext,
        nativeRef: slot.nativeRef ?? null,
        cellRef: slot.cellRef ?? null,
        choiceValue: slot.choiceValue ?? null,
        source: slot.provenance.some((entry) => entry.source === 'vision') ? 'vision' as const : 'native' as const,
      })
    }
    const renderMode = task.answerSlots.every((slot) => slot.renderPolicy === 'appendix')
      ? 'appendix' as const
      : task.answerSlots.some((slot) => slot.renderPolicy.startsWith('docx_native'))
        ? 'native' as const
        : 'overlay' as const
    const kind: TaskBlock['kind'] = task.kind === 'cloze'
      ? 'cloze'
      : task.kind === 'table_completion' || task.kind === 'single_choice' || task.kind === 'multi_choice'
        ? 'matching_table'
        : task.kind === 'matching'
          ? 'matching_inline'
          : task.kind === 'diagram_labeling'
            ? 'diagram_completion'
            : task.kind === 'free_text'
              ? targets.length > 0 ? 'free_text_inplace' : 'free_text_separate'
              : 'unknown'
    return {
      id: task.taskId,
      page: task.page,
      bbox: task.instructionBBox ?? targets[0]?.bbox ?? { x: 0.05, y: 0.05, w: 0.9, h: 0.08 },
      instruction: task.instruction,
      kind,
      confidence: task.confidence,
      evidence: [],
      targets,
      candidateBank: task.candidateBank ?? undefined,
      renderMode,
      renderConfidence: task.confidence >= 0.85 ? 'high' : task.confidence >= 0.65 ? 'medium' : 'low',
    }
  })
}
