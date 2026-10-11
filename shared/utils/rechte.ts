import type { Role } from '../types/domain'

/** Einzelne Berechtigungen. Rollen sind feste Bündel davon. */
export const RECHTE = ['lesen', 'anlegen', 'bearbeiten', 'loeschen', 'teilen', 'verwalten'] as const
export type Recht = (typeof RECHTE)[number]

/**
 * - Lesezugriff: nur ansehen und suchen.
 * - Beitragende: zusätzlich Neues anlegen und hochladen; Eigenes jederzeit bearbeiten und löschen,
 *   Bestehendes anderer aber nicht.
 * - Lehrkraft: alles bearbeiten, löschen und teilen.
 * - Administration: zusätzlich Benutzer und Einstellungen verwalten.
 */
export const ROLLEN_RECHTE: Record<Role, readonly Recht[]> = {
  leser: ['lesen'],
  beitragende: ['lesen', 'anlegen'],
  lehrkraft: ['lesen', 'anlegen', 'bearbeiten', 'loeschen', 'teilen'],
  admin: ['lesen', 'anlegen', 'bearbeiten', 'loeschen', 'teilen', 'verwalten'],
}

export interface RechteNutzer {
  id: string
  role: Role
}

type Nutzer = RechteNutzer | null | undefined

export function hatRecht(nutzer: Pick<RechteNutzer, 'role'> | null | undefined, recht: Recht): boolean {
  return Boolean(nutzer && ROLLEN_RECHTE[nutzer.role]?.includes(recht))
}

function istEigenes(nutzer: Nutzer, ownerId: string | null | undefined): boolean {
  return Boolean(nutzer && ownerId && ownerId === nutzer.id)
}

/** Bestehendes bearbeiten: allgemeines Recht oder – wer anlegen darf – das eigene Objekt. */
export function darfObjektBearbeiten(nutzer: Nutzer, ownerId: string | null | undefined): boolean {
  return hatRecht(nutzer, 'bearbeiten') || (hatRecht(nutzer, 'anlegen') && istEigenes(nutzer, ownerId))
}

/** Per Link teilen: allgemeines Recht oder – wer anlegen darf – das eigene Objekt. */
export function darfObjektTeilen(nutzer: Nutzer, ownerId: string | null | undefined): boolean {
  return hatRecht(nutzer, 'teilen') || (hatRecht(nutzer, 'anlegen') && istEigenes(nutzer, ownerId))
}

/** Löschen: allgemeines Recht oder – wer anlegen darf – das eigene Objekt. */
export function darfObjektLoeschen(nutzer: Nutzer, ownerId: string | null | undefined): boolean {
  return hatRecht(nutzer, 'loeschen') || (hatRecht(nutzer, 'anlegen') && istEigenes(nutzer, ownerId))
}
