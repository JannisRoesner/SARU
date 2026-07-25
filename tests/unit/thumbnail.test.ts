import { describe, expect, it } from 'vitest'
import { isOfficeFile, OFFICE_FILE_EXTENSIONS } from '../../shared/utils/office-files'
import { isThumbnailCandidate } from '../../shared/utils/thumbnail-candidate'
import { canHaveThumbnail } from '../../server/services/thumbnail.service'

describe('office file detection', () => {
  it('erkennt gängige Office-Endungen', () => {
    for (const ext of OFFICE_FILE_EXTENSIONS) {
      expect(isOfficeFile(`datei.${ext}`)).toBe(true)
    }
  })

  it('erkennt Office-Mime-Typen ohne Endung', () => {
    expect(
      isOfficeFile(
        'ohne-endung',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ),
    ).toBe(true)
  })

  it('lehnt Nicht-Office ab', () => {
    expect(isOfficeFile('bild.png', 'image/png')).toBe(false)
    expect(isOfficeFile('dokument.pdf', 'application/pdf')).toBe(false)
  })
})

describe('thumbnail candidates', () => {
  it('schließt PDF, Bilder und Office ein', () => {
    expect(isThumbnailCandidate('application/pdf', 'a.pdf')).toBe(true)
    expect(isThumbnailCandidate('image/jpeg', 'foto.jpg')).toBe(true)
    expect(isThumbnailCandidate(null, 'arbeit.docx')).toBe(true)
    expect(isThumbnailCandidate('application/vnd.ms-excel', 'tabelle.xls')).toBe(true)
  })

  it('schließt SVG und unbekannte Typen aus', () => {
    expect(isThumbnailCandidate('image/svg+xml', 'icon.svg')).toBe(false)
    expect(isThumbnailCandidate('application/zip', 'archiv.zip')).toBe(false)
  })

  it('entspricht canHaveThumbnail auf dem Server', () => {
    expect(canHaveThumbnail('application/pdf', 'a.pdf')).toBe(true)
    expect(canHaveThumbnail(null, 'folien.pptx')).toBe(true)
    expect(canHaveThumbnail('application/octet-stream', 'bin.exe')).toBe(false)
  })
})
