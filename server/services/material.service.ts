import { and, asc, eq, inArray, max, sql } from 'drizzle-orm'
import { useDatabase, type Database } from '../database/client'
import {
  materialAssets,
  materialCompetencies,
  materialGradeLevels,
  materialLearningGroups,
  materialRelations,
  materialSubjects,
  materialTags,
  materialTopics,
  materialVariants,
  materials,
  type AiMeta,
} from '../database/schema'
import { oeffentlicheFehlermeldung } from '#shared/utils/public-error'
import { istKursarchivErweiterung } from '#shared/utils/moodle'
import { conflict, invalidInput, notFound } from '../utils/errors'
import { createLogger } from '../utils/logger'
import { sanitizeText } from '../utils/validation'
import { getMaterialDetail, type MaterialDetail } from '../repositories/material.repository'
import { deleteFile, extensionOf, storeFile } from './storage.service'
import { deleteThumbnail, queueThumbnailGeneration } from './thumbnail.service'
import { extractTextFromStorage, isExtractable } from './extraction.service'
import { queueReindex, removeFromIndex } from './search/indexer'
import { resolveCompetencyIds, resolveTagIds } from './taxonomy.service'
import {
  type GradeLevel,
  gradeLevelToStorage,
  normalizeGradeLevels,
} from '#shared/utils/jahrgangsstufen'

const log = createLogger('materials')

export interface MaterialTaxonomyInput {
  subjectIds?: string[]
  topicIds?: string[]
  competencyIds?: string[]
  learningGroupIds?: string[]
  gradeLevels?: GradeLevel[]
  /** Freitext-Schlagwörter; fehlende werden automatisch angelegt. */
  tagNames?: string[]
  /** Freitext-Kompetenzen; fehlende werden automatisch angelegt. */
  competencyNames?: string[]
}

export interface MaterialInput extends MaterialTaxonomyInput {
  title: string
  description?: string | null
  content?: string | null
  materialType?: string
  schoolForm?: string | null
  source?: string | null
  author?: string | null
  pages?: string | null
  notes?: string | null
  learningObjectives?: string[]
  rating?: number | null
  isFavorite?: boolean
  origin?: 'manuell' | 'ki' | 'import'
  aiMeta?: AiMeta | null
}

async function requireMaterial(id: string, db: Database): Promise<void> {
  const rows = await db.select({ id: materials.id }).from(materials).where(eq(materials.id, id)).limit(1)
  if (!rows[0]) throw notFound('Das Material')
}

/** Schreibt die Verknüpfungstabellen neu; `undefined` lässt eine Zuordnung unverändert. */
async function applyTaxonomy(
  db: Database,
  materialId: string,
  input: MaterialTaxonomyInput,
): Promise<void> {
  if (input.subjectIds !== undefined) {
    await db.delete(materialSubjects).where(eq(materialSubjects.materialId, materialId))
    if (input.subjectIds.length) {
      await db
        .insert(materialSubjects)
        .values(input.subjectIds.map((subjectId) => ({ materialId, subjectId })))
        .onConflictDoNothing()
    }
  }

  if (input.topicIds !== undefined) {
    await db.delete(materialTopics).where(eq(materialTopics.materialId, materialId))
    if (input.topicIds.length) {
      await db
        .insert(materialTopics)
        .values(input.topicIds.map((topicId) => ({ materialId, topicId })))
        .onConflictDoNothing()
    }
  }

  if (input.gradeLevels !== undefined) {
    await db.delete(materialGradeLevels).where(eq(materialGradeLevels.materialId, materialId))
    const levels = normalizeGradeLevels(input.gradeLevels)
    if (levels.length) {
      await db
        .insert(materialGradeLevels)
        .values(levels.map((gradeLevel) => ({ materialId, gradeLevel: gradeLevelToStorage(gradeLevel) })))
        .onConflictDoNothing()
    }
  }

  if (input.learningGroupIds !== undefined) {
    await db.delete(materialLearningGroups).where(eq(materialLearningGroups.materialId, materialId))
    if (input.learningGroupIds.length) {
      await db
        .insert(materialLearningGroups)
        .values(input.learningGroupIds.map((learningGroupId) => ({ materialId, learningGroupId })))
        .onConflictDoNothing()
    }
  }

  if (input.tagNames !== undefined) {
    const tagIds = await resolveTagIds(input.tagNames, db)
    await db.delete(materialTags).where(eq(materialTags.materialId, materialId))
    if (tagIds.length) {
      await db
        .insert(materialTags)
        .values(tagIds.map((tagId) => ({ materialId, tagId })))
        .onConflictDoNothing()
    }
  }

  if (input.competencyIds !== undefined || input.competencyNames !== undefined) {
    const ids = [...(input.competencyIds ?? [])]
    if (input.competencyNames?.length) {
      const [firstSubject] = await db
        .select({ subjectId: materialSubjects.subjectId })
        .from(materialSubjects)
        .where(eq(materialSubjects.materialId, materialId))
        .limit(1)
      ids.push(
        ...(await resolveCompetencyIds(input.competencyNames, firstSubject?.subjectId ?? null, db)),
      )
    }
    await db.delete(materialCompetencies).where(eq(materialCompetencies.materialId, materialId))
    const unique = [...new Set(ids)]
    if (unique.length) {
      await db
        .insert(materialCompetencies)
        .values(unique.map((competencyId) => ({ materialId, competencyId })))
        .onConflictDoNothing()
    }
  }
}

function materialColumns(input: MaterialInput | Partial<MaterialInput>) {
  const patch: Record<string, unknown> = {}
  if (input.title !== undefined) patch.title = input.title.trim()
  if (input.description !== undefined) patch.description = sanitizeText(input.description)
  if (input.content !== undefined) patch.content = sanitizeText(input.content, 200_000)
  if (input.materialType !== undefined) patch.materialType = input.materialType
  if (input.schoolForm !== undefined) patch.schoolForm = input.schoolForm
  if (input.source !== undefined) patch.source = sanitizeText(input.source, 2000)
  if (input.author !== undefined) patch.author = sanitizeText(input.author, 300)
  if (input.pages !== undefined) patch.pages = sanitizeText(input.pages, 200)
  if (input.notes !== undefined) patch.notes = sanitizeText(input.notes, 50_000)
  if (input.learningObjectives !== undefined) {
    patch.learningObjectives = input.learningObjectives
      .map((o) => o.trim())
      .filter(Boolean)
      .slice(0, 50)
  }
  if (input.rating !== undefined) {
    patch.rating = input.rating === null ? null : Math.min(5, Math.max(0, input.rating))
  }
  if (input.isFavorite !== undefined) patch.isFavorite = input.isFavorite
  if (input.origin !== undefined) patch.origin = input.origin
  if (input.aiMeta !== undefined) patch.aiMeta = input.aiMeta
  return patch
}

export async function createMaterial(
  input: MaterialInput,
  ownerId: string | null,
  db: Database = useDatabase(),
): Promise<string> {
  if (!input.title?.trim()) throw invalidInput('Bitte einen Titel für das Material angeben.')

  const [created] = await db
    .insert(materials)
    .values({ ...materialColumns(input), title: input.title.trim(), ownerId } as never)
    .returning({ id: materials.id })

  const materialId = created!.id
  await applyTaxonomy(db, materialId, input)

  // Jedes Material besitzt mindestens eine Variante – das hält Dateien und
  // Differenzierungsfassungen einheitlich strukturiert.
  await db.insert(materialVariants).values({
    materialId,
    label: 'Standardfassung',
    variantKind: 'standard',
    isDefault: true,
    sortOrder: 0,
  })

  queueReindex('material', materialId)
  log.info('Material angelegt', { materialId, title: input.title })
  return materialId
}

export async function updateMaterial(
  id: string,
  input: Partial<MaterialInput>,
  db: Database = useDatabase(),
): Promise<void> {
  await requireMaterial(id, db)

  const patch = materialColumns(input)
  if (Object.keys(patch).length > 0) {
    await db
      .update(materials)
      .set({ ...patch, updatedAt: new Date() } as never)
      .where(eq(materials.id, id))
  }

  await applyTaxonomy(db, id, input)
  queueReindex('material', id)
}

export async function setArchived(
  id: string,
  isArchived: boolean,
  db: Database = useDatabase(),
): Promise<void> {
  await requireMaterial(id, db)
  await db
    .update(materials)
    .set({ isArchived, updatedAt: new Date() })
    .where(eq(materials.id, id))
  queueReindex('material', id)
}

export async function setFavorite(
  id: string,
  isFavorite: boolean,
  db: Database = useDatabase(),
): Promise<void> {
  await requireMaterial(id, db)
  await db.update(materials).set({ isFavorite }).where(eq(materials.id, id))
}

export async function setRating(
  id: string,
  rating: number | null,
  db: Database = useDatabase(),
): Promise<void> {
  await requireMaterial(id, db)
  await db
    .update(materials)
    .set({ rating: rating === null ? null : Math.min(5, Math.max(0, rating)) })
    .where(eq(materials.id, id))
}

export async function markMaterialUsed(
  ids: string[],
  db: Database = useDatabase(),
): Promise<void> {
  if (ids.length === 0) return
  await db.update(materials).set({ lastUsedAt: new Date() }).where(inArray(materials.id, ids))
}

/** Löscht Material samt Varianten, Dateien und Suchindex. */
export async function deleteMaterial(id: string, db: Database = useDatabase()): Promise<void> {
  const storageKeys = await db
    .select({ storageKey: materialAssets.storageKey })
    .from(materialAssets)
    .innerJoin(materialVariants, eq(materialVariants.id, materialAssets.variantId))
    .where(eq(materialVariants.materialId, id))

  const removed = await db.delete(materials).where(eq(materials.id, id)).returning({ id: materials.id })
  if (!removed[0]) throw notFound('Das Material')

  // Dateien erst nach erfolgreichem Löschen des Datensatzes entfernen.
  for (const { storageKey } of storageKeys) {
    if (storageKey) await deleteFile(storageKey)
  }

  await removeFromIndex('material', id)
  log.info('Material gelöscht', { materialId: id })
}

/**
 * Erzeugt eine unabhängige Kopie samt Varianten und Verknüpfungen.
 * Dateien werden referenziert statt kopiert – dieselbe Datei kann mehrfach
 * verwendet werden, gelöscht wird sie erst mit dem letzten Verweis.
 */
export async function duplicateMaterial(
  id: string,
  ownerId: string | null,
  db: Database = useDatabase(),
): Promise<string> {
  const source = await getMaterialDetail(id, db)
  if (!source) throw notFound('Das Material')

  const [created] = await db
    .insert(materials)
    .values({
      title: `${source.title} (Kopie)`,
      description: source.description,
      content: source.content,
      materialType: source.materialType,
      schoolForm: source.schoolForm,
      source: source.source,
      author: source.author,
      pages: source.pages,
      notes: source.notes,
      learningObjectives: source.learningObjectives,
      rating: source.rating,
      origin: source.origin,
      aiMeta: source.aiMeta,
      ownerId,
    } as never)
    .returning({ id: materials.id })

  const newId = created!.id

  await applyTaxonomy(db, newId, {
    subjectIds: source.subjects.map((s) => s.id),
    topicIds: source.topics.map((t) => t.id),
    competencyIds: source.competencies.map((c) => c.id),
    learningGroupIds: source.learningGroups.map((g) => g.id),
    gradeLevels: source.gradeLevels,
    tagNames: source.tags.map((t) => t.name),
  })

  for (const variant of source.variants) {
    const [newVariant] = await db
      .insert(materialVariants)
      .values({
        materialId: newId,
        label: variant.label,
        variantKind: variant.variantKind as never,
        differentiationLevel: variant.differentiationLevel as never,
        schoolYear: variant.schoolYear,
        version: variant.version,
        notes: variant.notes,
        isDefault: variant.isDefault,
        sortOrder: variant.sortOrder,
      })
      .returning({ id: materialVariants.id })

    for (const asset of variant.assets) {
      const original = await db
        .select()
        .from(materialAssets)
        .where(eq(materialAssets.id, asset.id))
        .limit(1)
      const row = original[0]
      if (!row) continue

      await db.insert(materialAssets).values({
        variantId: newVariant!.id,
        kind: row.kind,
        role: row.role,
        title: row.title,
        fileName: row.fileName,
        storageKey: row.storageKey,
        mimeType: row.mimeType,
        sizeBytes: row.sizeBytes,
        checksum: row.checksum,
        url: row.url,
        pageCount: row.pageCount,
        extractedText: row.extractedText,
        extractionStatus: row.extractionStatus,
        sortOrder: row.sortOrder,
      })
    }
  }

  queueReindex('material', newId)
  log.info('Material dupliziert', { quelle: id, kopie: newId })
  return newId
}

// --- Varianten ---------------------------------------------------------------

export interface VariantInput {
  label: string
  variantKind?: string
  differentiationLevel?: string | null
  schoolYear?: string | null
  version?: string
  notes?: string | null
}

export async function addVariant(
  materialId: string,
  input: VariantInput,
  db: Database = useDatabase(),
): Promise<string> {
  await requireMaterial(materialId, db)

  const [{ value: highest } = { value: null }] = await db
    .select({ value: max(materialVariants.sortOrder) })
    .from(materialVariants)
    .where(eq(materialVariants.materialId, materialId))

  const [created] = await db
    .insert(materialVariants)
    .values({
      materialId,
      label: input.label.trim() || 'Weitere Fassung',
      variantKind: (input.variantKind as never) ?? 'differenzierung',
      differentiationLevel: (input.differentiationLevel as never) ?? null,
      schoolYear: input.schoolYear ?? null,
      version: input.version ?? '1',
      notes: sanitizeText(input.notes),
      sortOrder: (highest ?? -1) + 1,
    })
    .returning({ id: materialVariants.id })

  queueReindex('material', materialId)
  return created!.id
}

export async function updateVariant(
  variantId: string,
  input: Partial<VariantInput>,
  db: Database = useDatabase(),
): Promise<void> {
  const patch: Record<string, unknown> = { updatedAt: new Date() }
  if (input.label !== undefined) patch.label = input.label.trim()
  if (input.variantKind !== undefined) patch.variantKind = input.variantKind
  if (input.differentiationLevel !== undefined) {
    patch.differentiationLevel = input.differentiationLevel
  }
  if (input.schoolYear !== undefined) patch.schoolYear = input.schoolYear
  if (input.version !== undefined) patch.version = input.version
  if (input.notes !== undefined) patch.notes = sanitizeText(input.notes)

  const [updated] = await db
    .update(materialVariants)
    .set(patch as never)
    .where(eq(materialVariants.id, variantId))
    .returning({ materialId: materialVariants.materialId })

  if (!updated) throw notFound('Die Variante')
  queueReindex('material', updated.materialId)
}

export async function deleteVariant(variantId: string, db: Database = useDatabase()): Promise<void> {
  const [variant] = await db
    .select()
    .from(materialVariants)
    .where(eq(materialVariants.id, variantId))
    .limit(1)
  if (!variant) throw notFound('Die Variante')

  const remaining = await db
    .select({ id: materialVariants.id })
    .from(materialVariants)
    .where(eq(materialVariants.materialId, variant.materialId))

  if (remaining.length <= 1) {
    throw conflict('Die letzte Fassung eines Materials kann nicht gelöscht werden.')
  }

  const assets = await db
    .select({ storageKey: materialAssets.storageKey })
    .from(materialAssets)
    .where(eq(materialAssets.variantId, variantId))

  await db.delete(materialVariants).where(eq(materialVariants.id, variantId))

  for (const { storageKey } of assets) {
    if (storageKey && !(await isStorageKeyInUse(storageKey, db))) await deleteFile(storageKey)
  }

  // Ohne Standardfassung wäre die Vorschau undefiniert – die erste übernimmt.
  if (variant.isDefault) {
    const [next] = await db
      .select({ id: materialVariants.id })
      .from(materialVariants)
      .where(eq(materialVariants.materialId, variant.materialId))
      .orderBy(asc(materialVariants.sortOrder))
      .limit(1)
    if (next) {
      await db.update(materialVariants).set({ isDefault: true }).where(eq(materialVariants.id, next.id))
    }
  }

  queueReindex('material', variant.materialId)
}

export async function setDefaultVariant(
  variantId: string,
  db: Database = useDatabase(),
): Promise<void> {
  const [variant] = await db
    .select({ materialId: materialVariants.materialId })
    .from(materialVariants)
    .where(eq(materialVariants.id, variantId))
    .limit(1)
  if (!variant) throw notFound('Die Variante')

  await db
    .update(materialVariants)
    .set({ isDefault: false })
    .where(eq(materialVariants.materialId, variant.materialId))
  await db.update(materialVariants).set({ isDefault: true }).where(eq(materialVariants.id, variantId))
}

export async function reorderVariants(
  materialId: string,
  orderedIds: string[],
  db: Database = useDatabase(),
): Promise<void> {
  for (const [index, id] of orderedIds.entries()) {
    await db
      .update(materialVariants)
      .set({ sortOrder: index })
      .where(and(eq(materialVariants.id, id), eq(materialVariants.materialId, materialId)))
  }
}

// --- Dateien und Links ------------------------------------------------------

async function isStorageKeyInUse(storageKey: string, db: Database): Promise<boolean> {
  const [row] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(materialAssets)
    .where(eq(materialAssets.storageKey, storageKey))
  return (row?.value ?? 0) > 0
}

export async function addFileAsset(
  variantId: string,
  file: { buffer: Buffer; fileName: string },
  options: { role?: 'haupt' | 'anhang'; title?: string | null } = {},
  db: Database = useDatabase(),
): Promise<string> {
  const [variant] = await db
    .select({ materialId: materialVariants.materialId })
    .from(materialVariants)
    .where(eq(materialVariants.id, variantId))
    .limit(1)
  if (!variant) throw notFound('Die Variante')

  const [material] = await db
    .select({ materialType: materials.materialType })
    .from(materials)
    .where(eq(materials.id, variant.materialId))
    .limit(1)

  const ext = extensionOf(file.fileName)
  if (material?.materialType === 'moodle_kurs') {
    if (!istKursarchivErweiterung(ext)) {
      throw invalidInput('Bei Moodle-Kursmaterialien sind nur .mbz- und .imscc-Dateien erlaubt.')
    }
    if ((options.role ?? 'haupt') !== 'haupt') {
      throw invalidInput('Kursarchive müssen als Hauptdatei der Variante hochgeladen werden.')
    }
    const [{ value: vorhanden } = { value: 0 }] = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(materialAssets)
      .where(and(eq(materialAssets.variantId, variantId), eq(materialAssets.role, 'haupt')))
    if ((vorhanden ?? 0) > 0) {
      throw invalidInput(
        'Diese Kursversion hat bereits ein Archiv. Lege für eine neue Datei eine neue Kursversion an.',
      )
    }
  }

  const stored = await storeFile(file.buffer, file.fileName)

  const [{ value: highest } = { value: null }] = await db
    .select({ value: max(materialAssets.sortOrder) })
    .from(materialAssets)
    .where(eq(materialAssets.variantId, variantId))

  const [created] = await db
    .insert(materialAssets)
    .values({
      variantId,
      kind: 'datei',
      role: options.role ?? 'haupt',
      title: options.title ?? null,
      fileName: stored.fileName,
      storageKey: stored.storageKey,
      mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes,
      checksum: stored.checksum,
      sortOrder: (highest ?? -1) + 1,
      extractionStatus: isExtractable(stored.fileName) ? 'ausstehend' : 'nicht_unterstuetzt',
    })
    .returning({ id: materialAssets.id })

  // Textextraktion und Miniatur im Hintergrund – Kursarchive haben keine Dokumentvorschau.
  void extractAssetText(created!.id, variant.materialId)
  if (!istKursarchivErweiterung(ext)) {
    queueThumbnailGeneration(created!.id, stored.mimeType, stored.fileName)
  }

  return created!.id
}

/** Extrahiert den Text einer Datei und aktualisiert anschließend den Suchindex. */
export async function extractAssetText(assetId: string, materialId?: string): Promise<void> {
  const db = useDatabase()
  try {
    const [asset] = await db
      .select()
      .from(materialAssets)
      .where(eq(materialAssets.id, assetId))
      .limit(1)
    if (!asset?.storageKey || !asset.fileName) return
    if (!isExtractable(asset.fileName)) return

    await db
      .update(materialAssets)
      .set({ extractionStatus: 'laeuft' })
      .where(eq(materialAssets.id, assetId))

    const result = await extractTextFromStorage(asset.storageKey, asset.fileName)

    await db
      .update(materialAssets)
      .set({
        extractedText: result.text || null,
        pageCount: result.pageCount ?? asset.pageCount,
        extractionStatus: result.status,
        extractionError: result.error ?? null,
      })
      .where(eq(materialAssets.id, assetId))

    const targetId =
      materialId ??
      (
        await db
          .select({ materialId: materialVariants.materialId })
          .from(materialVariants)
          .where(eq(materialVariants.id, asset.variantId))
          .limit(1)
      )[0]?.materialId

    if (targetId) queueReindex('material', targetId)
  } catch (error) {
    log.warn('Textextraktion konnte nicht abgeschlossen werden', { assetId, error })
    await db
      .update(materialAssets)
      .set({
        extractionStatus: 'fehlgeschlagen',
        extractionError: oeffentlicheFehlermeldung(
          error,
          'Der Text konnte nicht extrahiert werden.',
        ),
      })
      .where(eq(materialAssets.id, assetId))
      .catch(() => {})
  }
}

export async function addLinkAsset(
  variantId: string,
  input: { url: string; title?: string | null; role?: 'haupt' | 'anhang' },
  db: Database = useDatabase(),
): Promise<string> {
  const [variant] = await db
    .select({ materialId: materialVariants.materialId })
    .from(materialVariants)
    .where(eq(materialVariants.id, variantId))
    .limit(1)
  if (!variant) throw notFound('Die Variante')

  let parsed: URL
  try {
    parsed = new URL(input.url.trim())
  } catch {
    throw invalidInput('Bitte eine vollständige Adresse angeben, z. B. https://…')
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw invalidInput('Es sind nur http- und https-Adressen erlaubt.')
  }

  const [{ value: highest } = { value: null }] = await db
    .select({ value: max(materialAssets.sortOrder) })
    .from(materialAssets)
    .where(eq(materialAssets.variantId, variantId))

  const [created] = await db
    .insert(materialAssets)
    .values({
      variantId,
      kind: 'link',
      role: input.role ?? 'anhang',
      title: sanitizeText(input.title, 300),
      url: parsed.toString(),
      sortOrder: (highest ?? -1) + 1,
      extractionStatus: 'nicht_unterstuetzt',
    })
    .returning({ id: materialAssets.id })

  queueReindex('material', variant.materialId)
  return created!.id
}

export async function deleteAsset(assetId: string, db: Database = useDatabase()): Promise<void> {
  const [asset] = await db
    .select({
      storageKey: materialAssets.storageKey,
      variantId: materialAssets.variantId,
    })
    .from(materialAssets)
    .where(eq(materialAssets.id, assetId))
    .limit(1)
  if (!asset) throw notFound('Der Anhang')

  const [variant] = await db
    .select({ materialId: materialVariants.materialId })
    .from(materialVariants)
    .where(eq(materialVariants.id, asset.variantId))
    .limit(1)

  await db.delete(materialAssets).where(eq(materialAssets.id, assetId))

  await deleteThumbnail(assetId)
  if (asset.storageKey && !(await isStorageKeyInUse(asset.storageKey, db))) {
    await deleteFile(asset.storageKey)
  }
  if (variant) queueReindex('material', variant.materialId)
}

export async function reorderAssets(
  variantId: string,
  orderedIds: string[],
  db: Database = useDatabase(),
): Promise<void> {
  for (const [index, id] of orderedIds.entries()) {
    await db
      .update(materialAssets)
      .set({ sortOrder: index })
      .where(and(eq(materialAssets.id, id), eq(materialAssets.variantId, variantId)))
  }
}

// --- Beziehungen ------------------------------------------------------------

export async function addRelation(
  fromMaterialId: string,
  toMaterialId: string,
  relationType: string,
  note?: string | null,
  db: Database = useDatabase(),
): Promise<void> {
  if (fromMaterialId === toMaterialId) {
    throw invalidInput('Ein Material kann nicht mit sich selbst verknüpft werden.')
  }
  await requireMaterial(fromMaterialId, db)
  await requireMaterial(toMaterialId, db)

  await db
    .insert(materialRelations)
    .values({
      fromMaterialId,
      toMaterialId,
      relationType: relationType as never,
      note: sanitizeText(note, 1000),
    })
    .onConflictDoNothing()

  queueReindex('material', fromMaterialId)
}

export async function removeRelation(
  relationId: string,
  db: Database = useDatabase(),
): Promise<void> {
  const removed = await db
    .delete(materialRelations)
    .where(eq(materialRelations.id, relationId))
    .returning({ fromMaterialId: materialRelations.fromMaterialId })
  if (!removed[0]) throw notFound('Die Verknüpfung')
  queueReindex('material', removed[0].fromMaterialId)
}

export async function getDetailOrThrow(
  id: string,
  db: Database = useDatabase(),
): Promise<MaterialDetail> {
  const detail = await getMaterialDetail(id, db)
  if (!detail) throw notFound('Das Material')
  return detail
}
