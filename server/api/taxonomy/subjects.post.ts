import { getOrCreateSubject, listSubjects } from '../../services/taxonomy.service'
import { requireRecht } from '../../utils/permissions'
import { subjectSchema } from '../../utils/schemas'
import { readZodBody } from '../../utils/validation'

export default defineEventHandler(async (event) => {
  await requireRecht(event, 'anlegen')
  const { name } = await readZodBody(event, subjectSchema)

  const id = await getOrCreateSubject(name)
  const subjects = await listSubjects()

  setResponseStatus(event, 201)
  return subjects.find((s) => s.id === id)!
})
