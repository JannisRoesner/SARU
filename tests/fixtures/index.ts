import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

/**
 * Der Beispielexport des Schulportals liegt im Wurzelverzeichnis des Repos und
 * wird von dort gelesen, statt ihn als Kopie zu hinterlegen.
 */
export const SCHULPORTAL_EXPORT_NAME = '2024 2.HJ Biologie 09b- Stunden und Anhänge.zip'

export function fixturePfad(name: string) {
  return fileURLToPath(new URL(name, import.meta.url))
}

export function schulportalExport() {
  return readFile(fileURLToPath(new URL(`../../${SCHULPORTAL_EXPORT_NAME}`, import.meta.url)))
}
