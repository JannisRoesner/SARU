import { SCHOOL_FORMS, type SchoolForm } from '#shared/types/domain'
import { schoolForms } from '#shared/utils/labels'
import {
  schulformOptionen,
  sichtbareJahrgangsstufenGruppen,
  sichtbareSchulformen,
} from '#shared/utils/schulformen'
import type { UserPreferences } from '~~/server/database/schema/auth'

/**
 * Liefert die sichtbaren Schulformen und Jahrgangsstufen-Gruppen gemäß
 * den Kontoeinstellungen des angemeldeten Nutzers.
 */
export function useSchulformen() {
  const { benutzer, aktualisieren } = useSitzung()

  const einstellung = computed(
    () => (benutzer.value?.preferences as UserPreferences | undefined)?.visibleSchoolForms,
  )

  const alle = computed(() => sichtbareSchulformen(einstellung.value))
  const optionen = computed(() => schulformOptionen(einstellung.value))
  const jahrgangsstufenGruppen = computed(() => sichtbareJahrgangsstufenGruppen(einstellung.value))

  const alleOptionen = schoolForms.options()

  function istSichtbar(form: SchoolForm) {
    return alle.value.includes(form)
  }

  async function sichtbarkeitSetzen(form: SchoolForm, sichtbar: boolean) {
    const aktuell = new Set(alle.value)
    if (sichtbar) aktuell.add(form)
    else aktuell.delete(form)

    if (aktuell.size >= SCHOOL_FORMS.length) {
      await speichern(null)
      return
    }
    if (aktuell.size === 0) return
    await speichern([...aktuell])
  }

  async function alleEinblenden() {
    await speichern(null)
  }

  function optionenMitAktuell(aktuell?: SchoolForm | string | null) {
    const basis = schulformOptionen(einstellung.value)
    if (!aktuell || basis.some((o) => o.value === aktuell)) return basis
    const zusaetzlich = schoolForms.options().find((o) => o.value === aktuell)
    return zusaetzlich ? [...basis, zusaetzlich] : basis
  }

  async function speichern(formen: SchoolForm[] | null) {
    const body =
      formen === null || formen.length >= SCHOOL_FORMS.length
        ? { visibleSchoolForms: null }
        : { visibleSchoolForms: formen }

    const antwort = await $fetch<{ user: { preferences: UserPreferences } }>('/api/auth/preferences', {
      method: 'PATCH',
      body,
    }).catch(() => null)

    if (antwort?.user) {
      aktualisieren({ preferences: antwort.user.preferences as Record<string, unknown> })
    }
  }

  return {
    einstellung,
    alle,
    optionen,
    optionenMitAktuell,
    alleOptionen,
    jahrgangsstufenGruppen,
    istSichtbar,
    sichtbarkeitSetzen,
    alleEinblenden,
    speichern,
  }
}
