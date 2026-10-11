import { listBulkUploads } from '../../../services/bulk-upload/bulk-upload.service'
import { requireRecht } from '../../../utils/permissions'

export default defineEventHandler(async (event) => {
  await requireRecht(event, 'anlegen')
  return listBulkUploads()
})
