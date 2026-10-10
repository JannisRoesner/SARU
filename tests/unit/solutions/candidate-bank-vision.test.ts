import { describe, expect, it } from 'vitest'
import { candidateBankFromWords } from '../../../server/services/ai/solutions/candidate-bank'
import {
  buildCandidateBankVisionPrompt,
  parseCandidateBankVisionResponse,
} from '../../../server/services/ai/solutions/repair/candidate-bank-vision'

const BLATT_WORDS = [
  'Spitze',
  'unterschiedlich',
  'lang',
  'Zellschichten',
  'Wachsschicht',
  'Spaltöffnung',
  'Leitbündel',
  'Unterseite',
  'Blattstiel',
]

describe('candidateBankFromWords', () => {
  it('baut Bank mit reusePolicy once bei 9 Lücken', () => {
    const bank = candidateBankFromWords(BLATT_WORDS, 9, 'vision')
    expect(bank).not.toBeNull()
    expect(bank!.source).toBe('vision')
    expect(bank!.reusePolicy).toBe('once')
    expect(bank!.candidates).toHaveLength(9)
  })
})

describe('parseCandidateBankVisionResponse', () => {
  it('parst JSON-Wortliste aus Modellantwort', () => {
    const bank = parseCandidateBankVisionResponse(
      `\`\`\`json\n{"words": ${JSON.stringify(BLATT_WORDS)}}\n\`\`\``,
      9,
    )
    expect(bank).not.toBeNull()
    expect(bank!.candidates.map((c) => c.value)).toEqual(BLATT_WORDS)
  })

  it('lehnt zu kurze Listen ab', () => {
    expect(parseCandidateBankVisionResponse('{"words": ["eins"]}', 9)).toBeNull()
  })
})

describe('buildCandidateBankVisionPrompt', () => {
  it('enthält Lückenanzahl und Instruktion', () => {
    const prompt = buildCandidateBankVisionPrompt(9, 'Fülle die Lücken mit Wörtern aus der Wortliste.')
    expect(prompt).toContain('9 Lücken')
    expect(prompt).toContain('Wortliste')
    expect(prompt).toContain('Fülle die Lücken')
  })
})
