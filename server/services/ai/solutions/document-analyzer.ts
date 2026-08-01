import type { PdfBlankRegion, TextBlankInfo } from '../document-fill'
import type {
  AnswerTarget,
  DocumentModel,
  DocumentPage,
  NativeField,
  ShapeBlock,
  TextBlock,
} from './types'

export interface AnalyzeDocumentInput {
  fullText: string
  pages?: DocumentPage[]
  pdfBlanks?: PdfBlankRegion[]
  docxBlanks?: TextBlankInfo[]
  nativeFields?: NativeField[]
  shapes?: ShapeBlock[]
  /** Explizite AnswerTargets aus DOCX-Analyse (Textboxen, Shapes, …). */
  answerTargets?: AnswerTarget[]
}

/**
 * Baut eine gemeinsame DocumentModel aus Extrakt + erkannten Lücken.
 */
export function analyzeDocument(input: AnalyzeDocumentInput): DocumentModel {
  const fullText = (input.fullText ?? '').trim()
  const paragraphs = fullText
    .split(/\n{2,}|\r\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)

  const textBlocks: TextBlock[] = paragraphs.map((text, i) => ({
    id: `tb-${i}`,
    page: 1,
    text,
    bbox: null,
  }))

  if (textBlocks.length === 0 && fullText) {
    const lines = fullText.split(/\n/).map((l) => l.trim()).filter(Boolean)
    for (let i = 0; i < lines.length; i++) {
      textBlocks.push({ id: `tb-${i}`, page: 1, text: lines[i]!, bbox: null })
    }
  }

  const pages: DocumentPage[] =
    input.pages && input.pages.length > 0
      ? input.pages
      : [{ index: 0, width: 595, height: 842 }]

  return {
    pages,
    textBlocks,
    tables: [],
    images: [],
    nativeFields: input.nativeFields ?? [],
    shapes: input.shapes ?? [],
    fullText,
  }
}
