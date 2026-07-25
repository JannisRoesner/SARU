import { listBulkUploads } from '../../../services/bulk-upload/bulk-upload.service'
import { requireEditor } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  await requireEditor(event)
  return listBulkUploads()
})
