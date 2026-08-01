import type { PdfBlankRegion, TextBlankInfo } from '../document-fill'
import type { CandidateBank } from './types'
import type { AnswerTarget, DocumentModel, TaskBlock } from './types'

export interface SegmentTasksInput {
  document: DocumentModel
  pdfBlanks?: PdfBlankRegion[]
  docxBlanks?: TextBlankInfo[]
  candidateBank?: CandidateBank | null
  /** Native/Shape-Targets aus DOCX-Analyse (parallel zu Blanks). */
  answerTargets?: AnswerTarget[]
}

const DIAGRAM_INSTRUCTION =
  /\b(zeichne|eintrage|vervollst[äa]ndige|beschrifte|erg[äa]nze|diagramm|meiose|chromosom)/i

/**
 * Segmentiert Aufgabenblöcke:
 * - Cloze-Block wenn Lücken vorhanden
 * - Diagramm-Cluster aus Oval-/Box-Shapes
 * - Tabellen-Matching aus leeren Zellen
 * - Native Felder / Textboxen parallel zu Cloze
 * - Freitext für offene Operator-Aufgaben
 */
export function segmentTasks(input: SegmentTasksInput): TaskBlock[] {
  const {
    document,
    pdfBlanks = [],
    docxBlanks = [],
    candidateBank,
    answerTargets = [],
  } = input
  const tasks: TaskBlock[] = []

  const blankTargets: AnswerTarget[] = pdfBlanks.length
    ? pdfBlanks.map((b) => ({
        id: `blank-${b.blankIndex}`,
        kind: 'blank' as const,
        page: b.pageIndex + 1,
        blankIndex: b.blankIndex,
        leftText: b.leftText,
        rightText: b.rightText,
        bbox: {
          x: 0,
          y: 0,
          w: Math.max(0.02, b.width / Math.max(1, document.pages[b.pageIndex]?.width ?? 595)),
          h: Math.max(0.012, b.height / Math.max(1, document.pages[b.pageIndex]?.height ?? 842)),
        },
      }))
    : docxBlanks.map((b) => ({
        id: `blank-${b.blankIndex}`,
        kind: 'blank' as const,
        page: 1,
        blankIndex: b.blankIndex,
        leftText: b.leftText,
        rightText: b.rightText,
      }))

  if (blankTargets.length > 0) {
    const page = blankTargets[0]!.page
    tasks.push({
      id: `p${page}-t1`,
      page,
      bbox: blankTargets[0]!.bbox ?? { x: 0, y: 0, w: 1, h: 0.5 },
      instruction: extractClozeInstruction(document.fullText),
      kind: 'cloze',
      confidence: candidateBank ? 0.95 : 0.75,
      evidence: [
        `${blankTargets.length} answer targets detected`,
        candidateBank
          ? `${candidateBank.candidates.length} candidate terms detected`
          : 'no word list detected',
      ],
      targets: blankTargets,
      candidateBank: candidateBank ?? undefined,
      renderMode: 'overlay',
      renderConfidence: 'high',
    })
  }

  const shapeTargets = [
    ...answerTargets.filter(
      (t) =>
        t.kind === 'shape_oval' ||
        t.kind === 'shape_box' ||
        t.kind === 'answer_line',
    ),
    ...document.shapes.map((s) => ({
      id: s.id,
      kind:
        s.kind === 'oval'
          ? ('shape_oval' as const)
          : s.kind === 'box'
            ? ('shape_box' as const)
            : ('answer_line' as const),
      page: s.page,
      bbox: s.bbox,
      nativeRef: s.nativeRef,
      leftText: s.anchorText ?? undefined,
      source: 'native' as const,
    })),
  ]
  // Deduplicate by id
  const seenShapeIds = new Set<string>()
  const uniqueShapes = shapeTargets.filter((t) => {
    if (seenShapeIds.has(t.id)) return false
    seenShapeIds.add(t.id)
    return true
  })

  const ovals = uniqueShapes.filter((t) => t.kind === 'shape_oval' || t.kind === 'shape_box')
  if (ovals.length >= 3 && DIAGRAM_INSTRUCTION.test(document.fullText)) {
    tasks.push({
      id: 'p1-diagram',
      page: ovals[0]!.page,
      bbox: ovals[0]!.bbox ?? { x: 0.1, y: 0.3, w: 0.8, h: 0.4 },
      instruction: extractDiagramInstruction(document.fullText),
      kind: 'diagram_completion',
      confidence: 0.8,
      evidence: [`${ovals.length} diagram shape targets clustered`],
      targets: ovals,
      renderMode: 'native',
      renderConfidence: 'medium',
      requiresVisionTargetRepair: ovals.some((t) => !t.nativeRef),
    })
  } else if (uniqueShapes.filter((t) => t.kind === 'answer_line').length > 0 && blankTargets.length === 0) {
    const lines = uniqueShapes.filter((t) => t.kind === 'answer_line')
    tasks.push({
      id: 'p1-lines',
      page: lines[0]!.page,
      bbox: lines[0]!.bbox ?? { x: 0, y: 0, w: 1, h: 0.3 },
      instruction: 'Antwortlinien ausfüllen',
      kind: 'free_text_inplace',
      confidence: 0.65,
      evidence: [`${lines.length} answer lines detected`],
      targets: lines,
      renderMode: 'native',
      renderConfidence: 'medium',
    })
  }

  const tableCells = answerTargets.filter((t) => t.kind === 'table_cell')
  if (tableCells.length >= 2) {
    tasks.push({
      id: 'p1-table',
      page: tableCells[0]!.page,
      bbox: { x: 0.05, y: 0.2, w: 0.9, h: 0.4 },
      instruction: 'Tabellenzellen ausfüllen',
      kind: 'matching_table',
      confidence: 0.7,
      evidence: [`${tableCells.length} empty table cells`],
      targets: tableCells,
      renderMode: 'overlay',
      renderConfidence: 'medium',
    })
  }

  // Textboxen / Content Controls / Bookmarks – auch parallel zu Cloze.
  const nativeTargets =
    answerTargets.length > 0
      ? answerTargets.filter(
          (t) =>
            t.kind === 'text_field' ||
            t.kind === 'content_control' ||
            t.kind === 'bookmark',
        )
      : document.nativeFields.map((f) => ({
          id: f.id,
          kind:
            f.kind === 'content_control'
              ? ('content_control' as const)
              : f.kind === 'bookmark'
                ? ('bookmark' as const)
                : ('text_field' as const),
          page: f.page ?? 1,
          nativeRef: f.name,
          source: 'native' as const,
        }))

  if (nativeTargets.length > 0) {
    // Avoid duplicating diagram ovals that share textbox targets already used.
    const diagramIds = new Set(
      tasks.find((t) => t.kind === 'diagram_completion')?.targets.map((x) => x.id) ?? [],
    )
    const remaining = nativeTargets.filter((t) => !diagramIds.has(t.id))
    if (remaining.length > 0) {
      tasks.push({
        id: 'p1-native',
        page: remaining[0]!.page,
        bbox: { x: 0, y: 0, w: 1, h: 1 },
        instruction: 'Native Formularfelder / Textboxen',
        kind: 'free_text_inplace',
        confidence: 0.7,
        evidence: [`${remaining.length} native fields`],
        targets: remaining,
        renderMode: 'native',
        renderConfidence: 'medium',
      })
    }
  }

  const openTasks = detectOpenEndedTasks(document.fullText)
  for (const open of openTasks) {
    if (blankTargets.length > 0 && /wortliste|lückentext/i.test(open.instruction)) {
      continue
    }
    tasks.push({
      id: open.id,
      page: open.page,
      bbox: { x: 0.05, y: open.yNorm, w: 0.9, h: 0.08 },
      instruction: open.instruction,
      kind: 'free_text_separate',
      confidence: open.confidence,
      evidence: open.evidence,
      targets: [],
      renderMode: 'appendix',
      renderConfidence: 'high',
    })
  }

  return tasks
}

function extractClozeInstruction(text: string): string {
  const m = text.match(
    /(?:wortliste|füllen sie die lücken|lückentext)[^\n]{0,120}/i,
  )
  return m?.[0]?.trim() || 'Lückentext'
}

function extractDiagramInstruction(text: string): string {
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean)
  const hit = lines.find((l) => DIAGRAM_INSTRUCTION.test(l))
  return hit?.slice(0, 160) || 'Diagramm vervollständigen'
}

function detectOpenEndedTasks(text: string): Array<{
  id: string
  page: number
  yNorm: number
  instruction: string
  confidence: number
  evidence: string[]
}> {
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean)
  const out: Array<{
    id: string
    page: number
    yNorm: number
    instruction: string
    confidence: number
    evidence: string[]
  }> = []
  let openIndex = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (
      !/\b(beschreiben|erklären|erläutern|erörtern|vergleichen|diskutieren|begründen)\b/i.test(
        line,
      )
    ) {
      continue
    }
    openIndex += 1
    out.push({
      id: `p1-open-${openIndex}`,
      page: 1,
      yNorm: Math.min(0.9, i / Math.max(1, lines.length)),
      instruction: line.slice(0, 200),
      confidence: 0.85,
      evidence: ['open-ended operator verb', `line ${i + 1}`],
    })
  }
  return out
}
