import { blankRegionToBBox, type PdfBlankRegion, type TextBlankInfo } from '../document-fill'
import type { AnswerTarget, CandidateBank, DocumentModel, TaskBlock } from './types'
import {
  detectWorksheetTasks,
  type WorksheetTaskUnit,
} from './worksheet-tasks'
import { candidateBankFromWords } from './candidate-bank'

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

  const rawBlankTargets: AnswerTarget[] = pdfBlanks.length
    ? pdfBlanks.map((b) => ({
        id: `blank-${b.blankIndex}`,
        kind: 'blank' as const,
        page: b.pageIndex + 1,
        blankIndex: b.blankIndex,
        leftText: b.leftText,
        rightText: b.rightText,
        // V2 rendert ausschließlich anhand des kanonischen Plans. Die
        // Geometrie muss daher bereits hier die reale PDF-Position enthalten;
        // der frühere Platzhalter (0,0) war nur für den alten Nachbearbeitungs-
        // pfad brauchbar und führte zu Overlays oben links auf der Seite.
        bbox: blankRegionToBBox(
          b,
          document.pages[b.pageIndex]?.width ?? 595,
          document.pages[b.pageIndex]?.height ?? 842,
        ),
      }))
    : docxBlanks.map((b) => ({
        id: `blank-${b.blankIndex}`,
        kind: 'blank' as const,
        page: 1,
        blankIndex: b.blankIndex,
        leftText: b.leftText,
        rightText: b.rightText,
      }))

  const worksheetUnits = detectWorksheetTasks(document.fullText)
  const openUnits = worksheetUnits.filter((u) => u.kind === 'open_ended')
  const blankTargets = suppressLayoutBlanksWhenWorksheetOpen(
    rawBlankTargets,
    worksheetUnits,
  )

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
  } else if (uniqueShapes.filter((t) => t.kind === 'answer_line').length > 0) {
    const lines = uniqueShapes.filter((t) => t.kind === 'answer_line')
    if (openUnits.length === lines.length) {
      for (let index = 0; index < lines.length; index++) {
        const line = lines[index]!
        const open = openUnits[index]!
        tasks.push({
          id: `p${line.page}-open-lines-${index + 1}`,
          page: line.page,
          bbox: line.bbox ?? { x: 0, y: 0, w: 1, h: 0.3 },
          instruction: open.instruction,
          kind: 'free_text_inplace',
          confidence: Math.min(0.95, open.confidence + 0.05),
          evidence: [...open.evidence, 'matching answer line block detected'],
          targets: [line],
          renderMode: 'overlay',
          renderConfidence: 'high',
        })
      }
    } else {
      tasks.push({
        id: 'p1-lines',
        page: lines[0]!.page,
        bbox: lines[0]!.bbox ?? { x: 0, y: 0, w: 1, h: 0.3 },
        instruction: openUnits[0]?.instruction ?? 'Antwortlinien ausfüllen',
        kind: 'free_text_inplace',
        confidence: 0.7,
        evidence: [`${lines.length} answer line blocks detected`],
        targets: lines,
        // Overlay: PDF zeichnet auf die Linien; DOCX-native bleibt über Classifier möglich.
        renderMode: 'overlay',
        renderConfidence: 'medium',
      })
    }
  }

  const tableCells = answerTargets.filter((t) => t.kind === 'table_cell')
  const choiceCells = answerTargets.filter((t) => t.kind === 'choice_cell')
  if (choiceCells.length >= 4) {
    tasks.push({
      id: `p${choiceCells[0]!.page}-choice`,
      page: choiceCells[0]!.page,
      bbox: { x: 0.05, y: 0.2, w: 0.9, h: 0.4 },
      instruction: extractChoiceInstruction(document.fullText),
      kind: 'matching_table',
      confidence: 0.9,
      evidence: [`${choiceCells.length} exclusive choice cells`],
      targets: choiceCells,
      renderMode: 'overlay',
      renderConfidence: 'high',
    })
  }
  if (tableCells.length >= 2) {
    tasks.push({
      id: 'p1-table',
      page: tableCells[0]!.page,
      bbox: { x: 0.05, y: 0.2, w: 0.9, h: 0.4 },
      instruction: extractTableInstruction(document.fullText),
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

  const hasInplaceAnswerLines = tasks.some(
    (t) =>
      t.kind === 'free_text_inplace' &&
      t.targets.some((target) => target.kind === 'answer_line'),
  )
  const hasDiagram = tasks.some((t) => t.kind === 'diagram_completion')
  const hasTableCells = tasks.some((t) => t.kind === 'matching_table')

  // Bildbeschriftung ohne erkannte Shapes → Appendix mit Wortliste.
  for (const unit of worksheetUnits.filter((u) => u.kind === 'image_labeling')) {
    if (hasDiagram) continue
    const bank =
      unit.terms && unit.terms.length >= 2
        ? candidateBankFromWords(unit.terms, unit.terms.length, 'instruction')
        : candidateBank
    tasks.push({
      id: `p${unit.page}-label`,
      page: unit.page,
      bbox: { x: 0.05, y: unit.yNorm, w: 0.9, h: 0.12 },
      instruction: unit.instruction,
      kind: 'matching_inline',
      confidence: unit.confidence,
      evidence: unit.evidence,
      targets: [],
      candidateBank: bank ?? undefined,
      renderMode: 'appendix',
      renderConfidence: 'medium',
    })
  }

  // Glossar → eine Freitext-Aufgabe (Definitionen je Begriff).
  for (const unit of worksheetUnits.filter((u) => u.kind === 'glossary')) {
    tasks.push({
      id: `p${unit.page}-glossary`,
      page: unit.page,
      bbox: { x: 0.05, y: unit.yNorm, w: 0.9, h: 0.2 },
      instruction: unit.terms?.length
        ? `${unit.instruction} Begriffe: ${unit.terms.join(', ')}`
        : unit.instruction,
      kind: 'free_text_separate',
      confidence: unit.confidence,
      evidence: unit.evidence,
      targets: [],
      renderMode: 'appendix',
      renderConfidence: 'high',
    })
  }

  for (let i = 0; i < openUnits.length; i++) {
    const open = openUnits[i]!
    if (blankTargets.length > 0 && /wortliste|füllen sie die lücken/i.test(open.instruction)) {
      continue
    }
    // Schreiblinien vor Ort → kein zusätzlicher Appendix nur wegen „erklären/beschreiben“.
    if (hasInplaceAnswerLines) continue
    // Eine Tabellenanweisung kann „recherchiere“ enthalten und wird von der
    // Textheuristik sonst zusätzlich als offene Aufgabe samt Anhang angelegt.
    if (hasTableCells && /\b(?:tabelle|tabellarisch)\b/i.test(open.instruction)) continue
    tasks.push({
      id: `p${open.page}-open-${i + 1}`,
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

function extractTableInstruction(text: string): string {
  const match = text.match(
    /(?:^|\n)\s*(?:\d+[.)]?\s*)?[^\n]{0,220}\b(?:tabelle|tabellarisch)[^\n]{0,220}/i,
  )
  return match?.[0]?.trim() || 'Leere Tabellenzellen ausfüllen'
}

function extractChoiceInstruction(text: string): string {
  const match = text.match(/[^\n]{0,220}\b(?:kreuz\w*|ankreuz\w*)\b[^\n]{0,220}/i)
  return match?.[0]?.trim() || 'Kreuze pro Aussage genau eine passende Antwort an'
}

/**
 * Einzelne Header-Gaps (z. B. Begriff|Bedeutung) nicht als Cloze werten,
 * wenn das Blatt klar offene/Glossar-/Beschriftungsaufgaben hat.
 */
function suppressLayoutBlanksWhenWorksheetOpen(
  blanks: AnswerTarget[],
  worksheetUnits: WorksheetTaskUnit[],
): AnswerTarget[] {
  if (blanks.length === 0) return blanks
  const openLike = worksheetUnits.filter(
    (u) =>
      u.kind === 'open_ended' ||
      u.kind === 'glossary' ||
      u.kind === 'image_labeling',
  )
  if (openLike.length < 2) return blanks
  if (blanks.length > 2) return blanks

  return blanks.filter((b) => {
    const left = (b.leftText ?? '').trim()
    const right = (b.rightText ?? '').trim()
    if (/^begriff/i.test(left) && /^bedeutung/i.test(right)) return false
    if (left.length > 0 && left.length < 24 && right.length > 0 && right.length < 24) {
      if (!/[.!?…]/.test(left) && !/[.!?…]/.test(right)) return false
    }
    return true
  })
}

function extractClozeInstruction(text: string): string {
  const numberMatch = text.match(
    /ordn\w*.{0,120}nummern?|nummern?\s+der\s+begriffe|(?:nummern?|zahlen|ziffern)\s+(?:eintragen|zuordnen)|trage\s+(?:die\s+)?(?:nummern?|zahlen|ziffern)[^\n]{0,80}/i,
  )
  if (numberMatch?.[0]) return numberMatch[0].trim().slice(0, 200)

  const m = text.match(
    /(?:wortliste|füllen sie die lücken)[^\n]{0,120}/i,
  )
  return m?.[0]?.trim() || 'Cloze-Aufgabe'
}

function extractDiagramInstruction(text: string): string {
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean)
  const hit = lines.find((l) => DIAGRAM_INSTRUCTION.test(l))
  return hit?.slice(0, 160) || 'Diagramm vervollständigen'
}
