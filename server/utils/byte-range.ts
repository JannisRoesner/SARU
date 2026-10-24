/**
 * Wertet einen HTTP-`Range`-Header für genau einen Byte-Bereich aus (RFC 9110).
 * - `null`: kein oder nicht unterstützter Header (mehrere Bereiche, andere Einheit) → ganze Datei.
 * - `'ungueltig'`: Bereich liegt außerhalb der Datei → 416.
 * - sonst Start und Ende (inklusive).
 */
export function parseByteRange(header: string | undefined | null, groesse: number): { start: number; end: number } | 'ungueltig' | null {
  if (!header) return null
  const treffer = /^bytes=(\d*)-(\d*)$/i.exec(header.trim())
  if (!treffer) return null
  const [, von, bis] = treffer
  if (!von && !bis) return null
  if (groesse <= 0) return 'ungueltig'

  if (!von) {
    // Suffix: die letzten n Bytes.
    const n = Number(bis)
    if (n <= 0) return 'ungueltig'
    return { start: Math.max(0, groesse - n), end: groesse - 1 }
  }

  const start = Number(von)
  if (start >= groesse) return 'ungueltig'
  const end = bis ? Math.min(Number(bis), groesse - 1) : groesse - 1
  if (end < start) return 'ungueltig'
  return { start, end }
}
