import { SCHOOL_FORMS, type SchoolForm } from '../types/domain'
import { jahrgangsstufenGruppen } from './jahrgangsstufen'
import { schoolForms } from './labels'

/** Welche Schulformen eine Jahrgangsstufen-Gruppe sichtbar machen (mindestens eine). */
export const jahrgangsstufenGruppeSchulformen: Record<
  (typeof jahrgangsstufenGruppen)[number]['id'],
  readonly SchoolForm[]
> = {
  grundschule: ['grundschule'],
  sek1: ['hauptschule', 'realschule', 'gesamtschule', 'gymnasium', 'berufsschule', 'foerderschule', 'sonstige'],
  sek2: ['oberstufe', 'gymnasium', 'berufsschule', 'foerderschule', 'sonstige'],
}

/** Fehlt die Einstellung oder ist sie leer, gelten alle Schulformen als sichtbar. */
export function sichtbareSchulformen(einstellung?: SchoolForm[] | null): SchoolForm[] {
  if (!einstellung?.length) return [...SCHOOL_FORMS]
  const gueltig = new Set<SchoolForm>(SCHOOL_FORMS)
  return einstellung.filter((s) => gueltig.has(s))
}

export function istSchulformSichtbar(form: SchoolForm, einstellung?: SchoolForm[] | null): boolean {
  return sichtbareSchulformen(einstellung).includes(form)
}

export function schulformOptionen(einstellung?: SchoolForm[] | null) {
  const sichtbar = new Set(sichtbareSchulformen(einstellung))
  return schoolForms.options().filter((o) => sichtbar.has(o.value))
}

export function sichtbareJahrgangsstufenGruppen(einstellung?: SchoolForm[] | null) {
  const sichtbar = new Set(sichtbareSchulformen(einstellung))
  return jahrgangsstufenGruppen.filter((gruppe) =>
    jahrgangsstufenGruppeSchulformen[gruppe.id].some((form) => sichtbar.has(form)),
  )
}
