/**
 * Smoke-Check für PDF-Miniaturen im Docker-Image:
 * @napi-rs/canvas muss laden, pdfjs-dist-Assets müssen auflösbar sein.
 */
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'

const require = createRequire(import.meta.url)

async function main() {
  console.log('[check-canvas] platform', process.platform, process.arch, 'node', process.version)

  const { createCanvas } = await import('@napi-rs/canvas')
  const canvas = createCanvas(16, 16)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, 16, 16)
  const buf = canvas.toBuffer('image/png')
  if (buf.length < 50) throw new Error('PNG-Ausgabe unerwartet klein')
  console.log('[check-canvas] canvas OK', buf.length, 'bytes')

  const root = dirname(require.resolve('pdfjs-dist/package.json'))
  for (const rel of ['standard_fonts', 'cmaps', 'wasm', 'legacy/build/pdf.mjs']) {
    const p = join(root, rel)
    if (!existsSync(p)) throw new Error(`pdfjs-dist Asset fehlt: ${rel}`)
    console.log('[check-canvas] pdfjs', rel, 'OK')
  }
}

main().catch((error) => {
  console.error('[check-canvas] FAIL', error)
  process.exit(1)
})
