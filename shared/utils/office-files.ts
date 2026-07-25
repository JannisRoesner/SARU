/** Office-/OpenDocument-Formate mit Vorschau und Miniatur-Unterstützung. */
export const OFFICE_FILE_EXTENSIONS = new Set([
  'doc',
  'docx',
  'odt',
  'rtf',
  'ppt',
  'pptx',
  'odp',
  'xls',
  'xlsx',
  'ods',
  'csv',
])

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  if (dot <= 0) return ''
  return fileName.slice(dot + 1).toLowerCase()
}

/** Prüft, ob eine Datei ein Office-/OpenDocument-Format ist. */
export function isOfficeFile(
  fileName: string | null | undefined,
  mimeType?: string | null,
): boolean {
  const ext = fileName ? extensionOf(fileName) : ''
  if (ext && OFFICE_FILE_EXTENSIONS.has(ext)) return true
  if (!mimeType) return false
  return (
    mimeType.includes('officedocument') ||
    mimeType.includes('msword') ||
    mimeType.includes('ms-excel') ||
    mimeType.includes('ms-powerpoint') ||
    mimeType.includes('opendocument') ||
    mimeType === 'text/rtf' ||
    mimeType === 'application/rtf'
  )
}
