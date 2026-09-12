import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { expandBulkArchives } from '../../server/services/bulk-upload/zip'

describe('Stapel-ZIP', () => {
  it('entpackt Dokumente und überspringt Systemdateien', () => {
    const pdf = Buffer.from('%PDF-1.4 test')
    const archive = Buffer.from(
      zipSync({
        'Kopiervorlagen/ab_007.pdf': new Uint8Array(pdf),
        '__MACOSX/._ab_007.pdf': strToU8('mac'),
        'Thumbs.db': strToU8('win'),
        'readme.txt': strToU8('hinweis'),
      }),
    )

    const expanded = expandBulkArchives([{ buffer: archive, fileName: 'paket.zip' }])
    expect(expanded.archiveNames).toEqual(['paket.zip'])
    expect(expanded.files).toHaveLength(2)
    expect(expanded.files.map((f) => f.relativePath).sort()).toEqual([
      'Kopiervorlagen/ab_007.pdf',
      'readme.txt',
    ])
    expect(expanded.files.some((f) => /macosx|thumbs/i.test(f.relativePath || ''))).toBe(false)
  })
})
