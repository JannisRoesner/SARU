import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>

const SCRYPT_KEYLEN = 64
const SCRYPT_SALT_BYTES = 16

/**
 * Passwort-Hash im Format `scrypt$<salt-hex>$<hash-hex>`.
 * scrypt ist Teil der Node-Standardbibliothek, dadurch entfallen native
 * Abhängigkeiten im Docker-Build.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SCRYPT_SALT_BYTES)
  const derived = await scrypt(password.normalize('NFKC'), salt, SCRYPT_KEYLEN)
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false
  const salt = Buffer.from(parts[1]!, 'hex')
  const expected = Buffer.from(parts[2]!, 'hex')
  const derived = await scrypt(password.normalize('NFKC'), salt, expected.length)
  return derived.length === expected.length && timingSafeEqual(derived, expected)
}

export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex')
}

function encryptionKey(): Buffer {
  const raw = process.env.NUXT_ENCRYPTION_KEY ?? process.env.ENCRYPTION_KEY
  if (!raw || raw.length < 32) {
    throw new Error(
      'NUXT_ENCRYPTION_KEY fehlt oder ist zu kurz (mindestens 32 Zeichen). API-Schlüssel können nicht sicher gespeichert werden.',
    )
  }
  return createHash('sha256').update(raw).digest()
}

/** Verschlüsselt Geheimnisse (z. B. API-Schlüssel) für die Ablage in der Datenbank. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1.${iv.toString('base64')}.${tag.toString('base64')}.${encrypted.toString('base64')}`
}

export function decryptSecret(payload: string): string {
  const [version, ivB64, tagB64, dataB64] = payload.split('.')
  if (version !== 'v1' || !ivB64 || !tagB64 || !dataB64) {
    throw new Error('Verschlüsseltes Geheimnis hat ein unbekanntes Format.')
  }
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}

/** Zeigt nur die letzten Zeichen eines Schlüssels an, z. B. `sk-…4f2a`. */
export function maskSecret(secret: string): string {
  if (!secret) return ''
  if (secret.length <= 8) return '••••'
  return `${secret.slice(0, 3)}…${secret.slice(-4)}`
}
