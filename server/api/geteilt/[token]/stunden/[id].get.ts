import { gastStunde } from '../../../../services/share-view.service'
import { gastZugriff } from '../../../../utils/gast'
import { parseOrThrow, uuidSchema } from '../../../../utils/validation'

export default defineEventHandler(async (event) => {
  const umfang = await gastZugriff(event)
  const id = parseOrThrow(uuidSchema, getRouterParam(event, 'id'))
  return gastStunde(umfang, id)
})
