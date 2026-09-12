import { describe, expect, it } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { requireDifferenzierungProfil } from '../../server/services/ai/differenzierung/profiles'
import {
  parseDifferentiatedWorksheet,
  parseDifferentiatedWorksheetFromText,
  worksheetFileName,
  worksheetToPreviewMarkdown,
} from '../../server/services/ai/differenzierung/parse'
import { buildWorksheetDocx } from '../../server/services/ai/differenzierung/render'
import { SETTING_KEYS } from '../../server/services/settings.service'
import { differenzierungProfile } from '../../shared/utils/labels'

describe('Differenzierungsprofile', () => {
  it('ordnet Stufen und Variantenart zu', () => {
    expect(requireDifferenzierungProfil('leichte_sprache')).toMatchObject({
      differentiationLevel: 'grundlegend',
      variantKind: 'differenzierung',
      label: 'Leichte Sprache',
    })
    expect(requireDifferenzierungProfil('erweitert').differentiationLevel).toBe('erweitert')
    expect(requireDifferenzierungProfil('unterstuetzung').label).toBe('Mit Unterstützung')
  })

  it('lehnt unbekannte Profile ab', () => {
    expect(() => requireDifferenzierungProfil('mittel')).toThrow(/gültiges Differenzierungsprofil/i)
  })

  it('stellt UI-Labels bereit', () => {
    expect(differenzierungProfile.options().map((o) => o.value)).toEqual([
      'leichte_sprache',
      'grundlegend',
      'unterstuetzung',
      'erweitert',
    ])
  })
})

describe('Differenzierungs-JSON', () => {
  const sample = {
    title: 'Der Wasserkreislauf',
    intro: 'Arbeite die Aufgaben der Reihe nach.',
    tasks: [
      {
        number: '1',
        title: 'Begriffe',
        prompt: 'Nenne drei Stationen.',
        hints: ['Dampf', 'Regen'],
        figureNote: 'Abbildung wie im Original',
      },
    ],
    wordBank: ['Verdunstung', 'Niederschlag'],
    glossary: [{ term: 'Verdunstung', explanation: 'Wasser wird zu Dampf.' }],
    uncertainties: 'Die Grafik war nicht lesbar.',
  }

  it('parst ein vollständiges Arbeitsblatt', () => {
    const sheet = parseDifferentiatedWorksheet(sample, 'Fallback')
    expect(sheet?.title).toBe('Der Wasserkreislauf')
    expect(sheet?.tasks).toHaveLength(1)
    expect(sheet?.wordBank).toEqual(['Verdunstung', 'Niederschlag'])
    expect(sheet?.glossary[0]?.term).toBe('Verdunstung')
    expect(sheet?.uncertainties).toContain('Grafik')
  })

  it('liest JSON aus Modelltext mit Fence', () => {
    const sheet = parseDifferentiatedWorksheetFromText(
      '```json\n' + JSON.stringify(sample) + '\n```',
      'Fallback',
    )
    expect(sheet?.tasks[0]?.prompt).toContain('Stationen')
  })

  it('lehnt Antworten ohne Aufgaben ab', () => {
    expect(parseDifferentiatedWorksheet({ title: 'Leer', tasks: [] }, 'X')).toBeNull()
  })

  it('baut eine prüfbare Vorschau', () => {
    const md = worksheetToPreviewMarkdown(parseDifferentiatedWorksheet(sample, 'X')!)
    expect(md).toContain('# Der Wasserkreislauf')
    expect(md).toContain('Wortspeicher')
    expect(md).toContain('Verdunstung')
    expect(md).toContain('Unsicherheiten')
  })

  it('bildet Dateinamen aus Profil und Quelle', () => {
    expect(worksheetFileName('ab_wasser.pdf', 'Leichte Sprache')).toBe(
      'Leichte-Sprache-ab_wasser.docx',
    )
  })
})

describe('Differenzierungs-DOCX', () => {
  it('packt Titel, Aufgaben und Hinweis ins Word-Dokument', () => {
    const buffer = buildWorksheetDocx(
      {
        title: 'Leichte Fassung',
        intro: 'Lies den Text.',
        tasks: [{ number: '1', title: null, prompt: 'Was siehst du?', hints: [], figureNote: null }],
        wordBank: ['Wasser'],
        glossary: [],
        uncertainties: null,
      },
      { profileLabel: 'Leichte Sprache' },
    )

    const files = unzipSync(new Uint8Array(buffer))
    const xml = strFromU8(files['word/document.xml']!)
    expect(xml).toContain('Leichte Fassung')
    expect(xml).toContain('Was siehst du?')
    expect(xml).toContain('Wortspeicher')
    expect(xml).toContain('künstlicher Intelligenz')
  })
})

describe('Hermes-Entfernung', () => {
  it('hält keine Hermes-Einstellung mehr vor', () => {
    expect(SETTING_KEYS).not.toHaveProperty('hermes')
  })
})
