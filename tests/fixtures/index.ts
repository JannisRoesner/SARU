import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

/** Neutrales Beispielarchiv für den Schulportal-Adapter (ohne reale Unterrichtsdaten). */
export const SCHULPORTAL_EXPORT_NAME = 'schulportal-kursmappe.zip'

export function fixturePfad(name: string) {
  return fileURLToPath(new URL(name, import.meta.url))
}

export function schulportalExport() {
  return readFile(fixturePfad(SCHULPORTAL_EXPORT_NAME))
}

export function samplePdf() {
  return readFile(fixturePfad('sample.pdf'))
}
