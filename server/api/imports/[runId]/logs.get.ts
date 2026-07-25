import { asc, eq } from 'drizzle-orm'
import { useDatabase } from '../../../database/client'
import { importLogs, importRunItems } from '../../../database/schema'
import { requireEditor } from '../../../utils/auth'
import { parseOrThrow, uuidSchema } from '../../../utils/validation'

/** Das Protokoll eines Vorgangs: Ereignisse und je Quelldatensatz das Ergebnis. */
export default defineEventHandler(async (event) => {
  await requireEditor(event)
  const runId = parseOrThrow(uuidSchema, getRouterParam(event, 'runId'))
  const db = useDatabase()

  const [logs, items] = await Promise.all([
    db.select().from(importLogs).where(eq(importLogs.runId, runId)).orderBy(asc(importLogs.createdAt)),
    db
      .select()
      .from(importRunItems)
      .where(eq(importRunItems.runId, runId))
      .orderBy(asc(importRunItems.createdAt)),
  ])

  return { logs, items }
})
