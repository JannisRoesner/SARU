import { describe, expect, it } from 'vitest'
import { resolveBulkGradeLevels } from '../../shared/utils/bulk-upload'
import { guessMaterialType } from '../../shared/utils/material-type-guess'
import {
  clusterBulkFiles,
  clusterTitleFromStem,
  detectFolderRole,
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
})
