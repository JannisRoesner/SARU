export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const levelWeight: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

function currentLevel(): LogLevel {
  const raw = (process.env.NUXT_LOG_LEVEL ?? process.env.LOG_LEVEL ?? 'info').toLowerCase()
  return (['debug', 'info', 'warn', 'error'] as const).includes(raw as LogLevel)
    ? (raw as LogLevel)
    : 'info'
}

/** Feldnamen, deren Werte niemals im Log erscheinen dürfen. */
const REDACTED_KEYS = /^(password|passwort|apikey|api_key|token|secret|authorization|passwordhash)$/i

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value == null) return value
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1))
  if (value instanceof Error) return { name: value.name, message: value.message }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = REDACTED_KEYS.test(key) ? '[entfernt]' : redact(val, depth + 1)
    }
    return out
  }
  return value
}

const levelLabel: Record<LogLevel, string> = {
  debug: '· DEBUG',
  info: '✓ INFO ',
  warn: '⚠ WARN ',
  error: '✕ ERROR',
}

function formatValue(value: unknown): string {
  if (value == null) return String(value)
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)

  try {
    return JSON.stringify(value)
  }
  catch {
    return '[nicht darstellbar]'
  }
}

function formatContext(context: unknown): string {
  const redacted = redact(context)
  if (redacted == null || typeof redacted !== 'object' || Array.isArray(redacted)) {
    return formatValue(redacted)
  }

  const fields = Object.entries(redacted as Record<string, unknown>)
  if (fields.length === 0) return ''
  return fields.map(([key, value]) => `${key}=${formatValue(value)}`).join(' · ')
}

function timestamp(): string {
  const now = new Date()
  const day = String(now.getDate()).padStart(2, '0')
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const hours = String(now.getHours()).padStart(2, '0')
  const minutes = String(now.getMinutes()).padStart(2, '0')
  return `${day}.${month} ${hours}:${minutes}`
}

function scopeTag(scope: string): string {
  return scope
    .split(/[:.]/)
    .map((part) => part.replace(/[^a-z0-9]/gi, '').slice(0, 3).toUpperCase())
    .filter(Boolean)
    .join('/')
}

function emit(level: LogLevel, scope: string, message: string, context?: unknown) {
  if (levelWeight[level] < levelWeight[currentLevel()]) return
  const contextText = context === undefined ? '' : formatContext(context)
  const line = `${timestamp()} ${levelLabel[level]} [${scopeTag(scope)}] ${message}${contextText ? ` — ${contextText}` : ''}`
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export interface Logger {
  debug(message: string, context?: unknown): void
  info(message: string, context?: unknown): void
  warn(message: string, context?: unknown): void
  error(message: string, context?: unknown): void
  child(scope: string): Logger
}

export function createLogger(scope: string): Logger {
  return {
    debug: (m, c) => emit('debug', scope, m, c),
    info: (m, c) => emit('info', scope, m, c),
    warn: (m, c) => emit('warn', scope, m, c),
    error: (m, c) => emit('error', scope, m, c),
    child: (sub) => createLogger(`${scope}:${sub}`),
  }
}

export const logger = createLogger('saru')
