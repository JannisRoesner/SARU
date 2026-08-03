import { extractJsonObject } from '../../../../utils/json-parse'
import type { AiSettings } from '../../../settings.service'
import { chatCompletion, supportsNativePdf, type ChatPart } from '../../client'
import type { SolutionBBox } from '../../document-fill'
import { rasterizePdf } from '../../rasterize'
import type { AnswerTarget, AnswerTargetKind, TaskBlock, TaskKind } from '../types'
import { detectWorksheetTasks } from '../worksheet-tasks'

const MAX_VISION_PAGES = 200
const MAX_VISION_TASKS = 24
const MAX_TARGETS_PER_TASK = 20
const MIN_ACCEPTED_CONFIDENCE = 0.6

export interface PdfLayoutAssessment {
  shouldCheck: boolean
  reasons: string[]
  worksheetTaskCount: number
  openTaskCount: number
  inplaceTaskCount: number
  answerTargetCount: number
}

export interface PdfVisionLayoutResult {
  verdict: 'confirm' | 'repair' | 'no_targets'
  tasks: TaskBlock[]
  rawTaskCount: number
}

export function assessPdfLayoutPlan(args: {
  documentText: string
  tasks: TaskBlock[]
  /** PDFs werden vor dem Füllen immer mindestens einmal visuell gegengeprüft. */
  requireVision?: boolean
}): PdfLayoutAssessment {
  const worksheetTasks = detectWorksheetTasks(args.documentText)
  const openTaskCount = worksheetTasks.filter((task) => task.kind === 'open_ended').length
  const inplaceTasks = args.tasks.filter(
    (task) =>
      (task.renderMode === 'overlay' || task.renderMode === 'native') &&
      task.targets.length > 0,
  )
  const answerTargetCount = inplaceTasks.flatMap((task) => task.targets).length
  const reasons: string[] = []

  if (args.requireVision) {
    reasons.push('PDF layout requires mandatory visual verification')
  }

  if (args.tasks.length === 0) {
    reasons.push(
      worksheetTasks.length > 0
        ? 'worksheet tasks detected but solution plan is empty'
        : 'PDF solution plan contains no detectable tasks',
    )
  }
  if (
    args.tasks.length > 0 &&
    args.tasks.every((task) => task.renderMode === 'appendix')
  ) {
    reasons.push('solution plan would render every task as appendix')
  }
  if (openTaskCount > 0 && answerTargetCount === 0) {
    reasons.push('open-response tasks have no in-place answer targets')
  }
  if (
    openTaskCount > 1 &&
    inplaceTasks.length > 0 &&
    inplaceTasks.length !== openTaskCount
  ) {
    reasons.push('open-response task count does not match in-place task count')
  }
  if (args.tasks.some((task) => task.renderConfidence === 'low')) {
    reasons.push('solution plan contains low-confidence render targets')
  }
  if (args.tasks.some((task) => task.confidence < 0.7)) {
    reasons.push('solution plan contains low-confidence task classification')
  }

  return {
    shouldCheck: reasons.length > 0,
    reasons,
    worksheetTaskCount: worksheetTasks.length,
    openTaskCount,
    inplaceTaskCount: inplaceTasks.length,
    answerTargetCount,
  }
}

export function buildPdfLayoutVisionPrompt(args: {
  documentText: string
  tasks: TaskBlock[]
  assessment: PdfLayoutAssessment
}): string {
  const currentPlan = args.tasks.map((task) => ({
    id: task.id,
    kind: task.kind,
    instruction: task.instruction,
    page: task.page,
    renderMode: task.renderMode,
    confidence: task.confidence,
    targets: task.targets.map((target) => ({
      id: target.id,
      kind: target.kind,
      page: target.page,
      bbox: target.bbox ?? null,
      source: target.source ?? null,
    })),
  }))

  return [
    'Du prüfst ausschließlich das Layout eines Arbeitsblatts, nicht seine Lösungen.',
    'Erkenne sichtbare Aufgaben und die jeweils dazugehörigen beschreibbaren Antwortbereiche.',
    'Antwortbereiche können Linienblöcke, leere Kästen, Tabellenzellen, exklusive Auswahlzellen oder Diagrammziele sein.',
    'Dekorationen, Trennlinien, Kopf-/Fußzeilen und bereits bedruckte Flächen sind keine Antwortbereiche.',
    '',
    `Plausibilitätsprobleme: ${args.assessment.reasons.join('; ')}`,
    `Extrahierter Text: ${args.documentText.trim().slice(0, 6000) || '(leer)'}`,
    `Bisheriger Plan: ${JSON.stringify(currentPlan)}`,
    '',
    'Antworte ausschließlich als JSON:',
    '{"verdict":"confirm|repair|no_targets","tasks":[{"instruction":"…","kind":"cloze|open_response|short_answer|table|choice|diagram|no_response","page":1,"confidence":0.0,"answerRegions":[{"kind":"line_block|box|table_cell|choice_cell|diagram_target","rowId":"1","choiceValue":"richtig|falsch|ja|nein|null","bbox":{"x":0.1,"y":0.2,"w":0.8,"h":0.15}}]}]}',
    '',
    'Regeln:',
    '- bbox normalisiert 0–1, Ursprung oben links',
    '- Mehrere parallele Schreiblinien einer Aufgabe als EINEN line_block zusammenfassen',
    '- Jede Aufgabe separat ausgeben und nur ihre eigenen answerRegions zuordnen',
    '- Native Ziele aus dem bisherigen Plan bestätigen, sofern sie sichtbar korrekt sind',
    '- Keine Antworttexte erzeugen und keine unsichtbaren Bereiche erfinden',
    '- no_response nur für Aufgaben ohne vorgesehenen Eintrag im Original',
    '- Wenn wirklich keine nutzbaren Antwortbereiche sichtbar sind: verdict=no_targets',
  ].join('\n')
}

function parseBBox(raw: unknown): SolutionBBox | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const x = Number(row.x)
  const y = Number(row.y)
  const w = Number(row.w)
  const h = Number(row.h)
  if (![x, y, w, h].every(Number.isFinite)) return null
  if (w <= 0.015 || h <= 0.008) return null
  const left = Math.min(1, Math.max(0, x))
  const top = Math.min(1, Math.max(0, y))
  return {
    x: left,
    y: top,
    w: Math.min(1 - left, Math.max(0.015, w)),
    h: Math.min(1 - top, Math.max(0.008, h)),
  }
}

function mapTargetKind(raw: string): AnswerTargetKind {
  switch (raw.toLowerCase()) {
    case 'table_cell':
      return 'table_cell'
    case 'choice_cell':
      return 'choice_cell'
    case 'diagram_target':
      return 'shape_box'
    case 'box':
      return 'text_field'
    default:
      return 'answer_line'
  }
}

function mapTaskKind(raw: string, hasTargets: boolean): TaskKind {
  switch (raw.toLowerCase()) {
    case 'table':
      return hasTargets ? 'matching_table' : 'free_text_separate'
    case 'choice':
      return hasTargets ? 'matching_table' : 'free_text_separate'
    case 'diagram':
      return hasTargets ? 'diagram_completion' : 'free_text_separate'
    case 'cloze':
      return 'cloze'
    case 'open_response':
    case 'short_answer':
      return hasTargets ? 'free_text_inplace' : 'free_text_separate'
    default:
      return 'free_text_separate'
  }
}

function renderConfidence(confidence: number): 'high' | 'medium' | 'low' {
  if (confidence >= 0.85) return 'high'
  if (confidence >= MIN_ACCEPTED_CONFIDENCE) return 'medium'
  return 'low'
}

function overlapRatio(first: SolutionBBox, second: SolutionBBox): number {
  const firstWidth = first.w ?? 0
  const firstHeight = first.h ?? 0
  const secondWidth = second.w ?? 0
  const secondHeight = second.h ?? 0
  if (
    firstWidth <= 0 ||
    firstHeight <= 0 ||
    secondWidth <= 0 ||
    secondHeight <= 0
  ) {
    return 0
  }
  const left = Math.max(first.x, second.x)
  const top = Math.max(first.y, second.y)
  const right = Math.min(first.x + firstWidth, second.x + secondWidth)
  const bottom = Math.min(first.y + firstHeight, second.y + secondHeight)
  if (right <= left || bottom <= top) return 0
  const intersection = (right - left) * (bottom - top)
  return intersection / Math.min(firstWidth * firstHeight, secondWidth * secondHeight)
}

function reconcileNativeTarget(
  visual: AnswerTarget,
  nativeTargets: AnswerTarget[],
  usedNativeIds: Set<string>,
): AnswerTarget {
  if (!visual.bbox) return visual
  const native = nativeTargets.find(
    (candidate) =>
      !usedNativeIds.has(candidate.id) &&
      candidate.page === visual.page &&
      candidate.bbox &&
      overlapRatio(visual.bbox!, candidate.bbox) >= 0.45,
  )
  if (!native) return visual
  usedNativeIds.add(native.id)
  return {
    ...native,
    leftText: visual.leftText ?? native.leftText,
  }
}

export function parsePdfLayoutVisionResponse(
  raw: string,
  nativeTargets: AnswerTarget[] = [],
): PdfVisionLayoutResult | null {
  const parsed = extractJsonObject(raw)
  if (!parsed || !Array.isArray(parsed.tasks)) return null
  const verdict =
    parsed.verdict === 'confirm' || parsed.verdict === 'no_targets'
      ? parsed.verdict
      : 'repair'
  const tasks: TaskBlock[] = []
  const usedNativeIds = new Set<string>()

  for (let index = 0; index < parsed.tasks.length && index < MAX_VISION_TASKS; index++) {
    const rawTask = parsed.tasks[index]
    if (!rawTask || typeof rawTask !== 'object') continue
    const row = rawTask as Record<string, unknown>
    const instruction = String(row.instruction ?? '').trim().slice(0, 400)
    const page = Math.max(1, Math.floor(Number(row.page) || 1))
    const confidence = Math.min(1, Math.max(0, Number(row.confidence) || 0))
    if (!instruction || confidence < MIN_ACCEPTED_CONFIDENCE) continue

    const regions = Array.isArray(row.answerRegions) ? row.answerRegions : []
    const visualTargets: AnswerTarget[] = []
    for (let targetIndex = 0; targetIndex < regions.length && targetIndex < MAX_TARGETS_PER_TASK; targetIndex++) {
      const rawRegion = regions[targetIndex]
      if (!rawRegion || typeof rawRegion !== 'object') continue
      const region = rawRegion as Record<string, unknown>
      const bbox = parseBBox(region.bbox)
      if (!bbox) continue
      visualTargets.push({
        id: `pdf-vision-${index}-${targetIndex}`,
        kind: mapTargetKind(String(region.kind ?? 'line_block')),
        page,
        bbox,
        blankIndex: null,
        leftText: instruction.slice(0, 120),
        cellRef: typeof region.rowId === 'string'
          ? `${page}:${region.rowId}:${targetIndex}`
          : null,
        choiceValue: typeof region.choiceValue === 'string'
          ? region.choiceValue.toLocaleLowerCase('de-DE').trim()
          : null,
        source: 'vision',
      })
    }

    let targets = visualTargets.map((target) =>
      reconcileNativeTarget(target, nativeTargets, usedNativeIds),
    )
    const kind = mapTaskKind(String(row.kind ?? 'open_response'), targets.length > 0)
    if (kind === 'cloze') {
      targets = targets.map((target, blankIndex) => ({
        ...target,
        kind: 'blank' as const,
        blankIndex,
      }))
    }
    const bbox = targets[0]?.bbox ?? parseBBox(row.bbox) ?? {
      x: 0.05,
      y: Math.min(0.9, 0.12 + index * 0.12),
      w: 0.9,
      h: 0.08,
    }
    tasks.push({
      id: `p${page}-vision-${index + 1}`,
      page,
      bbox,
      instruction,
      kind,
      confidence,
      evidence: ['PDF layout verified via vision', `${targets.length} visual answer regions`],
      targets,
      renderMode: targets.length > 0 ? 'overlay' : 'appendix',
      renderConfidence: renderConfidence(confidence),
      requiresVisionTargetRepair: false,
    })
  }

  return { verdict, tasks, rawTaskCount: parsed.tasks.length }
}

export async function repairPdfLayoutViaVision(args: {
  buffer: Buffer
  fileName: string
  settings: AiSettings
  model: string
  documentText: string
  tasks: TaskBlock[]
  assessment: PdfLayoutAssessment
  nativeTargets?: AnswerTarget[]
}): Promise<PdfVisionLayoutResult | null> {
  if (supportsNativePdf(args.settings.provider)) {
    const completion = await chatCompletion(
      args.settings,
      [{
        role: 'user',
        parts: [
          {
            type: 'text',
            text: buildPdfLayoutVisionPrompt({
              documentText: args.documentText,
              tasks: args.tasks,
              assessment: args.assessment,
            }),
          },
          {
            type: 'file',
            mimeType: 'application/pdf',
            base64: args.buffer.toString('base64'),
            fileName: args.fileName,
          },
        ],
      }],
      {
        model: args.model,
        temperature: 0,
        maxOutputTokens: Math.min(5000, Math.max(1600, args.settings.maxOutputTokens)),
        jsonMode: true,
      },
    )
    const result = parsePdfLayoutVisionResponse(completion.text, args.nativeTargets)
    if (result?.verdict === 'confirm' && result.rawTaskCount === 0 && args.tasks.length > 0) {
      return { verdict: 'repair', tasks: [], rawTaskCount: 0 }
    }
    return result
  }

  const pages = await rasterizePdf(args.buffer, { maxPages: MAX_VISION_PAGES, scale: 1.6 })
  if (pages.length === 0) return null
  const results: PdfVisionLayoutResult[] = []
  for (let start = 0; start < pages.length; start += 3) {
    const batch = pages.slice(start, start + 3)
    const pageNumbers = new Set(batch.map((page) => page.pageNumber))
    const pageTasks = args.tasks.filter((task) => pageNumbers.has(task.page))
    const parts: ChatPart[] = [
      {
        type: 'text',
        text: buildPdfLayoutVisionPrompt({
          documentText: args.documentText,
          tasks: pageTasks,
          assessment: args.assessment,
        }),
      },
    ]
    for (const page of batch) {
      parts.push(
        { type: 'text', text: `Seite ${page.pageNumber}:` },
        { type: 'image', mimeType: page.mimeType, base64: page.base64 },
      )
    }
    const completion = await chatCompletion(
      args.settings,
      [{ role: 'user', parts }],
      {
        model: args.model,
        temperature: 0,
        maxOutputTokens: Math.min(4000, Math.max(1400, args.settings.maxOutputTokens)),
        jsonMode: true,
      },
    )
    const result = parsePdfLayoutVisionResponse(completion.text, args.nativeTargets)
    if (!result || (result.verdict === 'confirm' && result.rawTaskCount === 0 && pageTasks.length > 0)) {
      results.push({ verdict: 'repair', tasks: [], rawTaskCount: 0 })
    } else {
      results.push(result)
    }
  }
  return {
    verdict: results.some((result) => result.verdict === 'repair')
      ? 'repair'
      : results.every((result) => result.verdict === 'no_targets')
        ? 'no_targets'
        : 'confirm',
    tasks: results.flatMap((result) => result.tasks),
    rawTaskCount: results.reduce((sum, result) => sum + result.rawTaskCount, 0),
  }
}
