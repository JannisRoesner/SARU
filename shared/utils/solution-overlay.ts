/** Feldtyp für Overlay-Darstellung (Browser-Vorschau ↔ PDF). */
export type OverlayFieldType = 'luecke' | 'freitext'

/**
 * Feldtyp für Vorschau/PDF-Schrift: expliziter Typ, sonst Geometrie/Text
 * (analog inferAnswerFieldType in document-fill.ts, ohne Blank-Region).
 */
export function overlayFieldType(input: {
  fieldType?: string | null
  bboxH?: number | null
  answer?: string | null
}): OverlayFieldType {
  if (input.fieldType === 'freitext' || input.fieldType === 'luecke') {
    return input.fieldType
  }
  const h = input.bboxH
  if (h != null && Number.isFinite(h) && h >= 0.045) return 'freitext'
  const text = input.answer ?? ''
  if (text.length > 90 || /\n/.test(text)) return 'freitext'
  return 'luecke'
}

/**
 * Schriftgröße analog zu server/services/ai/document-fill.ts (fontSizeForField).
 * `boxHeight` in CSS-Pixeln der angezeigten Box (Anteil der Seitenvorschau).
 */
export function overlayFontSizePx(
  boxHeightPx: number,
  fieldType: OverlayFieldType = 'luecke',
): number {
  if (!Number.isFinite(boxHeightPx) || boxHeightPx <= 0) {
    return fieldType === 'freitext' ? 9 : 11
  }
  if (fieldType === 'freitext') {
    return Math.min(11, Math.max(7, boxHeightPx * 0.2))
  }
  return Math.min(14, Math.max(8, boxHeightPx * 0.85))
}

/** Entspricht SOLUTION_INK in document-fill (rgb 0.12, 0.22, 0.55). */
export const SOLUTION_INK_CSS = 'rgb(31, 56, 140)'
