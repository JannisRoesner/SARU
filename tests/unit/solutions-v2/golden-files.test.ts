import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { detectPdfAnswerLines } from '../../../server/services/ai/solutions/pdf-answer-lines'
import { buildPdfLayoutDocumentV2 } from '../../../server/services/ai/solutions-v2/layout-document'

interface GoldenManifest {
  cases: Array<{
    id: string
    file: string
    expectedPages: number
    expectedAnswerLines: number
  }>
}

const fixtureRoot = fileURLToPath(new URL('../../fixtures/solutions-v2/', import.meta.url))

describe('solution pipeline v2 golden files', () => {
  it('erkennt die reale Rasieren-Freitextgeometrie vollständig und reproduzierbar', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('../../fixtures/solutions-v2/golden.json', import.meta.url), 'utf8'),
    ) as GoldenManifest
    const golden = manifest.cases.find((entry) => entry.id === 'rasieren-freitext')!
    const source = await readFile(`${fixtureRoot}${golden.file}`)
    const [layout, first, second] = await Promise.all([
      buildPdfLayoutDocumentV2(source),
      detectPdfAnswerLines(source),
      detectPdfAnswerLines(source),
    ])

    expect(layout.pages).toHaveLength(golden.expectedPages)
    expect(first.targets).toHaveLength(golden.expectedAnswerLines)
    expect(second.targets).toEqual(first.targets)
    expect(first.targets.every((target) => target.page === 1 && target.bbox)).toBe(true)
  })
})
