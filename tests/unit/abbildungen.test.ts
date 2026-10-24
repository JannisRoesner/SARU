import { describe, expect, it } from 'vitest'
import {
  abbildungAusDateiname,
  bildUeberspringGrund,
  istInAbbildungsOrdner,
  parseAbbildungenManifest,
  planeAbbildungssammlung,
  sammlungsTitelAusOrdner,
  variantenStamm,
} from '../../shared/utils/abbildungen'
import { bulkUeberspringGrund, isBulkDocumentFileName } from '../../shared/utils/ai-material-formats'
import { findeBezug, parseMedienManifest } from '../../shared/utils/medien'
import {
  abbildungsOrdnerSchluessel,
  clusterBulkFiles,
  type PairingInputFile,
} from '../../server/services/bulk-upload/pairing'

function datei(pfad: string, ref = pfad): PairingInputFile {
  const fileName = pfad.split('/').pop()!
  return { sourceRef: ref, fileName, relativePath: pfad, extension: fileName.split('.').pop()!.toLowerCase() }
}

const ORDNER = 'Linder Biologie 1/Abbildungen/Cytologie'
const HAUPT = 'S012 Abb 1b - Pflanzenzelle im Lichtmikroskop.jpg'
const VARIANTE = 'S012 Abb 1b - Pflanzenzelle im Lichtmikroskop - unbeschriftet.png'

const MANIFEST = JSON.stringify({
  version: 1,
  titel: 'Linder Biologie 1 – Abbildungen Kapitel Cytologie',
  beschreibung: 'Grafiken und Fotos aus Schülerband, Arbeitsbuch und Materialheft',
  quelle: 'Linder Biologie Teil 1, Grafik-CD (Schroedel)',
  bilder: [
    {
      datei: HAUPT,
      titel: 'Pflanzenzelle im Lichtmikroskop',
      beschreibung: 'Zellwand, Vakuole, Chloroplasten und Zellkern; beschriftet',
      werk: 'Schülerband',
      seite: 12,
      abbildung: '1b',
      kapitel: 'Cytologie',
      schlagwoerter: ['Zelle', 'Pflanzenzelle', 'Lichtmikroskop'],
      beschriftet: true,
      variante_von: null,
      original: 'SCHULB/CYTOLOG/HOCH/012_1B.TIF',
    },
    { datei: VARIANTE, beschriftet: false, variante_von: HAUPT },
    { datei: 'S099 Fehlt.jpg', titel: 'Gibt es nicht' },
  ],
})

describe('Dateinamen von Abbildungen', () => {
  it('liest Seite, Abbildung und Titel aus dem Paketformat', () => {
    expect(abbildungAusDateiname(HAUPT)).toMatchObject({
      seite: '12',
      abbildung: '1b',
      titel: 'Pflanzenzelle im Lichtmikroskop',
      beschriftet: null,
    })
    expect(abbildungAusDateiname(VARIANTE)).toMatchObject({ seite: '12', beschriftet: false })
    expect(abbildungAusDateiname('Seite 12-13 - Zellteilung.png')).toMatchObject({ seite: '12–13', titel: 'Zellteilung' })
    expect(abbildungAusDateiname('Schnecke_im_Garten.jpg')).toMatchObject({ seite: null, titel: 'Schnecke im Garten' })
  })

  it('erkennt unbeschriftete Varianten am Namensende', () => {
    expect(variantenStamm('Zelle - unbeschriftet.png')).toEqual({ stamm: 'Zelle', unbeschriftet: true })
    expect(variantenStamm('Zelle (ohne Beschriftung).jpg')).toEqual({ stamm: 'Zelle', unbeschriftet: true })
    expect(variantenStamm('unbeschriftet.png')).toEqual({ stamm: 'unbeschriftet', unbeschriftet: false })
  })

  it('leitet den Sammlungstitel aus dem Ordner ab', () => {
    expect(sammlungsTitelAusOrdner(ORDNER)).toBe('Abbildungen Cytologie')
    expect(sammlungsTitelAusOrdner('Natura 7/Abbildungen')).toBe('Abbildungen Natura 7')
  })
})

describe('abbildungen.json', () => {
  it('liest das Paketformat und wandelt Typen', () => {
    const { manifest, fehler } = parseAbbildungenManifest(MANIFEST)
    expect(fehler).toEqual([])
    expect(manifest!.bilder[0]).toMatchObject({ seite: '12', schlagwoerter: ['Zelle', 'Pflanzenzelle', 'Lichtmikroskop'], varianteVon: null })
    expect(manifest!.bilder[1]!.varianteVon).toBe(HAUPT)
    expect(manifest!.bilder[2]!.varianteVon).toBeUndefined()
  })

  it('meldet kaputtes JSON, falsche Version und fehlende Liste', () => {
    expect(parseAbbildungenManifest('{ kaputt').fehler[0]).toMatch(/kein gültiges JSON/)
    expect(parseAbbildungenManifest('{"version":2,"bilder":[]}').fehler[0]).toMatch(/Version 2/)
    expect(parseAbbildungenManifest('{"version":1}').fehler[0]).toMatch(/„bilder“/)
  })

  it('überspringt Einträge ohne Datei und doppelte Einträge mit Warnung', () => {
    const { manifest, warnungen } = parseAbbildungenManifest(
      JSON.stringify({ bilder: [{ titel: 'ohne' }, { datei: 'a.png' }, { datei: 'A.png' }] }),
    )
    expect(manifest!.bilder).toHaveLength(1)
    expect(warnungen).toHaveLength(2)
  })
})

describe('Planung einer Sammlung', () => {
  const dateien = [
    { ref: 'v', dateiName: VARIANTE },
    { ref: 'h', dateiName: HAUPT },
    { ref: 'x', dateiName: 'S014 Abb 3 - Tierzelle.jpg' },
  ]

  it('gibt abbildungen.json Vorrang und ordnet Varianten zu', () => {
    const plan = planeAbbildungssammlung(dateien, parseAbbildungenManifest(MANIFEST).manifest)
    expect(plan.titel).toBe('Linder Biologie 1 – Abbildungen Kapitel Cytologie')
    expect(plan.eintraege.map((e) => e.ref)).toEqual(['h', 'v', 'x'])
    const [haupt, variante, ohne] = plan.eintraege
    expect(haupt).toMatchObject({ herkunft: 'paket', varianteVonRef: null })
    expect(haupt!.metadaten).toMatchObject({ werk: 'Schülerband', kapitel: 'Cytologie', original: 'SCHULB/CYTOLOG/HOCH/012_1B.TIF' })
    // Die Variante erbt Titel und Kapitel vom Hauptbild.
    expect(variante).toMatchObject({ varianteVonRef: 'h', herkunft: 'paket' })
    expect(variante!.metadaten).toMatchObject({ titel: 'Pflanzenzelle im Lichtmikroskop', beschriftet: false, kapitel: 'Cytologie' })
    expect(ohne).toMatchObject({ herkunft: 'dateiname', varianteVonRef: null })
    expect(ohne!.metadaten.titel).toBe('Tierzelle')
    expect(plan.ohneAngaben).toBe(1)
    expect(plan.varianten).toBe(1)
  })

  it('warnt, wenn abbildungen.json eine fehlende Datei nennt oder ein Bild keinen Eintrag hat', () => {
    const plan = planeAbbildungssammlung(dateien, parseAbbildungenManifest(MANIFEST).manifest)
    expect(plan.warnungen.some((w) => w.includes('S099 Fehlt.jpg') && w.includes('fehlt'))).toBe(true)
    expect(plan.warnungen.some((w) => w.includes('ohne Eintrag') && w.includes('Tierzelle'))).toBe(true)
  })

  it('erkennt Varianten ohne JSON am Dateinamen', () => {
    const plan = planeAbbildungssammlung(dateien, null)
    expect(plan.eintraege.find((e) => e.ref === 'v')!.varianteVonRef).toBe('h')
    expect(plan.warnungen).toEqual([])
  })

  it('verkürzt Ketten, löst Kreise auf und meldet unbekannte variante_von', () => {
    const manifest = parseAbbildungenManifest(
      JSON.stringify({
        bilder: [
          { datei: 'a.png' },
          { datei: 'b.png', variante_von: 'a.png' },
          { datei: 'c.png', variante_von: 'b.png' },
          { datei: 'd.png', variante_von: 'e.png' },
          { datei: 'e.png', variante_von: 'd.png' },
          { datei: 'f.png', variante_von: 'gibtsnicht.png' },
        ],
      }),
    ).manifest
    const plan = planeAbbildungssammlung(
      ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => ({ ref: n, dateiName: `${n}.png` })),
      manifest,
    )
    const von = Object.fromEntries(plan.eintraege.map((e) => [e.ref, e.varianteVonRef]))
    expect(von).toEqual({ a: null, b: 'a', c: 'a', d: null, e: null, f: null })
    expect(plan.warnungen.some((w) => w.includes('im Kreis'))).toBe(true)
    expect(plan.warnungen.some((w) => w.includes('gibtsnicht.png'))).toBe(true)
  })
})

describe('Bündelung im Stapel', () => {
  it('fasst alle Bilder eines Abbildungsordners zu einem Bündel zusammen', () => {
    const files = [
      datei(`${ORDNER}/${HAUPT}`, 'h'),
      datei(`${ORDNER}/${VARIANTE}`, 'v'),
      datei(`${ORDNER}/S014 Abb 3 - Tierzelle.jpg`, 'x'),
      datei(`${ORDNER}/abbildungen.json`, 'json'),
      datei('Linder Biologie 1/Abbildungen/Genetik/S080 Abb 1 - DNA.webp', 'g'),
      datei('Linder Biologie 1/Abbildungen/K1 Abbildung Zellorganellen.pdf', 'pdf'),
      datei('Linder Biologie 1/cover.jpg', 'cover'),
    ]
    const manifeste = new Map([
      [abbildungsOrdnerSchluessel(`${ORDNER}/abbildungen.json`, 'abbildungen.json'), parseAbbildungenManifest(MANIFEST)],
    ])
    const clusters = clusterBulkFiles(files, 'arbeitsblatt', { manifeste })
    const sammlungen = clusters.filter((c) => c.kind === 'abbildungssammlung')
    expect(sammlungen).toHaveLength(2)

    const cytologie = sammlungen.find((c) => c.abbildungen!.ordner === ORDNER)!
    expect(cytologie.fileRefs).toEqual(['h', 'v', 'x'])
    expect(cytologie.suggestions).toMatchObject({
      materialType: 'abbildungssammlung',
      title: 'Linder Biologie 1 – Abbildungen Kapitel Cytologie',
    })
    expect(cytologie.warnings.some((w) => w.includes('S099 Fehlt.jpg'))).toBe(true)
    expect(sammlungen.find((c) => c.stem === 'Genetik')!.suggestions.title).toBe('Abbildungen Genetik')

    // PDFs im Abbildungsordner bleiben einzelne Bild-Materialien, cover.* bleibt Cover-Kandidat.
    expect(clusters.find((c) => c.fileRefs.includes('pdf'))!.suggestions.materialType).toBe('bild')
    expect(clusters.find((c) => c.fileRefs.includes('cover'))!.kind).toBe('einzeln')
    // abbildungen.json wird kein Material.
    expect(clusters.some((c) => c.fileRefs.includes('json'))).toBe(false)
  })

  it('macht Videos im Abbildungsordner zu eigenen Video-Materialien mit Hinweis', () => {
    const clusters = clusterBulkFiles([datei(`${ORDNER}/Mitose.mp4`, 'vid'), datei(`${ORDNER}/${HAUPT}`, 'h')])
    const video = clusters.find((c) => c.fileRefs.includes('vid'))!
    expect(video.kind).toBe('einzeln')
    expect(video.suggestions.materialType).toBe('video')
    expect(video.warnings.some((w) => w.includes('nicht Teil der Abbildungssammlung'))).toBe(true)
    expect(clusters.find((c) => c.kind === 'abbildungssammlung')!.fileRefs).toEqual(['h'])
  })
})

describe('Formatfilter im Stapel', () => {
  it('lässt Bilder nur in Abbildungsordnern zu und nennt den Grund', () => {
    expect(isBulkDocumentFileName(`${ORDNER}/${HAUPT}`)).toBe(true)
    expect(isBulkDocumentFileName(`${ORDNER}/abbildungen.json`)).toBe(true)
    expect(isBulkDocumentFileName('Kopiervorlagen/Foto.jpg')).toBe(false)
    expect(isBulkDocumentFileName('Foto.jpg')).toBe(false)
    expect(isBulkDocumentFileName('Videos/Film.mp4')).toBe(true)
    expect(isBulkDocumentFileName('Videos/videos.json')).toBe(true)
    expect(isBulkDocumentFileName('cover.png')).toBe(true)
    expect(bulkUeberspringGrund('Kopiervorlagen/Foto.jpg')).toMatch(/außerhalb eines Abbildungsordners/)
    expect(bildUeberspringGrund(`${ORDNER}/012_1B.TIF`)).toMatch(/TIFF/)
    expect(bulkUeberspringGrund('setup.exe')).toBe('Kein unterstütztes Dateiformat.')
    expect(istInAbbildungsOrdner('Abbildungen.jpg')).toBe(false)
  })
})

describe('videos.json', () => {
  const VIDEOS = JSON.stringify({
    version: 1,
    videos: [
      {
        datei: 'Film - Ablauf der Mitose.mp4',
        titel: 'Ablauf der Mitose',
        beschreibung: 'Animation der Mitosephasen',
        bezug: ['Arbeitsblätter/AB6 - Film.pdf', 'Arbeitsblätter/Gibt es nicht.pdf'],
      },
      { datei: 'Fehlt.mp4' },
    ],
  })

  it('liest Einträge und meldet Fehler', () => {
    expect(parseMedienManifest(VIDEOS).eintraege[0]!.bezug).toHaveLength(2)
    expect(parseMedienManifest('{"version":3,"videos":[]}').fehler).toHaveLength(1)
  })

  it('findet Bezugsdateien auch unter einem zusätzlichen Wurzelordner', () => {
    const dateien = [{ pfad: 'Paket/Arbeitsblätter/AB6 - Film.pdf' }, { pfad: 'Paket/Andere/AB6 - Film.pdf' }]
    expect(findeBezug('Arbeitsblätter/AB6 - Film.pdf', dateien).treffer!.pfad).toBe('Paket/Arbeitsblätter/AB6 - Film.pdf')
    expect(findeBezug('AB6 - Film.pdf', dateien).mehrdeutig).toBe(true)
    expect(findeBezug('Fehlt.pdf', dateien).treffer).toBeNull()
  })

  it('übernimmt Titel und schlägt Verknüpfungen „Bezieht sich auf“ vor', () => {
    const files = [
      datei('Paket/Videos/Film - Ablauf der Mitose.mp4', 'film'),
      datei('Paket/Videos/videos.json', 'json'),
      datei('Paket/Arbeitsblätter/AB6 - Film.pdf', 'ab6'),
    ]
    const warnungen: string[] = []
    const clusters = clusterBulkFiles(files, 'arbeitsblatt', {
      medienManifeste: new Map([[abbildungsOrdnerSchluessel('Paket/Videos/videos.json', 'videos.json'), parseMedienManifest(VIDEOS)]]),
      warnungen,
    })
    const film = clusters.find((c) => c.fileRefs.includes('film'))!
    const blatt = clusters.find((c) => c.fileRefs.includes('ab6'))!
    expect(film.suggestions).toMatchObject({ title: 'Ablauf der Mitose', materialType: 'video' })
    expect(film.angabenAusPaket).toBe(true)
    expect(film.proposedLinks).toEqual([
      expect.objectContaining({ targetClusterId: blatt.clusterId, relationType: 'bezug', confidence: 'hoch' }),
    ])
    expect(film.warnings.some((w) => w.includes('Gibt es nicht.pdf'))).toBe(true)
    expect(warnungen.some((w) => w.includes('Fehlt.mp4'))).toBe(true)
    expect(clusters.some((c) => c.fileRefs.includes('json'))).toBe(false)
  })
})
