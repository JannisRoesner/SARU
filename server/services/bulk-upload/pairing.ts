import type { MaterialType } from '#shared/types/domain'
import { guessMaterialType } from '#shared/utils/material-type-guess'
import type { BulkFileRole, BulkFolderRole } from '#shared/utils/bulk-upload'
import type { BulkClusterKind, BulkUploadDetectedCluster } from './types'

const OFFICE_EXTENSIONS = new Set(['doc', 'docx', 'odt', 'ppt', 'pptx', 'odp', 'xls', 'xlsx', 'ods'])
const SOLUTION_EXTENSIONS = new Set(['pdf'])

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
  return 'sonstiges'
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
      return 'arbeitsblatt'
    default:
      return fromNames[0] ?? fallback
  }
}

function defaultRoles(
  files: PairingInputFile[],
  kind: BulkClusterKind,
): Record<string, BulkFileRole> {
  const roles: Record<string, BulkFileRole> = {}
  if (kind !== 'paar') {
    for (const file of files) roles[file.sourceRef] = 'einzeln'
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
    const stem = fold(stemOf(file.fileName))
    const key = `${fold(folder)}::${stem}`
    const list = groups.get(key)
    if (list) list.push(file)
    else groups.set(key, [file])
  }

  const clusters: BulkUploadDetectedCluster[] = []
  let index = 0
  for (const group of groups.values()) {
    const first = group[0]!
    const folderRole = detectFolderRole(first.relativePath, first.fileName)
    const stem = stemOf(first.fileName)
    const extensions = new Set(group.map((file) => file.extension))
    const isPair =
      group.length === 2 &&
      extensions.size === 2 &&
      (folderRole === 'kopiervorlagen' ||
        folderRole === 'klausuren' ||
        (OFFICE_EXTENSIONS.has(group[0]!.extension) && SOLUTION_EXTENSIONS.has(group[1]!.extension)) ||
        (SOLUTION_EXTENSIONS.has(group[0]!.extension) && OFFICE_EXTENSIONS.has(group[1]!.extension)))

    const kind: BulkClusterKind = isPair ? 'paar' : group.length === 1 ? 'einzeln' : 'unklar'
    const fileRefs = group.map((file) => file.sourceRef)
    const clusterId = group.length === 1 ? first.sourceRef : `cluster:${index}:${fold(stem).slice(0, 40)}`
    const paths = group.map((file) => posixPath(file.relativePath || file.fileName))
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
      suggestedRoles: defaultRoles(group, kind),
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
    suggestedRoles: { [file.sourceRef]: 'einzeln' as const },
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
