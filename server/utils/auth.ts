import { and, eq, gt, lt } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { deleteCookie, getCookie, getRequestHeader, setCookie } from 'h3'
import { useDatabase } from '../database/client'
import { sessions, users, type User } from '../database/schema'
import { generateToken, hashToken } from './crypto'
import { forbidden, unauthorized } from './errors'

export const SESSION_COOKIE = 'saru_session'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
/** Sliding expiration: erst nach dieser Zeit wird die Gültigkeit verlängert. */
const SESSION_REFRESH_AFTER_MS = 24 * 60 * 60 * 1000

export type Role = 'admin' | 'lehrkraft' | 'leser'

/** Höhere Zahl schließt alle Rechte der niedrigeren Rollen ein. */
const roleRank: Record<Role, number> = { leser: 1, lehrkraft: 2, admin: 3 }

export type SafeUser = Omit<User, 'passwordHash'>

export function toSafeUser(user: User): SafeUser {
  const { passwordHash: _passwordHash, ...rest } = user
  return rest
}

/**
 * Secure-Cookies nur setzen, wenn die Verbindung wirklich TLS nutzt.
 * Früher: in Production standardmäßig `true` – dadurch speichern Browser das
 * Sitzungs-Cookie unter reinem HTTP (z. B. LAN-IP) nicht. Login wirkte in der
 * UI erfolgreich (JSON-Antwort), API-Aufrufe scheiterten mit NICHT_ANGEMELDET.
 */
function isSecureRequest(event: H3Event): boolean {
  if (process.env.NODE_ENV !== 'production') return false

  if (process.env.NUXT_TRUST_PROXY === 'true') {
    const proto = getRequestHeader(event, 'x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase()
    if (proto === 'https') return true
    if (proto === 'http') return false
  }

  const socket = event.node.req.socket as { encrypted?: boolean } | null | undefined
  return Boolean(socket?.encrypted)
}

function sessionCookieOptions(event: H3Event, expires?: Date) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: isSecureRequest(event),
    path: '/',
    ...(expires ? { expires } : {}),
  }
}

export function clientIp(event: H3Event): string | undefined {
  if (process.env.NUXT_TRUST_PROXY === 'true') {
    const forwarded = getRequestHeader(event, 'x-forwarded-for')
    if (forwarded) return forwarded.split(',')[0]?.trim()
  }
  return event.node.req.socket?.remoteAddress ?? undefined
}

export async function createSession(event: H3Event, userId: string): Promise<string> {
  const db = useDatabase()
  const token = generateToken()
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)

  await db.insert(sessions).values({
    userId,
    tokenHash: hashToken(token),
    userAgent: getRequestHeader(event, 'user-agent')?.slice(0, 500),
    ipAddress: clientIp(event),
    expiresAt,
  })

  setCookie(event, SESSION_COOKIE, token, sessionCookieOptions(event, expiresAt))

  return token
}

export async function destroySession(event: H3Event): Promise<void> {
  const token = getCookie(event, SESSION_COOKIE)
  if (token) {
    await useDatabase().delete(sessions).where(eq(sessions.tokenHash, hashToken(token)))
  }
  deleteCookie(event, SESSION_COOKIE, sessionCookieOptions(event))
}

/** Meldet alle Sitzungen eines Benutzers ab, z. B. nach einem Passwortwechsel. */
export async function destroyAllSessions(userId: string): Promise<void> {
  await useDatabase().delete(sessions).where(eq(sessions.userId, userId))
}

export async function resolveUser(event: H3Event): Promise<SafeUser | null> {
  if (event.context.saruUser !== undefined) {
    return event.context.saruUser as SafeUser | null
  }

  const token = getCookie(event, SESSION_COOKIE)
  if (!token) {
    event.context.saruUser = null
    return null
  }

  const db = useDatabase()
  const rows = await db
    .select({ user: users, sessionId: sessions.id, lastSeenAt: sessions.lastSeenAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1)

  const row = rows[0]
  if (!row || !row.user.isActive) {
    event.context.saruUser = null
    return null
  }

  if (Date.now() - row.lastSeenAt.getTime() > SESSION_REFRESH_AFTER_MS) {
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
    await db
      .update(sessions)
      .set({ lastSeenAt: new Date(), expiresAt })
      .where(eq(sessions.id, row.sessionId))
    setCookie(event, SESSION_COOKIE, token, sessionCookieOptions(event, expiresAt))
  }

  const safe = toSafeUser(row.user)
  event.context.saruUser = safe
  return safe
}

export async function requireUser(event: H3Event): Promise<SafeUser> {
  const user = await resolveUser(event)
  if (!user) throw unauthorized()
  return user
}

/** Verlangt mindestens die angegebene Rolle (Rollen sind hierarchisch). */
export async function requireRole(event: H3Event, minimum: Role): Promise<SafeUser> {
  const user = await requireUser(event)
  if (roleRank[user.role] < roleRank[minimum]) {
    throw forbidden(`Diese Aktion erfordert mindestens die Rolle „${minimum}“.`)
  }
  return user
}

/** Schreibrechte haben Lehrkräfte und Administratoren, nicht aber Leser. */
export const requireEditor = (event: H3Event) => requireRole(event, 'lehrkraft')
export const requireAdmin = (event: H3Event) => requireRole(event, 'admin')

export function hasRole(user: SafeUser | null | undefined, minimum: Role): boolean {
  return !!user && roleRank[user.role] >= roleRank[minimum]
}

export async function purgeExpiredSessions(): Promise<number> {
  const deleted = await useDatabase()
    .delete(sessions)
    .where(lt(sessions.expiresAt, new Date()))
    .returning({ id: sessions.id })
  return deleted.length
}
