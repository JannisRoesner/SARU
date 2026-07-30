/** Dateiformate für „Material mit KI anlegen“ (Analyse + Metadaten-Vorschläge). */
export const AI_MATERIAL_FILE_EXTENSIONS = [
  'pdf',
  'doc',
  'docx',
  'ppt',
  'pptx',
  'xls',
  'xlsx',
  'odt',
  'odp',
  'ods',
  'txt',
  'md',
  'csv',
] as const

export type AiMaterialFileExtension = (typeof AI_MATERIAL_FILE_EXTENSIONS)[number]

const AI_MATERIAL_EXTENSION_SET = new Set<string>(AI_MATERIAL_FILE_EXTENSIONS)

export function isAiMaterialFileExtension(extension: string): boolean {
  return AI_MATERIAL_EXTENSION_SET.has(extension.toLowerCase().replace(/^\./, ''))
}

export function isAiMaterialFileName(fileName: string): boolean {
  const dot = fileName.lastIndexOf('.')
  if (dot <= 0) return false
  return isAiMaterialFileExtension(fileName.slice(dot + 1))
}

/** `accept`-Attribut für `<input type="file">`. */
export function aiMaterialAcceptAttribute(): string {
  const extensions = AI_MATERIAL_FILE_EXTENSIONS.map((ext) => `.${ext}`).join(',')
  const mimeTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.ms-powerpoint',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.oasis.opendocument.text',
    'application/vnd.oasis.opendocument.presentation',
    'application/vnd.oasis.opendocument.spreadsheet',
    'text/plain',
    'text/markdown',
    'text/csv',
  ].join(',')
  return `${extensions},${mimeTypes}`
}

/** Kurzbeschreibung für Upload-Hinweise in der UI. */
export function aiMaterialFormatsLabel(): string {
  return 'PDF, Word (.doc/.docx), PowerPoint (.ppt/.pptx), Excel (.xls/.xlsx), OpenDocument (.odt/.odp/.ods) oder Text'
}
