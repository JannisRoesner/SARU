import { getOrCreateLearningGroup, listLearningGroups } from '../../services/taxonomy.service'
import { requireRecht } from '../../utils/permissions'
import { learningGroupSchema } from '../../utils/schemas'
import { readZodBody } from '../../utils/validation'

export default defineEventHandler(async (event) => {
  await requireRecht(event, 'anlegen')
  const input = await readZodBody(event, learningGroupSchema)

  const id = await getOrCreateLearningGroup(input)
  const groups = await listLearningGroups()

  setResponseStatus(event, 201)
  return groups.find((g) => g.id === id)!
})
