import { eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import {
  darfObjektBearbeiten,
  darfObjektLoeschen,
  hatRecht,
  type Recht,
} from '#shared/utils/rechte'
import { useDatabase } from '../database/client'
import {
  aiJobs,
  aiSolutionRuns,
  importRuns,
  lessonMaterials,
  lessonPhaseMaterials,
  lessonPhases,
  lessons,
  materialAssets,
  materialRelations,
  materials,
  materialVariants,
  series,
  seriesMaterials,
} from '../database/schema'
import { requireUser, type SafeUser } from './auth'
import { forbidden, notFound } from './errors'

/**
 * Rechteprüfung auf Objektebene.
 * Grundregel: Wer das allgemeine Recht hat (Lehrkraft, Administration), darf alles;
 * wer nur anlegen darf (Beitragende), darf Eigenes bearbeiten und löschen.
 */

const KEIN_RECHT = 'Für diese Aktion fehlt die Berechtigung.'
const NUR_EIGENES = 'Du kannst nur eigene Inhalte bearbeiten.'

export async function requireRecht(event: H3Event, recht: Recht): Promise<SafeUser> {
  const user = await requireUser(event)
  if (!hatRecht(user, recht)) throw forbidden(KEIN_RECHT)
  return user
}

// --- Besitzer ermitteln --------------------------------------------------

async function materialOwner(materialId: string): Promise<string | null> {
  const [row] = await useDatabase()
    .select({ ownerId: materials.ownerId })
    .from(materials)
    .where(eq(materials.id, materialId))
    .limit(1)
  if (!row) throw notFound('Das Material')
  return row.ownerId
}

async function lessonOwner(lessonId: string): Promise<string | null> {
  const [row] = await useDatabase()
    .select({ ownerId: lessons.ownerId })
    .from(lessons)
    .where(eq(lessons.id, lessonId))
    .limit(1)
  if (!row) throw notFound('Die Stunde')
  return row.ownerId
}

async function seriesOwner(seriesId: string): Promise<string | null> {
  const [row] = await useDatabase()
    .select({ ownerId: series.ownerId })
    .from(series)
    .where(eq(series.id, seriesId))
    .limit(1)
  if (!row) throw notFound('Die Reihe')
  return row.ownerId
}

async function materialIdOfVariant(variantId: string): Promise<string> {
  const [row] = await useDatabase()
    .select({ materialId: materialVariants.materialId })
    .from(materialVariants)
    .where(eq(materialVariants.id, variantId))
    .limit(1)
  if (!row) throw notFound('Die Fassung')
  return row.materialId
}

async function materialIdOfAsset(assetId: string): Promise<string> {
  const [row] = await useDatabase()
    .select({ variantId: materialAssets.variantId })
    .from(materialAssets)
    .where(eq(materialAssets.id, assetId))
    .limit(1)
  if (!row) throw notFound('Die Datei')
  return materialIdOfVariant(row.variantId)
}

async function lessonIdOfPhase(phaseId: string): Promise<string> {
  const [row] = await useDatabase()
    .select({ lessonId: lessonPhases.lessonId })
    .from(lessonPhases)
    .where(eq(lessonPhases.id, phaseId))
    .limit(1)
  if (!row) throw notFound('Die Phase')
  return row.lessonId
}

// --- Prüfungen für Endpunkte ---------------------------------------------

function pruefe(user: SafeUser, erlaubt: boolean): SafeUser {
  if (!erlaubt) throw forbidden(hatRecht(user, 'anlegen') ? NUR_EIGENES : KEIN_RECHT)
  return user
}

export async function requireMaterialBearbeiten(event: H3Event, materialId: string): Promise<SafeUser> {
  const user = await requireUser(event)
  return pruefe(user, darfObjektBearbeiten(user, await materialOwner(materialId)))
}

export async function requireMaterialLoeschen(event: H3Event, materialId: string): Promise<SafeUser> {
  const user = await requireUser(event)
  return pruefe(user, darfObjektLoeschen(user, await materialOwner(materialId)))
}

export async function requireVariantBearbeiten(event: H3Event, variantId: string): Promise<SafeUser> {
  return requireMaterialBearbeiten(event, await materialIdOfVariant(variantId))
}

export async function requireAssetBearbeiten(event: H3Event, assetId: string): Promise<SafeUser> {
  return requireMaterialBearbeiten(event, await materialIdOfAsset(assetId))
}

/** Eine Zuordnung gehört zu dem Material, von dem sie ausgeht. */
export async function requireRelationBearbeiten(event: H3Event, relationId: string): Promise<SafeUser> {
  const [row] = await useDatabase()
    .select({ fromMaterialId: materialRelations.fromMaterialId })
    .from(materialRelations)
    .where(eq(materialRelations.id, relationId))
    .limit(1)
  if (!row) throw notFound('Die Zuordnung')
  return requireMaterialBearbeiten(event, row.fromMaterialId)
}

export async function requireLessonBearbeiten(event: H3Event, lessonId: string): Promise<SafeUser> {
  const user = await requireUser(event)
  return pruefe(user, darfObjektBearbeiten(user, await lessonOwner(lessonId)))
}

export async function requireLessonLoeschen(event: H3Event, lessonId: string): Promise<SafeUser> {
  const user = await requireUser(event)
  return pruefe(user, darfObjektLoeschen(user, await lessonOwner(lessonId)))
}

export async function requirePhaseBearbeiten(event: H3Event, phaseId: string): Promise<SafeUser> {
  return requireLessonBearbeiten(event, await lessonIdOfPhase(phaseId))
}

export async function requireLessonMaterialBearbeiten(event: H3Event, id: string): Promise<SafeUser> {
  const [row] = await useDatabase()
    .select({ lessonId: lessonMaterials.lessonId })
    .from(lessonMaterials)
    .where(eq(lessonMaterials.id, id))
    .limit(1)
  if (!row) throw notFound('Die Zuordnung')
  return requireLessonBearbeiten(event, row.lessonId)
}

export async function requirePhaseMaterialBearbeiten(event: H3Event, id: string): Promise<SafeUser> {
  const [row] = await useDatabase()
    .select({ phaseId: lessonPhaseMaterials.phaseId })
    .from(lessonPhaseMaterials)
    .where(eq(lessonPhaseMaterials.id, id))
    .limit(1)
  if (!row) throw notFound('Die Zuordnung')
  return requirePhaseBearbeiten(event, row.phaseId)
}

export async function requireSeriesBearbeiten(event: H3Event, seriesId: string): Promise<SafeUser> {
  const user = await requireUser(event)
  return pruefe(user, darfObjektBearbeiten(user, await seriesOwner(seriesId)))
}

export async function requireSeriesLoeschen(event: H3Event, seriesId: string): Promise<SafeUser> {
  const user = await requireUser(event)
  return pruefe(user, darfObjektLoeschen(user, await seriesOwner(seriesId)))
}

export async function requireSeriesMaterialBearbeiten(event: H3Event, id: string): Promise<SafeUser> {
  const [row] = await useDatabase()
    .select({ seriesId: seriesMaterials.seriesId })
    .from(seriesMaterials)
    .where(eq(seriesMaterials.id, id))
    .limit(1)
  if (!row) throw notFound('Die Zuordnung')
  return requireSeriesBearbeiten(event, row.seriesId)
}

/**
 * Import-, Stapel- und KI-Analyse-Läufe: wer anlegen darf, sieht und steuert die eigenen;
 * mit allgemeinem Bearbeitungsrecht auch die anderer.
 */
export async function requireImportLauf(event: H3Event, runId: string): Promise<SafeUser> {
  const user = await requireRecht(event, 'anlegen')
  const [row] = await useDatabase()
    .select({ userId: importRuns.userId })
    .from(importRuns)
    .where(eq(importRuns.id, runId))
    .limit(1)
  if (!row) throw notFound('Der Import')
  return pruefe(user, darfObjektBearbeiten(user, row.userId))
}

/** KI-Entwürfe (Musterlösung, Differenzierung): eigene Entwürfe oder Bearbeitungsrecht am Material. */
async function requireKiJobId(event: H3Event, jobId: string): Promise<SafeUser> {
  const user = await requireRecht(event, 'anlegen')
  const [job] = await useDatabase()
    .select({ userId: aiJobs.userId, materialId: aiJobs.materialId })
    .from(aiJobs)
    .where(eq(aiJobs.id, jobId))
    .limit(1)
  if (!job) throw notFound('Der Entwurf')
  if (job.userId === user.id) return user
  const ownerId = job.materialId ? await materialOwner(job.materialId) : null
  return pruefe(user, darfObjektBearbeiten(user, ownerId))
}

export async function requireDifferenzierungsEntwurf(event: H3Event, jobId: string): Promise<SafeUser> {
  return requireKiJobId(event, jobId)
}

export async function requireLoesungsEntwurf(event: H3Event, runId: string): Promise<SafeUser> {
  const [run] = await useDatabase()
    .select({ jobId: aiSolutionRuns.jobId })
    .from(aiSolutionRuns)
    .where(eq(aiSolutionRuns.id, runId))
    .limit(1)
  if (!run) throw notFound('Der Entwurf')
  return requireKiJobId(event, run.jobId)
}
