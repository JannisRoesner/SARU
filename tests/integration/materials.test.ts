import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  closeConnections,
  createTestUser,
  resetDatabase,
  withTempUploadDir,
} from './helpers'

const {
  addFileAsset,
  addLinkAsset,
  addRelation,
  addVariant,
  createMaterial,
  deleteMaterial,
  deleteVariant,
  duplicateMaterial,
  setArchived,
  setFavorite,
  updateMaterial,
} = await import('../../server/services/material.service')

const { getMaterialDetail, getMaterialFacets, listMaterials } = await import(
  '../../server/repositories/material.repository'
)
const { getOrCreateSubject, getOrCreateTopic } = await import(
  '../../server/services/taxonomy.service'
)

let userId: string

beforeAll(async () => {
  await resetDatabase()
})

afterAll(async () => {
  await closeConnections()
})

beforeEach(async () => {
  await resetDatabase()
  userId = (await createTestUser()).id
})

describe('Materialverwaltung', () => {
  it('legt ein Material mit Standardfassung und Verknüpfungen an', async () => {
    const subjectId = await getOrCreateSubject('Biologie')
    const topicId = await getOrCreateTopic('Sinnesorgane', { subjectId })

    const id = await createMaterial(
      {
        title: 'Arbeitsblatt Aufbau des Auges',
        description: 'Beschriftung der Bestandteile des Auges',
        materialType: 'arbeitsblatt',
        schoolForm: 'gesamtschule',
        author: 'J. Rösner',
        pages: 'S. 244–245',
        learningObjectives: ['Bestandteile des Auges benennen'],
        subjectIds: [subjectId],
        topicIds: [topicId],
        gradeLevels: [9],
        tagNames: ['Auge', 'Sinnesorgane'],
        competencyNames: ['Fachwissen'],
      },
      userId,
    )

    const detail = await getMaterialDetail(id)
    expect(detail).not.toBeNull()
    expect(detail!.title).toBe('Arbeitsblatt Aufbau des Auges')
    expect(detail!.subjects.map((s) => s.name)).toEqual(['Biologie'])
    expect(detail!.topics.map((t) => t.name)).toEqual(['Sinnesorgane'])
    expect(detail!.gradeLevels).toEqual([9])
    expect(detail!.tags.map((t) => t.name).sort()).toEqual(['Auge', 'Sinnesorgane'])
    expect(detail!.competencies.map((c) => c.name)).toEqual(['Fachwissen'])
    // Jedes Material erhält automatisch genau eine Standardfassung.
    expect(detail!.variants).toHaveLength(1)
    expect(detail!.variants[0]!.isDefault).toBe(true)
    expect(detail!.variantCount).toBe(1)
  })

  it('ersetzt Verknüpfungen beim Bearbeiten und lässt nicht genannte unberührt', async () => {
    const bio = await getOrCreateSubject('Biologie')
    const chemie = await getOrCreateSubject('Chemie')

    const id = await createMaterial(
      { title: 'Zellatmung', subjectIds: [bio], gradeLevels: [9], tagNames: ['Zelle'] },
      userId,
    )

    await updateMaterial(id, { subjectIds: [chemie], title: 'Zellatmung überarbeitet' })

    const detail = await getMaterialDetail(id)
    expect(detail!.title).toBe('Zellatmung überarbeitet')
    expect(detail!.subjects.map((s) => s.name)).toEqual(['Chemie'])
    // Jahrgangsstufen und Schlagwörter wurden nicht mitgeschickt und bleiben erhalten.
    expect(detail!.gradeLevels).toEqual([9])
    expect(detail!.tags.map((t) => t.name)).toEqual(['Zelle'])
  })

  it('verwaltet mehrere Differenzierungsvarianten als ein Material', async () => {
    const id = await createMaterial({ title: 'Steckbrief Verhütung' }, userId)

    await addVariant(id, {
      label: 'Differenzierung leicht',
      variantKind: 'differenzierung',
      differentiationLevel: 'grundlegend',
    })
    await addVariant(id, {
      label: 'Differenzierung erweitert',
      variantKind: 'differenzierung',
      differentiationLevel: 'erweitert',
    })

    const detail = await getMaterialDetail(id)
    expect(detail!.variants).toHaveLength(3)
    expect(detail!.variantCount).toBe(3)
    expect(detail!.variants.map((v) => v.label)).toEqual([
      'Standardfassung',
      'Differenzierung leicht',
      'Differenzierung erweitert',
    ])
    // Es bleibt genau eine Standardfassung.
    expect(detail!.variants.filter((v) => v.isDefault)).toHaveLength(1)
  })

  it('verhindert das Löschen der letzten Fassung', async () => {
    const id = await createMaterial({ title: 'Einzelfassung' }, userId)
    const detail = await getMaterialDetail(id)

    await expect(deleteVariant(detail!.variants[0]!.id)).rejects.toThrow(
      /letzte Fassung/i,
    )
  })

  it('speichert Dateien mit Metadaten und indiziert deren Text', async () => {
    await withTempUploadDir(async () => {
      const { readFile } = await import('node:fs/promises')
      const { fileURLToPath } = await import('node:url')
      const buffer = await readFile(
        fileURLToPath(new URL('../fixtures/AB1-Sexuelle-Vielfalt.pdf', import.meta.url)),
      )

      const id = await createMaterial({ title: 'Sexuelle Vielfalt' }, userId)
      const detail = await getMaterialDetail(id)
      const assetId = await addFileAsset(detail!.variants[0]!.id, {
        buffer,
        fileName: 'AB1-Sexuelle-Vielfalt.pdf',
      })
      expect(assetId).toBeTruthy()

      // Die Extraktion läuft im Hintergrund – kurz warten.
      await new Promise((resolve) => setTimeout(resolve, 2500))

      const updated = await getMaterialDetail(id)
      const asset = updated!.variants[0]!.assets[0]!
      expect(asset.fileName).toBe('AB1-Sexuelle-Vielfalt.pdf')
      expect(asset.mimeType).toBe('application/pdf')
      expect(asset.sizeBytes).toBe(buffer.length)
      expect(asset.extractionStatus).toBe('erfolgreich')
      expect(asset.pageCount).toBe(2)
      expect(asset.hasText).toBe(true)
    })
  })

  it('lehnt Dateien ab, deren Inhalt nicht zur Endung passt', async () => {
    await withTempUploadDir(async () => {
      const id = await createMaterial({ title: 'Falscher Typ' }, userId)
      const detail = await getMaterialDetail(id)

      await expect(
        addFileAsset(detail!.variants[0]!.id, {
          buffer: Buffer.from('<?php echo "kein PDF"; ?>'),
          fileName: 'schadcode.pdf',
        }),
      ).rejects.toThrow(/passt nicht zur/i)
    })
  })

  it('lehnt nicht zugelassene Dateitypen ab', async () => {
    await withTempUploadDir(async () => {
      const id = await createMaterial({ title: 'Ausführbare Datei' }, userId)
      const detail = await getMaterialDetail(id)

      await expect(
        addFileAsset(detail!.variants[0]!.id, {
          buffer: Buffer.from('MZ binary'),
          fileName: 'programm.exe',
        }),
      ).rejects.toThrow(/nicht zugelassen/i)
    })
  })

  it('nimmt externe Links auf und weist ungültige Adressen zurück', async () => {
    const id = await createMaterial({ title: 'Film zum Zyklus' }, userId)
    const detail = await getMaterialDetail(id)
    const variantId = detail!.variants[0]!.id

    await addLinkAsset(variantId, {
      url: 'https://hessen.edupool.de/@/PWC7ZRMZ',
      title: 'Vom Gehirn zum reifen Follikel',
    })

    await expect(addLinkAsset(variantId, { url: 'javascript:alert(1)' })).rejects.toThrow(
      /http/i,
    )

    const updated = await getMaterialDetail(id)
    expect(updated!.variants[0]!.assets).toHaveLength(1)
    expect(updated!.variants[0]!.assets[0]!.kind).toBe('link')
  })

  it('verknüpft ein Material mit seiner Musterlösung in beiden Richtungen', async () => {
    const materialId = await createMaterial({ title: 'AB Geschlechtsorgane' }, userId)
    const solutionId = await createMaterial(
      { title: 'Musterlösung Geschlechtsorgane', materialType: 'musterloesung' },
      userId,
    )

    await addRelation(materialId, solutionId, 'musterloesung')

    const material = await getMaterialDetail(materialId)
    expect(material!.hasSolution).toBe(true)
    expect(material!.relations).toHaveLength(1)
    expect(material!.relations[0]!.direction).toBe('ausgehend')
    expect(material!.relations[0]!.material.title).toBe('Musterlösung Geschlechtsorgane')

    // Aus Sicht der Musterlösung ist die Beziehung eingehend.
    const solution = await getMaterialDetail(solutionId)
    expect(solution!.relations[0]!.direction).toBe('eingehend')
    expect(solution!.hasSolution).toBe(false)
  })

  it('verhindert die Verknüpfung eines Materials mit sich selbst', async () => {
    const id = await createMaterial({ title: 'Selbstbezug' }, userId)
    await expect(addRelation(id, id, 'musterloesung')).rejects.toThrow(/sich selbst/i)
  })

  it('dupliziert ein Material samt Fassungen und Zuordnungen', async () => {
    const subjectId = await getOrCreateSubject('Biologie')
    const id = await createMaterial(
      {
        title: 'Stationenarbeit',
        subjectIds: [subjectId],
        gradeLevels: [9],
        tagNames: ['Station'],
      },
      userId,
    )
    await addVariant(id, { label: 'Fassung 2025' })

    const copyId = await duplicateMaterial(id, userId)
    const copy = await getMaterialDetail(copyId)

    expect(copy!.title).toBe('Stationenarbeit (Kopie)')
    expect(copy!.variants).toHaveLength(2)
    expect(copy!.subjects.map((s) => s.name)).toEqual(['Biologie'])
    expect(copy!.tags.map((t) => t.name)).toEqual(['Station'])
    // Das Original bleibt unverändert.
    const original = await getMaterialDetail(id)
    expect(original!.title).toBe('Stationenarbeit')
  })

  it('blendet archivierte Materialien standardmäßig aus', async () => {
    const visible = await createMaterial({ title: 'Aktuelles Material' }, userId)
    const archived = await createMaterial({ title: 'Altes Material' }, userId)
    await setArchived(archived, true)

    const standard = await listMaterials()
    expect(standard.items.map((m) => m.id)).toEqual([visible])
    expect(standard.total).toBe(1)

    const withArchived = await listMaterials({ filters: { includeArchived: true } })
    expect(withArchived.total).toBe(2)
  })

  it('filtert kombinierbar nach Fach, Jahrgang, Art und Favorit', async () => {
    const bio = await getOrCreateSubject('Biologie')
    const deutsch = await getOrCreateSubject('Deutsch')

    const treffer = await createMaterial(
      {
        title: 'Klausur Genetik',
        materialType: 'klausur',
        subjectIds: [bio],
        gradeLevels: [10],
        isFavorite: true,
      },
      userId,
    )
    await createMaterial(
      { title: 'Klausur Lyrik', materialType: 'klausur', subjectIds: [deutsch], gradeLevels: [10] },
      userId,
    )
    await createMaterial(
      { title: 'AB Genetik', materialType: 'arbeitsblatt', subjectIds: [bio], gradeLevels: [10] },
      userId,
    )
    await createMaterial(
      { title: 'Klausur Zellen', materialType: 'klausur', subjectIds: [bio], gradeLevels: [9] },
      userId,
    )

    const result = await listMaterials({
      filters: {
        subjectIds: [bio],
        gradeLevels: [10],
        materialTypes: ['klausur'],
        onlyFavorites: true,
      },
    })

    expect(result.items.map((m) => m.id)).toEqual([treffer])
  })

  it('filtert nach Dateityp anhand der gespeicherten Anhänge', async () => {
    await withTempUploadDir(async () => {
      const withPdf = await createMaterial({ title: 'Mit PDF' }, userId)
      const withoutPdf = await createMaterial({ title: 'Ohne PDF' }, userId)

      const detail = await getMaterialDetail(withPdf)
      await addFileAsset(detail!.variants[0]!.id, {
        buffer: Buffer.from('Nur Text', 'utf8'),
        fileName: 'notiz.txt',
      })

      const txtOnly = await listMaterials({ filters: { fileTypes: ['txt'] } })
      expect(txtOnly.items.map((m) => m.id)).toEqual([withPdf])

      const pdfOnly = await listMaterials({ filters: { fileTypes: ['pdf'] } })
      expect(pdfOnly.items).toHaveLength(0)
      expect(withoutPdf).toBeTruthy()
    })
  })

  it('findet Materialien ohne Musterlösung', async () => {
    const ohne = await createMaterial({ title: 'AB ohne Lösung' }, userId)
    const mit = await createMaterial({ title: 'AB mit Lösung' }, userId)
    const loesung = await createMaterial(
      { title: 'Lösung', materialType: 'musterloesung' },
      userId,
    )
    await addRelation(mit, loesung, 'musterloesung')

    const result = await listMaterials({ filters: { missingSolution: true } })
    const ids = result.items.map((m) => m.id)
    expect(ids).toContain(ohne)
    expect(ids).not.toContain(mit)
  })

  it('sortiert nach Titel, Datum und Bewertung', async () => {
    const b = await createMaterial({ title: 'Bravo', rating: 2 }, userId)
    const a = await createMaterial({ title: 'Alpha', rating: 5 }, userId)

    const byTitle = await listMaterials({ sort: 'titel' })
    expect(byTitle.items.map((m) => m.title)).toEqual(['Alpha', 'Bravo'])

    const byRating = await listMaterials({ sort: 'bewertung' })
    expect(byRating.items.map((m) => m.id)).toEqual([a, b])

    const byDate = await listMaterials({ sort: 'datum_neu' })
    expect(byDate.items[0]!.id).toBe(a)
  })

  it('liefert Facettenzähler passend zu den aktiven Filtern', async () => {
    const bio = await getOrCreateSubject('Biologie')
    await createMaterial(
      { title: 'AB 1', materialType: 'arbeitsblatt', subjectIds: [bio], gradeLevels: [9] },
      userId,
    )
    await createMaterial(
      { title: 'AB 2', materialType: 'arbeitsblatt', subjectIds: [bio], gradeLevels: [9] },
      userId,
    )
    await createMaterial({ title: 'Klausur', materialType: 'klausur', gradeLevels: [10] }, userId)

    const facets = await getMaterialFacets()
    const arbeitsblatt = facets.materialTypes.find((t) => t.value === 'arbeitsblatt')
    expect(arbeitsblatt?.count).toBe(2)
    expect(facets.subjects.find((s) => s.name === 'Biologie')?.count).toBe(2)
    expect(facets.gradeLevels.find((g) => g.value === 9)?.count).toBe(2)

    const scoped = await getMaterialFacets({ materialTypes: ['klausur'] })
    expect(scoped.materialTypes).toHaveLength(1)
    expect(scoped.gradeLevels.find((g) => g.value === 10)?.count).toBe(1)
  })

  it('löscht ein Material samt Fassungen und Anhängen', async () => {
    await withTempUploadDir(async () => {
      const id = await createMaterial({ title: 'Zu löschen' }, userId)
      const detail = await getMaterialDetail(id)
      await addFileAsset(detail!.variants[0]!.id, {
        buffer: Buffer.from('Inhalt', 'utf8'),
        fileName: 'notiz.txt',
      })

      await deleteMaterial(id)
      expect(await getMaterialDetail(id)).toBeNull()
    })
  })

  it('schaltet den Favoritenstatus um', async () => {
    const id = await createMaterial({ title: 'Favorit' }, userId)
    await setFavorite(id, true)
    expect((await getMaterialDetail(id))!.isFavorite).toBe(true)
    await setFavorite(id, false)
    expect((await getMaterialDetail(id))!.isFavorite).toBe(false)
  })
})
