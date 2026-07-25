import { isOfficeFile } from './office-files'

/** Dateitypen, für die eine Miniatur angefordert werden kann (API liefert ggf. 404). */
export function isThumbnailCandidate(
  mimeType: string | null | undefined,
  fileName: string | null | undefined,
): boolean {
  const mime = mimeType ?? ''
  const name = (fileName ?? '').toLowerCase()
  if (mime === 'application/pdf' || name.endsWith('.pdf')) return true
  if (mime.startsWith('image/') && mime !== 'image/svg+xml') return true
  return isOfficeFile(fileName, mimeType)
}
