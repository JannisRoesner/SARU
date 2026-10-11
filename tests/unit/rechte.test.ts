import { describe, expect, it } from 'vitest'
import { darfObjektBearbeiten, darfObjektLoeschen, hatRecht, ROLLEN_RECHTE } from '../../shared/utils/rechte'
import { ROLES } from '../../shared/types/domain'

const nutzer = (role: (typeof ROLES)[number]) => ({ id: 'ich', role })

describe('Rechtemodell', () => {
  it('kennt für jede Rolle eine Rechteliste', () => {
    for (const role of ROLES) expect(ROLLEN_RECHTE[role]).toContain('lesen')
  })

  it('Lesezugriff darf nur lesen', () => {
    const leser = nutzer('leser')
    expect(hatRecht(leser, 'anlegen')).toBe(false)
    expect(darfObjektBearbeiten(leser, 'ich')).toBe(false)
    expect(darfObjektLoeschen(leser, 'ich')).toBe(false)
  })

  it('Beitragende dürfen anlegen und Eigenes bearbeiten und löschen, Fremdes nicht', () => {
    const b = nutzer('beitragende')
    expect(hatRecht(b, 'anlegen')).toBe(true)
    expect(hatRecht(b, 'bearbeiten')).toBe(false)
    expect(hatRecht(b, 'teilen')).toBe(false)
    expect(darfObjektBearbeiten(b, 'ich')).toBe(true)
    expect(darfObjektLoeschen(b, 'ich')).toBe(true)
    expect(darfObjektBearbeiten(b, 'jemand-anders')).toBe(false)
    expect(darfObjektLoeschen(b, 'jemand-anders')).toBe(false)
    // Inhalte ohne Besitzer (z. B. gelöschtes Konto) gehören niemandem.
    expect(darfObjektBearbeiten(b, null)).toBe(false)
  })

  it('Lehrkräfte dürfen alles bearbeiten, löschen und teilen, aber nicht verwalten', () => {
    const l = nutzer('lehrkraft')
    expect(darfObjektBearbeiten(l, 'jemand-anders')).toBe(true)
    expect(darfObjektLoeschen(l, null)).toBe(true)
    expect(hatRecht(l, 'teilen')).toBe(true)
    expect(hatRecht(l, 'verwalten')).toBe(false)
  })

  it('Administration darf zusätzlich verwalten', () => {
    expect(hatRecht(nutzer('admin'), 'verwalten')).toBe(true)
  })

  it('ohne Anmeldung gibt es keine Rechte', () => {
    expect(hatRecht(null, 'lesen')).toBe(false)
    expect(darfObjektBearbeiten(undefined, 'ich')).toBe(false)
  })
})
