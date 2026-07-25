import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { SCHULPORTAL_EXPORT_NAME, schulportalExport } from '../fixtures'
import { closeConnections, createTestUser, resetDatabase, withTempUploadDir } from './helpers'

const { analyzeImport, commitImport, undoImport, updateMapping } = await import(
  '../../server/services/import/importer'
)
const { useDatabase } = await import('../../server/database/client')
const { getMaterialDetail, listMaterials } = await import(
  '../../server/repositories/material.repository'
)
const { listLessons } = await import('../../server/repositories/lesson.repository')
const { listSeries, getSeriesDetail } = await import('../../server/repositories/series.repository')

let userId: string
let archive: Buffer

const FILE_NAME = SCHULPORTAL_EXPORT_NAME
const LESSON_COUNT = 3
const ATTACHMENT_COUNT = 2

beforeAll(async () => {
  archive = await schulportalExport()
})

afterAll(async () => {
  await closeConnections()
})

beforeEach(async () => {
  await resetDatabase()
  userId = (await createTestUser()).id
})

describe('Importassistent für das Schulportal Hessen', () => {
  it('erzeugt eine Vorschau mit erkannten Kursdaten und Vorschlagszuordnung', async () => {
    await withTempUploadDir(async () => {
      const analysis = await analyzeImport({ buffer: archive, fileName: FILE_NAME }, userId)

      expect(analysis.adapterId).toBe('schulportal-hessen-kursmappe')
      expect(analysis.confidence).toBe(1)
      expect(analysis.course.subjectName).toBe('Biologie')
      expect(analysis.course.groupName).toBe('09b')
      expect(analysis.course.gradeLevel).toBe(9)
      expect(analysis.course.schoolYear).toBe('2024/25')
      expect(analysis.exportedBy).toBe('Test Lehrkraft')

      expect(analysis.summary.lessons).toBe(LESSON_COUNT)
      expect(analysis.summary.attachments).toBe(ATTACHMENT_COUNT)
      expect(analysis.summary.duplicateLessons).toBe(0)
      expect(analysis.summary.duplicateAttachments).toBe(0)

      expect(analysis.suggestedMapping.subjectName).toBe('Biologie')
      expect(analysis.suggestedMapping.seriesMode).toBe('neu')
      expect(Object.keys(analysis.suggestedMapping.records ?? {})).toHaveLength(LESSON_COUNT)
    })
  })

  it('berechnet Prüfsummen für alle Anlagen der Vorschau', async () => {
    await withTempUploadDir(async () => {
      const analysis = await analyzeImport({ buffer: archive, fileName: FILE_NAME }, userId)
      const attachments = analysis.lessons.flatMap((l) => l.attachments)

      expect(attachments).toHaveLength(ATTACHMENT_COUNT)
      for (const attachment of attachments) {
        expect(attachment.checksum).toMatch(/^[a-f0-9]{64}$/)
        expect(attachment.sizeBytes).toBeGreaterThan(0)
      }
    })
  })

  it('übernimmt Reihe, Stunden und Materialien vollständig', async () => {
    await withTempUploadDir(async () => {
      const analysis = await analyzeImport({ buffer: archive, fileName: FILE_NAME }, userId)
      const result = await commitImport(analysis.runId, userId)

      expect(result.status).toBe('importiert')
      expect(result.stats.reihen).toBe(1)
      expect(result.stats.stunden).toBe(LESSON_COUNT)
      expect(result.stats.materialien).toBeGreaterThan(0)
      expect(result.errors).toEqual([])

      const seriesList = await listSeries()
      expect(seriesList.total).toBe(1)
      expect(seriesList.items[0]!.title).toContain('Biologie 09b')
      expect(seriesList.items[0]!.progress.total).toBe(LESSON_COUNT)
      expect(seriesList.items[0]!.startDate).toBe('2025-02-05')
      expect(seriesList.items[0]!.endDate).toBe('2025-02-19')

      const lessonList = await listLessons({ pageSize: 50 })
      expect(lessonList.total).toBe(LESSON_COUNT)

      const materialList = await listMaterials({ pageSize: 100 })
      expect(materialList.total).toBeGreaterThanOrEqual(1)
    })
  })

  it('erhält Inhalte, Hausaufgaben und Schulstunden der Termine', async () => {
    await withTempUploadDir(async () => {
      const analysis = await analyzeImport({ buffer: archive, fileName: FILE_NAME }, userId)
      await commitImport(analysis.runId, userId)

      const lessonList = await listLessons({ pageSize: 50 })
      const lesson = lessonList.items.find((l) => l.date === '2025-02-12')!

      expect(lesson.title).toBe('Photosynthese')
      expect(lesson.periodFrom).toBe(3)
      expect(lesson.periodTo).toBe(4)
      expect(lesson.durationMinutes).toBe(90)
      expect(lesson.homework).toContain('Protokoll')
      expect(lesson.status).toBe('durchgefuehrt')
      expect(lesson.origin).toBe('import')
      expect(lesson.materialCount).toBe(1)
    })
  })

  it('ordnet die Stunden in der Reihe chronologisch', async () => {
    await withTempUploadDir(async () => {
      const analysis = await analyzeImport({ buffer: archive, fileName: FILE_NAME }, userId)
      await commitImport(analysis.runId, userId)

      const seriesList = await listSeries()
      const detail = await getSeriesDetail(seriesList.items[0]!.id)

      expect(detail!.lessons).toHaveLength(LESSON_COUNT)
      const positions = detail!.lessons.map((l) => l.positionInSeries)
      expect(positions).toEqual([...Array(LESSON_COUNT).keys()])
      expect(detail!.lessons[0]!.date).toBe('2025-02-05')
      expect(detail!.lessons.at(-1)!.date).toBe('2025-02-19')
    })
  })

  it('extrahiert den Text importierter PDFs für die Suche', async () => {
    await withTempUploadDir(async () => {
      const analysis = await analyzeImport({ buffer: archive, fileName: FILE_NAME }, userId)
      await commitImport(analysis.runId, userId)

      await new Promise((resolve) => setTimeout(resolve, 4000))

      const [row] = await useDatabase().execute<{ count: number }>(
        sql`select count(*)::int as count from material_assets
          where extraction_status = 'erfolgreich' and length(extracted_text) > 20`,
      )
      expect((row as unknown as { count: number }).count).toBeGreaterThan(0)
    })
  }, 40_000)

  it('übernimmt Schulform und Jahrgangsstufe auf importierte Materialien', async () => {
    await withTempUploadDir(async () => {
      const analysis = await analyzeImport({ buffer: archive, fileName: FILE_NAME }, userId)

      const mapping = structuredClone(analysis.suggestedMapping)
      mapping.schoolForm = 'gesamtschule'
      mapping.gradeLevel = 9
      const withFiles = analysis.lessons.find((l) => l.attachments.length > 0)!
      for (const ref of Object.keys(mapping.records!)) {
        mapping.records![ref]!.include = ref === withFiles.sourceRef
      }

      await updateMapping(analysis.runId, mapping)
      const result = await commitImport(analysis.runId, userId)

      expect(result.status).toBe('importiert')
      expect(result.stats.materialien).toBeGreaterThan(0)

      const materials = await listMaterials({ pageSize: 100 })
      expect(materials.total).toBeGreaterThan(0)
      for (const item of materials.items) {
        const detail = await getMaterialDetail(item.id)
        expect(detail!.schoolForm).toBe('gesamtschule')
        expect(detail!.gradeLevels).toEqual([9])
      }

      const db = useDatabase()
      const [group] = (await db.execute<{
        grade_level: number | null
        school_form: string | null
      }>(
        sql`select grade_level, school_form::text from learning_groups limit 1`,
      )) as unknown as { grade_level: number | null; school_form: string | null }[]
      expect(group!.grade_level).toBe(9)
      expect(group!.school_form).toBe('gesamtschule')
    })
  })

  it('behält Zuordnungsfelder, wenn Commit nur Teilwerte überschreibt', async () => {
    await withTempUploadDir(async () => {
      const analysis = await analyzeImport({ buffer: archive, fileName: FILE_NAME }, userId)
      const mapping = structuredClone(analysis.suggestedMapping)
      mapping.schoolForm = 'gymnasium'
      mapping.gradeLevel = 10
      const withFiles = analysis.lessons.find((l) => l.attachments.length > 0)!
      for (const ref of Object.keys(mapping.records!)) {
        mapping.records![ref]!.include = ref === withFiles.sourceRef
      }
      await updateMapping(analysis.runId, mapping)

      await commitImport(analysis.runId, userId, {
        seriesMode: 'neu',
        createMaterials: true,
        linkDuplicates: true,
        defaultLessonStatus: 'durchgefuehrt',
        records: mapping.records,
      })

      const materials = await listMaterials({ pageSize: 100 })
      expect(materials.total).toBeGreaterThan(0)
      const detail = await getMaterialDetail(materials.items[0]!.id)
      expect(detail!.schoolForm).toBe('gymnasium')
      expect(detail!.gradeLevels).toEqual([10])
    })
  })

  it('überspringt abgewählte Termine', async () => {
    await withTempUploadDir(async () => {
      const analysis = await analyzeImport({ buffer: archive, fileName: FILE_NAME }, userId)

      const mapping = structuredClone(analysis.suggestedMapping)
      const refs = Object.keys(mapping.records!)
      for (const ref of refs.slice(2)) mapping.records![ref]!.include = false

      const result = await commitImport(analysis.runId, userId, mapping)

      expect(result.stats.stunden).toBe(2)
      expect(result.stats.uebersprungen).toBe(1)
      expect((await listLessons()).total).toBe(2)
    })
  })

  it('erkennt beim zweiten Import Dubletten und schlägt Überspringen vor', async () => {
    await withTempUploadDir(async () => {
      const first = await analyzeImport({ buffer: archive, fileName: FILE_NAME }, userId)
      await commitImport(first.runId, userId)

      const second = await analyzeImport({ buffer: archive, fileName: FILE_NAME }, userId)

      expect(second.summary.duplicateLessons).toBe(LESSON_COUNT)
      expect(second.summary.duplicateAttachments).toBe(ATTACHMENT_COUNT)
      expect(second.lessons[0]!.duplicate?.confidence).toBe('sicher')

      const included = Object.values(second.suggestedMapping.records!).filter((r) => r.include)
      expect(included).toHaveLength(0)

      const result = await commitImport(second.runId, userId)
      expect(result.stats.stunden).toBe(0)
      expect(result.stats.uebersprungen).toBe(LESSON_COUNT)
      expect((await listLessons()).total).toBe(LESSON_COUNT)
    })
  }, 60_000)

  it('verknüpft einzelne Dateien mit dem einmaligen Material statt sie zu kopieren', async () => {
    await withTempUploadDir(async () => {
      const first = await analyzeImport({ buffer: archive, fileName: FILE_NAME }, userId)
      await commitImport(first.runId, userId)
      const materialsAfterFirst = (await listMaterials({ pageSize: 200 })).total

      const second = await analyzeImport({ buffer: archive, fileName: FILE_NAME }, userId)
      const mapping = structuredClone(second.suggestedMapping)
      for (const ref of Object.keys(mapping.records!)) {
        mapping.records![ref]!.include = true
        mapping.records![ref]!.action = 'erstellen'
      }
      await commitImport(second.runId, userId, mapping)

      const materialsAfterSecond = (await listMaterials({ pageSize: 200 })).total
      expect(materialsAfterSecond).toBe(materialsAfterFirst)
      expect((await listLessons()).total).toBe(LESSON_COUNT * 2)
    })
  }, 60_000)

  it('protokolliert jeden Quelldatensatz nachvollziehbar', async () => {
    await withTempUploadDir(async () => {
      const analysis = await analyzeImport({ buffer: archive, fileName: FILE_NAME }, userId)
      await commitImport(analysis.runId, userId)

      const db = useDatabase()
      const items = await db.execute<{ action: string; count: number }>(
        sql`select action::text, count(*)::int as count from import_run_items
          where run_id = ${analysis.runId}::uuid group by action`,
      )
      const byAction = Object.fromEntries(
        (items as unknown as { action: string; count: number }[]).map((r) => [r.action, r.count]),
      )
      expect(byAction.erstellt).toBeGreaterThan(LESSON_COUNT)

      const logs = await db.execute<{ count: number }>(
        sql`select count(*)::int as count from import_logs where run_id = ${analysis.runId}::uuid`,
      )
      expect((logs as unknown as { count: number }[])[0]!.count).toBeGreaterThan(0)
    })
  })

  it('macht einen Import vollständig rückgängig', async () => {
    await withTempUploadDir(async () => {
      const analysis = await analyzeImport({ buffer: archive, fileName: FILE_NAME }, userId)
      await commitImport(analysis.runId, userId)

      expect((await listLessons()).total).toBe(LESSON_COUNT)

      const { removed } = await undoImport(analysis.runId)

      expect(removed.stunden).toBe(LESSON_COUNT)
      expect(removed.reihen).toBe(1)
      expect((await listLessons()).total).toBe(0)
      expect((await listSeries()).total).toBe(0)
      expect((await listMaterials({ pageSize: 200 })).total).toBe(0)

      const db = useDatabase()
      const [subjects] = (await db.execute<{ count: number }>(
        sql`select count(*)::int as count from subjects`,
      )) as unknown as { count: number }[]
      expect(subjects!.count).toBe(1)
    })
  }, 60_000)

  it('lässt einen bereits rückgängig gemachten Import nicht erneut zurücknehmen', async () => {
    await withTempUploadDir(async () => {
      const analysis = await analyzeImport({ buffer: archive, fileName: FILE_NAME }, userId)
      await commitImport(analysis.runId, userId)
      await undoImport(analysis.runId)

      await expect(undoImport(analysis.runId)).rejects.toThrow(/bereits rückgängig/i)
    })
  }, 60_000)

  it('verhindert das doppelte Ausführen desselben Importvorgangs', async () => {
    await withTempUploadDir(async () => {
      const analysis = await analyzeImport({ buffer: archive, fileName: FILE_NAME }, userId)
      await commitImport(analysis.runId, userId)

      await expect(commitImport(analysis.runId, userId)).rejects.toThrow(/bereits abgeschlossen/i)
    })
  }, 60_000)

  it('weist unbekannte Dateiformate mit verständlicher Meldung zurück', async () => {
    await withTempUploadDir(async () => {
      await expect(
        analyzeImport({ buffer: Buffer.from('kein Archiv'), fileName: 'notizen.txt' }, userId),
      ).rejects.toThrow(/nicht erkannt/i)
    })
  })
})
