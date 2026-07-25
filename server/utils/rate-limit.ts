import { appError } from './errors'

interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()

/**
 * Einfacher prozesslokaler Zähler pro Schlüssel.
 * Für die Einzelcontainer-Installation ausreichend; bei mehreren Instanzen
 * müsste hier ein gemeinsamer Speicher (z. B. Redis) eingesetzt werden.
 */
export function checkRateLimit(
  key: string,
  options: { limit: number; windowMs: number; message?: string },
): void {
  const now = Date.now()
  const bucket = buckets.get(key)

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + options.windowMs })
    return
  }

  bucket.count += 1
  if (bucket.count > options.limit) {
    const seconds = Math.ceil((bucket.resetAt - now) / 1000)
    throw appError(
      'RATE_LIMIT',
      options.message ?? `Zu viele Versuche. Bitte in ${seconds} Sekunden erneut versuchen.`,
      { details: { retryAfterSeconds: seconds } },
    )
  }
}

export function resetRateLimit(key: string): void {
  buckets.delete(key)
}

/** Verhindert unbegrenztes Wachstum der Map bei vielen unterschiedlichen Schlüsseln. */
export function pruneRateLimits(): void {
  const now = Date.now()
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key)
  }
}
