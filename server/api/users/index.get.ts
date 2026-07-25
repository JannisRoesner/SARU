import { listUsers } from '../../services/user.service'
import { requireAdmin } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return { items: await listUsers() }
})
