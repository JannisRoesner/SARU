import { describe, expect, it } from 'vitest'
import { parsePdfSolutionQualityResponse } from '../../../server/services/ai/solutions/repair/pdf-solution-vision'

describe('parsePdfSolutionQualityResponse', () => {
  it('bewahrt konkrete visuelle Warnungen', () => {
    const result = parsePdfSolutionQualityResponse(
      '{"verdict":"warning","issues":["Zwei Kreuze in Aussage 3.","Antwort in Tabellenzeile 2 überdeckt Text."]}',
      'vision-test',
    )

    expect(result.status).toBe('warning')
    expect(result.issues).toHaveLength(2)
    expect(result.model).toBe('vision-test')
  })

  it('wertet eine leere Pass-Antwort als bestanden und ungültiges JSON als nicht verfügbar', () => {
    expect(parsePdfSolutionQualityResponse('{"verdict":"pass","issues":[]}').status).toBe('passed')
    expect(parsePdfSolutionQualityResponse('kein JSON').status).toBe('unavailable')
  })
})
