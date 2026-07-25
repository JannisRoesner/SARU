import { beforeAll, describe, expect, it } from 'vitest'
import {
  normalizeSchoolYear,
  parseCourseName,
  schulportalKursmappeAdapter as adapter,
} from '../../server/services/import/adapters/schulportal-kursmappe'
import { detectBestAdapter } from '../../server/services/import/registry'
import type { ImportSource } from '../../server/services/import/types'
import { SCHULPORTAL_EXPORT_NAME, schulportalExport } from '../fixtures'

let source: ImportSource

beforeAll(async () => {
  const buffer = await schulportalExport()
  source = {
    fileName: SCHULPORTAL_EXPORT_NAME,
    buffer,
    sizeBytes: buffer.length,
  }
})

describe('parseCourseName', () => {
  it('trennt Fach und Lerngruppe und leitet die Jahrgangsstufe ab', () => {
    expect(parseCourseName('Biologie 09b')).toEqual({
      subjectName: 'Biologie',
      groupName: '09b',
      gradeLevel: 9,
    })
    expect(parseCourseName('Deutsch 10')).toEqual({
      subjectName: 'Deutsch',
      groupName: '10',
      gradeLevel: 10,
    })
    expect(parseCourseName('Politik und Wirtschaft 7c')).toEqual({
      subjectName: 'Politik und Wirtschaft',
      groupName: '7c',
      gradeLevel: 7,
    })
  })

  it('erkennt Kursbezeichnungen der Oberstufe ohne Jahrgangszahl', () => {
    expect(parseCourseName('Biologie Q3')).toEqual({
      subjectName: 'Biologie',
      groupName: 'Q3',
      gradeLevel: null,
    })
  })

  it('gibt bei unbekanntem Aufbau alles als Fach zurück', () => {
    expect(parseCourseName('Projektkurs')).toEqual({
      subjectName: 'Projektkurs',
      groupName: null,
      gradeLevel: null,
    })
  })
})

describe('normalizeSchoolYear', () => {
  it('wandelt das Anfangsjahr in die übliche Schreibweise um', () => {
    expect(normalizeSchoolYear('2024')).toBe('2024/25')
    expect(normalizeSchoolYear('2099')).toBe('2099/00')
  })

  it('gibt bei fehlenden oder unsinnigen Angaben null zurück', () => {
    expect(normalizeSchoolYear(null)).toBeNull()
    expect(normalizeSchoolYear('unbekannt')).toBeNull()
  })
})

describe('Erkennung des Schulportal-Exports', () => {
  it('erkennt das Beispielarchiv mit voller Sicherheit', async () => {
    const result = await adapter.detect(source)
    expect(result.confidence).toBe(1)
    expect(result.reason).toContain('3 Terminen')
  })

  it('lehnt Dateien ab, die kein ZIP-Archiv sind', async () => {
    const result = await adapter.detect({
      fileName: 'notizen.pdf',
      buffer: Buffer.from('kein zip'),
      sizeBytes: 8,
    })
    expect(result.confidence).toBe(0)
  })

  it('wählt über die Registry automatisch den passenden Adapter', async () => {
    const match = await detectBestAdapter(source)
    expect(match.adapter.id).toBe('schulportal-hessen-kursmappe')
    expect(match.confidence).toBe(1)
  })

  it('meldet unbekannte Formate mit verständlichem Hinweis', async () => {
    await expect(
      detectBestAdapter({ fileName: 'export.txt', buffer: Buffer.from('x'), sizeBytes: 1 }),
    ).rejects.toThrow(/nicht erkannt/i)
  })
})

describe('Auswertung des Schulportal-Exports', () => {
  it('liest Kursdaten und Exportinformationen', async () => {
    const parsed = await adapter.parse(source)

    expect(parsed.course.rawName).toBe('Biologie 09b')
    expect(parsed.course.subjectName).toBe('Biologie')
    expect(parsed.course.groupName).toBe('09b')
    expect(parsed.course.gradeLevel).toBe(9)
    expect(parsed.course.schoolYear).toBe('2024/25')
    expect(parsed.course.halfYear).toBe(2)
    expect(parsed.exportedBy).toBe('Test Lehrkraft')
  })

  it('liest die Termine chronologisch aufsteigend', async () => {
    const parsed = await adapter.parse(source)

    expect(parsed.lessons).toHaveLength(3)
    expect(parsed.lessons[0]!.date).toBe('2025-02-05')
    expect(parsed.lessons.at(-1)!.date).toBe('2025-02-19')

    const dates = parsed.lessons.map((l) => l.date)
    expect([...dates].sort()).toEqual(dates)
  })

  it('übernimmt Thema, Inhalt, Hausaufgaben und Schulstunden', async () => {
    const parsed = await adapter.parse(source)
    const lesson = parsed.lessons.find((l) => l.date === '2025-02-12')!

    expect(lesson.topic).toBe('Photosynthese')
    expect(lesson.periodFrom).toBe(3)
    expect(lesson.periodTo).toBe(4)
    expect(lesson.periods).toBe(2)
    expect(lesson.content).toContain('Photosynthese')
    expect(lesson.homework).toContain('Protokoll')
    expect(lesson.substituteTeacher).toBeNull()
  })

  it('ordnet die Anlagen den richtigen Terminen zu', async () => {
    const parsed = await adapter.parse(source)
    const lesson = parsed.lessons.find((l) => l.date === '2025-02-05')!

    expect(lesson.attachments).toHaveLength(1)
    expect(lesson.attachments[0]!.fileName).toBe('Arbeitsblatt.pdf')
    expect(lesson.attachments[0]!.sizeBytes).toBeGreaterThan(0)

    const total = parsed.lessons.reduce((sum, l) => sum + l.attachments.length, 0)
    expect(total).toBe(2)
  })

  it('behandelt Termine ohne Inhalt oder Anlagen fehlerfrei', async () => {
    const parsed = await adapter.parse(source)
    const lesson = parsed.lessons.find((l) => l.date === '2025-02-19')!

    expect(lesson.topic).toBe('Abschluss')
    expect(lesson.content).toBeNull()
    expect(lesson.homework).toBeNull()
    expect(lesson.attachments).toEqual([])
  })

  it('meldet keine verwaisten Dateien für einen vollständigen Export', async () => {
    const parsed = await adapter.parse(source)
    expect(parsed.orphanFiles).toEqual([])
  })

  it('vergibt eindeutige, stabile Quellreferenzen', async () => {
    const parsed = await adapter.parse(source)
    const refs = parsed.lessons.map((l) => l.sourceRef)
    expect(new Set(refs).size).toBe(refs.length)
    expect(refs).toContain('termin:2025-02-12')
  })

  it('liefert den Inhalt einer Anlage auf Anforderung', async () => {
    const buffer = await adapter.readAttachment(
      source,
      '20250205_Einfuehrung/Arbeitsblatt.pdf',
    )
    expect(buffer).not.toBeNull()
    expect(buffer!.subarray(0, 4).toString()).toBe('%PDF')
  })

  it('gibt null zurück, wenn eine Anlage nicht existiert', async () => {
    expect(await adapter.readAttachment(source, 'gibt/es/nicht.pdf')).toBeNull()
  })
})
