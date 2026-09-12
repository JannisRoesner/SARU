import { describe, expect, it } from 'vitest'
import {
  chooseMaterialDescription,
  isBoilerplateDescription,
} from '../../shared/utils/material-description'
import { mapLimit } from '../../server/utils/async'

describe('Materialbeschreibungen', () => {
  it('erkennt Herkunfts- und Prozessfloskeln', () => {
    expect(isBoilerplateDescription('Aus dem Schulportal importiert (Termin 2025-05-20).')).toBe(
      true,
    )
    expect(isBoilerplateDescription('Manuell geprüfter KI-Entwurf zum Material „AB Vorhaut“.')).toBe(
      true,
    )
    expect(
      isBoilerplateDescription('Automatisch erstellte Musterlösung zum Material „AB Vorhaut“.'),
    ).toBe(true)
    expect(isBoilerplateDescription('  ')).toBe(true)
    expect(isBoilerplateDescription('Lücken-AB zur Mitose in Klasse 9.')).toBe(false)
  })

  it('nimmt die erste inhaltliche Beschreibung', () => {
    expect(
      chooseMaterialDescription(
        'Aus dem Schulportal importiert (Termin 2025-05-20).',
        'Arbeitsblatt zur Photosynthese.',
      ),
    ).toBe('Arbeitsblatt zur Photosynthese.')
    expect(chooseMaterialDescription('Manuell geprüfter KI-Entwurf zum Material „X“.', null)).toBe(
      null,
    )
  })
})

describe('mapLimit', () => {
  it('behält die Reihenfolge und begrenzt die Parallelität', async () => {
    let running = 0
    let maxRunning = 0
    const result = await mapLimit([1, 2, 3, 4, 5], 2, async (value) => {
      running += 1
      maxRunning = Math.max(maxRunning, running)
      await new Promise((resolve) => setTimeout(resolve, 15))
      running -= 1
      return value * 10
    })
    expect(result).toEqual([10, 20, 30, 40, 50])
    expect(maxRunning).toBeLessThanOrEqual(2)
  })
})
