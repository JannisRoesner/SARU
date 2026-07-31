import {
  fillDocxDocument,
  type FilledDocument,
  type StructuredSolution,
} from '../../document-fill'
import type { TaskBlock } from '../types'

export interface DocxRenderOptions {
  title: string
  notice?: string
  sourceFileName: string
  tasks: TaskBlock[]
}

/**
 * Rendert DOCX aufgabenbasiert: In-place für Cloze/native, Anhang für offene Tasks.
 */
export function renderDocxSolution(
  source: Buffer,
  solution: StructuredSolution,
  options: DocxRenderOptions,
): FilledDocument {
  const hasAppendix = options.tasks.some((t) => t.renderMode === 'appendix')
  const hasOverlayOrNative = options.tasks.some(
    (t) => t.renderMode === 'overlay' || t.renderMode === 'native',
  )

  const result = fillDocxDocument(source, solution, {
    title: options.title,
    notice: options.notice,
    appendOpenAnswers: hasAppendix && hasOverlayOrNative,
  })

  return {
    buffer: result.buffer,
    fileName: options.sourceFileName.replace(/\.docx$/i, '') + '-musterloesung.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    strategy: result.strategy,
    summary: solution.summary,
  }
}
