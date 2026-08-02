import { SCHOOL_FORMS } from '#shared/types/domain'
import { z } from 'zod'
import { updatePreferences } from '../../services/user.service'
import { requireUser } from '../../utils/auth'
import { readZodBody } from '../../utils/validation'

const schema = z.object({
  theme: z.enum(['hell', 'dunkel', 'system']).optional(),
  palette: z.string().max(40).optional(),
  density: z.enum(['komfortabel', 'kompakt']).optional(),
  defaultMaterialView: z.enum(['raster', 'liste', 'tabelle']).optional(),
  sidebarCollapsed: z.boolean().optional(),
  /** null setzt die Einstellung zurück (alle Schulformen sichtbar). */
  visibleSchoolForms: z.array(z.enum(SCHOOL_FORMS)).max(SCHOOL_FORMS.length).nullish(),
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const preferences = await readZodBody(event, schema)
  return { user: await updatePreferences(user.id, preferences) }
})
