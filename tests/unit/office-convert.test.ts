import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  convertOfficeFileToPdf,
  resetLibreOfficeCacheForTests,
  resolveLibreOfficeExecutable,
} from '../../server/services/office-convert.service'

const execFile = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({
  execFile,
}))

vi.mock('node:util', () => ({
  promisify: () => execFile,
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    access: vi.fn(async (path: string) => {
      if (path === '/usr/bin/libreoffice' || path === '/custom/soffice') return
      throw new Error('ENOENT')
    }),
    mkdtemp: vi.fn(async () => '/tmp/saru-lo-test'),
    mkdir: vi.fn(async () => undefined),
    readFile: vi.fn(async (path: string) => {
      if (String(path).endsWith('.pdf')) return Buffer.from('%PDF-1.4 mock')
      throw new Error('missing')
    }),
    rm: vi.fn(async () => undefined),
  }
})

describe('office-convert.service', () => {
  afterEach(() => {
    resetLibreOfficeCacheForTests()
    delete process.env.NUXT_LIBREOFFICE_PATH
    execFile.mockReset()
  })

  it('nutzt NUXT_LIBREOFFICE_PATH wenn ausführbar', async () => {
    process.env.NUXT_LIBREOFFICE_PATH = '/custom/soffice'
    await expect(resolveLibreOfficeExecutable()).resolves.toBe('/custom/soffice')
  })

  it('findet libreoffice über PATH', async () => {
    execFile.mockResolvedValue({ stdout: '/usr/bin/libreoffice\n', stderr: '' })
    await expect(resolveLibreOfficeExecutable()).resolves.toBe('/usr/bin/libreoffice')
  })

  it('konvertiert Office-Dateien per soffice nach PDF', async () => {
    execFile.mockResolvedValue({ stdout: '', stderr: '' })
    process.env.NUXT_LIBREOFFICE_PATH = '/custom/soffice'

    const pdf = await convertOfficeFileToPdf('/data/uploads/test.docx')
    expect(pdf?.subarray(0, 5).toString()).toBe('%PDF-')
    expect(execFile).toHaveBeenCalledWith(
      '/custom/soffice',
      expect.arrayContaining(['--headless', '--convert-to', 'pdf']),
      expect.objectContaining({ timeout: 120_000 }),
    )
  })

  it('liefert null wenn LibreOffice fehlt', async () => {
    const { access } = await import('node:fs/promises')
    vi.mocked(access).mockRejectedValue(new Error('ENOENT'))
    execFile.mockRejectedValue(new Error('not found'))

    await expect(convertOfficeFileToPdf('/data/uploads/test.docx')).resolves.toBeNull()
  })
})
