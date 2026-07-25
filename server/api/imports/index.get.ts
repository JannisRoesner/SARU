import { and, desc } from 'drizzle-orm'
import { useDatabase } from '../../database/client'
import { importRuns } from '../../database/schema'
import { excludeBulkAdapterSql } from '../../services/bulk-upload/bulk-upload.service'
import { requireEditor } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  await requireEditor(event)

  return useDatabase()
    .select({
      id: importRuns.id,
      sourceFileName: importRuns.sourceFileName,
      sourceSizeBytes: importRuns.sourceSizeBytes,
      adapterId: importRuns.adapterId,
      adapterVersion: importRuns.adapterVersion,
      status: importRuns.status,
      stats: importRuns.stats,
      errorMessage: importRuns.errorMessage,
      startedAt: importRuns.startedAt,
      finishedAt: importRuns.finishedAt,
      undoneAt: importRuns.undoneAt,
    })
    .from(importRuns)
    .where(and(excludeBulkAdapterSql()))
    .orderBy(desc(importRuns.startedAt))
    .limit(50)
})
