import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { expandBulkArchives } from '../../server/services/bulk-upload/zip'

const MB = 1024 * 1024
const limits = { maxTotalBytes: 100 * MB }

function pdf(label: string) {
  return new Uint8Array(Buffer.from(`%PDF-1.4 ${label}`))
}

/** Setzt die Originalgröße aller Einträge im zentralen Verzeichnis (gefälschter Header). */
function fakeOriginalSize(archive: Uint8Array, size: number): Buffer {
  const buf = Buffer.from(archive)
  for (let i = 0; i <= buf.length - 4; i++) {
    if (buf.readUInt32LE(i) === 0x02014b50) buf.writeUInt32LE(size, i + 24)
    if (buf.readUInt32LE(i) === 0x04034b50) buf.writeUInt32LE(size, i + 22)
  }
  return buf
}

describe('Stapel-ZIP', () => {
  it('entpackt Dokumente und überspringt Systemdateien', () => {
    const archive = Buffer.from(
      zipSync({
        'Kopiervorlagen/ab_007.pdf': pdf('test'),
        '__MACOSX/._ab_007.pdf': strToU8('mac'),
        'Thumbs.db': strToU8('win'),
        'readme.txt': strToU8('hinweis'),
      }),
    )

    const expanded = expandBulkArchives([{ buffer: archive, fileName: 'paket.zip' }], limits)
    expect(expanded.archiveNames).toEqual(['paket.zip'])
    expect(expanded.files).toHaveLength(2)
    expect(expanded.files.map((f) => f.relativePath).sort()).toEqual([
      'Kopiervorlagen/ab_007.pdf',
      'readme.txt',
    ])
    expect(expanded.files.some((f) => /macosx|thumbs/i.test(f.relativePath || ''))).toBe(false)
  })

  it('nimmt Lehrwerke mit mehreren tausend Dateien an', () => {
    const entries: Record<string, Uint8Array> = {}
    for (let i = 0; i < 2500; i++) {
      entries[`Kapitel ${Math.floor(i / 100)}/ab_${i}.pdf`] = pdf(String(i))
    }
    const archive = Buffer.from(zipSync(entries))

    const expanded = expandBulkArchives([{ buffer: archive, fileName: 'lehrwerk.zip' }], limits)
    expect(expanded.files).toHaveLength(2500)
  })

  it('lehnt ZIP-Bomben anhand der angekündigten Größe vor dem Entpacken ab', () => {
    const archive = Buffer.from(
      zipSync({ 'bombe.pdf': new Uint8Array(50 * MB) }, { level: 9 }),
    )
    expect(archive.length).toBeLessThan(1 * MB)

    expect(() =>
      expandBulkArchives([{ buffer: archive, fileName: 'bombe.zip' }], { maxTotalBytes: 10 * MB }),
    ).toThrow(/größer als das Limit/)
  })

  it('belegt bei gefälschter Originalgröße nicht mehr Speicher als angekündigt', () => {
    const archive = fakeOriginalSize(zipSync({ 'bombe.pdf': new Uint8Array(20 * MB) }), 1024)

    let result: ReturnType<typeof expandBulkArchives> | null = null
    try {
      result = expandBulkArchives([{ buffer: archive, fileName: 'bombe.zip' }], { maxTotalBytes: 10 * MB })
    } catch (error) {
      expect(String((error as Error).message)).toMatch(/konnte nicht gelesen werden/)
    }
    for (const file of result?.files ?? []) {
      expect(file.buffer.length).toBeLessThanOrEqual(1024)
    }
  })

  it('zählt lose Dateien und Archivinhalte gemeinsam gegen das Größenlimit', () => {
    const archive = Buffer.from(zipSync({ 'a.pdf': new Uint8Array(6 * MB) }))
    const loose = { buffer: Buffer.alloc(6 * MB), fileName: 'b.pdf' }

    expect(() =>
      expandBulkArchives([loose, { buffer: archive, fileName: 'paket.zip' }], { maxTotalBytes: 10 * MB }),
    ).toThrow(/größer als das Limit/)
  })

  it('begrenzt die Dateianzahl pro Stapel', () => {
    const archive = Buffer.from(zipSync({ 'a.pdf': pdf('a'), 'b.pdf': pdf('b'), 'c.pdf': pdf('c') }))

    expect(() =>
      expandBulkArchives([{ buffer: archive, fileName: 'paket.zip' }], { maxTotalBytes: 10 * MB, maxFiles: 2 }),
    ).toThrow(/Maximal 2 Dateien/)
  })
})
