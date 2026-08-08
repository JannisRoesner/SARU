import { PDFDocument } from 'pdf-lib'
import {
  buildAnswerListPdf,
  fillPdfAcroForm,
  overlayPdfAnswers,
  type FilledDocument,
  type StructuredSolution,
} from '../../document-fill'
import type { TaskBlock } from '../types'

export interface PdfRenderOptions {
  title: string
  notice?: string
  sourceFileName: string
  tasks: TaskBlock[]
}

/**
 * Rendert PDF-Musterlösung aufgabenbasiert:
 * - Overlay-Tasks → Text auf Originalseiten
 * - Appendix-Tasks → angehängte Lösungsseiten
 * Strategie: pdf_hybrid wenn beides, sonst pdf_overlay / pdf_separate.
 */
export async function renderPdfSolution(
  source: Buffer,
  solution: StructuredSolution,
  options: PdfRenderOptions,
): Promise<FilledDocument> {
  // PDF: native In-place-Ziele (Antwortlinien) ebenfalls als Overlay zeichnen.
  const overlayTasks = options.tasks.filter(
    (t) => t.renderMode === 'overlay' || t.renderMode === 'native',
  )
  const appendixTasks = options.tasks.filter((t) => t.renderMode === 'appendix')

  const acro = await fillPdfAcroForm(source, solution)
  if (acro && overlayTasks.length === 0 && appendixTasks.length === 0) {
    return {
      buffer: acro.buffer,
      fileName: options.sourceFileName.replace(/\.pdf$/i, '') + '-musterloesung.pdf',
      mimeType: 'application/pdf',
      strategy: 'pdf_acroform',
      summary: solution.summary,
    }
  }

  const overlayAnswers = filterAnswersForTasks(solution, overlayTasks, {
    includeAllIfNoTasks: appendixTasks.length === 0,
  })
  const appendixAnswers = filterAnswersForTasks(solution, appendixTasks, {
    includeAllIfNoTasks: overlayTasks.length === 0 && overlayAnswers.answers.length === 0,
  })

  const wantsOverlay = overlayAnswers.answers.length > 0 || overlayTasks.length > 0
  const wantsAppendix = appendixAnswers.answers.length > 0

  if (!wantsOverlay && wantsAppendix) {
    const buffer = await buildAnswerListPdf(options.title, appendixAnswers, {
      notice: options.notice,
    })
    return {
      buffer,
      fileName: options.sourceFileName.replace(/\.pdf$/i, '') + '-musterloesung.pdf',
      mimeType: 'application/pdf',
      strategy: 'pdf_separate',
      summary: solution.summary,
    }
  }

  let base = source
  if (wantsOverlay) {
    // Die Antworten wurden vor diesem Schritt bereits mit dem kanonischen
    // Zielinventar angereichert. Eine erneute, möglicherweise unvollständige
    // Lückenerkennung darf diese bboxes nicht anhand gleicher Indizes ersetzen.
    const overlay = await overlayPdfAnswers(base, overlayAnswers, { preferBBox: true })
    base = overlay.buffer
  }

  if (wantsAppendix) {
    const appendixPdf = await buildAnswerListPdf(
      `${options.title} – Offene Aufgaben`,
      appendixAnswers,
      { notice: options.notice },
    )
    base = await mergePdfs(base, appendixPdf)
    return {
      buffer: base,
      fileName: options.sourceFileName.replace(/\.pdf$/i, '') + '-musterloesung.pdf',
      mimeType: 'application/pdf',
      strategy: 'pdf_hybrid',
      summary: solution.summary,
    }
  }

  return {
    buffer: base,
    fileName: options.sourceFileName.replace(/\.pdf$/i, '') + '-musterloesung.pdf',
    mimeType: 'application/pdf',
    strategy: wantsOverlay ? 'pdf_overlay' : 'pdf_separate',
    summary: solution.summary,
  }
}

function filterAnswersForTasks(
  solution: StructuredSolution,
  tasks: TaskBlock[],
  opts: { includeAllIfNoTasks: boolean },
): StructuredSolution {
  if (tasks.length === 0) {
    return opts.includeAllIfNoTasks
      ? solution
      : { ...solution, answers: [] }
  }

  const inplaceTargetIds = new Set(
    tasks
      .filter(
        (task) =>
          task.kind === 'free_text_inplace' ||
          task.kind === 'matching_table' ||
          task.kind === 'diagram_completion',
      )
      .flatMap((task) => task.targets)
      .filter(
        (target) =>
          target.kind === 'answer_line' ||
          target.kind === 'text_field' ||
          target.kind === 'content_control' ||
          target.kind === 'table_cell' ||
          target.kind === 'choice_cell' ||
          target.kind === 'shape_box' ||
          target.kind === 'shape_oval',
      )
      .map((target) => target.id),
  )
  if (inplaceTargetIds.size > 0) {
    const choiceTargetIds = new Set(
      tasks
        .flatMap((task) => task.targets)
        .filter((target) => target.kind === 'choice_cell')
        .map((target) => target.id),
    )
    const matched = solution.answers.filter(
      (answer) => answer.targetId && inplaceTargetIds.has(answer.targetId),
    )
    const answers = matched.length
      ? matched
      : solution.answers.filter(
          (answer) =>
            answer.fieldType === 'freitext' &&
            answer.blankIndex == null &&
            Boolean(answer.bbox),
        )
    return {
      ...solution,
      answers: answers.map((answer) =>
        answer.targetId && choiceTargetIds.has(answer.targetId)
          ? { ...answer, answer: 'X', fieldType: 'luecke' as const }
          : answer,
      ),
    }
  }

  const blankIndexes = new Set<number>()
  let hasBlankTargets = false
  for (const task of tasks) {
    for (const target of task.targets) {
      if (target.kind === 'blank' && typeof target.blankIndex === 'number') {
        blankIndexes.add(target.blankIndex)
        hasBlankTargets = true
      }
    }
  }

  // Freitext-Appendix: Antworten ohne blankIndex oder fieldType freitext.
  if (!hasBlankTargets) {
    const answers = solution.answers.filter(
      (a) =>
        (a.fieldType === 'freitext' || a.blankIndex == null) &&
        !a.targetId,
    )
    return {
      ...solution,
      answers: answers.length ? answers : solution.answers,
    }
  }

  return {
    ...solution,
    answers: solution.answers.filter(
      (a) => typeof a.blankIndex === 'number' && blankIndexes.has(a.blankIndex),
    ),
  }
}

async function mergePdfs(first: Buffer, second: Buffer): Promise<Buffer> {
  const out = await PDFDocument.create()
  const a = await PDFDocument.load(first, { ignoreEncryption: true })
  const b = await PDFDocument.load(second, { ignoreEncryption: true })
  const pagesA = await out.copyPages(a, a.getPageIndices())
  for (const p of pagesA) out.addPage(p)
  const pagesB = await out.copyPages(b, b.getPageIndices())
  for (const p of pagesB) out.addPage(p)
  return Buffer.from(await out.save())
}
