/** Anzeige „KI · modellname“ für KI-Musterlösungen (Autor/Credit). */
export function kiAutorAnzeige(
  aiMeta?: { model?: string | null; provider?: string | null } | null,
  author?: string | null,
): string | null {
  const model = aiMeta?.model?.trim()
  if (model) return `KI · ${model}`
  const existing = author?.trim()
  if (existing) {
    if (/^ki\s*[·•\-–]/i.test(existing) || /^ki\b/i.test(existing)) return existing
    return `KI · ${existing}`
  }
  if (aiMeta?.provider?.trim()) return `KI · ${aiMeta.provider.trim()}`
  return null
}

export function istKiMusterloesung(material: {
  materialType?: string | null
  origin?: string | null
}): boolean {
  return material.origin === 'ki' && material.materialType === 'musterloesung'
}
