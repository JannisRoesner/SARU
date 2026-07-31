import { strFromU8, unzipSync } from 'fflate'
import type { NativeField } from './types'
import type { AnswerTarget } from './types'

export interface DocxAnalysis {
  nativeFields: NativeField[]
  targets: AnswerTarget[]
  fullText: string
}

/**
 * Erfasst native DOCX-Ziele: Content Controls, Bookmarks, Textfelder.
 */
export function analyzeDocxTargets(source: Buffer): DocxAnalysis {
  const files = unzipSync(new Uint8Array(source))
  const docEntry = files['word/document.xml']
  if (!docEntry) {
    return { nativeFields: [], targets: [], fullText: '' }
  }
  const xml = strFromU8(docEntry)
  const nativeFields: NativeField[] = []
  const targets: AnswerTarget[] = []

  // Content Controls
  const sdtRe = /<w:sdt>([\s\S]*?)<\/w:sdt>/g
  let m: RegExpExecArray | null
  let i = 0
  while ((m = sdtRe.exec(xml)) != null) {
    const inner = m[1]!
    const alias =
      inner.match(/<w:alias[^>]*w:val="([^"]+)"/)?.[1] ??
      inner.match(/<w:tag[^>]*w:val="([^"]+)"/)?.[1] ??
      `sdt-${i}`
    const id = `cc-${i}`
    nativeFields.push({ id, name: alias, kind: 'content_control', page: 1 })
    targets.push({
      id,
      kind: 'content_control',
      page: 1,
      nativeRef: alias,
    })
    i += 1
  }

  // Bookmarks
  const bmRe = /<w:bookmarkStart[^>]*w:name="([^"]+)"[^>]*>/g
  let b: RegExpExecArray | null
  let bi = 0
  while ((b = bmRe.exec(xml)) != null) {
    const name = b[1]!
    if (name.startsWith('_')) continue // interne Bookmarks
    const id = `bm-${bi}`
    nativeFields.push({ id, name, kind: 'bookmark', page: 1 })
    targets.push({ id, kind: 'bookmark', page: 1, nativeRef: name })
    bi += 1
  }

  // Plain text for wordlist / segmentation
  const texts = [...xml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((x) =>
    decodeXml(x[1] ?? ''),
  )
  const fullText = texts.join('')

  return { nativeFields, targets, fullText }
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}
