import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Resolve über package-Name, nicht über gebündelte Chunk-URL (Nitro/Docker). */
const require = createRequire(import.meta.url)

type PdfjsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs')

/**
 * Bevorzugt das vollständige Paket neben package.json (/app/node_modules),
 * weil Nitro's NFT oft nur pdf.mjs nach .output/... kopiert – ohne Worker.
 */
export function pdfjsPackageRoot(): string {
  const candidates: Array<() => string> = [
    () => dirname(createRequire(join(process.cwd(), 'package.json')).resolve('pdfjs-dist/package.json')),
    () => dirname(require.resolve('pdfjs-dist/package.json')),
  ]

  const roots: string[] = []
  for (const resolveRoot of candidates) {
    try {
      const root = resolveRoot()
      if (!roots.includes(root)) roots.push(root)
    } catch {
      // nächster Kandidat
    }
  }

  for (const root of roots) {
    if (existsSync(join(root, 'legacy/build/pdf.worker.mjs'))) return root
  }

  if (roots[0]) return roots[0]
  throw new Error('pdfjs-dist nicht auflösbar')
}

/** Trailing slash ist für pdf.js Pflicht (cMapUrl / standardFontDataUrl / wasmUrl). */
export function pdfjsAssetUrl(...segments: string[]): string {
  return pathToFileURL(join(pdfjsPackageRoot(), ...segments) + '/').href
}

/**
 * In Node deaktiviert pdf.js echte Worker und lädt per Fake-Worker
 * `import(workerSrc)`. Relatives `./pdf.worker.mjs` zeigt dann auf die
 * unvollständige Nitro-Kopie – daher absolute file://-URL setzen.
 */
export function configurePdfjsWorker(pdfjs: PdfjsModule): void {
  const workerPath = join(pdfjsPackageRoot(), 'legacy/build/pdf.worker.mjs')
  if (!existsSync(workerPath)) {
    throw new Error(`pdf.worker.mjs fehlt: ${workerPath}`)
  }
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href
}

/** Importiert den Legacy-Build und konfiguriert den Worker für Node/Nitro. */
export async function loadPdfjs(): Promise<PdfjsModule> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  configurePdfjsWorker(pdfjs)
  return pdfjs
}
