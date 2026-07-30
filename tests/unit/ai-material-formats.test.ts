import { describe, expect, it } from 'vitest'
import {
  AI_MATERIAL_FILE_EXTENSIONS,
  aiMaterialAcceptAttribute,
  aiMaterialFormatsLabel,
  isAiMaterialFileExtension,
  isAiMaterialFileName,
} from '../../shared/utils/ai-material-formats'

describe('ai-material-formats', () => {
  it('enthält PDF, Office, OpenDocument und Text', () => {
    expect(AI_MATERIAL_FILE_EXTENSIONS).toContain('pdf')
    expect(AI_MATERIAL_FILE_EXTENSIONS).toContain('doc')
    expect(AI_MATERIAL_FILE_EXTENSIONS).toContain('docx')
    expect(AI_MATERIAL_FILE_EXTENSIONS).toContain('ppt')
    expect(AI_MATERIAL_FILE_EXTENSIONS).toContain('pptx')
    expect(AI_MATERIAL_FILE_EXTENSIONS).toContain('xls')
    expect(AI_MATERIAL_FILE_EXTENSIONS).toContain('xlsx')
    expect(AI_MATERIAL_FILE_EXTENSIONS).toContain('odt')
    expect(AI_MATERIAL_FILE_EXTENSIONS).toContain('odp')
    expect(AI_MATERIAL_FILE_EXTENSIONS).toContain('ods')
  })

  it('erkennt Dateinamen und Endungen', () => {
    expect(isAiMaterialFileName('Arbeitsblatt.doc')).toBe(true)
    expect(isAiMaterialFileName('Folien.ppt')).toBe(true)
    expect(isAiMaterialFileExtension('.ODP')).toBe(true)
    expect(isAiMaterialFileName('kurs.mbz')).toBe(false)
  })

  it('liefert accept-Attribut mit Endungen und MIME-Typen', () => {
    const accept = aiMaterialAcceptAttribute()
    expect(accept).toContain('.doc')
    expect(accept).toContain('.ppt')
    expect(accept).toContain('.odt')
    expect(accept).toContain('application/vnd.oasis.opendocument.text')
  })

  it('beschreibt Formate für die UI', () => {
    expect(aiMaterialFormatsLabel()).toContain('OpenDocument')
    expect(aiMaterialFormatsLabel()).toContain('.doc')
  })
})
