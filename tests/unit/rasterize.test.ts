import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { rasterizePdf } from '../../server/services/ai/rasterize'

describe('rasterizePdf', () => {
  it('rendert die erste Seite als PNG', async () => {
    const buffer = await readFile(join(process.cwd(), 'tests/fixtures/sample.pdf'))
    const pages = await rasterizePdf(buffer, { maxPages: 1, scale: 1 })
    expect(pages).toHaveLength(1)

    const png = Buffer.from(pages[0]!.base64, 'base64')
    expect(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true)
    expect(png.length).toBeGreaterThan(500)
  })
})
