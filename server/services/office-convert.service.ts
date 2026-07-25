import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { createLogger } from '../utils/logger'

const log = createLogger('office-convert')
const execFileAsync = promisify(execFile)

const CONVERT_TIMEOUT_MS = 120_000

let cachedExecutable: string | null | undefined

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

async function findOnPath(command: string): Promise<string | null> {
  try {
    const which = process.platform === 'win32' ? 'where' : 'which'
    const { stdout } = await execFileAsync(which, [command], { timeout: 5_000 })
    const line = stdout.trim().split(/\r?\n/)[0]?.trim()
    return line || null
  } catch {
    return null
  }
}

/** Ermittelt den LibreOffice/soffice-Pfad (Cache, env oder PATH). */
export async function resolveLibreOfficeExecutable(): Promise<string | null> {
  if (cachedExecutable !== undefined) return cachedExecutable

  const fromEnv = process.env.NUXT_LIBREOFFICE_PATH?.trim()
  if (fromEnv && (await isExecutable(fromEnv))) {
    cachedExecutable = fromEnv
    return cachedExecutable
  }

  const candidates = [
    await findOnPath('soffice'),
    await findOnPath('libreoffice'),
    process.platform === 'win32'
      ? 'C:\\Program Files\\LibreOffice\\program\\soffice.exe'
      : '/usr/bin/libreoffice',
    process.platform === 'win32' ? null : '/usr/bin/soffice',
  ]

  for (const candidate of candidates) {
    if (!candidate) continue
    if (await isExecutable(candidate)) {
      cachedExecutable = candidate
      return cachedExecutable
    }
  }

  cachedExecutable = null
  return null
}

export async function isLibreOfficeAvailable(): Promise<boolean> {
  return (await resolveLibreOfficeExecutable()) !== null
}

function profileUrl(profileDir: string): string {
  const normalized = profileDir.replace(/\\/g, '/')
  if (process.platform === 'win32') {
    return `file:///${normalized.replace(/^\/+/, '')}`
  }
  return `file://${normalized}`
}

/**
 * Konvertiert eine Office-Datei per LibreOffice headless nach PDF.
 * Liefert `null`, wenn LibreOffice fehlt oder die Konvertierung scheitert.
 */
export async function convertOfficeFileToPdf(inputPath: string): Promise<Buffer | null> {
  const executable = await resolveLibreOfficeExecutable()
  if (!executable) {
    log.debug('LibreOffice nicht verfügbar – Office-Miniatur entfällt.')
    return null
  }

  const workDir = await mkdtemp(join(tmpdir(), 'saru-lo-'))
  const profileDir = join(workDir, 'profile')
  await mkdir(profileDir, { recursive: true })

  try {
    await execFileAsync(
      executable,
      [
        '--headless',
        '--nologo',
        '--nolockcheck',
        '--nodefault',
        '--nofirststartwizard',
        `-env:UserInstallation=${profileUrl(profileDir)}`,
        '--convert-to',
        'pdf',
        '--outdir',
        workDir,
        inputPath,
      ],
      { timeout: CONVERT_TIMEOUT_MS },
    )

    const pdfName = `${basename(inputPath, extname(inputPath))}.pdf`
    const pdfPath = join(workDir, pdfName)
    return await readFile(pdfPath)
  } catch (error) {
    log.warn('LibreOffice-Konvertierung fehlgeschlagen', { inputPath, error })
    return null
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}

/** Setzt den Executable-Cache zurück (Tests). */
export function resetLibreOfficeCacheForTests(): void {
  cachedExecutable = undefined
}
