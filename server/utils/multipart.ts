import type { H3Event } from 'h3'
import { getRequestHeader, readRawBody } from 'h3'

/** Entspricht h3s MultiPartData, ohne dessen byteweisen Parser. */
export interface MultipartPart {
  data: Buffer
  name?: string
  filename?: string
  type?: string
}

const CRLFCRLF = Buffer.from('\r\n\r\n')

function stripQuotes(value: string): string {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

export function multipartBoundary(contentType: string | undefined): string | null {
  if (!contentType?.toLowerCase().startsWith('multipart/form-data')) return null
  const match = contentType.match(/boundary=([^;]*)(;|$)/i)
  if (!match?.[1]) return null
  const boundary = stripQuotes(match[1])
  return boundary || null
}

function headerValue(headers: string, name: string): string {
  const prefix = `${name}:`
  for (const line of headers.split('\r\n')) {
    if (line.toLowerCase().startsWith(prefix)) {
      return line.slice(prefix.length).trim()
    }
  }
  return ''
}

function parseDisposition(header: string): { name?: string; filename?: string } {
  const result: { name?: string; filename?: string } = {}
  const starred = header.match(/filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/i)
  if (starred?.[1]) {
    try {
      result.filename = decodeURIComponent(starred[1].trim())
    } catch {
      result.filename = starred[1].trim()
    }
  }

  for (const segment of header.split(';')) {
    const eq = segment.indexOf('=')
    if (eq < 0) continue
    const key = segment.slice(0, eq).trim().toLowerCase()
    const value = stripQuotes(segment.slice(eq + 1)).replace(/\\"/g, '"')
    if (key === 'name') result.name = Buffer.from(value, 'latin1').toString('utf8')
    if (key === 'filename' && !result.filename) {
      result.filename = Buffer.from(value, 'latin1').toString('utf8')
    }
  }
  return result
}

/**
 * Zerlegt einen Multipart-Body per Buffer.indexOf.
 * h3s readMultipartFormData legt jedes Byte in ein JS-Array – ab ~180 MB
 * wirft V8 RangeError: Invalid array length.
 */
export function parseMultipartBuffer(body: Buffer, boundary: string): MultipartPart[] {
  const dashBoundary = Buffer.from(`--${boundary}`)
  const parts: MultipartPart[] = []
  let searchFrom = 0

  while (searchFrom < body.length) {
    const boundaryAt = body.indexOf(dashBoundary, searchFrom)
    if (boundaryAt === -1) break

    let cursor = boundaryAt + dashBoundary.length
    if (body[cursor] === 0x2d && body[cursor + 1] === 0x2d) break
    if (body[cursor] !== 0x0d || body[cursor + 1] !== 0x0a) break
    cursor += 2

    const headersEnd = body.indexOf(CRLFCRLF, cursor)
    if (headersEnd === -1) break

    const nextBoundary = body.indexOf(dashBoundary, headersEnd + 4)
    if (nextBoundary === -1) break

    let dataEnd = nextBoundary
    if (dataEnd >= 2 && body[dataEnd - 2] === 0x0d && body[dataEnd - 1] === 0x0a) {
      dataEnd -= 2
    }

    const headers = body.subarray(cursor, headersEnd).toString('latin1')
    const disposition = parseDisposition(headerValue(headers, 'content-disposition'))
    const type = headerValue(headers, 'content-type') || undefined

    const part: MultipartPart = { data: body.subarray(headersEnd + 4, dataEnd) }
    if (disposition.name) part.name = disposition.name
    if (disposition.filename) part.filename = disposition.filename
    if (type) part.type = type
    parts.push(part)

    searchFrom = nextBoundary
  }

  return parts
}

/** Liest multipart/form-data ohne h3s Array.push-Parser. */
export async function readMultipartParts(event: H3Event): Promise<MultipartPart[] | undefined> {
  const boundary = multipartBoundary(getRequestHeader(event, 'content-type'))
  if (!boundary) return
  const raw = await readRawBody(event, false)
  if (!raw) return
  const body = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)
  return parseMultipartBuffer(body, boundary)
}
