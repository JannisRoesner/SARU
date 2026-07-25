import { and, asc, count, eq, ne } from 'drizzle-orm'
import { useDatabase } from '../database/client'
import { users, type UserPreferences } from '../database/schema'
import { destroyAllSessions, toSafeUser, type Role, type SafeUser } from '../utils/auth'
import { hashPassword, verifyPassword } from '../utils/crypto'
import { conflict, invalidInput, notFound } from '../utils/errors'
import { createLogger } from '../utils/logger'

const log = createLogger('users')

export const PASSWORD_MIN_LENGTH = 10

export function assertPasswordStrength(password: string): void {
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw invalidInput(`Das Passwort muss mindestens ${PASSWORD_MIN_LENGTH} Zeichen lang sein.`)
  }
  const classes = [/[a-zäöüß]/, /[A-ZÄÖÜ]/, /\d/, /[^\w\s]/].filter((r) => r.test(password)).length
  if (classes < 3) {
    throw invalidInput(
      'Das Passwort muss mindestens drei der folgenden Zeichenarten enthalten: Kleinbuchstaben, Großbuchstaben, Ziffern, Sonderzeichen.',
    )
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export async function countUsers(): Promise<number> {
  const [row] = await useDatabase().select({ value: count() }).from(users)
  return row?.value ?? 0
}

export async function listUsers(): Promise<SafeUser[]> {
  const rows = await useDatabase().select().from(users).orderBy(asc(users.name))
  return rows.map(toSafeUser)
}

export async function findUserByEmail(email: string) {
  const rows = await useDatabase()
    .select()
    .from(users)
    .where(eq(users.email, normalizeEmail(email)))
    .limit(1)
  return rows[0] ?? null
}

export async function getUser(id: string): Promise<SafeUser> {
  const rows = await useDatabase().select().from(users).where(eq(users.id, id)).limit(1)
  const user = rows[0]
  if (!user) throw notFound('Das Benutzerkonto')
  return toSafeUser(user)
}

export interface CreateUserInput {
  email: string
  name: string
  password: string
  role: Role
  mustChangePassword?: boolean
}

export async function createUser(input: CreateUserInput): Promise<SafeUser> {
  assertPasswordStrength(input.password)
  const email = normalizeEmail(input.email)

  if (await findUserByEmail(email)) {
    throw conflict('Zu dieser E-Mail-Adresse existiert bereits ein Konto.')
  }

  const [created] = await useDatabase()
    .insert(users)
    .values({
      email,
      name: input.name.trim(),
      passwordHash: await hashPassword(input.password),
      role: input.role,
      mustChangePassword: input.mustChangePassword ?? false,
    })
    .returning()

  log.info('Benutzerkonto angelegt', { email, role: input.role })
  return toSafeUser(created!)
}

export interface UpdateUserInput {
  name?: string
  email?: string
  role?: Role
  isActive?: boolean
  password?: string
}

export async function updateUser(id: string, input: UpdateUserInput): Promise<SafeUser> {
  const db = useDatabase()
  const existing = await db.select().from(users).where(eq(users.id, id)).limit(1)
  if (!existing[0]) throw notFound('Das Benutzerkonto')

  const patch: Record<string, unknown> = { updatedAt: new Date() }

  if (input.name !== undefined) patch.name = input.name.trim()
  if (input.email !== undefined) {
    const email = normalizeEmail(input.email)
    const other = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1)
    if (other[0] && other[0].id !== id) {
      throw conflict('Zu dieser E-Mail-Adresse existiert bereits ein Konto.')
    }
    patch.email = email
  }
  if (input.role !== undefined) {
    if (existing[0].role === 'admin' && input.role !== 'admin') await assertNotLastAdmin(id)
    patch.role = input.role
  }
  if (input.isActive !== undefined) {
    if (!input.isActive) await assertNotLastAdmin(id)
    patch.isActive = input.isActive
  }
  if (input.password !== undefined) {
    assertPasswordStrength(input.password)
    patch.passwordHash = await hashPassword(input.password)
    patch.mustChangePassword = false
  }

  const [updated] = await db.update(users).set(patch).where(eq(users.id, id)).returning()

  // Bei Rechte- oder Passwortänderungen alle bestehenden Sitzungen beenden.
  if (input.password !== undefined || input.role !== undefined || input.isActive === false) {
    await destroyAllSessions(id)
  }

  return toSafeUser(updated!)
}

/** Verhindert, dass sich die Instanz durch Herabstufen oder Löschen selbst aussperrt. */
async function assertNotLastAdmin(userId: string): Promise<void> {
  const [row] = await useDatabase()
    .select({ value: count() })
    .from(users)
    .where(and(eq(users.role, 'admin'), eq(users.isActive, true), ne(users.id, userId)))

  if ((row?.value ?? 0) === 0) {
    throw conflict(
      'Das letzte aktive Administratorkonto kann nicht deaktiviert, herabgestuft oder gelöscht werden.',
    )
  }
}

export async function deleteUser(id: string): Promise<void> {
  await assertNotLastAdmin(id)
  const removed = await useDatabase().delete(users).where(eq(users.id, id)).returning({ id: users.id })
  if (!removed[0]) throw notFound('Das Benutzerkonto')
  log.info('Benutzerkonto gelöscht', { id })
}

export async function changeOwnPassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const db = useDatabase()
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  if (!user) throw notFound('Das Benutzerkonto')

  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw invalidInput('Das aktuelle Passwort ist nicht korrekt.')
  }
  assertPasswordStrength(newPassword)

  await db
    .update(users)
    .set({
      passwordHash: await hashPassword(newPassword),
      mustChangePassword: false,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId))
}

export async function updatePreferences(
  userId: string,
  preferences: UserPreferences,
): Promise<SafeUser> {
  const db = useDatabase()
  const [current] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  if (!current) throw notFound('Das Benutzerkonto')

  const [updated] = await db
    .update(users)
    .set({ preferences: { ...current.preferences, ...preferences }, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning()

  return toSafeUser(updated!)
}

export async function markLogin(userId: string): Promise<void> {
  await useDatabase().update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId))
}
