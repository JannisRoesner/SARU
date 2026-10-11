import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { closeConnections, createTestUser, resetDatabase } from './helpers'

const { addFileAsset, addRelation, createMaterial } = await import('../../server/services/material.service')
const { getMaterialDetail } = await import('../../server/repositories/material.repository')
const { addLessonToSeries, attachMaterialToSeries, createSeries } = await import(
  '../../server/services/series.service'
)
const { addPhase, attachMaterial, attachMaterialToPhase, createLesson } = await import(
  '../../server/services/lesson.service'
)
const { updateUser } = await import('../../server/services/user.service')
const { createShare, freigabeUmfang, listShares, revokeShare } = await import(
  '../../server/services/share.service'
)
const { gastLehrwerkInhalt, gastMaterial } = await import('../../server/services/share-view.service')
const { useDatabase } = await import('../../server/database/client')
const { shareLinks, users } = await import('../../server/database/schema')

type Nutzer = Awaited<ReturnType<typeof ladeNutzer>>

async function ladeNutzer(id: string) {
  const [u] = await useDatabase().select().from(users).where(eq(users.id, id)).limit(1)
  const { passwordHash: _ph, ...safe } = u!
  return safe
}

const schluessel = (pfad: string) => pfad.split('/').pop()!

let lehrkraft: Nutzer

beforeAll(async () => {
  await resetDatabase()
})

afterAll(async () => {
  await closeConnections()
})

beforeEach(async () => {
  await resetDatabase()
  lehrkraft = await ladeNutzer((await createTestUser()).id)
})

describe('Freigabe-Links: Umfang', () => {
  it('teilt ein Lehrwerk mit Inhalt und Lösungen, aber nichts anderes', async () => {
    const lehrwerk = await createMaterial({ title: 'Lehrwerk', materialType: 'lehrwerk' }, lehrkraft.id)
    const ab = await createMaterial({ title: 'AB 1', materialType: 'arbeitsblatt' }, lehrkraft.id)
    const loesung = await createMaterial({ title: 'Lösung AB 1', materialType: 'musterloesung' }, lehrkraft.id)
    const fremd = await createMaterial({ title: 'Nicht geteilt', materialType: 'arbeitsblatt' }, lehrkraft.id)
    await addRelation(ab, lehrwerk, 'gehoert_zu')
    await addRelation(ab, loesung, 'musterloesung')

    const link = await createShare({ entityType: 'material', entityId: lehrwerk, permission: 'ansehen' }, lehrkraft)
    expect(link.pfad).toMatch(/^\/geteilt\/[A-Za-z0-9_-]{40,}$/)

    const umfang = await freigabeUmfang(schluessel(link.pfad))
    expect([...umfang.materialIds].sort()).toEqual([lehrwerk, ab, loesung].sort())
    expect(umfang.materialIds.has(fremd)).toBe(false)

    const inhalt = await gastLehrwerkInhalt(umfang, lehrwerk)
    expect(inhalt.map((m) => m.title)).toEqual(['AB 1'])
    await expect(gastMaterial(umfang, fremd)).rejects.toThrow()
  })

  it('liefert Dateiname und Typ für die Miniaturen der Inhaltsliste', async () => {
    const lehrwerk = await createMaterial({ title: 'Lehrwerk', materialType: 'lehrwerk' }, lehrkraft.id)
    const ab = await createMaterial({ title: 'AB mit Datei', materialType: 'arbeitsblatt' }, lehrkraft.id)
    await addRelation(ab, lehrwerk, 'gehoert_zu')
    const buffer = await readFile(fileURLToPath(new URL('../fixtures/sample.pdf', import.meta.url)))
    const assetId = await addFileAsset((await getMaterialDetail(ab))!.variants[0]!.id, {
      buffer,
      fileName: 'sample.pdf',
    })
    // Textextraktion läuft im Hintergrund – abwarten, bevor die Datenbank zurückgesetzt wird.
    await new Promise((resolve) => setTimeout(resolve, 2500))

    const link = await createShare({ entityType: 'material', entityId: lehrwerk, permission: 'ansehen' }, lehrkraft)
    const [eintrag] = await gastLehrwerkInhalt(await freigabeUmfang(schluessel(link.pfad)), lehrwerk)
    expect(eintrag).toMatchObject({
      vorschauDateiId: assetId,
      vorschauDateiname: 'sample.pdf',
      vorschauMimeType: 'application/pdf',
    })
  })

  it('teilt eine Reihe mit Stunden und dem Material aus Reihe, Stunden und Phasen', async () => {
    const reihe = await createSeries({ title: 'Reihe' }, lehrkraft.id)
    const stunde = await createLesson({ title: 'Stunde 1' }, lehrkraft.id)
    const fremdeStunde = await createLesson({ title: 'Andere Stunde' }, lehrkraft.id)
    await addLessonToSeries(reihe, stunde)
    const mReihe = await createMaterial({ title: 'Reihenmaterial' }, lehrkraft.id)
    const mStunde = await createMaterial({ title: 'Stundenmaterial' }, lehrkraft.id)
    const mPhase = await createMaterial({ title: 'Phasenmaterial' }, lehrkraft.id)
    const mFremd = await createMaterial({ title: 'Fremd' }, lehrkraft.id)
    await attachMaterialToSeries(reihe, { materialId: mReihe })
    await attachMaterial(stunde, { materialId: mStunde })
    const phase = await addPhase(stunde, { name: 'Einstieg' })
    await attachMaterialToPhase(phase, { materialId: mPhase })
    await attachMaterial(fremdeStunde, { materialId: mFremd })

    const link = await createShare({ entityType: 'reihe', entityId: reihe, permission: 'ansehen' }, lehrkraft)
    const umfang = await freigabeUmfang(schluessel(link.pfad))
    expect([...umfang.lessonIds]).toEqual([stunde])
    expect([...umfang.materialIds].sort()).toEqual([mReihe, mStunde, mPhase].sort())
  })
})

describe('Freigabe-Links: Gültigkeit', () => {
  it('funktioniert nach dem Widerruf nicht mehr', async () => {
    const m = await createMaterial({ title: 'M' }, lehrkraft.id)
    const link = await createShare({ entityType: 'material', entityId: m, permission: 'ansehen' }, lehrkraft)
    await revokeShare(link.id, lehrkraft)
    await expect(freigabeUmfang(schluessel(link.pfad))).rejects.toThrow(/zurückgezogen|ungültig/)
    expect(await listShares('material', m)).toHaveLength(0)
  })

  it('läuft ab', async () => {
    const m = await createMaterial({ title: 'M' }, lehrkraft.id)
    const link = await createShare({ entityType: 'material', entityId: m, permission: 'ansehen', ablaufTage: 7 }, lehrkraft)
    await useDatabase().update(shareLinks).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(shareLinks.id, link.id))
    await expect(freigabeUmfang(schluessel(link.pfad))).rejects.toThrow(/abgelaufen/)
  })

  it('gilt nicht mehr, wenn das erstellende Konto deaktiviert ist', async () => {
    const zweite = await ladeNutzer((await createTestUser()).id)
    const m = await createMaterial({ title: 'M' }, zweite.id)
    const link = await createShare({ entityType: 'material', entityId: m, permission: 'ansehen' }, zweite)
    // SARU verlangt mindestens ein aktives Administratorkonto, bevor jemand deaktiviert wird.
    await createTestUser({ role: 'admin' })
    await updateUser(zweite.id, { isActive: false })
    await expect(freigabeUmfang(schluessel(link.pfad))).rejects.toThrow(/nicht mehr gültig/)
  })

  it('lehnt erfundene oder kaputte Schlüssel ab', async () => {
    await expect(freigabeUmfang('A'.repeat(43))).rejects.toThrow()
    await expect(freigabeUmfang('../etc/passwd')).rejects.toThrow()
  })
})

describe('Freigabe-Links: Wer darf teilen', () => {
  it('Beitragende teilen nur Eigenes, Lesezugriff gar nichts', async () => {
    const beitragend = await ladeNutzer((await createTestUser({ role: 'beitragende' })).id)
    const leser = await ladeNutzer((await createTestUser({ role: 'leser' })).id)
    const eigenes = await createMaterial({ title: 'Eigenes' }, beitragend.id)
    const fremdes = await createMaterial({ title: 'Fremdes' }, lehrkraft.id)

    await expect(createShare({ entityType: 'material', entityId: eigenes, permission: 'ansehen' }, beitragend)).resolves.toBeTruthy()
    await expect(createShare({ entityType: 'material', entityId: fremdes, permission: 'ansehen' }, beitragend)).rejects.toThrow()
    await expect(createShare({ entityType: 'material', entityId: fremdes, permission: 'ansehen' }, leser)).rejects.toThrow()
  })

  it('Reihen lassen sich nur zum Ansehen teilen', async () => {
    const reihe = await createSeries({ title: 'Reihe' }, lehrkraft.id)
    await expect(createShare({ entityType: 'reihe', entityId: reihe, permission: 'bearbeiten' }, lehrkraft)).rejects.toThrow(/nur zum Ansehen/)
  })
})
