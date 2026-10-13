import { createReadStream } from 'node:fs'
import { open, type FileHandle } from 'node:fs/promises'
import { Readable } from 'node:stream'
import * as zlib from 'node:zlib'
import { appError } from '../../utils/errors'

/**
 * Schlanker ZIP-Schreiber und -Leser für Sicherungen.
 *
 * fflate schreibt kein ZIP64 – eine vollständige Sicherung überschreitet aber
 * schnell 4 GB. Dateien werden unkomprimiert gestreamt (PDF und Office sind
 * bereits komprimiert), kleine Puffer wie die JSON-Daten werden deflatiert.
 */

const SIG_LOKAL = 0x04034b50
const SIG_DESKRIPTOR = 0x08074b50
const SIG_ZENTRAL = 0x02014b50
const SIG_ENDE = 0x06054b50
const SIG_ENDE64 = 0x06064b50
const SIG_LOCATOR64 = 0x07064b50

const MAX32 = 0xffffffff
const MAX16 = 0xffff

const FLAG_DESKRIPTOR = 0x0008
const FLAG_UTF8 = 0x0800

// --- CRC-32 --------------------------------------------------------------------

let crcTabelle: Uint32Array | null = null

function crcSoftware(daten: Uint8Array, start: number): number {
  if (!crcTabelle) {
    crcTabelle = new Uint32Array(256)
    for (let n = 0; n < 256; n += 1) {
      let c = n
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTabelle[n] = c >>> 0
    }
  }
  let crc = (start ^ MAX32) >>> 0
  for (let i = 0; i < daten.length; i += 1) {
    crc = crcTabelle[(crc ^ daten[i]!) & 0xff]! ^ (crc >>> 8)
  }
  return (crc ^ MAX32) >>> 0
}

/** Node ≥ 22.2 rechnet CRC-32 nativ; ältere Versionen fallen auf die Tabelle zurück. */
export function crc32(daten: Uint8Array, start = 0): number {
  const nativ = (zlib as unknown as { crc32?: (d: Uint8Array, v?: number) => number }).crc32
  return nativ ? nativ(daten, start) >>> 0 : crcSoftware(daten, start)
}

// --- Schreiben -------------------------------------------------------------------

export type ZipQuelle =
  /** Kleiner Inhalt im Speicher – wird komprimiert. */
  | { name: string; daten: Buffer }
  /** Datei auf der Platte – wird unkomprimiert gestreamt. */
  | { name: string; datei: string; groesse: number }

interface ZentralEintrag {
  name: Buffer
  flags: number
  methode: number
  crc: number
  komprimiert: number
  groesse: number
  offset: number
}

function dosZeit(datum: Date): { zeit: number; tag: number } {
  const jahr = Math.max(1980, datum.getFullYear())
  return {
    zeit: (datum.getHours() << 11) | (datum.getMinutes() << 5) | Math.floor(datum.getSeconds() / 2),
    tag: ((jahr - 1980) << 9) | ((datum.getMonth() + 1) << 5) | datum.getDate(),
  }
}

function zip64Extra(werte: number[]): Buffer {
  const extra = Buffer.alloc(4 + werte.length * 8)
  extra.writeUInt16LE(0x0001, 0)
  extra.writeUInt16LE(werte.length * 8, 2)
  werte.forEach((wert, i) => extra.writeBigUInt64LE(BigInt(wert), 4 + i * 8))
  return extra
}

function lokalerKopf(
  name: Buffer,
  flags: number,
  methode: number,
  crc: number,
  komprimiert: number,
  groesse: number,
  zeit: { zeit: number; tag: number },
  zip64 = groesse >= MAX32 || komprimiert >= MAX32,
): Buffer {
  const extra = zip64 ? zip64Extra([groesse, komprimiert]) : Buffer.alloc(0)
  const kopf = Buffer.alloc(30)
  kopf.writeUInt32LE(SIG_LOKAL, 0)
  kopf.writeUInt16LE(zip64 ? 45 : 20, 4)
  kopf.writeUInt16LE(flags, 6)
  kopf.writeUInt16LE(methode, 8)
  kopf.writeUInt16LE(zeit.zeit, 10)
  kopf.writeUInt16LE(zeit.tag, 12)
  kopf.writeUInt32LE(crc, 14)
  kopf.writeUInt32LE(zip64 ? MAX32 : komprimiert, 18)
  kopf.writeUInt32LE(zip64 ? MAX32 : groesse, 22)
  kopf.writeUInt16LE(name.length, 26)
  kopf.writeUInt16LE(extra.length, 28)
  return Buffer.concat([kopf, name, extra])
}

function zentralerKopf(e: ZentralEintrag, zeit: { zeit: number; tag: number }): Buffer {
  const werte: number[] = []
  if (e.groesse >= MAX32) werte.push(e.groesse)
  if (e.komprimiert >= MAX32) werte.push(e.komprimiert)
  if (e.offset >= MAX32) werte.push(e.offset)
  const extra = werte.length ? zip64Extra(werte) : Buffer.alloc(0)

  const kopf = Buffer.alloc(46)
  kopf.writeUInt32LE(SIG_ZENTRAL, 0)
  kopf.writeUInt16LE(45, 4)
  kopf.writeUInt16LE(werte.length ? 45 : 20, 6)
  kopf.writeUInt16LE(e.flags, 8)
  kopf.writeUInt16LE(e.methode, 10)
  kopf.writeUInt16LE(zeit.zeit, 12)
  kopf.writeUInt16LE(zeit.tag, 14)
  kopf.writeUInt32LE(e.crc, 16)
  kopf.writeUInt32LE(Math.min(e.komprimiert, MAX32), 20)
  kopf.writeUInt32LE(Math.min(e.groesse, MAX32), 24)
  kopf.writeUInt16LE(e.name.length, 28)
  kopf.writeUInt16LE(extra.length, 30)
  // Kommentar, Datenträger, interne Attribute: 0
  kopf.writeUInt32LE(0, 38)
  kopf.writeUInt32LE(Math.min(e.offset, MAX32), 42)
  return Buffer.concat([kopf, e.name, extra])
}

function ende(anzahl: number, cdGroesse: number, cdOffset: number): Buffer {
  const teile: Buffer[] = []
  const zip64 = anzahl >= MAX16 || cdGroesse >= MAX32 || cdOffset >= MAX32
  if (zip64) {
    const ende64 = Buffer.alloc(56)
    ende64.writeUInt32LE(SIG_ENDE64, 0)
    ende64.writeBigUInt64LE(44n, 4)
    ende64.writeUInt16LE(45, 12)
    ende64.writeUInt16LE(45, 14)
    ende64.writeBigUInt64LE(BigInt(anzahl), 24)
    ende64.writeBigUInt64LE(BigInt(anzahl), 32)
    ende64.writeBigUInt64LE(BigInt(cdGroesse), 40)
    ende64.writeBigUInt64LE(BigInt(cdOffset), 48)

    const locator = Buffer.alloc(20)
    locator.writeUInt32LE(SIG_LOCATOR64, 0)
    locator.writeBigUInt64LE(BigInt(cdOffset + cdGroesse), 8)
    locator.writeUInt32LE(1, 16)
    teile.push(ende64, locator)
  }
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(SIG_ENDE, 0)
  eocd.writeUInt16LE(Math.min(anzahl, MAX16), 8)
  eocd.writeUInt16LE(Math.min(anzahl, MAX16), 10)
  eocd.writeUInt32LE(Math.min(cdGroesse, MAX32), 12)
  eocd.writeUInt32LE(Math.min(cdOffset, MAX32), 16)
  teile.push(eocd)
  return Buffer.concat(teile)
}

async function* zipErzeugen(quellen: Iterable<ZipQuelle> | AsyncIterable<ZipQuelle>): AsyncGenerator<Buffer> {
  const zeit = dosZeit(new Date())
  const zentral: ZentralEintrag[] = []
  let offset = 0

  for await (const quelle of quellen) {
    const name = Buffer.from(quelle.name, 'utf8')

    if ('daten' in quelle) {
      const komprimiert = zlib.deflateRawSync(quelle.daten)
      const eintrag: ZentralEintrag = {
        name,
        flags: FLAG_UTF8,
        methode: 8,
        crc: crc32(quelle.daten),
        komprimiert: komprimiert.length,
        groesse: quelle.daten.length,
        offset,
      }
      const kopf = lokalerKopf(name, eintrag.flags, 8, eintrag.crc, eintrag.komprimiert, eintrag.groesse, zeit)
      yield kopf
      yield komprimiert
      offset += kopf.length + komprimiert.length
      zentral.push(eintrag)
      continue
    }

    // Die Prüfsumme entsteht erst beim Lesen → Datendeskriptor; der lokale Kopf
    // trägt dann laut Spezifikation Nullen. Das ZIP64-Extra kündigt 8-Byte-Größen
    // im Deskriptor an.
    const flags = FLAG_UTF8 | FLAG_DESKRIPTOR
    const zip64 = quelle.groesse >= MAX32
    const kopf = lokalerKopf(name, flags, 0, 0, 0, 0, zeit, zip64)
    yield kopf

    let crc = 0
    let gelesen = 0
    for await (const chunk of createReadStream(quelle.datei)) {
      const teil = chunk as Buffer
      crc = crc32(teil, crc)
      gelesen += teil.length
      yield teil
    }
    if (gelesen !== quelle.groesse) {
      throw new Error(`Datei hat sich während der Sicherung verändert: ${quelle.name}`)
    }

    const deskriptor = Buffer.alloc(zip64 ? 24 : 16)
    deskriptor.writeUInt32LE(SIG_DESKRIPTOR, 0)
    deskriptor.writeUInt32LE(crc, 4)
    if (zip64) {
      deskriptor.writeBigUInt64LE(BigInt(gelesen), 8)
      deskriptor.writeBigUInt64LE(BigInt(gelesen), 16)
    } else {
      deskriptor.writeUInt32LE(gelesen, 8)
      deskriptor.writeUInt32LE(gelesen, 12)
    }
    yield deskriptor

    zentral.push({ name, flags, methode: 0, crc, komprimiert: gelesen, groesse: gelesen, offset })
    offset += kopf.length + gelesen + deskriptor.length
  }

  const cdOffset = offset
  let cdGroesse = 0
  for (const eintrag of zentral) {
    const kopf = zentralerKopf(eintrag, zeit)
    cdGroesse += kopf.length
    yield kopf
  }
  yield ende(zentral.length, cdGroesse, cdOffset)
}

/** Streamt die Quellen als ZIP; Backpressure regelt der Readable-Stream. */
export function zipSchreiben(quellen: Iterable<ZipQuelle> | AsyncIterable<ZipQuelle>): Readable {
  return Readable.from(zipErzeugen(quellen), { objectMode: false })
}

// --- Lesen -----------------------------------------------------------------------

export interface ZipEintragInfo {
  name: string
  methode: number
  crc: number
  komprimiert: number
  groesse: number
  offsetLokal: number
}

const utf8Streng = new TextDecoder('utf-8', { fatal: true })

function nameDekodieren(roh: Buffer, flags: number): string {
  if (flags & FLAG_UTF8) return roh.toString('utf8')
  // Manche Packprogramme setzen das UTF-8-Flag nicht, schreiben aber UTF-8.
  try {
    return utf8Streng.decode(roh)
  } catch {
    return roh.toString('latin1')
  }
}

function kaputt(details: string) {
  return appError('IMPORT_FEHLER', `Die ZIP-Datei ist beschädigt oder kein gültiges Archiv (${details}).`)
}

async function lesen(datei: FileHandle, position: number, laenge: number): Promise<Buffer> {
  const puffer = Buffer.alloc(laenge)
  const { bytesRead } = await datei.read(puffer, 0, laenge, position)
  if (bytesRead !== laenge) throw kaputt('unerwartetes Dateiende')
  return puffer
}

/**
 * Liest das Inhaltsverzeichnis eines ZIP-Archivs von der Platte, ohne die
 * Datei in den Speicher zu laden. Einzelne Einträge werden bei Bedarf gestreamt.
 */
export class ZipLeser {
  private constructor(
    readonly pfad: string,
    readonly eintraege: Map<string, ZipEintragInfo>,
  ) {}

  static async oeffnen(pfad: string): Promise<ZipLeser> {
    const datei = await open(pfad, 'r')
    try {
      const { size } = await datei.stat()
      if (size < 22) throw kaputt('zu klein')

      const suchLaenge = Math.min(size, 22 + MAX16)
      const schwanz = await lesen(datei, size - suchLaenge, suchLaenge)
      let eocd = -1
      for (let i = schwanz.length - 22; i >= 0; i -= 1) {
        if (schwanz.readUInt32LE(i) === SIG_ENDE) {
          eocd = i
          break
        }
      }
      if (eocd < 0) throw kaputt('kein Inhaltsverzeichnis')

      let anzahl = schwanz.readUInt16LE(eocd + 10)
      let cdGroesse = schwanz.readUInt32LE(eocd + 12)
      let cdOffset = schwanz.readUInt32LE(eocd + 16)

      const locatorPos = size - suchLaenge + eocd - 20
      if (locatorPos >= 0) {
        const locator = await lesen(datei, locatorPos, 20)
        if (locator.readUInt32LE(0) === SIG_LOCATOR64) {
          const ende64Pos = Number(locator.readBigUInt64LE(8))
          const ende64 = await lesen(datei, ende64Pos, 56)
          if (ende64.readUInt32LE(0) !== SIG_ENDE64) throw kaputt('ZIP64-Ende fehlt')
          anzahl = Number(ende64.readBigUInt64LE(32))
          cdGroesse = Number(ende64.readBigUInt64LE(40))
          cdOffset = Number(ende64.readBigUInt64LE(48))
        }
      }
      if (cdOffset + cdGroesse > size) throw kaputt('Inhaltsverzeichnis außerhalb der Datei')

      const cd = await lesen(datei, cdOffset, cdGroesse)
      const eintraege = new Map<string, ZipEintragInfo>()
      let pos = 0
      for (let i = 0; i < anzahl; i += 1) {
        if (pos + 46 > cd.length || cd.readUInt32LE(pos) !== SIG_ZENTRAL) throw kaputt('Eintrag ungültig')
        const flags = cd.readUInt16LE(pos + 8)
        const methode = cd.readUInt16LE(pos + 10)
        const crc = cd.readUInt32LE(pos + 16)
        let komprimiert = cd.readUInt32LE(pos + 20)
        let groesse = cd.readUInt32LE(pos + 24)
        const nameLaenge = cd.readUInt16LE(pos + 28)
        const extraLaenge = cd.readUInt16LE(pos + 30)
        const kommentarLaenge = cd.readUInt16LE(pos + 32)
        let offsetLokal = cd.readUInt32LE(pos + 42)

        const name = nameDekodieren(cd.subarray(pos + 46, pos + 46 + nameLaenge), flags)
        const extra = cd.subarray(pos + 46 + nameLaenge, pos + 46 + nameLaenge + extraLaenge)

        // ZIP64-Felder stehen nur für die Werte, die im Kopf auf 0xFFFFFFFF stehen.
        let e = 0
        while (e + 4 <= extra.length) {
          const id = extra.readUInt16LE(e)
          const laenge = extra.readUInt16LE(e + 2)
          if (id === 0x0001) {
            let f = e + 4
            if (groesse === MAX32) {
              groesse = Number(extra.readBigUInt64LE(f))
              f += 8
            }
            if (komprimiert === MAX32) {
              komprimiert = Number(extra.readBigUInt64LE(f))
              f += 8
            }
            if (offsetLokal === MAX32) offsetLokal = Number(extra.readBigUInt64LE(f))
          }
          e += 4 + laenge
        }

        if (flags & 0x0001) throw appError('IMPORT_FEHLER', 'Verschlüsselte ZIP-Dateien werden nicht unterstützt.')
        if (!name.endsWith('/')) {
          eintraege.set(name, { name, methode, crc, komprimiert, groesse, offsetLokal })
        }
        pos += 46 + nameLaenge + extraLaenge + kommentarLaenge
      }

      return new ZipLeser(pfad, eintraege)
    } finally {
      await datei.close()
    }
  }

  /** Stream des entpackten Inhalts. Prüft Länge und CRC beim Lesen. */
  async stream(eintrag: ZipEintragInfo): Promise<Readable> {
    if (eintrag.methode !== 0 && eintrag.methode !== 8) {
      throw appError('IMPORT_FEHLER', `Kompressionsverfahren ${eintrag.methode} wird nicht unterstützt (${eintrag.name}).`)
    }
    const datei = await open(this.pfad, 'r')
    let start: number
    try {
      const kopf = await lesen(datei, eintrag.offsetLokal, 30)
      if (kopf.readUInt32LE(0) !== SIG_LOKAL) throw kaputt(`lokaler Kopf fehlt bei ${eintrag.name}`)
      start = eintrag.offsetLokal + 30 + kopf.readUInt16LE(26) + kopf.readUInt16LE(28)
    } finally {
      await datei.close()
    }

    const roh =
      eintrag.komprimiert > 0
        ? createReadStream(this.pfad, { start, end: start + eintrag.komprimiert - 1 })
        : Readable.from([])
    const quelle = eintrag.methode === 8 ? roh.pipe(zlib.createInflateRaw()) : roh
    if (eintrag.methode === 8) roh.on('error', (fehler) => quelle.destroy(fehler))

    const erwartet = eintrag.groesse
    const erwarteteCrc = eintrag.crc
    async function* pruefen() {
      let crc = 0
      let gelesen = 0
      for await (const chunk of quelle) {
        const teil = chunk as Buffer
        gelesen += teil.length
        // Schutz vor ZIP-Bomben: nie mehr liefern als angekündigt.
        if (gelesen > erwartet) throw kaputt(`${eintrag.name} ist größer als angegeben`)
        crc = crc32(teil, crc)
        yield teil
      }
      if (gelesen !== erwartet) throw kaputt(`${eintrag.name} ist unvollständig`)
      if (crc !== erwarteteCrc) throw kaputt(`Prüfsumme von ${eintrag.name} stimmt nicht`)
    }
    return Readable.from(pruefen(), { objectMode: false })
  }

  async puffer(eintrag: ZipEintragInfo, maxBytes: number): Promise<Buffer> {
    if (eintrag.groesse > maxBytes) {
      throw appError('IMPORT_FEHLER', `${eintrag.name} ist zu groß, um ihn einzulesen.`)
    }
    const teile: Buffer[] = []
    for await (const chunk of await this.stream(eintrag)) teile.push(chunk as Buffer)
    return Buffer.concat(teile)
  }
}
