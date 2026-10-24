import { readFile } from 'node:fs/promises'
import { and, eq, sql } from 'drizzle-orm'
import type { GradeLevel } from '#shared/utils/jahrgangsstufen'
import { useDatabase } from '../../database/client'
import { materialRelations, materials } from '../../database/schema'
import { invalidInput } from '../../utils/errors'
import { abbildungenHinzufuegen, type NeueAbbildung } from '../abbildungen/abbildung.service'
import { addRelation, createMaterial, deleteMaterial } from '../material.service'
import { deleteFile, fileExists, resolveStoragePath } from '../storage.service'
import type { BulkUploadDetectedCluster, BulkUploadDetectedFile, BulkUploadRecordDecision } from './types'

export interface SammlungAnlegenEingabe {
  cluster: BulkUploadDetectedCluster
  decision: BulkUploadRecordDecision | undefined
  filesByRef: ReadonlyMap<string, BulkUploadDetectedFile>
  lehrwerkId: string | null
  subjectIds: string[]
  gradeLevels: GradeLevel[]
  schoolForm: string | null
  userId: string | null
}

export interface SammlungAnlegenErgebnis {
  materialId: string
  /** `false`: an eine bestehende Sammlung gleichen Titels im selben Lehrwerk angehängt. */
  neu: boolean
  /** Neu gespeicherte Dateien (für das Rückgängigmachen beim Anhängen). */
  assetIds: string[]
  uebersprungen: { dateiName: string; grund: string }[]
}

/**
 * Bestehende Sammlung gleichen Titels im selben Lehrwerk. So lässt sich eine große Bild-CD auf
 * mehrere Stapel verteilen (Paketgrenze): Jeder Stapel ergänzt dieselbe Sammlung.
 */
async function bestehendeSammlung(lehrwerkId: string, titel: string): Promise<string | null> {
  const [treffer] = await useDatabase()
    .select({ id: materials.id })
    .from(materials)
    .innerJoin(materialRelations, eq(materialRelations.fromMaterialId, materials.id))
    .where(
      and(
        eq(materialRelations.toMaterialId, lehrwerkId),
        eq(materialRelations.relationType, 'gehoert_zu'),
        eq(materials.materialType, 'abbildungssammlung'),
        sql`lower(${materials.title}) = lower(${titel})`,
      ),
    )
    .limit(1)
  return treffer?.id ?? null
}

/** Legt aus einem Abbildungs-Bündel eine Sammlung an (oder ergänzt eine bestehende). */
export async function sammlungAnlegen(eingabe: SammlungAnlegenEingabe): Promise<SammlungAnlegenErgebnis> {
  const { cluster, decision, filesByRef } = eingabe
  const plan = cluster.abbildungen?.plan
  if (!plan) throw invalidInput('Das Bündel enthält keine Abbildungen.')
  const titel = (decision?.title ?? cluster.suggestions.title).trim()
  if (!titel) throw invalidInput('Titel fehlt.')

  const dateien = plan.eintraege.map((eintrag) => ({ eintrag, datei: filesByRef.get(eintrag.ref) }))
  for (const { eintrag, datei } of dateien) {
    if (!datei || datei.stagingMissing || !datei.stagingPath || !(await fileExists(datei.stagingPath))) {
      throw invalidInput(`Die Datei „${eintrag.dateiName}“ liegt nicht mehr vor. Bitte den Stapel neu hochladen.`)
    }
  }

  const vorhanden = eingabe.lehrwerkId ? await bestehendeSammlung(eingabe.lehrwerkId, titel) : null
  const materialId =
    vorhanden ??
    (await createMaterial(
      {
        title: titel,
        materialType: 'abbildungssammlung',
        description: (decision?.description ?? cluster.suggestions.description)?.trim() || plan.beschreibung || null,
        source: plan.quelle,
        origin: 'manuell',
        schoolForm: eingabe.schoolForm,
        subjectIds: eingabe.subjectIds,
        gradeLevels: eingabe.gradeLevels,
        tagNames: decision?.tagNames ?? cluster.suggestions.tagNames ?? [],
      },
      eingabe.userId,
    ))

  const bilder: NeueAbbildung[] = dateien.map(({ eintrag, datei }) => ({
    ref: eintrag.ref,
    dateiName: datei!.fileName,
    laden: () => readFile(resolveStoragePath(datei!.stagingPath)),
    metadaten: eintrag.metadaten,
    varianteVonRef: eintrag.varianteVonRef,
    herkunft: eintrag.herkunft,
  }))

  let ergebnis
  try {
    ergebnis = await abbildungenHinzufuegen(materialId, bilder, { ohneDubletten: true })
    if (!vorhanden && !ergebnis.angelegt.length) {
      throw invalidInput(
        `Keines der ${bilder.length} Bilder konnte gespeichert werden: ${ergebnis.uebersprungen[0]?.grund ?? 'unbekannter Fehler'}`,
      )
    }
    if (!vorhanden && eingabe.lehrwerkId) {
      await addRelation(materialId, eingabe.lehrwerkId, 'gehoert_zu', 'Lehrwerk-Paket')
    }
  } catch (error) {
    // Sonst bliebe eine halbe Sammlung zurück, die kein Eintrag kennt und kein Undo entfernt.
    if (!vorhanden) await deleteMaterial(materialId).catch(() => undefined)
    throw error
  }

  // Erst nach dem Erfolg aufräumen, damit ein fehlgeschlagenes Bündel erneut angelegt werden kann.
  for (const { datei } of dateien) {
    await deleteFile(datei!.stagingPath)
  }

  return {
    materialId,
    neu: !vorhanden,
    assetIds: ergebnis.angelegt.map((a) => a.assetId),
    uebersprungen: ergebnis.uebersprungen.map((u) => ({ dateiName: u.dateiName, grund: u.grund })),
  }
}
