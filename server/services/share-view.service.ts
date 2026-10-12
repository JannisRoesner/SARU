import { getLessonDetail } from '../repositories/lesson.repository'
import { getMaterialDetail, listMaterials, type MaterialSummary } from '../repositories/material.repository'
import { getSeriesDetail } from '../repositories/series.repository'
import { notFound } from '../utils/errors'
import type { FreigabeUmfang } from './share.service'

/**
 * Was Gäste über einen Freigabe-Link sehen. Bewusst schlank: keine internen Notizen,
 * Reflexionen, Vertretungen, KI-Metadaten, Bewertungen oder Verwendungsstatistiken.
 */

export interface GastDatei {
  id: string
  kind: 'datei' | 'link'
  role: 'haupt' | 'anhang'
  title: string | null
  fileName: string | null
  mimeType: string | null
  sizeBytes: number | null
  url: string | null
}

export interface GastMaterial {
  id: string
  title: string
  description: string | null
  materialType: string
  source: string | null
  subjects: string[]
  gradeLevels: string[]
  fassungen: { id: string; label: string; isDefault: boolean; dateien: GastDatei[] }[]
  /** Lösungen, Differenzierungen und Zusatzmaterial, soweit im Umfang. */
  anhaengend: { id: string; title: string; materialType: string; relationType: string }[]
  /** Zugeordnete Materialien, z. B. die Stationen eines Lernzirkels (Lehrwerke: siehe Startansicht). */
  inhalt: GastMaterialKurz[]
}

export interface GastMaterialKurz {
  id: string
  title: string
  description: string | null
  materialType: string
  fileTypes: string[]
  assetCount: number
  vorschauDateiId: string | null
  /** Dateiname und Typ der Vorschaudatei – die Miniatur lädt nur bei bekannten Formaten. */
  vorschauDateiname: string | null
  vorschauMimeType: string | null
}

export interface GastStundeKurz {
  id: string
  title: string
  date: string | null
  positionInSeries: number | null
  materialCount: number
}

export interface GastMaterialVerweis {
  materialId: string
  title: string
  materialType: string
  note: string | null
  vorschauDateiId: string | null
  vorschauDateiname: string | null
  vorschauMimeType: string | null
}

export interface GastReihe {
  id: string
  title: string
  description: string | null
  subject: string | null
  schoolYear: string | null
  stunden: GastStundeKurz[]
  materialien: GastMaterialVerweis[]
}

export interface GastStunde {
  id: string
  title: string
  date: string | null
  durationMinutes: number | null
  homework: string | null
  methodSummary: string | null
  learningObjectives: string[]
  phasen: {
    id: string
    name: string
    durationMinutes: number | null
    content: string | null
    teacherActivity: string | null
    studentActivity: string | null
    method: string | null
    socialForm: string | null
    materialien: GastMaterialVerweis[]
  }[]
  materialien: GastMaterialVerweis[]
}

export async function gastMaterial(umfang: FreigabeUmfang, id: string): Promise<GastMaterial> {
  if (!umfang.materialIds.has(id)) throw notFound('Das Material')
  const m = await getMaterialDetail(id)
  if (!m) throw notFound('Das Material')
  return {
    id: m.id,
    title: m.title,
    description: m.description,
    materialType: m.materialType,
    source: m.source,
    subjects: m.subjects.map((s) => s.name),
    gradeLevels: m.gradeLevels.map(String),
    fassungen: m.variants.map((v) => ({
      id: v.id,
      label: v.label,
      isDefault: v.isDefault,
      dateien: v.assets.map((a) => ({
        id: a.id,
        kind: a.kind,
        role: a.role,
        title: a.title,
        fileName: a.fileName,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
        url: a.url,
      })),
    })),
    anhaengend: m.relations
      .filter((r) => r.direction === 'ausgehend' && umfang.materialIds.has(r.material.id))
      .map((r) => ({
        id: r.material.id,
        title: r.material.title,
        materialType: r.material.materialType,
        relationType: r.relationType,
      })),
    inhalt: m.materialType === 'lehrwerk' ? [] : await gastLehrwerkInhalt(umfang, m.id),
  }
}

function kurz(m: MaterialSummary): GastMaterialKurz {
  return {
    id: m.id,
    title: m.title,
    description: m.description,
    materialType: m.materialType,
    fileTypes: m.fileTypes,
    assetCount: m.assetCount,
    vorschauDateiId: m.preview?.kind === 'datei' ? m.preview.assetId : null,
    vorschauDateiname: m.preview?.kind === 'datei' ? m.preview.fileName : null,
    vorschauMimeType: m.preview?.kind === 'datei' ? m.preview.mimeType : null,
  }
}

/** Inhalt eines Lehrwerks (alle Seiten, sortiert nach Titel). */
export async function gastLehrwerkInhalt(umfang: FreigabeUmfang, lehrwerkId: string): Promise<GastMaterialKurz[]> {
  const items: MaterialSummary[] = []
  for (let page = 1; page < 50; page++) {
    const res = await listMaterials({ filters: { belongsToId: lehrwerkId }, sort: 'titel', page, pageSize: 100 })
    items.push(...res.items)
    if (items.length >= res.total || res.items.length === 0) break
  }
  return items.filter((m) => umfang.materialIds.has(m.id)).map(kurz)
}

type VerweisRoh = { materialId: string; title: string; materialType: string; note: string | null }

/** Verweise samt Vorschaudatei, damit Gäste Material direkt ansehen und laden können. */
async function verweiseMitVorschau(umfang: FreigabeUmfang, roh: VerweisRoh[]): Promise<GastMaterialVerweis[]> {
  const sichtbar = roh.filter((m) => umfang.materialIds.has(m.materialId))
  const ids = [...new Set(sichtbar.map((m) => m.materialId))]
  const vorschau = new Map<string, MaterialSummary['preview']>()
  for (let i = 0; i < ids.length; i += 100) {
    const teil = ids.slice(i, i + 100)
    const res = await listMaterials({
      filters: { ids: teil, includeArchived: true },
      sort: 'titel',
      page: 1,
      pageSize: teil.length,
    })
    for (const m of res.items) vorschau.set(m.id, m.preview)
  }
  return sichtbar.map((m) => {
    const p = vorschau.get(m.materialId)
    return {
      materialId: m.materialId,
      title: m.title,
      materialType: m.materialType,
      note: m.note,
      vorschauDateiId: p?.kind === 'datei' ? p.assetId : null,
      vorschauDateiname: p?.kind === 'datei' ? p.fileName : null,
      vorschauMimeType: p?.kind === 'datei' ? p.mimeType : null,
    }
  })
}

export async function gastReihe(umfang: FreigabeUmfang): Promise<GastReihe> {
  if (!umfang.seriesId) throw notFound('Die Reihe')
  const r = await getSeriesDetail(umfang.seriesId)
  if (!r) throw notFound('Die Reihe')
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    subject: r.subject?.name ?? null,
    schoolYear: r.schoolYear,
    stunden: r.lessons
      .filter((l) => umfang.lessonIds.has(l.id))
      .map((l) => ({
        id: l.id,
        title: l.title,
        date: l.date,
        positionInSeries: l.positionInSeries,
        materialCount: l.materialCount,
      })),
    materialien: await verweiseMitVorschau(umfang, r.materials),
  }
}

export async function gastStunde(umfang: FreigabeUmfang, id: string): Promise<GastStunde> {
  if (!umfang.lessonIds.has(id)) throw notFound('Die Stunde')
  const s = await getLessonDetail(id)
  if (!s) throw notFound('Die Stunde')
  return {
    id: s.id,
    title: s.title,
    date: s.date,
    durationMinutes: s.durationMinutes,
    homework: s.homework,
    methodSummary: s.methodSummary,
    learningObjectives: s.learningObjectives,
    phasen: await Promise.all(
      s.phases.map(async (p) => ({
        id: p.id,
        name: p.name,
        durationMinutes: p.durationMinutes,
        content: p.content,
        teacherActivity: p.teacherActivity,
        studentActivity: p.studentActivity,
        method: p.method,
        socialForm: p.socialForm,
        materialien: await verweiseMitVorschau(umfang, p.materials),
      })),
    ),
    materialien: await verweiseMitVorschau(umfang, s.materials),
  }
}
