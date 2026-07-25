import { getSeriesDetail } from '../../repositories/series.repository'
import { createSeries } from '../../services/series.service'
import { recordAudit } from '../../services/audit.service'
import { requireEditor } from '../../utils/auth'
import { seriesCreateSchema } from '../../utils/schemas'
import { readValidatedBody } from '../../utils/validation'

export default defineEventHandler(async (event) => {
  const user = await requireEditor(event)
  const input = await readValidatedBody(event, seriesCreateSchema)

  const id = await createSeries(input, user.id)
  await recordAudit(
    {
      userId: user.id,
      action: 'reihe.erstellt',
      entityType: 'reihe',
      entityId: id,
      details: { titel: input.title },
    },
    event,
  )

  setResponseStatus(event, 201)
  return getSeriesDetail(id)
})
