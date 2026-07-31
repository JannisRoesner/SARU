import type { PdfBlankRegion, TextBlankInfo } from '../document-fill'
import type { CandidateBank } from './types'
import type { AnswerTarget, DocumentModel, TaskBlock } from './types'

export interface SegmentTasksInput {
  document: DocumentModel
  pdfBlanks?: PdfBlankRegion[]
  docxBlanks?: TextBlankInfo[]
  candidateBank?: CandidateBank | null
}

/**
 * Segmentiert Aufgabenblöcke (MVP):
 * - Cloze-Block wenn Lücken vorhanden (+ optional Wortliste)
 * - Freitext-Blöcke für nummerierte „Beschreiben/Erklären“-Aufgaben ohne Lücken
 */
export function segmentTasks(input: SegmentTasksInput): TaskBlock[] {
  const { document, pdfBlanks = [], docxBlanks = [], candidateBank } = input
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
    })
  }

  // Offene Aufgaben: nummerierte Operator-Sätze ohne eigene Lücken in diesem Block.
  const openTasks = detectOpenEndedTasks(document.fullText)
  for (const open of openTasks) {
    // Wenn bereits ein Cloze-Task existiert und der Text die Wortliste erwähnt, nicht doppelt.
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
    })
  }

  // Native Felder als mögliche In-place-Ziele.
  if (document.nativeFields.length > 0 && blankTargets.length === 0) {
    tasks.push({
      id: 'p1-native',
      page: 1,
      bbox: { x: 0, y: 0, w: 1, h: 1 },
      instruction: 'Native Formularfelder / Content Controls',
      kind: 'free_text_inplace',
      confidence: 0.7,
      evidence: [`${document.nativeFields.length} native fields`],
      targets: document.nativeFields.map((f) => ({
        id: f.id,
        kind: f.kind === 'content_control' ? 'content_control' : f.kind === 'bookmark' ? 'bookmark' : 'text_field',
        page: f.page ?? 1,
        nativeRef: f.name,
      })),
      renderMode: 'native',
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

  const op =
    /\b(beschreiben sie|erklären sie|erläutern sie|erörtern sie|vergleichen sie|diskutieren sie|nehmen sie stellung|begründen sie|nennen sie|stellen sie dar)\b/i

  let idx = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (!op.test(line)) continue
    // Überspringe Zeilen, die klar zu einem Lückentext gehören.
    if (/wortliste|_{3,}/i.test(line)) continue
    idx += 1
    out.push({
      id: `p1-open-${idx}`,
      page: 1,
      yNorm: Math.min(0.9, 0.1 + i * 0.02),
      instruction: line.slice(0, 240),
      confidence: 0.8,
      evidence: ['open-ended operator verb', `line ${i + 1}`],
    })
  }
  return out
}
