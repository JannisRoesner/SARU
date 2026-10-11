import type { MaterialType } from '#shared/types/domain'
import { guessMaterialType } from '#shared/utils/material-type-guess'
import type { BulkFileRole, BulkFolderRole, BulkLernzirkelRef } from '#shared/utils/bulk-upload'
import type { BulkClusterKind, BulkUploadDetectedCluster } from './types'

const OFFICE_EXTENSIONS = new Set(['doc', 'docx', 'odt', 'ppt', 'pptx', 'odp', 'xls', 'xlsx', 'ods'])
const SOLUTION_EXTENSIONS = new Set(['pdf'])
/** Lehrkraft-Zubehör eines Lernzirkels (kein Schülerblatt). */
const LERNZIRKEL_ZUBEHOER = /handreichung|hinweise fur die lehr|materialliste|kontrollliste|aufbauplan/
const BUCH_TYPEN = new Set<MaterialType>(['lehrwerk', 'serviceband', 'loesungsbuch'])

const STOP_TOKENS = new Set([
  'versuch',
  'versuche',
  'gfb',
  'abbsb',
  'abbsvb',
  'abb',
  'anhang',
  'kap',
  'kopiervorlage',
  'kopiervorlagen',
  'klausur',
  'klausuren',
  'arbeitsblatt',
  'abbildung',
  'abbildungen',
  'loesung',
  'losung',
  'musterloesung',
  'wd01',
  'wd02',
  'wd03',
  'wd04',
  'bio',
  'che',
  'phy',
  'mat',
])

export interface PairingInputFile {
  sourceRef: string
  fileName: string
  relativePath?: string | null
  extension: string
}

function fold(value: string): string {
  return value
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
}

/** Endung im Dateinamen, die eine Lösungsdatei kennzeichnet („… - Lösung“, „…_lsg“). */
const SOLUTION_SUFFIX = /[\s._-]*(?:(?:muster)?(?:loesung|losung)(?:en)?|lsg)$/

/** Stamm ohne Lösungs-Endung (gefaltet); bleibt unverändert, wenn dann nichts übrig wäre. */
function solutionBaseStem(stem: string): string {
  const folded = fold(stem)
  const base = folded.replace(SOLUTION_SUFFIX, '')
  return base ? base : folded
}

function hasSolutionSuffix(stem: string): boolean {
  const folded = fold(stem)
  return SOLUTION_SUFFIX.test(folded) && folded.replace(SOLUTION_SUFFIX, '') !== ''
}

/**
 * Mehrere Fassungen desselben Materials: `<Titel> - Fassung <Bezeichnung> (<Code>).<Endung>`,
 * z. B. „Hunde und Katzen - Fassung Handbuch (LH 1.1).pdf“ neben „… - Fassung Assistent (S040).pdf“.
 */
const FASSUNG = /^(.*?)\s+[-–—]\s+Fassung\s+(.+?)(?:\s+\(([^)]*)\))?$/i

export function fassungInfo(stem: string): { base: string; label: string } | null {
  const match = FASSUNG.exec(stem.trim())
  const base = match?.[1]?.trim()
  const label = match?.[2]?.trim()
  return base && label ? { base, label } : null
}

/** Bezeichnung der Fassung aus dem Dateinamen („Handbuch“), sonst `null`. */
export function fassungLabel(fileName: string): string | null {
  return fassungInfo(basename(fileName).replace(/\.[^.]+$/, ''))?.label ?? null
}

function posixPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+/g, '/')
}

function basename(path: string): string {
  return posixPath(path).split('/').pop() ?? path
}

function parentFolder(path: string): string {
  const parts = posixPath(path).split('/').filter(Boolean)
  if (parts.length < 2) return ''
  return parts[parts.length - 2] ?? ''
}

function stemOf(fileName: string): string {
  return basename(fileName).replace(/\.[^.]+$/, '')
}

export function detectFolderRole(
  relativePath: string | null | undefined,
  fileName: string,
): BulkFolderRole {
  const path = fold(posixPath(relativePath || fileName))
  const folder = fold(parentFolder(relativePath || fileName))
  const haystack = `${folder} ${path}`

  if (/kopiervorlage/.test(haystack)) return 'kopiervorlagen'
  if (/klausur|_ka_/.test(haystack)) return 'klausuren'
  if (/abbildung/.test(haystack) || /abbsb|abbsvb/.test(haystack)) return 'abbildungen'
  if (/(_gfb_|gefaehrdung|gefahrdung)/.test(haystack)) return 'gefaehrdungsbeurteilung'
  if (
    /(^|\/| )versuche?(\/|$| )/.test(` ${haystack} `) ||
    /^versuch_/.test(fold(basename(fileName)))
  ) {
    return 'versuche'
  }
  if (detectLernzirkelOrdner(relativePath, fileName)) return 'lernzirkel'
  return 'sonstiges'
}

/** Ordnername, der eine Stationenarbeit kennzeichnet („Lernzirkel Katze“, „Stationenlernen“). */
const LERNZIRKEL_ORDNER =
  /lernzirkel|lernstation|(?:^|[^a-z])stationen(?:arbeit|lernen|lauf|betrieb)?(?:[^a-z]|$)|lernwerkstatt|zirkeltraining/
/** Blatt einer Station: „Station 3 – …“, „Station A“, „Ergänzungsstation“, „Pflichtstation 2“. */
const STATIONS_DATEI = /(?:^|[\s_.-])(?:erganzungs|pflicht|wahl|zusatz)?station\s*(?:[0-9]{1,2}|[a-z])(?:[\s_.:-]|$)/
/** Ab so vielen Stationsblättern in einem Ordner gilt dieser auch ohne sprechenden Namen als Lernzirkel. */
const MIN_STATIONS_DATEIEN = 3

function ordnerSegmente(path: string): string[] {
  const parts = posixPath(path).split('/').filter(Boolean)
  return parts.slice(0, -1)
}

function aufraeumenOrdnername(name: string): string {
  return name
    .replace(/^\d{1,3}[\s._-]+/, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Lernzirkel, zu dem die Datei per Ordnerstruktur gehört: der tiefste Ordner mit „Lernzirkel“/„Stationen“
 * im Namen, sonst `null`. Ein Ordner ohne eigenes Thema („Stationenarbeit“) bekommt den Elternordner
 * als Thema. Der Dateiname allein reicht hier nicht – das prüft `markiereLernzirkel` pro Ordner.
 */
export function detectLernzirkelOrdner(
  relativePath: string | null | undefined,
  fileName: string,
): BulkLernzirkelRef | null {
  const segmente = ordnerSegmente(relativePath || fileName)
  for (let i = segmente.length - 1; i >= 0; i -= 1) {
    const segment = segmente[i]!
    if (!LERNZIRKEL_ORDNER.test(fold(segment))) continue
    let titel = aufraeumenOrdnername(segment)
    // „Stationenarbeit“ allein sagt nichts – das Thema steht im Ordner darüber.
    if (/^(lernzirkel|stationen\w*|lernstationen)$/i.test(titel) && i > 0) {
      titel = `${titel} ${aufraeumenOrdnername(segmente[i - 1]!)}`
    }
    return { id: fold(segmente.slice(0, i + 1).join('/')), title: titel }
  }
  return null
}

/**
 * Setzt `cluster.lernzirkel` für alle Bündel, die zu einer Stationenarbeit gehören:
 * Ordner mit „Lernzirkel“ im Namen, oder ein Ordner mit mindestens drei Stationsblättern.
 * Ein einzelnes Bündel macht noch keinen Lernzirkel.
 */
function markiereLernzirkel(
  clusters: BulkUploadDetectedCluster[],
  pfadNachRef: ReadonlyMap<string, string>,
): void {
  const proOrdner = new Map<string, BulkUploadDetectedCluster[]>()
  const nachOrdnername = new Map<string, BulkLernzirkelRef>()

  for (const cluster of clusters) {
    const pfad = pfadNachRef.get(cluster.fileRefs[0] ?? '') ?? ''
    const ref = detectLernzirkelOrdner(pfad, basename(pfad))
    if (ref) {
      cluster.lernzirkel = ref
      continue
    }
    const stationsBlatt = cluster.fileRefs.some((fileRef) =>
      STATIONS_DATEI.test(fold(stemOf(pfadNachRef.get(fileRef) ?? ''))),
    )
    if (!stationsBlatt) continue
    const segmente = ordnerSegmente(pfad)
    if (!segmente.length) continue
    const id = fold(segmente.join('/'))
    const liste = proOrdner.get(id)
    if (liste) liste.push(cluster)
    else proOrdner.set(id, [cluster])
    nachOrdnername.set(id, {
      id,
      title: `Lernzirkel ${aufraeumenOrdnername(segmente[segmente.length - 1]!)}`,
    })
  }

  for (const [id, liste] of proOrdner) {
    if (liste.length < MIN_STATIONS_DATEIEN) continue
    for (const cluster of liste) cluster.lernzirkel = nachOrdnername.get(id)!
  }

  // Ein Lernzirkel aus nur einem Bündel ist keiner.
  const anzahl = new Map<string, number>()
  for (const cluster of clusters) {
    if (cluster.lernzirkel) anzahl.set(cluster.lernzirkel.id, (anzahl.get(cluster.lernzirkel.id) ?? 0) + 1)
  }
  for (const cluster of clusters) {
    if (cluster.lernzirkel && (anzahl.get(cluster.lernzirkel.id) ?? 0) < 2) delete cluster.lernzirkel
  }
}

export function clusterTitleFromStem(stem: string, folderRole: BulkFolderRole): string {
  let s = stem
  s = s.replace(/^wd\d+_[A-Za-z0-9]+_/i, '')
  s = s.replace(
    /^(?:bio|che|phy|mat|deu|eng|inf)_[a-z0-9]+_s\d+_(ab|ka)_/i,
    (_, kind: string) => (kind.toLowerCase() === 'ka' ? 'Klausur ' : 'AB '),
  )
  s = s.replace(/_gfb_/i, '_')
  s = s.replace(/^gfb_/i, '')
  s = s.replace(/^versuch_/i, '')
  s = s.replace(/AbbS[vV]?B_/g, '')
  s = s.replace(/Kap(\d+)_(\d+)_/i, 'Kap. $1.$2 ')
  s = s.replace(/^\d{2,4}[-_ ]+/, '')
  s = s.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!s) s = stem.replace(/[-_]+/g, ' ').trim()
  s = s.charAt(0).toUpperCase() + s.slice(1)

  if (folderRole === 'versuche' && !/^versuch\b/i.test(s)) s = `Versuch ${s}`
  if (folderRole === 'abbildungen' && !/^abbildung/i.test(s)) s = `Abbildungen ${s}`
  if (folderRole === 'gefaehrdungsbeurteilung' && !/^gef/i.test(s)) {
    s = `Gefährdungsbeurteilung ${s}`
  }
  return s
}

function materialTypeForCluster(
  folderRole: BulkFolderRole,
  fileNames: string[],
  fallback: MaterialType,
): MaterialType {
  const fromNames = fileNames.map((name) => guessMaterialType(name, fallback))
  const specific = fromNames.find((type) =>
    ['gefaehrdungsbeurteilung', 'klausur', 'bild', 'musterloesung', 'praesentation'].includes(
      type,
    ),
  )
  if (specific && specific !== 'musterloesung') return specific
  if (fromNames.some((type) => type === 'arbeitsblatt') && folderRole !== 'klausuren') {
    return 'arbeitsblatt'
  }

  switch (folderRole) {
    case 'klausuren':
      return 'klausur'
    case 'gefaehrdungsbeurteilung':
      return 'gefaehrdungsbeurteilung'
    case 'abbildungen':
      return 'bild'
    case 'versuche':
      return 'zusatzmaterial'
    case 'kopiervorlagen':
    case 'lernzirkel':
      return 'arbeitsblatt'
    default:
      return fromNames[0] ?? fallback
  }
}

function defaultRoles(
  files: PairingInputFile[],
  kind: BulkClusterKind,
  folderRole: BulkFolderRole,
  solutionRefs: ReadonlySet<string> | null = null,
): Record<string, BulkFileRole> {
  const roles: Record<string, BulkFileRole> = {}
  if (kind === 'varianten') {
    // Die erste Fassung (nach Bezeichnung sortiert) ist das Material, die weiteren sind Fassungen davon.
    files.forEach((file, index) => {
      roles[file.sourceRef] = index === 0 ? 'schueler' : 'fassung'
    })
    return roles
  }
  if (kind !== 'paar') {
    const einzel = folderRole === 'abbildungen' ? 'abbildung' : 'einzeln'
    for (const file of files) roles[file.sourceRef] = einzel
    return roles
  }

  // Dateiname verrät die Lösung („… - Lösung.doc“) – unabhängig vom Dateiformat.
  if (solutionRefs?.size === 1) {
    for (const file of files) {
      roles[file.sourceRef] = solutionRefs.has(file.sourceRef) ? 'loesung' : 'schueler'
    }
    return roles
  }

  const office = files.filter((file) => OFFICE_EXTENSIONS.has(file.extension))
  const pdfs = files.filter((file) => SOLUTION_EXTENSIONS.has(file.extension))
  if (office.length && pdfs.length) {
    for (const file of office) roles[file.sourceRef] = 'schueler'
    for (const file of pdfs) roles[file.sourceRef] = 'loesung'
    for (const file of files) {
      if (!roles[file.sourceRef]) roles[file.sourceRef] = 'anhaengsel'
    }
    return roles
  }

  const sorted = [...files].sort((a, b) => a.extension.localeCompare(b.extension))
  roles[sorted[0]!.sourceRef] = 'schueler'
  for (const file of sorted.slice(1)) roles[file.sourceRef] = 'loesung'
  return roles
}

function topicTokens(stem: string): string[] {
  const folded = fold(stem).replace(/^wd\d+_[a-z0-9]+_/, '')
  return folded
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4)
    .filter((token) => !STOP_TOKENS.has(token))
    .filter((token) => !/^\d+$/.test(token))
}

function pageTokens(stem: string): string[] {
  return [...fold(stem).matchAll(/(?:^|_)(\d{2,3})(?:_|$)/g)].map((match) => match[1]!)
}

function proposeGfbVersuchLinks(clusters: BulkUploadDetectedCluster[]): void {
  const gfbs = clusters.filter((cluster) => cluster.folderRole === 'gefaehrdungsbeurteilung')
  const versuche = clusters.filter((cluster) => cluster.folderRole === 'versuche')
  if (!gfbs.length || !versuche.length) return

  for (const versuch of versuche) {
    const versuchTopics = new Set(topicTokens(versuch.stem))
    const versuchPages = new Set(pageTokens(versuch.stem))
    let best: { cluster: BulkUploadDetectedCluster; score: number; reason: string } | null = null

    for (const gfb of gfbs) {
      const sharedTopics = topicTokens(gfb.stem).filter((token) => versuchTopics.has(token))
      const sharedPages = pageTokens(gfb.stem).filter((page) => versuchPages.has(page))
      const score = sharedTopics.length * 10 + sharedPages.length * 2
      if (score < 10) continue
      const reason = sharedTopics.length
        ? `gemeinsames Thema „${sharedTopics[0]}“`
        : `Seitenzahl ${sharedPages[0]}`
      if (!best || score > best.score) best = { cluster: gfb, score, reason }
    }

    if (!best) continue
    versuch.proposedLinks.push({
      targetClusterId: best.cluster.clusterId,
      relationType: 'gehoert_zu',
      reason: `Versuch zu Gefährdungsbeurteilung (${best.reason})`,
      confidence: best.score >= 10 ? 'hoch' : 'mittel',
    })
  }
}

export function clusterBulkFiles(
  files: PairingInputFile[],
  fallbackType: MaterialType = 'arbeitsblatt',
): BulkUploadDetectedCluster[] {
  const groups = new Map<string, PairingInputFile[]>()
  for (const file of files) {
    const path = posixPath(file.relativePath || file.fileName)
    const folder = parentFolder(path)
    const fassung = fassungInfo(stemOf(file.fileName))
    const stem = fassung ? fold(fassung.base) : solutionBaseStem(stemOf(file.fileName))
    const key = `${fold(folder)}::${stem}`
    const list = groups.get(key)
    if (list) list.push(file)
    else groups.set(key, [file])
  }

  const clusters: BulkUploadDetectedCluster[] = []
  let index = 0
  for (const group of groups.values()) {
    // Klausur.doc + „Klausur - Lösung.doc“: die Lösungsdatei erkennt man am Namen.
    const solutionRefs = new Set(
      group
        .filter((file) => hasSolutionSuffix(stemOf(file.fileName)))
        .map((file) => file.sourceRef),
    )
    // Mehrere Fassungen („… - Fassung A“, „… - Fassung B“) gehören zu einem Material.
    const fassungLabels = group.map((file) => fassungInfo(stemOf(file.fileName))?.label)
    const fassungsGruppe =
      group.length >= 2 &&
      fassungLabels.every(Boolean) &&
      new Set(fassungLabels.map((label) => fold(label!))).size === group.length
    if (fassungsGruppe) {
      group.sort((a, b) =>
        fold(fassungInfo(stemOf(a.fileName))!.label).localeCompare(fold(fassungInfo(stemOf(b.fileName))!.label)),
      )
    }
    const namedSolutionPair = !fassungsGruppe && group.length === 2 && solutionRefs.size === 1
    const first = namedSolutionPair
      ? group.find((file) => !solutionRefs.has(file.sourceRef))!
      : group[0]!
    const folderRole = detectFolderRole(first.relativePath, first.fileName)
    const stem = fassungsGruppe ? fassungInfo(stemOf(first.fileName))!.base : stemOf(first.fileName)
    const extensions = new Set(group.map((file) => file.extension))
    const isPair =
      group.length === 2 &&
      (namedSolutionPair ||
        (extensions.size === 2 &&
          (folderRole === 'kopiervorlagen' ||
            folderRole === 'klausuren' ||
            (OFFICE_EXTENSIONS.has(group[0]!.extension) &&
              SOLUTION_EXTENSIONS.has(group[1]!.extension)) ||
            (SOLUTION_EXTENSIONS.has(group[0]!.extension) &&
              OFFICE_EXTENSIONS.has(group[1]!.extension)))))

    const kind: BulkClusterKind = fassungsGruppe
      ? 'varianten'
      : isPair
        ? 'paar'
        : group.length === 1
          ? 'einzeln'
          : 'unklar'
    const fileRefs = group.map((file) => file.sourceRef)
    const clusterId = group.length === 1 ? first.sourceRef : `cluster:${index}:${fold(stem).slice(0, 40)}`
    // Bei benannten Lösungspaaren bestimmt nur die Aufgabenfassung den Materialtyp.
    const paths = group
      .filter((file) => !(namedSolutionPair && solutionRefs.has(file.sourceRef)))
      .map((file) => posixPath(file.relativePath || file.fileName))
    const materialType = materialTypeForCluster(folderRole, paths, fallbackType)
    const warnings: string[] = []
    if (kind === 'unklar') {
      warnings.push('Mehrere Dateien mit gleichem Namen – Rollen bitte prüfen.')
    }

    clusters.push({
      clusterId,
      kind,
      folderRole,
      stem,
      fileRefs,
      suggestedRoles: defaultRoles(group, kind, folderRole, namedSolutionPair ? solutionRefs : null),
      suggestions: {
        title: clusterTitleFromStem(stem, folderRole),
        materialType,
        subjectNames: [],
        tagNames: [],
        description: '',
        learningObjectives: [],
        contentSummary: '',
        schoolForm: null,
        aiUsed: false,
      },
      proposedLinks: [],
      warnings,
    })
    index += 1
  }

  proposeGfbVersuchLinks(clusters)
  markiereLernzirkel(
    clusters,
    new Map(files.map((file) => [file.sourceRef, posixPath(file.relativePath || file.fileName)])),
  )
  for (const cluster of clusters) {
    // Handreichung o. Ä. innerhalb eines Lernzirkels ist Zubehör, kein eigenes Buch.
    if (!cluster.lernzirkel) continue
    if (BUCH_TYPEN.has(cluster.suggestions.materialType) || LERNZIRKEL_ZUBEHOER.test(fold(cluster.stem))) {
      cluster.suggestions.materialType = 'zusatzmaterial'
    }
  }
  return clusters
}

export function filesAsSingletonClusters(
  files: Array<{
    sourceRef: string
    fileName: string
    relativePath?: string | null
    suggestions?: BulkUploadDetectedCluster['suggestions']
    warnings?: string[]
  }>,
): BulkUploadDetectedCluster[] {
  return files.map((file) => ({
    clusterId: file.sourceRef,
    kind: 'einzeln' as const,
    folderRole: detectFolderRole(file.relativePath, file.fileName),
    stem: stemOf(file.fileName),
    fileRefs: [file.sourceRef],
    suggestedRoles: {
      [file.sourceRef]:
        detectFolderRole(file.relativePath, file.fileName) === 'abbildungen'
          ? ('abbildung' as const)
          : ('einzeln' as const),
    },
    suggestions: file.suggestions ?? {
      title: clusterTitleFromStem(stemOf(file.fileName), 'sonstiges'),
      materialType: guessMaterialType(file.fileName),
      subjectNames: [],
      tagNames: [],
      description: '',
      learningObjectives: [],
      contentSummary: '',
      schoolForm: null,
      aiUsed: false,
    },
    proposedLinks: [],
    warnings: file.warnings ?? [],
  }))
}
