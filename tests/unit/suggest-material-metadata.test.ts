import { afterEach, describe, expect, it, vi } from 'vitest'
import * as aiClient from '../../server/services/ai/client'
import {
  filenameBasedMaterialSuggestion,
  guessMaterialType,
  suggestMaterialMetadata,
  titleFromFileName,
} from '../../server/services/ai/suggest-material-metadata'
import { refineMaterialTypeForDocument } from '../../shared/utils/material-type-guess'
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
    expect(guessMaterialType('bio_zel_s2_ka_001.docx')).toBe('klausur')
    expect(guessMaterialType('Klett_Biologie_Schulbuch.pdf')).toBe('lehrwerk')
    expect(guessMaterialType('Schuelerbuch_Band2.pdf')).toBe('lehrwerk')
    expect(guessMaterialType('Schulbuch_Loesung.pdf')).toBe('musterloesung')
    expect(guessMaterialType('Natura_Serviceband_EF.pdf')).toBe('serviceband')
    expect(guessMaterialType('Lehrerband_Biologie_8.pdf')).toBe('serviceband')
    expect(guessMaterialType('Loesungsheft_Natura.pdf')).toBe('loesungsbuch')
  })

  it('korrigiert lange PDFs ohne AB-Kennung nicht als Arbeitsblatt', () => {
    expect(
      refineMaterialTypeForDocument({
        fileName: 'Natura_Oberstufe_Begleitmaterial.pdf',
        current: 'arbeitsblatt',
        pageCount: 180,
        excerpt: 'Serviceband Natura Biologie\nInhaltsverzeichnis',
      }),
    ).toBe('serviceband')
    expect(
      refineMaterialTypeForDocument({
        fileName: 'AB_Zellatmung.pdf',
        current: 'arbeitsblatt',
        pageCount: 4,
      }),
    ).toBe('arbeitsblatt')
  })

  it('erzeugt Dateiname-basierte Vorschläge ohne KI', () => {
    const vorschlag = filenameBasedMaterialSuggestion('AB_Mitose.pdf', 'arbeitsblatt')
    expect(vorschlag.aiUsed).toBe(false)
    expect(vorschlag.title).toBe('AB Mitose')
    expect(vorschlag.contentSummary).toBe('')
    expect(vorschlag.learningObjectives).toEqual([])
    expect(vorschlag.subjectNames).toEqual([])
    expect(vorschlag.gradeLevels).toEqual([])
  })

  it('übernimmt die Jahrgangsstufe aus dem Dateinamen', () => {
    expect(filenameBasedMaterialSuggestion('Biologie_8_Schuelerbuch.pdf').gradeLevels).toEqual([8])
    expect(filenameBasedMaterialSuggestion('Klasse_9_Natura.pdf').gradeLevels).toEqual([9])
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('suggestMaterialMetadata Jahrgangsstufen', () => {
  const enabledSettings: AiSettings = {
    enabled: true,
    provider: 'ollama',
    baseUrl: '',
    apiKey: '',
    chatModel: 'test',
    visionModel: '',
    useVision: false,
    embeddingsEnabled: false,
    embeddingModel: '',
    temperature: 0.2,
    maxOutputTokens: 800,
    timeoutMs: 10_000,
    refererUrl: '',
    appTitle: 'SARU',
  }

  it('übernimmt gradeLevels aus der KI-Antwort', async () => {
    vi.spyOn(aiClient, 'chatCompletion').mockResolvedValue({
      text: JSON.stringify({
        title: 'Natura 8 Schülerbuch',
        materialType: 'lehrwerk',
        schoolForm: 'gymnasium',
        subjectNames: ['Biologie'],
        tagNames: ['Natura'],
        learningObjectives: [],
        description: 'Lehrwerk für Biologie.',
        contentSummary: 'Schülerbuch Klasse 8.',
        gradeLevels: [8],
      }),
      model: 'test',
      finishReason: 'stop',
      outputTokens: 40,
    })

    const result = await suggestMaterialMetadata({
      fileName: 'Scan.pdf',
      extractedText: 'Natura Biologie Schülerbuch',
      settings: enabledSettings,
    })
    expect(result.gradeLevels).toEqual([8])
  })

  it('fällt ohne KI-Jahrgang auf den Dateinamen zurück', async () => {
    vi.spyOn(aiClient, 'chatCompletion').mockResolvedValue({
      text: JSON.stringify({
        title: 'Biologie Schülerbuch',
        materialType: 'lehrwerk',
        schoolForm: null,
        subjectNames: ['Biologie'],
        tagNames: [],
        learningObjectives: [],
        description: 'Lehrwerk für Biologie.',
        contentSummary: 'Schülerbuch.',
      }),
      model: 'test',
      finishReason: 'stop',
      outputTokens: 40,
    })

    const result = await suggestMaterialMetadata({
      fileName: 'Biologie_8_Schuelerbuch.pdf',
      extractedText: 'Natura Biologie',
      settings: enabledSettings,
    })
    expect(result.gradeLevels).toEqual([8])
  })

  it('liest Jahrgangsstufen aus Freitext der KI', async () => {
    vi.spyOn(aiClient, 'chatCompletion').mockResolvedValue({
      text: JSON.stringify({
        title: 'Klausur Einführungsphase',
        materialType: 'klausur',
        schoolForm: null,
        subjectNames: ['Biologie'],
        tagNames: [],
        learningObjectives: [],
        description: 'Klausur zur Einführungsphase.',
        contentSummary: '',
        gradeLevels: ['E1'],
      }),
      model: 'test',
      finishReason: 'stop',
      outputTokens: 40,
    })

    const result = await suggestMaterialMetadata({
      fileName: 'Scan.pdf',
      extractedText: 'Klausur E1',
      settings: enabledSettings,
    })
    expect(result.gradeLevels).toEqual(['E1'])
  })

  it('nutzt für Lehrwerke Einbandtitel und Inhaltsverzeichnis, nicht das erste Kapitel', async () => {
    const spy = vi.spyOn(aiClient, 'chatCompletion').mockResolvedValue({
      text: JSON.stringify({
        title: 'Natura Oberstufe Einführungsphase',
        materialType: 'arbeitsblatt',
        schoolForm: 'oberstufe',
        subjectNames: ['Biologie'],
        tagNames: ['Natura', 'Zelle', 'Stoffwechsel'],
        learningObjectives: [],
        description: 'Schülerbuch der Reihe Natura für die Einführungsphase.',
        contentSummary: '- Zellen und Stoffwechsel\n- Genetik\n- Ökologie',
        gradeLevels: ['E1', 'E2'],
      }),
      model: 'test',
      finishReason: 'stop',
      outputTokens: 40,
    })

    const result = await suggestMaterialMetadata({
      fileName: 'Natura_Oberstufe_Einfuehrungsphase_komplett.pdf',
      extractedText: 'Einband: Natura Biologie Oberstufe Einführungsphase\nInhaltsverzeichnis\n1 Zellen\n2 Bakterien',
      settings: enabledSettings,
      context: { defaultMaterialType: 'lehrwerk' },
    })

    const nachrichten = spy.mock.calls[0]![1] as Array<{ parts: Array<{ text?: string }> }>
    const prompt = nachrichten[1]?.parts[0]?.text ?? ''
    expect(prompt).toContain('Schulbuch')
    expect(prompt).toContain('Einband')
    expect(prompt).toContain('Inhaltsverzeichnis')
    expect(prompt).not.toMatch(/Unterrichtsmaterial vorzuschlagen/)
    expect(result.materialType).toBe('lehrwerk')
    expect(result.title).toBe('Natura Oberstufe Einführungsphase')
  })

  it('nutzt für Servicebände den Begleitband-Prompt', async () => {
    const spy = vi.spyOn(aiClient, 'chatCompletion').mockResolvedValue({
      text: JSON.stringify({
        title: 'Natura Serviceband Einführungsphase',
        materialType: 'arbeitsblatt',
        schoolForm: 'oberstufe',
        subjectNames: ['Biologie'],
        tagNames: ['Natura'],
        learningObjectives: [],
        description: 'Serviceband zur Reihe Natura.',
        contentSummary: '- Hinweise zum Unterricht',
        gradeLevels: ['E1', 'E2'],
      }),
      model: 'test',
      finishReason: 'stop',
      outputTokens: 40,
    })

    const result = await suggestMaterialMetadata({
      fileName: 'Natura_Serviceband.pdf',
      extractedText: 'Einband: Natura Serviceband\nInhaltsverzeichnis',
      settings: enabledSettings,
      context: { defaultMaterialType: 'serviceband' },
    })

    const nachrichten = spy.mock.calls[0]![1] as Array<{ parts: Array<{ text?: string }> }>
    const prompt = nachrichten[1]?.parts[0]?.text ?? ''
    expect(prompt).toContain('Serviceband')
    expect(prompt).toContain('Einband')
    expect(result.materialType).toBe('serviceband')
  })

  it('setzt bei Einführungsphase E1 und E2, wenn das Halbjahr fehlt', async () => {
    vi.spyOn(aiClient, 'chatCompletion').mockResolvedValue({
      text: JSON.stringify({
        title: 'Klausur Einführungsphase',
        materialType: 'klausur',
        schoolForm: null,
        subjectNames: ['Biologie'],
        tagNames: [],
        learningObjectives: [],
        description: 'Klausur zur Einführungsphase.',
        contentSummary: '',
        gradeLevels: ['Einführungsphase'],
      }),
      model: 'test',
      finishReason: 'stop',
      outputTokens: 40,
    })

    const result = await suggestMaterialMetadata({
      fileName: 'Scan.pdf',
      extractedText: 'Klausur Einführungsphase Genetik',
      settings: enabledSettings,
    })
    expect(result.gradeLevels).toEqual(['E1', 'E2'])
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

  it('erzeugt ohne Dokumenttext Vorschläge aus Dateiname und Kontext', async () => {
    vi.spyOn(aiClient, 'chatCompletion').mockResolvedValue({
      text: JSON.stringify({
        title: 'Klausur Zellteilung',
        materialType: 'klausur',
        schoolForm: null,
        subjectNames: ['Biologie'],
        tagNames: ['Mitose'],
        learningObjectives: ['Zellteilung beschreiben'],
        description: 'Klausur zur Mitose und Zellteilung.',
        contentSummary: 'Aufgaben zur Zellteilung.',
      }),
      model: 'test',
      finishReason: 'stop',
      outputTokens: 40,
    })

    const result = await suggestFileMetadata({
      fileName: 'Scan.pdf',
      extractedText: '   ',
      mapping: { defaultMaterialType: 'klausur' },
      extraContext: 'Ordner: Klausuren',
      settings: { ...disabledSettings, enabled: true, chatModel: 'test' },
    })
    expect(result.aiUsed).toBe(true)
    expect(result.title).toBe('Klausur Zellteilung')
    expect(result.description).toContain('Zellteilung')
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
