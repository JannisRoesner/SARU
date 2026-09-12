import { describe, expect, it } from 'vitest'
import { guessMaterialType } from '../../shared/utils/material-type-guess'
import {
  clusterBulkFiles,
  clusterTitleFromStem,
  detectFolderRole,
} from '../../server/services/bulk-upload/pairing'

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
})
