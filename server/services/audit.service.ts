import { lt } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { useDatabase } from '../database/client'
import { auditLog } from '../database/schema'
import { clientIp } from '../utils/auth'
import { createLogger } from '../utils/logger'

const log = createLogger('audit')

export interface AuditEntry {
  userId?: string | null
  action: string
  entityType?: string
  entityId?: string
  details?: Record<string, unknown>
}

/**
 * Schreibt einen Protokolleintrag. Fehler werden bewusst geschluckt –
 * ein fehlgeschlagenes Protokoll darf die eigentliche Aktion nicht abbrechen.
 */
export async function recordAudit(entry: AuditEntry, event?: H3Event): Promise<void> {
  try {
    await useDatabase()
      .insert(auditLog)
      .values({
        userId: entry.userId ?? null,
        action: entry.action,
        entityType: entry.entityType ?? null,
        entityId: entry.entityId ?? null,
        details: entry.details ?? null,
        ipAddress: event ? (clientIp(event) ?? null) : null,
      })
  } catch (error) {
    log.warn('Protokolleintrag konnte nicht geschrieben werden', { action: entry.action, error })
  }
}

export async function purgeAuditLog(retentionDays: number): Promise<number> {
  if (retentionDays <= 0) return 0
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
  const removed = await useDatabase()
    .delete(auditLog)
    .where(lt(auditLog.createdAt, cutoff))
    .returning({ id: auditLog.id })
  return removed.length
}
