import type { H3Event } from 'h3'
import { getQuery, readBody } from 'h3'
import { z, type ZodType } from 'zod'
import { invalidInput } from './errors'

/** Wandelt Zod-Fehler in eine kompakte, feldbezogene Struktur für das Frontend. */
function formatIssues(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const issue of error.issues) {
    const path = issue.path.join('.') || '_'
    ;(out[path] ??= []).push(issue.message)
  }
  return out
}

export function parseOrThrow<T>(schema: ZodType<T>, value: unknown, what = 'Die Eingabe'): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw invalidInput(`${what} ist unvollständig oder fehlerhaft.`, formatIssues(result.error))
  }
  return result.data
}

export async function readZodBody<T>(event: H3Event, schema: ZodType<T>): Promise<T> {
  const body = await readBody(event).catch(() => undefined)
  return parseOrThrow(schema, body ?? {}, 'Die übermittelten Daten')
}

export function readValidatedQuery<T>(event: H3Event, schema: ZodType<T>): T {
  return parseOrThrow(schema, getQuery(event), 'Die Suchanfrage')
}

export const uuidSchema = z.string().uuid('Ungültige Kennung.')

/**
 * Nimmt sowohl `?a=1&a=2` als auch `?a=1,2` entgegen und prüft jeden Wert
 * anschließend mit dem übergebenen Schema.
 */
export const csvArray = <T extends ZodType>(item: T) =>
  z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value, ctx) => {
      if (value === undefined) return undefined
      const parts = (Array.isArray(value) ? value : value.split(','))
        .map((p) => p.trim())
        .filter(Boolean)

      const parsed = z.array(item).safeParse(parts)
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          ctx.addIssue({ code: 'custom', message: issue.message, path: issue.path })
        }
        return z.NEVER
      }
      return parsed.data as z.infer<T>[]
    })

export const booleanish = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((v) => (typeof v === 'string' ? v === 'true' || v === '1' : v))

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
})

/** Entfernt Steuerzeichen und begrenzt die Länge von Freitextfeldern. */
export function sanitizeText(value: string | null | undefined, maxLength = 20_000): string | null {
  if (value == null) return null
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim()
  if (!cleaned) return null
  return cleaned.length > maxLength ? cleaned.slice(0, maxLength) : cleaned
}
