import { clearEmbeddings, getIndexStatus, startEmbeddingJob } from '../../services/search/indexer'
import { recordAudit } from '../../services/audit.service'
import { requireAdmin } from '../../utils/auth'

/**
 * Startet die Berechnung fehlender oder veralteter Vektoren im Hintergrund.
 * Mit `?alle=1` werden zuvor alle Vektoren verworfen und mit dem aktuellen
 * Modell neu erzeugt.
 */
export default defineEventHandler(async (event) => {
  const user = await requireAdmin(event)
  const alle = ['1', 'true'].includes(String(getQuery(event).alle ?? ''))

  const status = await getIndexStatus()
  if (!status.job.running) {
    if (alle) await clearEmbeddings()
    void startEmbeddingJob()
    await recordAudit(
      {
        userId: user.id,
        action: alle ? 'suchindex.embeddings_neu' : 'suchindex.embeddings_nachgezogen',
        entityType: 'system',
        details: { modell: status.currentModel },
      },
      event,
    )
  }

  return getIndexStatus()
})
