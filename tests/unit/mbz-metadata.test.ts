import { gzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { mbzBeschreibung, mbzVariantenLabel } from '../../shared/utils/moodle'
import {
  parseImsccMetadata,
  parseKursarchivMetadata,
  parseMbzMetadata,
} from '../../server/services/moodle/mbz-metadata'

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<moodle_backup>
  <information>
    <name>backup-moodle2-course-test</name>
    <moodle_version>2022112800</moodle_version>
    <moodle_release>4.1.1</moodle_release>
    <backup_date>1704067200</backup_date>
    <details>
      <detail>
        <type>course</type>
        <format>topics</format>
      </detail>
    </details>
  </information>
  <course>
    <course id="2">
      <shortname>PHOTO-Q1</shortname>
      <fullname>Photosynthese Oberstufe</fullname>
      <summary><![CDATA[<p>Kurs zur Photosynthese</p>]]></summary>
    </course>
  </course>
</moodle_backup>`

const IMSCC_MANIFEST = `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="course_1" xmlns="http://www.imsglobal.org/xsd/imscp_v1p1">
  <metadata>
    <schema>IMS Common Cartridge</schema>
    <schemaversion>1.1.0</schemaversion>
  </metadata>
  <organizations>
    <organization identifier="org_1" structure="rooted-hierarchy">
      <item identifier="item_1">
        <title>Photosynthese OpenLearning</title>
      </item>
    </organization>
  </organizations>
</manifest>`

const IMSCC_LOM_MANIFEST = `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="course_1" xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
  xmlns:lomimscc="http://ltsc.ieee.org/xsd/LOM/manifest">
  <metadata>
    <schema>IMS Common Cartridge</schema>
    <schemaversion>1.3.0</schemaversion>
    <lomimscc:lom>
      <lomimscc:general>
        <lomimscc:title>
          <lomimscc:string language="en">3D Druck 10 - 13 2025/2026</lomimscc:string>
        </lomimscc:title>
        <lomimscc:description>
          <lomimscc:string language="en">Einführung in den 3D-Druck &amp; Modellierung</lomimscc:string>
        </lomimscc:description>
      </lomimscc:general>
    </lomimscc:lom>
  </metadata>
</manifest>`

function gzippedSample(): Buffer {
  return Buffer.from(gzipSync(new TextEncoder().encode(SAMPLE_XML)))
}

function zippedImsccSample(): Buffer {
  return Buffer.from(
    zipSync({
      'imsmanifest.xml': new TextEncoder().encode(IMSCC_MANIFEST),
    }),
  )
}

function zippedImsccLomSample(): Buffer {
  return Buffer.from(
    zipSync({
      'imsmanifest.xml': new TextEncoder().encode(IMSCC_LOM_MANIFEST),
    }),
  )
}

describe('parseMbzMetadata', () => {
  it('liest Kurstitel und Moodle-Version aus gzip-MBZ', () => {
    const meta = parseMbzMetadata(gzippedSample(), 'photosynthese.mbz')
    expect(meta.archiveFormat).toBe('mbz')
    expect(meta.fullName).toBe('Photosynthese Oberstufe')
    expect(meta.shortName).toBe('PHOTO-Q1')
    expect(meta.moodleRelease).toBe('4.1.1')
    expect(meta.courseFormat).toBe('topics')
    expect(meta.backupDate).toBe('2024-01-01')
  })

  it('baut Beschreibung und Variantenlabel', () => {
    const meta = parseMbzMetadata(gzippedSample(), 'kurs.mbz')
    expect(mbzVariantenLabel(meta)).toBe('2023/24')
    expect(mbzBeschreibung(meta)).toContain('Moodle 4.1.1')
    expect(mbzBeschreibung(meta)).toContain('Wiederherstellen')
  })

  it('lehnt ungültige Dateien ab', () => {
    expect(() => parseMbzMetadata(Buffer.from('kein backup'))).toThrow(/Kein gültiges Moodle-Backup/)
  })
})

describe('parseImsccMetadata', () => {
  it('liest Kurstitel und Schemaversion aus IMSCC-ZIP', () => {
    const meta = parseImsccMetadata(zippedImsccSample(), 'photosynthese.imscc')
    expect(meta.archiveFormat).toBe('imscc')
    expect(meta.fullName).toBe('Photosynthese OpenLearning')
    expect(meta.cartridgeVersion).toBe('1.1.0')
    expect(meta.moodleRelease).toBeNull()
    expect(meta.backupDate).toBeNull()
  })

  it('baut Beschreibung und Variantenlabel für IMSCC', () => {
    const meta = parseImsccMetadata(zippedImsccSample(), 'kurs.imscc')
    expect(mbzVariantenLabel(meta)).toBe('Photosynthese OpenLearning')
    expect(mbzBeschreibung(meta)).toContain('IMS Common Cartridge 1.1.0')
    expect(mbzBeschreibung(meta)).toContain('.imscc')
  })

  it('lehnt ungültige Dateien ab', () => {
    expect(() => parseImsccMetadata(Buffer.from('kein cartridge'))).toThrow(
      /Kein gültiges IMS Common Cartridge/,
    )
  })

  it('extrahiert Klartext aus LOM lomimscc:string-Wrappern', () => {
    const meta = parseImsccMetadata(zippedImsccLomSample(), '3d-druck.imscc')
    expect(meta.fullName).toBe('3D Druck 10 - 13 2025/2026')
    expect(meta.summary).toBe('Einführung in den 3D-Druck & Modellierung')
    expect(meta.cartridgeVersion).toBe('1.3.0')
    expect(mbzVariantenLabel(meta)).toBe('3D Druck 10 - 13 2025/2026')
  })
})

describe('parseKursarchivMetadata', () => {
  it('erkennt Format anhand des Dateinamens', () => {
    const mbz = parseKursarchivMetadata(gzippedSample(), 'kurs.mbz')
    expect(mbz.archiveFormat).toBe('mbz')

    const imscc = parseKursarchivMetadata(zippedImsccSample(), 'kurs.imscc')
    expect(imscc.archiveFormat).toBe('imscc')
  })
})
