import { countUsers, createUser } from '../services/user.service'
import { ensureUploadRoot } from '../services/storage.service'
import { createLogger } from '../utils/logger'
import { pruneRateLimits } from '../utils/rate-limit'
import { purgeExpiredSessions } from '../utils/auth'

const log = createLogger('bootstrap')

/**
 * Einmalige Initialisierung beim Serverstart:
 * Upload-Verzeichnis anlegen, erstes Administratorkonto erzeugen und
 * wiederkehrende Aufräumarbeiten planen.
 */
export default defineNitroPlugin(async () => {
  if (process.env.SARU_SKIP_BOOTSTRAP === 'true') return

  try {
    await ensureUploadRoot()
  } catch (error) {
    log.error('Upload-Verzeichnis konnte nicht angelegt werden', error)
  }

  try {
    await seedInitialAdmin()
  } catch (error) {
    log.error('Initiales Administratorkonto konnte nicht angelegt werden', error)
  }

  // Stündlich abgelaufene Sitzungen und Rate-Limit-Einträge entfernen.
  const interval = setInterval(
    () => {
      pruneRateLimits()
      purgeExpiredSessions().catch((error) =>
        log.warn('Abgelaufene Sitzungen konnten nicht entfernt werden', error),
      )
    },
    60 * 60 * 1000,
  )
  interval.unref?.()
})

async function seedInitialAdmin(): Promise<void> {
  if ((await countUsers()) > 0) return

  const email = process.env.NUXT_INITIAL_ADMIN_EMAIL?.trim()
  const password = process.env.NUXT_INITIAL_ADMIN_PASSWORD

  if (!email || !password) {
    log.warn(
      'Es existiert noch kein Benutzerkonto. Bitte NUXT_INITIAL_ADMIN_EMAIL und NUXT_INITIAL_ADMIN_PASSWORD setzen und den Dienst neu starten.',
    )
    return
  }

  await createUser({
    email,
    name: 'Administration',
    password,
    role: 'admin',
    // Das Startpasswort steht in der Umgebung – deshalb sofortiger Wechsel.
    mustChangePassword: true,
  })

  log.info('Initiales Administratorkonto angelegt', { email })
}
