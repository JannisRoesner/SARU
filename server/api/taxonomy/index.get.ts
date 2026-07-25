import {
  listCompetencies,
  listLearningGroups,
  listSubjects,
  listTags,
  listTopics,
} from '../../services/taxonomy.service'
import { requireUser } from '../../utils/auth'

/** Sammelabruf aller Auswahllisten – die Oberfläche braucht sie fast überall. */
export default defineEventHandler(async (event) => {
  await requireUser(event)

  const [subjects, learningGroups, topics, tags, competencies] = await Promise.all([
    listSubjects(),
    listLearningGroups(),
    listTopics(),
    listTags(),
    listCompetencies(),
  ])

  return { subjects, learningGroups, topics, tags, competencies }
})
