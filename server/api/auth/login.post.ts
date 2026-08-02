import { isError } from 'h3'
import { z } from 'zod'
import { recordAudit } from '../../services/audit.service'
import { findUserByEmail, markLogin } from '../../services/user.service'
import { clientIp, createSession, toSafeUser } from '../../utils/auth'
import { verifyPassword } from '../../utils/crypto'
import { appError } from '../../utils/errors'
import { createLogger } from '../../utils/logger'
import { checkRateLimit, resetRateLimit } from '../../utils/rate-limit'
import { toPublicError } from '../../utils/sanitize-error'
import { readZodBody } from '../../utils/validation'

const log = createLogger('auth.login')

const schema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Bitte E-Mail-Adresse angeben.')
    .email('Bitte eine gültige E-Mail-Adresse angeben.'),
  password: z.string().min(1, 'Bitte Passwort angeben.'),
})

export default defineEventHandler(async (event) => {
  const { email, password } = await readZodBody(event, schema)

  // Gegen Passwort-Raten: pro IP und pro Konto begrenzen.
  const ipKey = `login:ip:${clientIp(event) ?? 'unbekannt'}`
  const accountKey = `login:konto:${email.toLowerCase()}`
  checkRateLimit(ipKey, { limit: 20, windowMs: 10 * 60 * 1000 })
  checkRateLimit(accountKey, {
    limit: 8,
    windowMs: 10 * 60 * 1000,
    message: 'Zu viele fehlgeschlagene Anmeldeversuche für dieses Konto. Bitte später erneut versuchen.',
  })

  let user
  try {
    user = await findUserByEmail(email)
  } catch (error) {
    if (isError(error) && error.statusCode) throw error
    log.error('Anmeldung: Datenbankfehler', { err: error, email })
    throw toPublicError(
      error,
      'Die Anmeldung ist derzeit nicht möglich. Bitte später erneut versuchen oder die Administration kontaktieren.',
    )
  }

  const passwordOk = user ? await verifyPassword(password, user.passwordHash) : false

  if (!user || !passwordOk || !user.isActive) {
    await recordAudit(
      {
        userId: user?.id ?? null,
        action: 'anmeldung.fehlgeschlagen',
        details: { email, grund: !user ? 'unbekannt' : !passwordOk ? 'passwort' : 'deaktiviert' },
      },
      event,
    )
    // Bewusst identische Meldung, damit keine Konten ausgespäht werden können.
    throw appError('NICHT_ANGEMELDET', 'E-Mail-Adresse oder Passwort ist nicht korrekt.')
  }

  resetRateLimit(accountKey)
  await createSession(event, user.id)
  await markLogin(user.id)
  await recordAudit({ userId: user.id, action: 'anmeldung.erfolgreich' }, event)

  return { user: toSafeUser(user) }
})
