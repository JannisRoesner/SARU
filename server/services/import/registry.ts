import { appError } from '../../utils/errors'
import { schulportalKursmappeAdapter } from './adapters/schulportal-kursmappe'
import type { ImportAdapter, ImportSource } from './types'

/**
 * Verzeichnis aller verfügbaren Importadapter.
 * Ein neues Format wird ausschließlich hier registriert – Vorschau,
 * Dublettenerkennung und Speicherung bleiben unverändert.
 */
const adapters: ImportAdapter[] = [schulportalKursmappeAdapter]

export function listAdapters(): ImportAdapter[] {
  return [...adapters]
}

export function getAdapter(id: string): ImportAdapter {
  const adapter = adapters.find((entry) => entry.id === id)
  if (!adapter) {
    throw appError('IMPORT_FEHLER', `Für das Format „${id}“ ist kein Importadapter vorhanden.`)
  }
  return adapter
}

export interface AdapterMatch {
  adapter: ImportAdapter
  confidence: number
  reason: string
}

/** Befragt alle Adapter und liefert sie nach Erkennungssicherheit sortiert. */
export async function detectAdapters(source: ImportSource): Promise<AdapterMatch[]> {
  const matches: AdapterMatch[] = []

  for (const adapter of adapters) {
    try {
      const result = await adapter.detect(source)
      matches.push({ adapter, confidence: result.confidence, reason: result.reason })
    } catch (error) {
      matches.push({
        adapter,
        confidence: 0,
        reason: `Erkennung fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }

  return matches.sort((a, b) => b.confidence - a.confidence)
}

export async function detectBestAdapter(source: ImportSource): Promise<AdapterMatch> {
  const [best] = await detectAdapters(source)

  if (!best || best.confidence <= 0) {
    throw appError(
      'IMPORT_FEHLER',
      'Das Dateiformat wurde nicht erkannt. Unterstützt werden derzeit ZIP-Exporte einer Kursmappe aus „mein Unterricht“ des Schulportals Hessen.',
      { details: { geprueft: adapters.map((a) => a.label) } },
    )
  }

  return best
}
