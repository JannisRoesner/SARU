import { getOrCreateTopic, listTopics } from '../../services/taxonomy.service'
import { requireRecht } from '../../utils/permissions'
import { topicSchema } from '../../utils/schemas'
import { readZodBody } from '../../utils/validation'

export default defineEventHandler(async (event) => {
  await requireRecht(event, 'anlegen')
  const { name, parentId, subjectId } = await readZodBody(event, topicSchema)

  const id = await getOrCreateTopic(name, { parentId, subjectId })
  const topics = await listTopics()

  setResponseStatus(event, 201)
  return topics.find((t) => t.id === id)!
})
