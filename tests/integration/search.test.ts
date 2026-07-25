import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeConnections, createTestUser, resetDatabase, withTempUploadDir } from './helpers'

const { createMaterial } = await import('../../server/services/material.service')
const { addFileAsset } = await import('../../server/services/material.service')
const { createLesson } = await import('../../server/services/lesson.service')
const { createSeries } = await import('../../server/services/series.service')
const { getMaterialDetail } = await import('../../server/repositories/material.repository')
const { getOrCreateSubject } = await import('../../server/services/taxonomy.service')
const { waitForIndex, getIndexStatus } = await import('../../server/services/search/indexer')
const { search, suggest, recordSearch } = await import(
  '../../server/services/search/search.service'
)

let userId: string

afterAll(async () => {
  await closeConnections()
})

beforeEach(async () => {
  await resetDatabase()
  userId = (await createTestUser()).id
})

describe('Hybride Suche', () => {
  it('findet Materialien über den Titel', async () => {
    await createMaterial({ title: 'Arbeitsblatt zum weiblichen Zyklus' }, userId)
    await createMaterial({ title: 'Aufbau des Auges' }, userId)
    await waitForIndex()

    const result = await search('Zyklus')
    expect(result.hits).toHaveLength(1)
    expect(result.hits[0]!.title).toBe('Arbeitsblatt zum weiblichen Zyklus')
    expect(result.hits[0]!.entityType).toBe('material')
    expect(result.hits[0]!.matchedIn).toContain('titel')
  })

  it('nutzt die deutsche Stammformreduktion', async () => {
    await createMaterial({ title: 'Die Geschlechtsorgane des Menschen' }, userId)
    await waitForIndex()

    // Suche im Singular findet den Plural und umgekehrt.
    const result = await search('Geschlechtsorgan')
    expect(result.hits).toHaveLength(1)
  })

  it('findet Treffer trotz Tippfehler über die Trigramm-Ähnlichkeit', async () => {
    await createMaterial({ title: 'Endometriose verstehen' }, userId)
    await waitForIndex()

    const result = await search('Endometrios')
    expect(result.hits.length).toBeGreaterThan(0)
    expect(result.hits[0]!.title).toBe('Endometriose verstehen')
  })

  it('durchsucht Metadaten wie Fach, Schlagwörter und Autor', async () => {
    const subjectId = await getOrCreateSubject('Biologie')
    await createMaterial(
      { title: 'Unbenanntes Blatt', subjectIds: [subjectId], tagNames: ['Pubertät'], author: 'Rösner' },
      userId,
    )
    await waitForIndex()

    expect((await search('Pubertät')).hits).toHaveLength(1)
    expect((await search('Rösner')).hits).toHaveLength(1)
    expect((await search('Biologie')).hits).toHaveLength(1)
  })

  it('durchsucht den extrahierten Text von PDF-Anhängen', async () => {
    await withTempUploadDir(async () => {
      const { readFile } = await import('node:fs/promises')
      const { fileURLToPath } = await import('node:url')
      const buffer = await readFile(
        fileURLToPath(new URL('../fixtures/AB1-Sexuelle-Vielfalt.pdf', import.meta.url)),
      )

      // Der Titel enthält den gesuchten Begriff bewusst nicht.
      const id = await createMaterial({ title: 'Materialblatt 7' }, userId)
      const detail = await getMaterialDetail(id)
      await addFileAsset(detail!.variants[0]!.id, {
        buffer,
        fileName: 'AB1-Sexuelle-Vielfalt.pdf',
      })

      await new Promise((resolve) => setTimeout(resolve, 3000))
      await waitForIndex()

      const result = await search('Heterosexualität')
      expect(result.hits).toHaveLength(1)
      expect(result.hits[0]!.entityId).toBe(id)
      expect(result.hits[0]!.matchedIn).toContain('inhalt')
      // Der Textausschnitt zeigt die Fundstelle mit Hervorhebung.
      expect(result.hits[0]!.snippet).toContain('<mark>')
      expect(result.hits[0]!.sourceLabel).toBe('AB1-Sexuelle-Vielfalt.pdf')
    })
  }, 30_000)

  it('durchsucht Materialien, Stunden und Reihen gemeinsam', async () => {
    await createMaterial({ title: 'Mitose Arbeitsblatt' }, userId)
    await createLesson({ title: 'Mitose und Meiose' }, userId)
    await createSeries({ title: 'Zellteilung: Mitose im Überblick' }, userId)
    await waitForIndex()

    const result = await search('Mitose')

    expect(result.hits).toHaveLength(3)
    expect(new Set(result.hits.map((h) => h.entityType))).toEqual(
      new Set(['material', 'unterrichtsstunde', 'reihe']),
    )
    expect(result.idsByType.material).toHaveLength(1)
    expect(result.idsByType.unterrichtsstunde).toHaveLength(1)
    expect(result.idsByType.reihe).toHaveLength(1)
  })

  it('lässt sich auf einzelne Ergebnistypen einschränken', async () => {
    await createMaterial({ title: 'Osmose Versuch' }, userId)
    await createLesson({ title: 'Osmose im Experiment' }, userId)
    await waitForIndex()

    const result = await search('Osmose', { entityTypes: ['unterrichtsstunde'] })
    expect(result.hits).toHaveLength(1)
    expect(result.hits[0]!.entityType).toBe('unterrichtsstunde')
  })

  it('findet Stunden über Phaseninhalte und Hausaufgaben', async () => {
    await createLesson(
      {
        title: 'Stunde ohne Stichwort im Titel',
        homework: 'Steckbrief zu einem Verhütungsmittel erstellen',
      },
      userId,
    )
    await waitForIndex()

    const result = await search('Verhütungsmittel')
    expect(result.hits).toHaveLength(1)
    expect(result.hits[0]!.entityType).toBe('unterrichtsstunde')
  })

  it('gibt bei leerer Anfrage keine Treffer zurück', async () => {
    await createMaterial({ title: 'Irgendetwas' }, userId)
    await waitForIndex()

    expect((await search('')).hits).toEqual([])
    expect((await search('   ')).hits).toEqual([])
  })

  it('arbeitet ohne konfigurierten KI-Anbieter rein lexikalisch', async () => {
    await createMaterial({ title: 'Photosynthese' }, userId)
    await waitForIndex()

    const result = await search('Photosynthese')
    expect(result.hits).toHaveLength(1)
    // Ohne Embedding-Anbieter darf die Suche trotzdem funktionieren.
    expect(result.vectorSearchUsed).toBe(false)
  })

  it('entfernt gelöschte Datensätze aus dem Index', async () => {
    const { deleteMaterial } = await import('../../server/services/material.service')
    const id = await createMaterial({ title: 'Vergänglich' }, userId)
    await waitForIndex()
    expect((await search('Vergänglich')).hits).toHaveLength(1)

    await deleteMaterial(id)
    await waitForIndex()
    expect((await search('Vergänglich')).hits).toHaveLength(0)
  })

  it('aktualisiert den Index nach Änderungen', async () => {
    const { updateMaterial } = await import('../../server/services/material.service')
    const id = await createMaterial({ title: 'Chloroplasten' }, userId)
    await waitForIndex()

    await updateMaterial(id, { title: 'Zellmembran' })
    await waitForIndex()

    expect((await search('Zellmembran')).hits).toHaveLength(1)
    expect((await search('Chloroplasten')).hits).toHaveLength(0)
  })

  it('meldet den Indexzustand', async () => {
    await createMaterial({ title: 'Indexprüfung' }, userId)
    await waitForIndex()

    const status = await getIndexStatus()
    expect(status.documents).toBeGreaterThan(0)
    // Ohne Embedding-Anbieter bleiben alle Dokumente unvektorisiert.
    expect(status.embedded).toBe(0)
    expect(status.pending).toBe(status.documents)
  })
})

describe('Suchvorschläge', () => {
  it('schlägt Titel, Schlagwörter und Fächer vor', async () => {
    const subjectId = await getOrCreateSubject('Biologie')
    await createMaterial(
      { title: 'Bienen und Bestäubung', subjectIds: [subjectId], tagNames: ['Bienensterben'] },
      userId,
    )
    await waitForIndex()

    const suggestions = await suggest('Biene', userId)
    const kinds = new Set(suggestions.map((s) => s.kind))

    expect(suggestions.length).toBeGreaterThan(0)
    expect(kinds.has('material')).toBe(true)
    expect(kinds.has('schlagwort')).toBe(true)
  })

  it('berücksichtigt die eigene Suchhistorie', async () => {
    await recordSearch(userId, 'Zellatmung', 3)
    const suggestions = await suggest('Zell', userId)

    expect(suggestions.some((s) => s.kind === 'verlauf' && s.value === 'Zellatmung')).toBe(true)
  })

  it('liefert bei sehr kurzen Eingaben keine Vorschläge', async () => {
    expect(await suggest('a', userId)).toEqual([])
  })
})
