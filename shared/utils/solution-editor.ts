import type { StoredSolutionAnswer } from '~~/server/database/schema/materials'

/** Bearbeitungsmodus der Musterlösungs-Nachbearbeitung. */
export type SolutionEditorMode = 'overlay' | 'appendix' | 'hybrid'

const PDF_EDITOR_STRATEGIES: Record<string, SolutionEditorMode> = {
  pdf_overlay: 'overlay',
  pdf_separate: 'appendix',
  pdf_hybrid: 'hybrid',
}

/** Ermittelt den Editor-Modus aus der fillStrategy (null = kein PDF-Editor). */
export function solutionEditorMode(
  fillStrategy: string | null | undefined,
): SolutionEditorMode | null {
  if (!fillStrategy) return null
  return PDF_EDITOR_STRATEGIES[fillStrategy] ?? null
}

/** Antwort liegt im Overlay (Lücke/Position), nicht im Anhang. */
export function istOverlayAntwort(
  antwort: StoredSolutionAnswer,
  modus: SolutionEditorMode,
): boolean {
  if (modus === 'appendix') return false
  // Freitext ohne Position gehört nie auf das Quell-PDF (weder overlay noch hybrid).
  if (
    antwort.blankIndex == null &&
    !antwort.bbox &&
    (antwort.fieldType === 'freitext' || !antwort.fieldType)
  ) {
    return false
  }
  if (modus === 'overlay') {
    return (
      antwort.bbox != null ||
      antwort.blankIndex != null ||
      antwort.fieldType === 'luecke'
    )
  }
  return (
    antwort.blankIndex != null ||
    antwort.bbox != null ||
    antwort.fieldType === 'luecke'
  )
}

/**
 * Asset für die linke Seitenvorschau.
 * appendix → erzeugtes Lösungs-PDF; overlay/hybrid → Quell-PDF (Fallback: Lösung).
 */
export function solutionEditorBackgroundAssetId(
  modus: SolutionEditorMode,
  solutionAssetId: string | null | undefined,
  sourceAssetId: string | null | undefined,
): string | null {
  if (modus === 'appendix') return solutionAssetId ?? null
  return sourceAssetId || solutionAssetId || null
}

/**
 * Normierte Overlay-Box – oder null, wenn bewusst keine Position existiert
 * (free_text_separate / pdf_separate). Keine künstliche Default-bbox.
 */
export function overlayBboxVon(
  antwort: StoredSolutionAnswer,
): { x: number; y: number; w: number; h: number } | null {
  if (
    antwort.blankIndex == null &&
    !antwort.bbox &&
    (antwort.fieldType === 'freitext' || !antwort.fieldType)
  ) {
    return null
  }
  const b = antwort.bbox
  return {
    x: b?.x ?? 0.35,
    y: b?.y ?? 0.2,
    w: b?.w ?? (antwort.fieldType === 'freitext' ? 0.45 : 0.28),
    h: b?.h ?? (antwort.fieldType === 'freitext' ? 0.08 : 0.028),
  }
}
