import { countUsers } from '../../services/user.service'
import { getAppearanceSettings } from '../../services/settings.service'
import { resolveUser } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = await resolveUser(event)
  const appearance = await getAppearanceSettings()

  return {
    user,
    /** Erlaubt der Oberfläche, vor der Anmeldung auf eine leere Instanz hinzuweisen. */
    setupRequired: user ? false : (await countUsers()) === 0,
    appearance,
  }
})
