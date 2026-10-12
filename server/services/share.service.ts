import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { darfObjektTeilen, hatRecht } from '#shared/utils/rechte'
import { useDatabase } from '../database/client'
import {
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
  shareLinks,
  users,
  type FreigabeRecht,
  type FreigabeZiel,
  type ShareLink,
} from '../database/schema'
import type { SafeUser } from '../utils/auth'
import { decryptSecret, encryptSecret, generateToken, hashToken } from '../utils/crypto'
import { forbidden, invalidInput, notFound, unauthorized } from '../utils/errors'

/** Alles, was an einem Material hängt und mitgeteilt wird. */
const ANHAENGENDE_RELATIONEN = ['musterloesung', 'loesung', 'differenzierung', 'zusatzmaterial'] as const

export interface FreigabeEintrag {
  id: string
  entityType: FreigabeZiel
  entityId: string
  permission: FreigabeRecht
  label: string | null
  pfad: string
  createdAt: string
  createdByName: string | null
  expiresAt: string | null
  lastUsedAt: string | null
  useCount: number
}

export interface FreigabeUmfang {
  link: ShareLink
  /** Wurzelobjekt der Freigabe. */
  wurzel: { typ: FreigabeZiel; id: string; materialType?: string }
  materialIds: Set<string>
  lessonIds: Set<string>
  seriesId: string | null
}

export function freigabePfad(token: string): string {
  return `/geteilt/${token}`
}

// --- Eigentümer und Rechte -------------------------------------------------

async function zielBesitzer(entityType: FreigabeZiel, entityId: string): Promise<string | null> {
  const db = useDatabase()
  if (entityType === 'material') {
    const [row] = await db.select({ ownerId: materials.ownerId }).from(materials).where(eq(materials.id, entityId)).limit(1)
    if (!row) throw notFound('Das Material')
    return row.ownerId
  }
  const [row] = await db.select({ ownerId: series.ownerId }).from(series).where(eq(series.id, entityId)).limit(1)
  if (!row) throw notFound('Die Reihe')
  return row.ownerId
}

export async function assertDarfTeilen(user: SafeUser, entityType: FreigabeZiel, entityId: string) {
  if (!darfObjektTeilen(user, await zielBesitzer(entityType, entityId))) {
    throw forbidden('Du kannst nur eigene Inhalte per Link teilen.')
  }
}

// --- Verwaltung ---------------------------------------------------------------

export async function createShare(
  input: { entityType: FreigabeZiel; entityId: string; permission: FreigabeRecht; label?: string | null; ablaufTage?: number | null },
  user: SafeUser,
): Promise<FreigabeEintrag> {
  await assertDarfTeilen(user, input.entityType, input.entityId)
  if (input.entityType === 'reihe' && input.permission === 'bearbeiten') {
    throw invalidInput('Reihen können derzeit nur zum Ansehen geteilt werden.')
  }

  const token = generateToken(32)
  const expiresAt =
    input.ablaufTage && input.ablaufTage > 0 ? new Date(Date.now() + input.ablaufTage * 86_400_000) : null

  const [row] = await useDatabase()
    .insert(shareLinks)
    .values({
      tokenHash: hashToken(token),
      tokenEncrypted: encryptSecret(token),
      entityType: input.entityType,
      entityId: input.entityId,
      permission: input.permission,
      label: input.label?.trim() || null,
      createdBy: user.id,
      expiresAt,
    })
    .returning()

  return toEintrag(row!, user.name || user.email)
}

function toEintrag(row: ShareLink, createdByName: string | null): FreigabeEintrag {
  let pfad = ''
  try {
    pfad = freigabePfad(decryptSecret(row.tokenEncrypted))
  } catch {
    // Schlüssel nicht mehr lesbar (z. B. NUXT_ENCRYPTION_KEY geändert) – Link bleibt gültig, ist aber nicht kopierbar.
  }
  return {
    id: row.id,
    entityType: row.entityType,
    entityId: row.entityId,
    permission: row.permission,
    label: row.label,
    pfad,
    createdAt: row.createdAt.toISOString(),
    createdByName,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    useCount: row.useCount,
  }
}

/** Aktive (nicht widerrufene, nicht abgelaufene) Links eines Objekts. */
export async function listShares(entityType: FreigabeZiel, entityId: string): Promise<FreigabeEintrag[]> {
  const rows = await useDatabase()
    .select({ link: shareLinks, createdByName: users.name })
    .from(shareLinks)
    .leftJoin(users, eq(users.id, shareLinks.createdBy))
    .where(
      and(
        eq(shareLinks.entityType, entityType),
        eq(shareLinks.entityId, entityId),
        isNull(shareLinks.revokedAt),
        sql`(${shareLinks.expiresAt} is null or ${shareLinks.expiresAt} > now())`,
      ),
    )
    .orderBy(desc(shareLinks.createdAt))
  return rows.map((r) => toEintrag(r.link, r.createdByName))
}

/** Widerrufen dürfen die anlegende Person und alle, die das Objekt teilen dürfen. */
export async function revokeShare(id: string, user: SafeUser): Promise<void> {
  const db = useDatabase()
  const [row] = await db.select().from(shareLinks).where(eq(shareLinks.id, id)).limit(1)
  if (!row || row.revokedAt) throw notFound('Der Link')
  if (row.createdBy !== user.id && !hatRecht(user, 'teilen')) {
    await assertDarfTeilen(user, row.entityType, row.entityId)
  }
  await db.update(shareLinks).set({ revokedAt: new Date() }).where(eq(shareLinks.id, id))
}

// --- Zugriff über den Schlüssel ---------------------------------------------

async function linkZuSchluessel(token: string): Promise<ShareLink> {
  // Schlüssel sind 43 Zeichen base64url; alles andere gar nicht erst nachschlagen.
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw unauthorized('Dieser Link ist ungültig.')
  const [row] = await useDatabase()
    .select()
    .from(shareLinks)
    .where(eq(shareLinks.tokenHash, hashToken(token)))
    .limit(1)
  if (!row || row.revokedAt) throw unauthorized('Dieser Link ist ungültig oder wurde zurückgezogen.')
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) throw unauthorized('Dieser Link ist abgelaufen.')
  // Links gelöschter oder deaktivierter Konten gelten nicht mehr.
  const [ersteller] = row.createdBy
    ? await useDatabase().select({ isActive: users.isActive }).from(users).where(eq(users.id, row.createdBy)).limit(1)
    : []
  if (!ersteller?.isActive) throw unauthorized('Dieser Link ist nicht mehr gültig.')
  return row
}

/** Zählt einen Aufruf (nur beim Öffnen der Startansicht, nicht bei jeder Datei). */
export async function markShareUsed(link: ShareLink): Promise<void> {
  await useDatabase()
    .update(shareLinks)
    .set({ lastUsedAt: new Date(), useCount: sql`${shareLinks.useCount} + 1` })
    .where(eq(shareLinks.id, link.id))
}

/**
 * Prüft den Schlüssel aus der URL und berechnet den Umfang der Freigabe.
 * Ergebnis wird pro Anfrage zwischengespeichert.
 */
export async function requireFreigabe(event: H3Event): Promise<FreigabeUmfang> {
  const cached = event.context.saruFreigabe as FreigabeUmfang | undefined
  if (cached) return cached
  const umfang = await freigabeUmfang(String(getRouterParam(event, 'token') ?? ''))
  event.context.saruFreigabe = umfang
  return umfang
}

/** Schlüssel prüfen und Umfang berechnen (ohne Anfrage-Kontext, z. B. für Tests). */
export async function freigabeUmfang(token: string): Promise<FreigabeUmfang> {
  return berechneUmfang(await linkZuSchluessel(token))
}

export function requireFreigabeBearbeiten(umfang: FreigabeUmfang): void {
  if (umfang.link.permission !== 'bearbeiten') {
    throw forbidden('Dieser Link erlaubt nur das Ansehen.')
  }
}

async function berechneUmfang(link: ShareLink): Promise<FreigabeUmfang> {
  const db = useDatabase()
  const materialIds = new Set<string>()
  const lessonIds = new Set<string>()
  let seriesId: string | null = null
  let wurzel: FreigabeUmfang['wurzel']

  if (link.entityType === 'material') {
    const [root] = await db
      .select({ id: materials.id, materialType: materials.materialType, isArchived: materials.isArchived })
      .from(materials)
      .where(eq(materials.id, link.entityId))
      .limit(1)
    if (!root) throw notFound('Das geteilte Material')
    wurzel = { typ: 'material', id: root.id, materialType: root.materialType }
    materialIds.add(root.id)
    // Lehrwerke und Lernzirkel: auch die ihnen zugeordneten Materialien (Blätter, Stationen) sind enthalten.
    const inhalt = await db
      .select({ id: materialRelations.fromMaterialId })
      .from(materialRelations)
      .where(and(eq(materialRelations.toMaterialId, root.id), eq(materialRelations.relationType, 'gehoert_zu')))
    for (const r of inhalt) materialIds.add(r.id)
  } else {
    const [root] = await db.select({ id: series.id }).from(series).where(eq(series.id, link.entityId)).limit(1)
    if (!root) throw notFound('Die geteilte Reihe')
    wurzel = { typ: 'reihe', id: root.id }
    seriesId = root.id
    const stunden = await db.select({ id: lessons.id }).from(lessons).where(eq(lessons.seriesId, root.id))
    for (const s of stunden) lessonIds.add(s.id)
    const reihenMaterial = await db
      .select({ id: seriesMaterials.materialId })
      .from(seriesMaterials)
      .where(eq(seriesMaterials.seriesId, root.id))
    for (const m of reihenMaterial) materialIds.add(m.id)
    if (lessonIds.size) {
      const ids = [...lessonIds]
      const stundenMaterial = await db
        .select({ id: lessonMaterials.materialId })
        .from(lessonMaterials)
        .where(inArray(lessonMaterials.lessonId, ids))
      for (const m of stundenMaterial) materialIds.add(m.id)
      const phasenMaterial = await db
        .select({ id: lessonPhaseMaterials.materialId })
        .from(lessonPhaseMaterials)
        .innerJoin(lessonPhases, eq(lessonPhases.id, lessonPhaseMaterials.phaseId))
        .where(inArray(lessonPhases.lessonId, ids))
      for (const m of phasenMaterial) materialIds.add(m.id)
    }
  }

  // Ein Lernzirkel in einer Reihe oder Stunde bringt seine Stationen mit.
  if (materialIds.size) {
    const zirkel = await db
      .select({ id: materials.id })
      .from(materials)
      .where(and(inArray(materials.id, [...materialIds]), eq(materials.materialType, 'lernzirkel')))
    if (zirkel.length) {
      const stationen = await db
        .select({ id: materialRelations.fromMaterialId })
        .from(materialRelations)
        .where(
          and(
            inArray(materialRelations.toMaterialId, zirkel.map((z) => z.id)),
            eq(materialRelations.relationType, 'gehoert_zu'),
          ),
        )
      for (const r of stationen) materialIds.add(r.id)
    }
  }

  // Lösungen, Differenzierungen und Zusatzmaterial der enthaltenen Materialien (eine Ebene).
  if (materialIds.size) {
    const anhaengend = await db
      .select({ id: materialRelations.toMaterialId })
      .from(materialRelations)
      .where(
        and(
          inArray(materialRelations.fromMaterialId, [...materialIds]),
          inArray(materialRelations.relationType, [...ANHAENGENDE_RELATIONEN]),
        ),
      )
    for (const r of anhaengend) materialIds.add(r.id)
  }

  return { link, wurzel, materialIds, lessonIds, seriesId }
}

export function assertMaterialImUmfang(umfang: FreigabeUmfang, materialId: string): void {
  if (!umfang.materialIds.has(materialId)) throw notFound('Das Material')
}

export function assertStundeImUmfang(umfang: FreigabeUmfang, lessonId: string): void {
  if (!umfang.lessonIds.has(lessonId)) throw notFound('Die Stunde')
}

/** Datei → Fassung → Material; liefert die Material-ID, wenn sie im Umfang liegt. */
export async function assertDateiImUmfang(umfang: FreigabeUmfang, assetId: string): Promise<string> {
  const [row] = await useDatabase()
    .select({ materialId: materialVariants.materialId })
    .from(materialAssets)
    .innerJoin(materialVariants, eq(materialVariants.id, materialAssets.variantId))
    .where(eq(materialAssets.id, assetId))
    .limit(1)
  if (!row || !umfang.materialIds.has(row.materialId)) throw notFound('Die Datei')
  return row.materialId
}

/** Gäste handeln im Namen der Person, die den Link erstellt hat (für Besitz und Protokoll). */
export async function freigabeHandelnde(umfang: FreigabeUmfang): Promise<{ id: string; name: string }> {
  if (!umfang.link.createdBy) throw forbidden('Dieser Link gehört zu keinem aktiven Konto mehr.')
  const [u] = await useDatabase()
    .select({ id: users.id, name: users.name, isActive: users.isActive })
    .from(users)
    .where(eq(users.id, umfang.link.createdBy))
    .limit(1)
  if (!u?.isActive) throw forbidden('Dieser Link gehört zu keinem aktiven Konto mehr.')
  return { id: u.id, name: u.name }
}
