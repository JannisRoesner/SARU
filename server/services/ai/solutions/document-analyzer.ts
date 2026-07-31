import type { PdfBlankRegion, TextBlankInfo } from '../document-fill'
import type { DocumentModel, DocumentPage, NativeField, TextBlock } from './types'

export interface AnalyzeDocumentInput {
  fullText: string
  pages?: DocumentPage[]
  pdfBlanks?: PdfBlankRegion[]
  docxBlanks?: TextBlankInfo[]
  nativeFields?: NativeField[]
}

/**
 * Baut eine gemeinsame DocumentModel aus Extrakt + erkannten Lücken.
 * MVP: Textblöcke aus Absätzen, Targets kommen später aus dem Segmenter.
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

  // Einzeilige Blöcke als Fallback, wenn keine Absätze.
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
    shapes: [],
    fullText,
  }
}
