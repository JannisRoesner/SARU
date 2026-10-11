import { describe, expect, it } from 'vitest'
import { resolveBulkGradeLevels } from '../../shared/utils/bulk-upload'
import { guessMaterialType } from '../../shared/utils/material-type-guess'
import {
  clusterBulkFiles,
  clusterTitleFromStem,
  detectFolderRole,
  fassungInfo,
  fassungLabel,
} from '../../server/services/bulk-upload/pairing'

describe('resolveBulkGradeLevels', () => {
  it('nimmt mehrere Stufen und fällt auf ein einzelnes gradeLevel zurück', () => {
    expect(resolveBulkGradeLevels({ gradeLevels: ['E1', 'E2'] })).toEqual(['E1', 'E2'])
    expect(resolveBulkGradeLevels({ gradeLevel: 9 })).toEqual([9])
    expect(resolveBulkGradeLevels({ gradeLevels: [], gradeLevel: 9 })).toEqual([])
  })
})

describe('guessMaterialType für Verlagsdateien', () => {
  it('erkennt Arbeitsblatt, Klausur, GFB und Abbildungen', () => {
    expect(guessMaterialType('bio_zel_s2_ab_007.docx')).toBe('arbeitsblatt')
    expect(guessMaterialType('bio_zel_s2_ka_001.pdf')).toBe('klausur')
    expect(guessMaterialType('wd01_049000_gfb_081_katalase.docx')).toBe('gefaehrdungsbeurteilung')
    expect(guessMaterialType('Kopiervorlagen/wd01_ECF55018UAA99_004_zellmembran.docx')).toBe(
      'arbeitsblatt',
    )
    expect(guessMaterialType('wd01_ECF55018UAA99_AbbSB_Kap2_1_Enzyme.docx')).toBe('bild')
    expect(guessMaterialType('Versuche/versuch_kronether.pdf')).toBe('zusatzmaterial')
    expect(guessMaterialType('AB-Zellatmung_Loesung.pdf')).toBe('musterloesung')
  })
})

describe('Stapel-Paarung', () => {
  it('ordnet Ordnerrollen zu', () => {
    expect(detectFolderRole('Kopiervorlagen/foo.docx', 'foo.docx')).toBe('kopiervorlagen')
    expect(detectFolderRole('Gefährdungsbeurteilung/x.docx', 'x.docx')).toBe(
      'gefaehrdungsbeurteilung',
    )
    expect(detectFolderRole(null, 'wd01_049000_gfb_081_katalase.docx')).toBe(
      'gefaehrdungsbeurteilung',
    )
    expect(detectFolderRole(null, 'versuch_polyp.pdf')).toBe('versuche')
    expect(detectFolderRole('Abbildungen/AbbSB_Kap1.docx', 'AbbSB_Kap1.docx')).toBe('abbildungen')
  })

  it('setzt bei Abbildungen die Dateirolle Abbildung', () => {
    const clusters = clusterBulkFiles([
      {
        sourceRef: 'abb',
        fileName: 'wd01_ECF55018UAA99_AbbSB_Kap4_3_Entstehung_Leben.docx',
        relativePath: 'klett-Dateien/Abbildungen/wd01_ECF55018UAA99_AbbSB_Kap4_3_Entstehung_Leben.docx',
        extension: 'docx',
      },
    ])
    expect(clusters).toHaveLength(1)
    expect(clusters[0]!.folderRole).toBe('abbildungen')
    expect(clusters[0]!.suggestions.materialType).toBe('bild')
    expect(clusters[0]!.suggestedRoles.abb).toBe('abbildung')
  })

  it('macht aus Verlagsstämmen lesbare Titel', () => {
    expect(clusterTitleFromStem('wd01_ECF55018UAA99_004_zellmembran', 'kopiervorlagen')).toBe(
      'Zellmembran',
    )
    expect(clusterTitleFromStem('bio_zel_s2_ab_007', 'kopiervorlagen')).toBe('AB 007')
    expect(clusterTitleFromStem('versuch_kronether', 'versuche')).toBe('Versuch Kronether')
  })

  it('paart Word und PDF mit gleichem Stamm', () => {
    const clusters = clusterBulkFiles([
      {
        sourceRef: 'a',
        fileName: 'bio_zel_s2_ab_007.docx',
        relativePath: 'Kopiervorlagen/bio_zel_s2_ab_007.docx',
        extension: 'docx',
      },
      {
        sourceRef: 'b',
        fileName: 'bio_zel_s2_ab_007.pdf',
        relativePath: 'Kopiervorlagen/bio_zel_s2_ab_007.pdf',
        extension: 'pdf',
      },
      {
        sourceRef: 'c',
        fileName: 'versuch_katalase.pdf',
        relativePath: 'Versuche/versuch_katalase.pdf',
        extension: 'pdf',
      },
      {
        sourceRef: 'd',
        fileName: 'wd01_049000_gfb_081_katalase.docx',
        relativePath: 'Gefährdungsbeurteilung/wd01_049000_gfb_081_katalase.docx',
        extension: 'docx',
      },
    ])

    expect(clusters).toHaveLength(3)
    const paar = clusters.find((c) => c.kind === 'paar')!
    expect(paar.suggestions.materialType).toBe('arbeitsblatt')
    expect(paar.suggestedRoles.a).toBe('schueler')
    expect(paar.suggestedRoles.b).toBe('loesung')

    const gfb = clusters.find((c) => c.folderRole === 'gefaehrdungsbeurteilung')!
    const versuch = clusters.find((c) => c.folderRole === 'versuche')!
    expect(gfb.suggestions.materialType).toBe('gefaehrdungsbeurteilung')
    expect(versuch.proposedLinks).toHaveLength(1)
    expect(versuch.proposedLinks[0]!.targetClusterId).toBe(gfb.clusterId)
    expect(versuch.proposedLinks[0]!.relationType).toBe('gehoert_zu')
  })

  it('paart Klausur und Lösung auch bei gleichem Dateiformat anhand des Namens', () => {
    const clusters = clusterBulkFiles([
      {
        sourceRef: 'lsg',
        fileName: 'Klausur 01 Fische mit und ohne Kiefer - Lösung.doc',
        relativePath: 'Klausuren/1 Belege/Klausur 01 Fische mit und ohne Kiefer - Lösung.doc',
        extension: 'doc',
      },
      {
        sourceRef: 'ka',
        fileName: 'Klausur 01 Fische mit und ohne Kiefer.doc',
        relativePath: 'Klausuren/1 Belege/Klausur 01 Fische mit und ohne Kiefer.doc',
        extension: 'doc',
      },
      {
        sourceRef: 'ka2',
        fileName: 'Klausur 02 Insulin.doc',
        relativePath: 'Klausuren/1 Belege/Klausur 02 Insulin.doc',
        extension: 'doc',
      },
    ])

    expect(clusters).toHaveLength(2)
    const paar = clusters.find((c) => c.kind === 'paar')!
    expect(paar.suggestions.materialType).toBe('klausur')
    expect(paar.suggestions.title).toBe('Klausur 01 Fische mit und ohne Kiefer')
    expect(paar.suggestedRoles.ka).toBe('schueler')
    expect(paar.suggestedRoles.lsg).toBe('loesung')
    expect(clusters.find((c) => c.kind === 'einzeln')!.fileRefs).toEqual(['ka2'])
  })

  it('erkennt Lösungs-Endungen wie _Loesung und _lsg, auch außerhalb von Klausurordnern', () => {
    const clusters = clusterBulkFiles([
      { sourceRef: 'a', fileName: 'AB-Zellatmung.docx', extension: 'docx' },
      { sourceRef: 'b', fileName: 'AB-Zellatmung_Loesung.docx', extension: 'docx' },
      { sourceRef: 'c', fileName: 'mel_740449.doc', extension: 'doc' },
      { sourceRef: 'd', fileName: 'mel_740449_lsg.doc', extension: 'doc' },
    ])
    expect(clusters).toHaveLength(2)
    for (const c of clusters) expect(c.kind).toBe('paar')
    expect(clusters[0]!.suggestedRoles).toEqual({ a: 'schueler', b: 'loesung' })
    expect(clusters[1]!.suggestedRoles).toEqual({ c: 'schueler', d: 'loesung' })
  })

  it('lässt eine einzelne Lösungsdatei allein und paart nicht aus Versehen', () => {
    const allein = clusterBulkFiles([
      { sourceRef: 'x', fileName: 'Lösung.docx', extension: 'docx' },
    ])
    expect(allein).toHaveLength(1)
    expect(allein[0]!.kind).toBe('einzeln')

    const unklar = clusterBulkFiles([
      { sourceRef: 'a', fileName: 'Test.docx', extension: 'docx' },
      { sourceRef: 'b', fileName: 'Test.docx', extension: 'docx' },
    ])
    expect(unklar[0]!.kind).toBe('unklar')
  })

  it('liest die Fassungs-Bezeichnung aus dem Dateinamen', () => {
    expect(fassungLabel('Hunde und Katzen - Fassung Handbuch (LH 1.1 Diff-02).pdf')).toBe('Handbuch')
    expect(fassungLabel('Natura 1 Lehrerband - Fassung Unterrichtsassistent (alle Seiten).pdf')).toBe(
      'Unterrichtsassistent',
    )
    expect(fassungInfo('Modell Katzenkralle (2) - Fassung Assistent (S038-03)')).toEqual({
      base: 'Modell Katzenkralle (2)',
      label: 'Assistent',
    })
    expect(fassungLabel('Hunde und Katzen.pdf')).toBeNull()
  })

  it('fasst Dateien mit „- Fassung …“ im selben Ordner zu einem Material mit mehreren Fassungen zusammen', () => {
    const clusters = clusterBulkFiles([
      {
        sourceRef: 'h',
        fileName: 'Hunde und Katzen im Vergleich (2) - Fassung Handbuch (LH 1.1 Diff-02).pdf',
        relativePath: 'Natura 1/Kapitel 01/Arbeitsblätter/Hunde und Katzen im Vergleich (2) - Fassung Handbuch (LH 1.1 Diff-02).pdf',
        extension: 'pdf',
      },
      {
        sourceRef: 'a',
        fileName: 'Hunde und Katzen im Vergleich (2) - Fassung Assistent (S040-03).pdf',
        relativePath: 'Natura 1/Kapitel 01/Arbeitsblätter/Hunde und Katzen im Vergleich (2) - Fassung Assistent (S040-03).pdf',
        extension: 'pdf',
      },
      {
        sourceRef: 'x',
        fileName: 'Der Wolf (S032-01).pdf',
        relativePath: 'Natura 1/Kapitel 01/Arbeitsblätter/Der Wolf (S032-01).pdf',
        extension: 'pdf',
      },
    ])
    expect(clusters).toHaveLength(2)
    const faessungen = clusters.find((c) => c.kind === 'varianten')!
    expect(faessungen.suggestions.title).toBe('Hunde und Katzen im Vergleich (2)')
    // alphabetisch nach Bezeichnung: „Assistent“ wird das Material, „Handbuch“ eine weitere Fassung
    expect(faessungen.suggestedRoles).toEqual({ a: 'schueler', h: 'fassung' })
    expect(clusters.find((c) => c.kind === 'einzeln')!.fileRefs).toEqual(['x'])
  })

  it('bildet keine Fassungen, wenn die Bezeichnung doppelt vorkommt oder der Ordner verschieden ist', () => {
    const doppelt = clusterBulkFiles([
      { sourceRef: 'a', fileName: 'AB - Fassung A (1).pdf', relativePath: 'x/AB - Fassung A (1).pdf', extension: 'pdf' },
      { sourceRef: 'b', fileName: 'AB - Fassung A (2).pdf', relativePath: 'x/AB - Fassung A (2).pdf', extension: 'pdf' },
    ])
    expect(doppelt.every((c) => c.kind !== 'varianten')).toBe(true)

    const andererOrdner = clusterBulkFiles([
      { sourceRef: 'a', fileName: 'AB - Fassung A.pdf', relativePath: 'x/AB - Fassung A.pdf', extension: 'pdf' },
      { sourceRef: 'b', fileName: 'AB - Fassung B.pdf', relativePath: 'y/AB - Fassung B.pdf', extension: 'pdf' },
    ])
    expect(andererOrdner).toHaveLength(2)
    expect(andererOrdner.every((c) => c.kind === 'einzeln')).toBe(true)
  })

  it('ordnet drei Fassungen einem Material zu (Lehrerband)', () => {
    const clusters = clusterBulkFiles(
      ['Lehrerhandbuch', 'Unterrichtsassistent', 'Kopie'].map((label) => ({
        sourceRef: label,
        fileName: `Natura 1 Lehrerband - Fassung ${label} (alle Seiten).pdf`,
        relativePath: `Natura 1/00 Lehrerband/Natura 1 Lehrerband - Fassung ${label} (alle Seiten).pdf`,
        extension: 'pdf',
      })),
    )
    expect(clusters).toHaveLength(1)
    expect(clusters[0]!.kind).toBe('varianten')
    expect(clusters[0]!.suggestions.title).toBe('Natura 1 Lehrerband')
    expect(Object.values(clusters[0]!.suggestedRoles).sort()).toEqual(['fassung', 'fassung', 'schueler'])
  })
})

describe('Lernzirkel-Erkennung', () => {
  const datei = (ref: string, pfad: string) => ({
    sourceRef: ref,
    fileName: pfad.split('/').pop()!,
    relativePath: pfad,
    extension: pfad.split('.').pop()!,
  })

  it('erkennt einen Ordner „Lernzirkel …“ und fasst Stationen samt Lösung zusammen', () => {
    const cluster = clusterBulkFiles([
      datei('s1', 'Katze/Lernzirkel Katze/Station 1 - Knochen.pdf'),
      datei('s1l', 'Katze/Lernzirkel Katze/Station 1 - Knochen - Lösung.pdf'),
      datei('s2', 'Katze/Lernzirkel Katze/Station 2 - Auge.pdf'),
      datei('lz', 'Katze/Lernzirkel Katze/Laufzettel.pdf'),
    ])
    expect(cluster).toHaveLength(3)
    for (const c of cluster) {
      expect(c.lernzirkel?.title).toBe('Lernzirkel Katze')
      expect(c.folderRole).toBe('lernzirkel')
      expect(c.suggestions.materialType).toBe('arbeitsblatt')
    }
    expect(new Set(cluster.map((c) => c.lernzirkel!.id)).size).toBe(1)
    expect(cluster.find((c) => c.fileRefs.includes('s1'))!.kind).toBe('paar')
  })

  it('gibt einem Ordner „Stationenarbeit“ das Thema des Elternordners', () => {
    const [a] = clusterBulkFiles([
      datei('a', 'Skelett/Stationenarbeit/Station A.pdf'),
      datei('b', 'Skelett/Stationenarbeit/Station B.pdf'),
    ])
    expect(a!.lernzirkel?.title).toBe('Stationenarbeit Skelett')
  })

  it('erkennt Stationsblätter in einem Ordner ohne sprechenden Namen ab drei Blättern', () => {
    const drei = clusterBulkFiles([
      datei('1', 'Ernaehrung/Zirkel 7/Station 1 Fette.pdf'),
      datei('2', 'Ernaehrung/Zirkel 7/Station 2 Zucker.pdf'),
      datei('3', 'Ernaehrung/Zirkel 7/Station 3 Eiweiß.pdf'),
    ])
    expect(drei.every((c) => c.lernzirkel?.title === 'Lernzirkel Zirkel 7')).toBe(true)

    const zwei = clusterBulkFiles([
      datei('1', 'Ernaehrung/Zirkel 7/Station 1 Fette.pdf'),
      datei('2', 'Ernaehrung/Zirkel 7/Station 2 Zucker.pdf'),
    ])
    expect(zwei.every((c) => !c.lernzirkel)).toBe(true)
  })

  it('macht aus einem einzelnen Bündel keinen Lernzirkel', () => {
    const [einzeln] = clusterBulkFiles([datei('a', 'Lernzirkel Katze/Station 1.pdf')])
    expect(einzeln!.lernzirkel).toBeUndefined()
  })

  it('hält normale Arbeitsblätter und Wörter wie „Wetterstation“ aus dem Lernzirkel heraus', () => {
    const cluster = clusterBulkFiles([
      datei('a', 'Kapitel 1/Arbeitsblätter/Der Hund.pdf'),
      datei('b', 'Kapitel 1/Arbeitsblätter/Die Katze.pdf'),
      datei('c', 'Wetterstation/Messung.pdf'),
    ])
    expect(cluster.every((c) => !c.lernzirkel)).toBe(true)
  })

  it('stuft eine Handreichung im Lernzirkel nicht als Serviceband ein', () => {
    const cluster = clusterBulkFiles([
      datei('h', 'Lernzirkel Vögel/Handreichungen für die Lehrerin und den Lehrer.pdf'),
      datei('s', 'Lernzirkel Vögel/Station 1 Federn.pdf'),
    ])
    const handreichung = cluster.find((c) => c.fileRefs.includes('h'))!
    expect(handreichung.lernzirkel).toBeDefined()
    expect(handreichung.suggestions.materialType).toBe('zusatzmaterial')
  })
})
