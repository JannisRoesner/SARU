import { describe, expect, it } from 'vitest'
import {
  filenameBasedMaterialSuggestion,
  guessMaterialType,
  titleFromFileName,
} from '../../server/services/ai/suggest-material-metadata'
import {
  filenameBasedSuggestion,
  suggestFileMetadata,
} from '../../server/services/bulk-upload/suggest-metadata'
import type { AiSettings } from '../../server/services/settings.service'

describe('suggest-material-metadata helpers', () => {
  it('leitet Titel aus Dateinamen ab', () => {
    expect(titleFromFileName('AB_Photosynthese-09.pdf')).toBe('AB Photosynthese 09')
  })

  it('schätzt Materialarten aus dem Dateinamen', () => {
    expect(guessMaterialType('Lernkontrolle_Kapitel3.pdf')).toBe('lernkontrolle')
    expect(guessMaterialType('Klausur-2024.pdf')).toBe('klausur')
    expect(guessMaterialType('AB-Zellatmung_Loesung.pdf')).toBe('musterloesung')
  })

  it('erzeugt Dateiname-basierte Vorschläge ohne KI', () => {
    const vorschlag = filenameBasedMaterialSuggestion('AB_Mitose.pdf', 'arbeitsblatt')
    expect(vorschlag.aiUsed).toBe(false)
    expect(vorschlag.title).toBe('AB Mitose')
    expect(vorschlag.contentSummary).toBe('')
    expect(vorschlag.learningObjectives).toEqual([])
    expect(vorschlag.subjectNames).toEqual([])
  })
})

describe('bulk suggestFileMetadata Wrapper', () => {
  const disabledSettings: AiSettings = {
    enabled: false,
    provider: 'ollama',
    baseUrl: '',
    apiKey: '',
    chatModel: '',
    visionModel: '',
    useVision: false,
    embeddingsEnabled: false,
    embeddingModel: '',
    temperature: 0.2,
    maxOutputTokens: 1000,
    timeoutMs: 10_000,
    refererUrl: '',
    appTitle: 'SARU',
  }

  it('fällt ohne KI auf den Dateinamen zurück', async () => {
    const result = await suggestFileMetadata({
      fileName: 'AB_Zellteilung.pdf',
      extractedText: 'Irgendein Text',
      mapping: { defaultMaterialType: 'arbeitsblatt' },
      settings: disabledSettings,
    })
    expect(result.aiUsed).toBe(false)
    expect(result.title).toBe('AB Zellteilung')
    expect(result.contentSummary).toBe('')
  })

  it('fällt bei leerem Text auch mit aktivierter KI zurück', async () => {
    const result = await suggestFileMetadata({
      fileName: 'Scan.pdf',
      extractedText: '   ',
      mapping: { defaultMaterialType: 'klausur' },
      settings: { ...disabledSettings, enabled: true, chatModel: 'test' },
    })
    expect(result.aiUsed).toBe(false)
    expect(result.materialType).toBe('klausur')
  })

  it('reicht Bulk-Vorschläge mit erweiterten Feldern durch', () => {
    const vorschlag = filenameBasedSuggestion('Folien_Einfuehrung.pdf')
    expect(vorschlag).toMatchObject({
      title: 'Folien Einfuehrung',
      materialType: 'praesentation',
      aiUsed: false,
      subjectNames: [],
      learningObjectives: [],
      contentSummary: '',
    })
  })
})

describe('ensureExtractedText ohne Vision', () => {
  it('nutzt die Textebene und markiert die Methode', async () => {
    const { ensureExtractedText } = await import('../../server/services/ai/document-text')
    const { extractText } = await import('../../server/services/extraction.service')
    const { readFile } = await import('node:fs/promises')
    const { fileURLToPath } = await import('node:url')

    const buffer = await readFile(
      fileURLToPath(new URL('../fixtures/sample.pdf', import.meta.url)),
    )
    const layer = await extractText(buffer, 'sample.pdf')
    expect(layer.text.trim()).toBeTruthy()

    const ensured = await ensureExtractedText(buffer, 'sample.pdf', null)
    expect(ensured.method).toBe('text_layer')
    expect(ensured.status).toBe('erfolgreich')
    expect(ensured.text).toContain('Photosynthese')
  })

  it('ruft Vision nicht auf, wenn Format nicht unterstützt wird', async () => {
    const { ensureExtractedText } = await import('../../server/services/ai/document-text')
    const result = await ensureExtractedText(Buffer.from('x'), 'bild.png', {
      enabled: true,
      provider: 'ollama',
      baseUrl: '',
      apiKey: '',
      chatModel: 'chat',
      visionModel: 'vision',
      useVision: true,
      embeddingsEnabled: false,
      embeddingModel: '',
      temperature: 0.2,
      maxOutputTokens: 1000,
      timeoutMs: 10_000,
      refererUrl: '',
      appTitle: 'SARU',
    })
    expect(result.method).toBe('none')
    expect(result.status).toBe('nicht_unterstuetzt')
  })
})
