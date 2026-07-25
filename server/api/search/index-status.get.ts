import { getIndexStatus } from '../../services/search/indexer'
import { requireUser } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  return getIndexStatus()
})
