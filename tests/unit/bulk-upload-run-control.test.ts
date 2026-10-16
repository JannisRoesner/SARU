import { describe, expect, it } from 'vitest'
import {
  abortAnalysis,
  decideOrphanRecovery,
  isRunActive,
  registerAnalysis,
  registerCommit,
  unregisterAnalysis,
  unregisterCommit,
} from '../../server/services/bulk-upload/run-control'

describe('Stapel-Laufregister', () => {
  it('meldet laufende Analysen und gibt beim Abbruch das Signal', () => {
    const signal = registerAnalysis('run-a')
    expect(isRunActive('run-a')).toBe(true)
    expect(signal.aborted).toBe(false)

    expect(abortAnalysis('run-a')).toBe(true)
    expect(signal.aborted).toBe(true)
    expect(isRunActive('run-a')).toBe(false)
    expect(abortAnalysis('run-a')).toBe(false)
  })

  it('entfernt beim Abmelden nur den eigenen Eintrag', () => {
    const alt = registerAnalysis('run-b')
    const neu = registerAnalysis('run-b')
    expect(alt.aborted).toBe(true)

    unregisterAnalysis('run-b', alt)
    expect(isRunActive('run-b')).toBe(true)
    unregisterAnalysis('run-b', neu)
    expect(isRunActive('run-b')).toBe(false)
  })

  it('zählt laufende Übernahmen als aktiv', () => {
    registerCommit('run-c')
    expect(isRunActive('run-c')).toBe(true)
    unregisterCommit('run-c')
    expect(isRunActive('run-c')).toBe(false)
  })
})

describe('Verwaiste Stapel abschließen', () => {
  it('setzt eine unterbrochene Analyse auf fehlgeschlagen und behält die Dateien', () => {
    const decision = decideOrphanRecovery({
      analysisPending: true,
      createdMaterials: 0,
      reason: 'neustart',
    })
    expect(decision.status).toBe('fehlgeschlagen')
    expect(decision.discardStaging).toBe(false)
    expect(decision.errorMessage).toMatch(/Analyse.*Neustart/)
    expect(decision.errorMessage).toMatch(/verwerfen/)
  })

  it('macht eine Übernahme mit angelegten Materialien rückgängig-fähig', () => {
    const decision = decideOrphanRecovery({
      analysisPending: false,
      createdMaterials: 3,
      reason: 'neustart',
    })
    expect(decision.status).toBe('teilweise_importiert')
    expect(decision.discardStaging).toBe(false)
    expect(decision.errorMessage).toContain('3 Materialien wurden')
    expect(decision.errorMessage).toMatch(/rückgängig/)
    expect(decision.errorMessage).toMatch(/erneut anlegen/)
  })

  it('formuliert die Einzahl richtig', () => {
    const decision = decideOrphanRecovery({
      analysisPending: false,
      createdMaterials: 1,
      reason: 'fehler',
    })
    expect(decision.errorMessage).toContain('1 Material wurde')
    expect(decision.errorMessage).toContain('durch einen Fehler')
  })

  it('setzt eine Übernahme ohne angelegte Materialien auf fehlgeschlagen', () => {
    const decision = decideOrphanRecovery({
      analysisPending: false,
      createdMaterials: 0,
      reason: 'neustart',
    })
    expect(decision.status).toBe('fehlgeschlagen')
    expect(decision.discardStaging).toBe(false)
    expect(decision.errorMessage).toMatch(/bevor Materialien angelegt wurden/)
  })
})
