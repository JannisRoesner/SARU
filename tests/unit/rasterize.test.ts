import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { rasterizePdf } from '../../server/services/ai/rasterize'

describe('rasterizePdf', () => {
  it('rendert eingebettete Schriften lesbar (kein Tofu)', async () => {
    const buffer = await readFile(join(process.cwd(), 'tests/fixtures/AB1-Sexuelle-Vielfalt.pdf'))
    const pages = await rasterizePdf(buffer, { maxPages: 1, scale: 1 })
    expect(pages).toHaveLength(1)

    const png = Buffer.from(pages[0]!.base64, 'base64')
    expect(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true)

    const { createCanvas, loadImage } = await import('@napi-rs/canvas')
    const image = await loadImage(png)
    const canvas = createCanvas(image.width, image.height)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(image, 0, 0)
    const { data, width, height } = ctx.getImageData(0, 0, image.width, image.height)

    // Oberes Drittel links/mitte = Titel + Fließtext (Comic rechts auslassen).
    let ink = 0
    let total = 0
    const yMin = Math.floor(height * 0.08)
    const yMax = Math.floor(height * 0.22)
    const xMin = Math.floor(width * 0.12)
    const xMax = Math.floor(width * 0.75)
    for (let y = yMin; y < yMax; y += 3) {
      for (let x = xMin; x < xMax; x += 3) {
        const i = (y * width + x) * 4
        total++
        if (data[i]! < 180 || data[i + 1]! < 180 || data[i + 2]! < 180) ink++
      }
    }

    expect(total).toBeGreaterThan(100)
    // Lesbarer Fließtext füllt deutlich mehr dunkle Pixel als leere □-Rahmen.
    expect(ink / total).toBeGreaterThan(0.02)
  })
})
