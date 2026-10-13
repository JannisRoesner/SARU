import { and, desc, ne } from 'drizzle-orm'
import { SICHERUNG_ADAPTER_ID } from '#shared/utils/sicherung'
import { useDatabase } from '../../database/client'
import { importRuns } from '../../database/schema'
import { excludeBulkAdapterSql } from '../../services/bulk-upload/bulk-upload.service'
import { requireRecht } from '../../utils/permissions'

export default defineEventHandler(async (event) => {
  await requireRecht(event, 'anlegen')

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
    .where(and(excludeBulkAdapterSql(), ne(importRuns.adapterId, SICHERUNG_ADAPTER_ID)))
    .orderBy(desc(importRuns.startedAt))
    .limit(50)
})
