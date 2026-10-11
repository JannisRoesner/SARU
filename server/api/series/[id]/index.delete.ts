import { z } from 'zod'
import { deleteSeries } from '../../../services/series.service'
import { recordAudit } from '../../../services/audit.service'
import { requireSeriesLoeschen } from '../../../utils/permissions'
import { parseOrThrow, readValidatedQuery, uuidSchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  const user = await requireSeriesLoeschen(event, id)
  const { deleteLessons } = readValidatedQuery(
    event,
    z.object({ deleteLessons: z.enum(['0', '1']).default('0') }),
  )

  await deleteSeries(id, { deleteLessons: deleteLessons === '1' })
  await recordAudit(
    {
      userId: user.id,
      action: 'reihe.geloescht',
      entityType: 'reihe',
      entityId: id,
      details: { stundenGeloescht: deleteLessons === '1' },
    },
    event,
  )

  return { erfolg: true }
})
