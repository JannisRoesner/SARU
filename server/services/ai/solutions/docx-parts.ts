import { strFromU8, unzipSync } from 'fflate'

const PART_PRIORITY = [
  /^word\/document\.xml$/i,
  /^word\/header\d*\.xml$/i,
  /^word\/footer\d*\.xml$/i,
  /^word\/footnotes\.xml$/i,
  /^word\/endnotes\.xml$/i,
]

/** Listet relevante Word-XML-Parts in Scan-Reihenfolge. */
export function listDocxXmlParts(source: Buffer): string[] {
  const files = unzipSync(new Uint8Array(source))
  const names = Object.keys(files).filter((name) =>
    PART_PRIORITY.some((re) => re.test(name)),
  )
  return names.sort((a, b) => {
    const ai = PART_PRIORITY.findIndex((re) => re.test(a))
    const bi = PART_PRIORITY.findIndex((re) => re.test(b))
    if (ai !== bi) return ai - bi
    return a.localeCompare(b)
  })
}

/** Liest einen XML-Part als String (oder null). */
export function readDocxPart(source: Buffer, part: string): string | null {
  const files = unzipSync(new Uint8Array(source))
  const entry = files[part]
  if (!entry) return null
  return strFromU8(entry)
}

/** Heuristische Seitennummer: document.xml = 1, Header/Footer = 1. */
export function pageForDocxPart(part: string): number {
  if (/document\.xml$/i.test(part)) return 1
  return 1
}

export function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}
