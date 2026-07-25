import { getOrCreateSubject, listSubjects } from '../../services/taxonomy.service'
import { requireEditor } from '../../utils/auth'
import { subjectSchema } from '../../utils/schemas'
import { readValidatedBody } from '../../utils/validation'

export default defineEventHandler(async (event) => {
  await requireEditor(event)
  const { name } = await readValidatedBody(event, subjectSchema)

  const id = await getOrCreateSubject(name)
  const subjects = await listSubjects()

  setResponseStatus(event, 201)
  return subjects.find((s) => s.id === id)!
})
