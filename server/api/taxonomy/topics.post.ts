import { getOrCreateTopic, listTopics } from '../../services/taxonomy.service'
import { requireEditor } from '../../utils/auth'
import { topicSchema } from '../../utils/schemas'
import { readZodBody } from '../../utils/validation'

export default defineEventHandler(async (event) => {
  await requireEditor(event)
  const { name, parentId, subjectId } = await readZodBody(event, topicSchema)

  const id = await getOrCreateTopic(name, { parentId, subjectId })
  const topics = await listTopics()

  setResponseStatus(event, 201)
  return topics.find((t) => t.id === id)!
})
