import { listAdapters } from '../../services/import/registry'
import { requireRecht } from '../../utils/permissions'

/** Die verfügbaren Importformate – die Liste wächst mit neuen Adaptern mit. */
export default defineEventHandler(async (event) => {
  await requireRecht(event, 'anlegen')

  return listAdapters().map((adapter) => ({
    id: adapter.id,
    label: adapter.label,
    version: adapter.version,
    description: adapter.description,
    extensions: adapter.extensions,
  }))
})
