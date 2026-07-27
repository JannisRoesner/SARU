import { gunzipSync, unzipSync } from 'fflate'
import type { MbzMetadata } from '#shared/utils/moodle'
import { kursarchivErweiterung } from '#shared/utils/moodle'

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
}

function decodeXmlText(raw: string): string {
  const cdata = raw.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/i)
  return decodeXmlEntities((cdata?.[1] ?? raw).trim())
}

/** Extrahiert Klartext aus XML-Inhalt (LOM string-Wrapper, CDATA, verschachtelte Tags). */
function flattenXmlText(raw: string): string {
  let text = raw.trim()
  text = text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
  text = text.replace(/<[^>]+>/g, '')
  text = decodeXmlEntities(text)
  return text.replace(/\s+/g, ' ').trim()
}

function xmlTag(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i')
  const match = xml.match(re)
  if (!match?.[1]) return null
  const value = decodeXmlText(match[1].trim())
  return value || null
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function readBackupXml(buffer: Buffer): string | null {
  const payloads: Buffer[] = [buffer]
  if (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
    try {
      payloads.unshift(Buffer.from(gunzipSync(buffer)))
    } catch {
      // weiter mit Rohpuffer
    }
  }

  for (const payload of payloads) {
    if (payload.length >= 4 && payload[0] === 0x50 && payload[1] === 0x4b) {
      try {
        const entries = unzipSync(payload)
        const name = Object.keys(entries).find((n) => n.endsWith('moodle_backup.xml'))
        if (name) return new TextDecoder('utf-8').decode(entries[name]!)
      } catch {
        // nächster Versuch
      }
    }
    const asText = payload.toString('utf-8')
    if (asText.includes('<moodle_backup')) return asText
  }

  return null
}

function readManifestXml(buffer: Buffer): string | null {
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) return null
  try {
    const entries = unzipSync(buffer)
    const name = Object.keys(entries).find((n) => /imsmanifest\.xml$/i.test(n))
    if (name) return new TextDecoder('utf-8').decode(entries[name]!)
  } catch {
    // ungültiges ZIP
  }
  return null
}

function xmlTagAnyNs(xml: string, localName: string): string | null {
  const re = new RegExp(`<(?:[\\w.-]+:)?${localName}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${localName}>`, 'i')
  const match = xml.match(re)
  if (!match?.[1]) return null
  const value = decodeXmlText(match[1].trim())
  return value || null
}

/** Liest Kurstitel aus einer .imscc-Datei (IMS Common Cartridge). */
export function parseImsccMetadata(buffer: Buffer, fileName?: string): MbzMetadata {
  const xml = readManifestXml(buffer)
  if (!xml || !/<manifest\b/i.test(xml)) {
    throw new Error('Kein gültiges IMS Common Cartridge (.imscc) erkannt.')
  }

  const fullNameRaw =
    xmlTagAnyNs(xml, 'title') ??
    xmlTag(xml, 'title')
  const fullName = fullNameRaw ? flattenXmlText(fullNameRaw) : null
  const cartridgeVersion = xmlTag(xml, 'schemaversion') ?? xmlTagAnyNs(xml, 'schemaversion')
  const summaryRaw = xmlTagAnyNs(xml, 'description') ?? xmlTag(xml, 'description')
  const summary = summaryRaw ? stripHtml(flattenXmlText(summaryRaw)) : null

  if (!fullName && !cartridgeVersion) {
    throw new Error('Die Cartridge-Datei enthält keine erkennbaren Kursinformationen.')
  }

  return {
    archiveFormat: 'imscc',
    fullName,
    shortName: null,
    summary: summary ? summary.slice(0, 4000) : null,
    moodleRelease: null,
    moodleVersion: null,
    backupDate: null,
    courseFormat: null,
    cartridgeVersion,
    originalFileName: fileName ?? null,
  }
}

/** Liest Metadaten aus .mbz oder .imscc anhand des Dateinamens. */
export function parseKursarchivMetadata(buffer: Buffer, fileName: string): MbzMetadata {
  const format = kursarchivErweiterung(fileName)
  if (format === 'imscc') return parseImsccMetadata(buffer, fileName)
  if (format === 'mbz') return parseMbzMetadata(buffer, fileName)
  throw new Error('Nur .mbz- und .imscc-Dateien werden unterstützt.')
}

/** Liest Kurstitel und Moodle-Version aus einer .mbz-Datei. */
export function parseMbzMetadata(buffer: Buffer, fileName?: string): MbzMetadata {
  const xml = readBackupXml(buffer)
  if (!xml) {
    throw new Error('Kein gültiges Moodle-Backup (.mbz) erkannt.')
  }

  const courseBlock = xml.match(/<course\b[^>]*>[\s\S]*?<\/course>/i)?.[0] ?? xml
  const fullName = xmlTag(courseBlock, 'fullname') ?? xmlTag(xml, 'fullname')
  const shortName = xmlTag(courseBlock, 'shortname') ?? xmlTag(xml, 'shortname')
  const summaryRaw = xmlTag(courseBlock, 'summary') ?? xmlTag(xml, 'summary')
  const summary = summaryRaw ? stripHtml(summaryRaw) : null

  const moodleRelease = xmlTag(xml, 'moodle_release')
  const moodleVersion = xmlTag(xml, 'moodle_version')
  const backupDate = xmlTag(xml, 'backup_date') ?? xmlTag(xml, 'original_backup_date')

  let courseFormat: string | null = null
  const detailBlock = xml.match(/<detail\b[^>]*>[\s\S]*?<\/detail>/i)?.[0]
  if (detailBlock && xmlTag(detailBlock, 'type') === 'course') {
    courseFormat = xmlTag(detailBlock, 'format')
  }
  if (!courseFormat) courseFormat = xmlTag(courseBlock, 'format')

  let normalizedDate: string | null = null
  if (backupDate) {
    const numeric = Number(backupDate)
    if (Number.isFinite(numeric) && numeric > 1_000_000_000) {
      normalizedDate = new Date(numeric * 1000).toISOString().slice(0, 10)
    } else if (/^\d{4}-\d{2}-\d{2}/.test(backupDate)) {
      normalizedDate = backupDate.slice(0, 10)
    }
  }

  if (!fullName && !shortName && !moodleRelease) {
    throw new Error('Die Backup-Datei enthält keine erkennbaren Kursinformationen.')
  }

  return {
    archiveFormat: 'mbz',
    fullName,
    shortName,
    summary: summary ? summary.slice(0, 4000) : null,
    moodleRelease,
    moodleVersion,
    backupDate: normalizedDate,
    courseFormat,
    cartridgeVersion: null,
    originalFileName: fileName ?? null,
  }
}
