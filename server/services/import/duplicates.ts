import { sql } from 'drizzle-orm'
import { useDatabase, type Database } from '../../database/client'

export interface LessonDuplicate {
  lessonId: string
  title: string
  date: string | null
  seriesTitle: string | null
  /** Woran die Dublette erkannt wurde. */
  reason: string
  confidence: 'sicher' | 'moeglich'
}

export interface AttachmentDuplicate {
  materialId: string
  title: string
  assetId: string
  fileName: string | null
  reason: string
}

/**
 * Sucht bereits vorhandene Stunden, die zum importierten Termin passen.
 * Ein identisches Datum in derselben Lerngruppe gilt als sichere Dublette,
 * gleiches Datum mit gleichem Titel ohne Gruppenbezug als mögliche.
 */
export async function findLessonDuplicates(
  candidates: { sourceRef: string; date: string | null; title: string }[],
  learningGroupId: string | null,
  db: Database = useDatabase(),
): Promise<Map<string, LessonDuplicate>> {
  const result = new Map<string, LessonDuplicate>()
  const dated = candidates.filter((c) => c.date)
  if (dated.length === 0) return result

  const rows = await db.execute<{
    id: string
    title: string
    date: string | null
    learningGroupId: string | null
    seriesTitle: string | null
  }>(
    sql`select l.id, l.title, l.date, l.learning_group_id as "learningGroupId",
      (select s.title from series s where s.id = l.series_id) as "seriesTitle"
      from lessons l
      where l.date = any(array[${sql.join(
        dated.map((c) => sql`${c.date}`),
        sql`, `,
      )}]::date[])`,
  )

  const existing = rows as unknown as {
    id: string
    title: string
    date: string | null
    learningGroupId: string | null
    seriesTitle: string | null
  }[]

  for (const candidate of dated) {
    const sameDate = existing.filter((row) => row.date === candidate.date)
    if (sameDate.length === 0) continue

    const sameGroup = learningGroupId
      ? sameDate.find((row) => row.learningGroupId === learningGroupId)
      : undefined

    if (sameGroup) {
      result.set(candidate.sourceRef, {
        lessonId: sameGroup.id,
        title: sameGroup.title,
        date: sameGroup.date,
        seriesTitle: sameGroup.seriesTitle,
        reason: 'Es existiert bereits eine Stunde am selben Datum in dieser Lerngruppe.',
        confidence: 'sicher',
      })
      continue
    }

    const sameTitle = sameDate.find(
      (row) => row.title.trim().toLowerCase() === candidate.title.trim().toLowerCase(),
    )
    if (sameTitle) {
      result.set(candidate.sourceRef, {
        lessonId: sameTitle.id,
        title: sameTitle.title,
        date: sameTitle.date,
        seriesTitle: sameTitle.seriesTitle,
        reason: 'Es existiert bereits eine Stunde mit gleichem Datum und Titel.',
        confidence: 'moeglich',
      })
    }
  }

  return result
}

/** Findet bereits gespeicherte Dateien mit identischer Prüfsumme. */
export async function findAttachmentDuplicates(
  checksums: string[],
  db: Database = useDatabase(),
): Promise<Map<string, AttachmentDuplicate>> {
  const result = new Map<string, AttachmentDuplicate>()
  const unique = [...new Set(checksums.filter(Boolean))]
  if (unique.length === 0) return result

  const rows = await db.execute<{
    checksum: string
    assetId: string
    fileName: string | null
    materialId: string
    title: string
  }>(
    sql`select distinct on (a.checksum)
      a.checksum, a.id as "assetId", a.file_name as "fileName",
      v.material_id as "materialId", m.title
      from material_assets a
      join material_variants v on v.id = a.variant_id
      join materials m on m.id = v.material_id
      where a.checksum = any(array[${sql.join(
        unique.map((c) => sql`${c}`),
        sql`, `,
      )}]::text[])
      order by a.checksum, a.created_at asc`,
  )

  for (const row of rows as unknown as {
    checksum: string
    assetId: string
    fileName: string | null
    materialId: string
    title: string
  }[]) {
    result.set(row.checksum, {
      materialId: row.materialId,
      title: row.title,
      assetId: row.assetId,
      fileName: row.fileName,
      reason: 'Eine Datei mit identischem Inhalt ist bereits gespeichert.',
    })
  }

  return result
}
