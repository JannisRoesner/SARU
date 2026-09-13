import type { MaterialType } from '#shared/types/domain'
import type { GradeLevel } from '#shared/utils/jahrgangsstufen'

export interface KiAnalyseErgebnis {
  analyzeId: string
  fileName: string
  sizeBytes: number
  hasText: boolean
  extractionMethod: 'text_layer' | 'vision' | 'none'
  textPreview: string | null
  pageCount: number | null
  aiEnabled: boolean
  suggestions: {
    title: string
    materialType: MaterialType
    schoolForm: string | null
    subjectNames: string[]
    tagNames: string[]
    learningObjectives: string[]
    description: string
    contentSummary: string
    gradeLevels: GradeLevel[]
    aiUsed: boolean
  }
  warnings: string[]
}

interface KiAnalyseStart {
  analyzeId: string
  status: string
}

interface KiAnalyseStand {
  analyzeId: string
  status: 'laeuft' | 'vorschau' | 'fehlgeschlagen'
  fileName: string
  sizeBytes: number
  errorMessage: string | null
  result: KiAnalyseErgebnis | null
}

const POLL_MS = 2000
const MAX_WAIT_MS = 12 * 60 * 1000

function analyseFehler(nachricht: string, statusCode: number, code = 'KI_FEHLER'): Error {
  const error = new Error(nachricht) as Error & {
    statusCode: number
    data: { message: string; statusMessage: string }
  }
  error.statusCode = statusCode
  error.data = { message: nachricht, statusMessage: code }
  return error
}

/** Startet die Hintergrundanalyse und wartet per kurzer Abfrage auf das Ergebnis. */
export async function analysiereKiMaterial(
  file: File,
  context?: Record<string, unknown>,
): Promise<KiAnalyseErgebnis> {
  const body = new FormData()
  body.append('file', file)
  if (context) body.append('context', JSON.stringify(context))

  const start = await $fetch<KiAnalyseStart>('/api/materials/ai/analyze', {
    method: 'POST',
    body,
  })

  const begun = Date.now()
  while (Date.now() - begun < MAX_WAIT_MS) {
    const stand = await $fetch<KiAnalyseStand>(`/api/materials/ai/${start.analyzeId}`)
    if (stand.status === 'vorschau' && stand.result) return stand.result
    if (stand.status === 'fehlgeschlagen') {
      throw analyseFehler(
        stand.errorMessage || 'Die KI-Analyse ist fehlgeschlagen.',
        422,
      )
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }

  throw analyseFehler(
    'Die Analyse dauert ungewöhnlich lange. Bitte später erneut versuchen.',
    504,
  )
}
