const BOILERPLATE = [
  /^Aus dem Schulportal/i,
  /^Manuell geprüfter KI-Entwurf/i,
  /^Automatisch erstellte Musterlösung/i,
]

export function isBoilerplateDescription(value: string | null | undefined): boolean {
  const text = value?.replace(/\s+/g, ' ').trim() ?? ''
  if (!text) return true
  return BOILERPLATE.some((pattern) => pattern.test(text))
}

/** Erste inhaltliche Beschreibung, keine Herkunfts- oder Prozessfloskel. */
export function chooseMaterialDescription(
  ...candidates: (string | null | undefined)[]
): string | null {
  for (const candidate of candidates) {
    const text = candidate?.replace(/\s+/g, ' ').trim()
    if (text && !isBoilerplateDescription(text)) return text
  }
  return null
}
