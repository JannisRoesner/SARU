import { describe, expect, it } from 'vitest'
import { multipartBoundary, parseMultipartBuffer } from '../../server/utils/multipart'

function buildMultipart(
  parts: Array<{ name: string; filename?: string; type?: string; data: Buffer }>,
  boundary = '----SaruTestBoundary',
  { quoteBoundary = false } = {},
) {
  const chunks: Buffer[] = []
  for (const part of parts) {
    const disposition = part.filename
      ? `form-data; name="${part.name}"; filename="${part.filename}"`
      : `form-data; name="${part.name}"`
    const typeLine = part.type ? `Content-Type: ${part.type}\r\n` : ''
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: ${disposition}\r\n${typeLine}\r\n`,
      ),
      part.data,
      Buffer.from('\r\n'),
    )
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`))
  const header = quoteBoundary ? `"${boundary}"` : boundary
  return {
    contentType: `multipart/form-data; boundary=${header}`,
    body: Buffer.concat(chunks),
  }
}

describe('multipartBoundary', () => {
  it('liest unquoted und quoted Boundaries', () => {
    expect(multipartBoundary('multipart/form-data; boundary=----abc')).toBe('----abc')
    expect(multipartBoundary('multipart/form-data; boundary="----abc"')).toBe('----abc')
    expect(multipartBoundary('application/json')).toBeNull()
  })
})

describe('parseMultipartBuffer', () => {
  it('liest Datei- und Textfelder', () => {
    const file = Buffer.from('%PDF-1.4 test')
    const { body, contentType } = buildMultipart([
      { name: 'file', filename: 'blatt.pdf', type: 'application/pdf', data: file },
      { name: 'context', data: Buffer.from('{"ok":true}') },
    ])
    const parts = parseMultipartBuffer(body, multipartBoundary(contentType)!)
    expect(parts).toHaveLength(2)
    expect(parts[0]).toMatchObject({ name: 'file', filename: 'blatt.pdf', type: 'application/pdf' })
    expect(parts[0]!.data.equals(file)).toBe(true)
    expect(parts[1]!.data.toString()).toBe('{"ok":true}')
    expect(parts[1]!.filename).toBeUndefined()
  })

  it('akzeptiert quoted Boundaries', () => {
    const { body, contentType } = buildMultipart(
      [{ name: 'file', filename: 'a.bin', data: Buffer.from('xyz') }],
      '----SaruTestBoundary',
      { quoteBoundary: true },
    )
    const parts = parseMultipartBuffer(body, multipartBoundary(contentType)!)
    expect(parts[0]?.data.toString()).toBe('xyz')
  })

  it('behält Binärdaten mit CRLF im Inhalt', () => {
    const data = Buffer.concat([
      Buffer.from([0, 1, 2, 13, 10, 3, 4]),
      Buffer.alloc(64 * 1024, 0x7a),
    ])
    const { body, contentType } = buildMultipart([
      { name: 'file', filename: 'scan.bin', data },
    ])
    const parts = parseMultipartBuffer(body, multipartBoundary(contentType)!)
    expect(parts[0]!.data.equals(data)).toBe(true)
  })
})
