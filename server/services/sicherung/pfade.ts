import { freierName, pfadSegment } from '#shared/utils/sicherung'

/**
 * Lesbare Ordnerstruktur der Sicherung:
 *
 *   Lehrwerke/<Lehrwerk>/…                  Buchdatei des Lehrwerks
 *   Lehrwerke/<Lehrwerk>/<Material>/…       zugeordnete Materialien
 *   Materialien/<Fach>/<Material>/…         alles andere
 *   …/<Material>/<Lösung>/…                 Musterlösungen beim Ausgangsmaterial
 *   …/<Material>/Variante – <Name>/…        weitere Varianten
 *
 * Die Pfade dienen nur der Orientierung beim Durchsehen des Archivs – der
 * Import liest die Zuordnung ausschließlich aus `saru-export.json`.
 */

export interface PfadMaterial {
  id: string
  title: string
  materialType: string
}

export interface PfadRelation {
  fromMaterialId: string
  toMaterialId: string
  relationType: string
}

export interface PfadVariante {
  id: string
  materialId: string
  label: string
  isDefault: boolean
  sortOrder: number
}

export interface PfadAsset {
  id: string
  variantId: string
  fileName: string | null
}

export function materialOrdner(
  materialien: PfadMaterial[],
  relationen: PfadRelation[],
  /** Erstes Fach je Material (für die Einordnung loser Materialien). */
  fachName: Map<string, string>,
): Map<string, string> {
  const nachId = new Map(materialien.map((m) => [m.id, m]))
  const eltern = new Map<string, string>()

  for (const r of relationen) {
    if (r.relationType !== 'gehoert_zu' || r.fromMaterialId === r.toMaterialId) continue
    if (!nachId.has(r.toMaterialId) || eltern.has(r.fromMaterialId)) continue
    eltern.set(r.fromMaterialId, r.toMaterialId)
  }
  for (const r of relationen) {
    if (r.relationType !== 'musterloesung' && r.relationType !== 'loesung') continue
    if (r.fromMaterialId === r.toMaterialId || !nachId.has(r.fromMaterialId)) continue
    if (eltern.has(r.toMaterialId)) continue
    eltern.set(r.toMaterialId, r.fromMaterialId)
  }

  const belegt = new Map<string, Set<string>>()
  const ordner = new Map<string, string>()
  const inArbeit = new Set<string>()

  function belegung(pfad: string): Set<string> {
    let menge = belegt.get(pfad)
    if (!menge) belegt.set(pfad, (menge = new Set()))
    return menge
  }

  function wurzel(material: PfadMaterial): string {
    if (material.materialType === 'lehrwerk') return 'Lehrwerke'
    return `Materialien/${pfadSegment(fachName.get(material.id), 'Ohne Fach')}`
  }

  function aufloesen(id: string): string {
    const bekannt = ordner.get(id)
    if (bekannt) return bekannt
    const material = nachId.get(id)!
    inArbeit.add(id)
    const elternId = eltern.get(id)
    // Zyklen (A gehört zu B, B zu A) brechen wir an der Wurzel ab.
    const basis = elternId && !inArbeit.has(elternId) ? aufloesen(elternId) : wurzel(material)
    inArbeit.delete(id)
    const pfad = `${basis}/${freierName(pfadSegment(material.title), belegung(basis))}`
    ordner.set(id, pfad)
    return pfad
  }

  // Lehrwerke zuerst, damit ihre Ordner die „schönen“ Namen bekommen.
  const reihenfolge = [...materialien].sort(
    (a, b) => Number(b.materialType === 'lehrwerk') - Number(a.materialType === 'lehrwerk'),
  )
  for (const material of reihenfolge) aufloesen(material.id)
  return ordner
}

/** Archivpfad jeder Datei – eindeutig, auch wenn Titel oder Dateinamen doppelt sind. */
export function dateiPfade(
  ordner: Map<string, string>,
  varianten: PfadVariante[],
  assets: PfadAsset[],
): Map<string, string> {
  const variantenOrdner = new Map<string, string>()
  const belegt = new Map<string, Set<string>>()
  const ergebnis = new Map<string, string>()

  function belegung(pfad: string): Set<string> {
    let menge = belegt.get(pfad)
    if (!menge) belegt.set(pfad, (menge = new Set()))
    return menge
  }

  // Unterordnernamen der Materialien vorab belegen, damit Dateien sie nicht verdecken.
  for (const pfad of ordner.values()) {
    const trenner = pfad.lastIndexOf('/')
    belegung(pfad.slice(0, trenner)).add(pfad.slice(trenner + 1).toLowerCase())
  }

  const sortiert = [...varianten].sort(
    (a, b) => Number(b.isDefault) - Number(a.isDefault) || a.sortOrder - b.sortOrder,
  )
  const mitStandardordner = new Set<string>()
  for (const variante of sortiert) {
    const basis = ordner.get(variante.materialId)
    if (!basis) continue
    const istErste = !mitStandardordner.has(variante.materialId)
    mitStandardordner.add(variante.materialId)
    variantenOrdner.set(
      variante.id,
      istErste
        ? basis
        : `${basis}/${freierName(`Variante – ${pfadSegment(variante.label, 'Ohne Namen', 60)}`, belegung(basis))}`,
    )
  }

  for (const asset of assets) {
    const basis = variantenOrdner.get(asset.variantId)
    if (!basis) continue
    const roh = pfadSegment(asset.fileName, 'Datei', 140)
    const punkt = roh.lastIndexOf('.')
    const stamm = punkt > 0 ? roh.slice(0, punkt) : roh
    const endung = punkt > 0 ? roh.slice(punkt).toLowerCase() : ''
    ergebnis.set(asset.id, `${basis}/${freierName(stamm, belegung(basis), endung)}`)
  }
  return ergebnis
}
