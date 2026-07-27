import { readMultipartFormData } from 'h3'
import {
  istKursarchivDatei,
  kursarchivErweiterung,
  mbzBeschreibung,
  mbzVariantenLabel,
} from '#shared/utils/moodle'
import { parseKursarchivMetadata } from '../../../services/moodle/mbz-metadata'
import { requireEditor } from '../../../utils/auth'
import { invalidInput } from '../../../utils/errors'

function dateinameOhneEndung(fileName: string): string {
  return fileName.replace(/\.(mbz|imscc)$/i, '')
}

function quelleAusMeta(meta: Awaited<ReturnType<typeof parseKursarchivMetadata>>): string {
  if (meta.archiveFormat === 'imscc') {
    return meta.cartridgeVersion ? `IMS CC ${meta.cartridgeVersion}` : 'IMS Common Cartridge'
  }
  return meta.moodleRelease ? `Moodle ${meta.moodleRelease}` : 'Moodle'
}

export default defineEventHandler(async (event) => {
  await requireEditor(event)

  const parts = await readMultipartFormData(event)
  const file = parts?.find((part) => part.filename && part.data?.length)
  if (!file?.filename || !file.data?.length) {
    throw invalidInput('Bitte eine Kursarchiv-Datei (.mbz oder .imscc) hochladen.')
  }

  if (!istKursarchivDatei(file.filename)) {
    throw invalidInput('Nur Kursarchive mit der Endung .mbz oder .imscc werden unterstützt.')
  }

  const buffer = Buffer.from(file.data)
  let meta
  try {
    meta = parseKursarchivMetadata(buffer, file.filename)
  } catch (error) {
    throw invalidInput(
      error instanceof Error
        ? error.message
        : 'Die Datei konnte nicht als Kursarchiv gelesen werden.',
    )
  }

  const format = kursarchivErweiterung(file.filename)!
  const tagNames = format === 'imscc' ? ['IMS CC'] : ['Moodle']

  return {
    meta,
    vorschlaege: {
      title: meta.fullName ?? meta.shortName ?? dateinameOhneEndung(file.filename),
      description: mbzBeschreibung(meta),
      variantLabel: mbzVariantenLabel(meta, file.filename),
      schoolYear: mbzVariantenLabel(meta, file.filename),
      tagNames,
      source: quelleAusMeta(meta),
    },
  }
})
