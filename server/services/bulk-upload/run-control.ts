/**
 * In-Prozess-Register der Stapel-Läufe, die gerade in diesem Node-Prozess arbeiten.
 * Was hier nicht steht, aber in der Datenbank `laeuft` heißt, ist verwaist
 * (Serverneustart oder Absturz mitten in Analyse oder Übernahme).
 */
const analyses = new Map<string, AbortController>()
const commits = new Set<string>()

export function registerAnalysis(runId: string): AbortSignal {
  analyses.get(runId)?.abort()
  const controller = new AbortController()
  analyses.set(runId, controller)
  return controller.signal
}

export function unregisterAnalysis(runId: string, signal: AbortSignal): void {
  // Nur den eigenen Eintrag entfernen – ein neuerer Worker könnte schon registriert sein.
  if (analyses.get(runId)?.signal === signal) analyses.delete(runId)
}

/** Signalisiert einem laufenden Worker den Abbruch. `true`, wenn einer lief. */
export function abortAnalysis(runId: string): boolean {
  const controller = analyses.get(runId)
  if (!controller) return false
  controller.abort()
  analyses.delete(runId)
  return true
}

export function registerCommit(runId: string): void {
  commits.add(runId)
}

export function unregisterCommit(runId: string): void {
  commits.delete(runId)
}

export function isRunActive(runId: string): boolean {
  return analyses.has(runId) || commits.has(runId)
}

export interface OrphanRecoveryInput {
  /** `true`: in der Analyse unterbrochen, sonst während der Übernahme. */
  analysisPending: boolean
  /** Materialien, die die unterbrochene Übernahme schon angelegt hat (laut import_run_items). */
  createdMaterials: number
  reason: 'neustart' | 'fehler'
}

export interface OrphanRecoveryDecision {
  status: 'fehlgeschlagen' | 'teilweise_importiert'
  errorMessage: string
  /** Übrige Staging-Dateien gleich entfernen (der Stapel kann nicht erneut übernommen werden). */
  discardStaging: boolean
}

/**
 * Was mit einem verwaisten `laeuft`-Stapel passiert:
 * - Analyse unterbrochen → `fehlgeschlagen`; Dateien bleiben, bis jemand verwirft.
 * - Übernahme mit angelegten Materialien → `teilweise_importiert`, damit „Rückgängig“
 *   die bereits angelegten Materialien über import_run_items wieder entfernen kann.
 * - Übernahme ohne angelegte Materialien → `fehlgeschlagen`, verwerfbar.
 */
export function decideOrphanRecovery(input: OrphanRecoveryInput): OrphanRecoveryDecision {
  const ursache =
    input.reason === 'neustart' ? 'durch einen Neustart des Servers' : 'durch einen Fehler'
  if (input.analysisPending) {
    return {
      status: 'fehlgeschlagen',
      errorMessage: `Die Analyse wurde ${ursache} unterbrochen. Bitte den Stapel verwerfen und neu hochladen.`,
      discardStaging: false,
    }
  }
  if (input.createdMaterials > 0) {
    const n = input.createdMaterials
    return {
      status: 'teilweise_importiert',
      errorMessage: `Die Übernahme wurde ${ursache} unterbrochen. ${n} Material${n === 1 ? '' : 'ien'} wurde${n === 1 ? '' : 'n'} schon angelegt und lässt sich rückgängig machen; die übrigen Dateien wurden nicht übernommen.`,
      discardStaging: true,
    }
  }
  return {
    status: 'fehlgeschlagen',
    errorMessage: `Die Übernahme wurde ${ursache} unterbrochen, bevor Materialien angelegt wurden. Bitte den Stapel verwerfen und neu hochladen.`,
    discardStaging: false,
  }
}
