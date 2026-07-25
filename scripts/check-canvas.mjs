/**
 * Smoke-Check für PDF-Miniaturen im Docker-Image:
 * @napi-rs/canvas muss laden, pdfjs-dist inkl. Worker müssen auflösbar sein,
 * und der Fake-Worker muss sich importieren lassen.
 */
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)

function assertExists(path, label) {
  if (!existsSync(path)) throw new Error(`${label} fehlt: ${path}`)
  console.log('[check-canvas]', label, 'OK')
}

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
  for (const rel of [
    'standard_fonts',
    'cmaps',
    'wasm',
    'legacy/build/pdf.mjs',
    'legacy/build/pdf.worker.mjs',
  ]) {
    assertExists(join(root, rel), `pdfjs ${rel}`)
  }

  // Nitro-Trace-Kopie muss denselben Worker enthalten (Produktionspfad).
  const nitroPdfjs = join(process.cwd(), '.output/server/node_modules/pdfjs-dist')
  if (existsSync(join(process.cwd(), '.output/server'))) {
    for (const rel of ['legacy/build/pdf.mjs', 'legacy/build/pdf.worker.mjs', 'cmaps', 'standard_fonts', 'wasm']) {
      assertExists(join(nitroPdfjs, rel), `nitro pdfjs ${rel}`)
    }
  } else {
    console.log('[check-canvas] .output/server fehlt – Nitro-Assets übersprungen')
  }

  // Fake-Worker wie in Node/Produktion: relative Default-URL schlägt ohne Worker fehl.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
    join(root, 'legacy/build/pdf.worker.mjs'),
  ).href

  // Minimales leeres PDF (eine Seite).
  const minimalPdf = Buffer.from(
    '%PDF-1.1\n1 0 obj<<>>endobj\n2 0 obj<</Length 0>>stream\nendstream\nendobj\n3 0 obj<</Type/Page/Parent 4 0 R/MediaBox[0 0 3 3]/Contents 2 0 R>>endobj\n4 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n5 0 obj<</Type/Catalog/Pages 4 0 R>>endobj\nxref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000024 00000 n \n0000000073 00000 n \n0000000150 00000 n \n0000000207 00000 n \ntrailer<</Size 6/Root 5 0 R>>\nstartxref\n258\n%%EOF\n',
  )
  const task = pdfjs.getDocument({
    data: new Uint8Array(minimalPdf),
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  })
  try {
    const doc = await task.promise
    if (doc.numPages < 1) throw new Error('pdfjs getDocument lieferte keine Seiten')
    console.log('[check-canvas] pdfjs fake-worker OK', doc.numPages, 'page(s)')
  } finally {
    await task.destroy()
  }
}

main().catch((error) => {
  console.error('[check-canvas] FAIL', error)
  process.exit(1)
})
