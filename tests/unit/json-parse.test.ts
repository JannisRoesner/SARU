import { describe, expect, it } from 'vitest'
import { extractJsonObject } from '../../server/utils/json-parse'

describe('extractJsonObject', () => {
  it('parst reines JSON', () => {
    expect(extractJsonObject('{"title":"Test","tagNames":[]}')).toEqual({
      title: 'Test',
      tagNames: [],
    })
  })

  it('parst JSON in Markdown-Fences', () => {
    const raw = '```json\n{"title":"AB GUIs","subjectNames":["Informatik"]}\n```'
    expect(extractJsonObject(raw)).toMatchObject({
      title: 'AB GUIs',
      subjectNames: ['Informatik'],
    })
  })

  it('parst JSON mit Einleitungstext', () => {
    const raw = 'Hier ist das Ergebnis:\n{"title":"Test","materialType":"arbeitsblatt"}'
    expect(extractJsonObject(raw)).toMatchObject({ title: 'Test' })
  })

  it('parst JSON mit trailing comma', () => {
    const raw = '{"title":"Test","tagNames":["GUI",],}'
    expect(extractJsonObject(raw)).toMatchObject({ title: 'Test', tagNames: ['GUI'] })
  })

  it('ignoriert geschweifte Klammern in Strings', () => {
    const raw = '{"contentSummary":"Text mit } Klammer","title":"Ok"}'
    expect(extractJsonObject(raw)).toMatchObject({ title: 'Ok' })
  })

  it('gibt null bei leerer Antwort zurück', () => {
    expect(extractJsonObject('')).toBeNull()
    expect(extractJsonObject('Keine Ahnung.')).toBeNull()
  })
})
