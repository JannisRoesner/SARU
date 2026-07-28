import { eq } from 'drizzle-orm'
import { readFile } from 'node:fs/promises'
import { useDatabase } from '../database/client'
import { materialAssets, type User } from '../database/schema'
import { hasRole } from '../utils/auth'
import {
  buildCollaboraIframeUrl,
  createWopiAccessToken,
  isCollaboraCandidate,
  isCollaboraConfigured,
  shouldShowCollaboraCertHint,
} from './collabora.service'
import { getCollaboraSettings } from './settings.service'
import { canHaveThumbnail } from './thumbnail.service'
import { getPdfPageCount } from './ai/rasterize'
import { resolveStoragePath } from './storage.service'

export type PreviewMode = 'pdf' | 'bild' | 'text' | 'collabora' | 'download' | 'link' | 'keine'

export interface AssetPreviewInfo {
  mode: PreviewMode
  assetId: string
  title: string
  fileName: string | null
  mimeType: string | null
  kind: 'datei' | 'link'
  url: string | null
  /** Inline-Download-URL für Browser-PDF/Bild. */
  inlineUrl: string | null
  downloadUrl: string
  thumbnailUrl: string | null
  /** Collabora iframe-URL, nur wenn konfiguriert und Dateityp geeignet. */
  collaboraUrl: string | null
  /** true, wenn der aktuelle Nutzer Office-Dokumente bearbeiten darf. */
  canWrite: boolean
  hinweis: string | null
  /** PDF: Seitenzahl für Bild-Vorschau (Mobile). */
  pdfPageCount: number | null
}

/**
 * Entscheidet, wie eine Datei in der App angezeigt werden kann.
 */
export async function getAssetPreviewInfo(
  assetId: string,
  user: User,
  requestOrigin: string,
): Promise<AssetPreviewInfo | null> {
  const [asset] = await useDatabase()
    .select()
    .from(materialAssets)
    .where(eq(materialAssets.id, assetId))
    .limit(1)

  if (!asset) return null

  const title = asset.title || asset.fileName || asset.url || 'Anhang'
  const downloadUrl = `/api/assets/${asset.id}/download`
  const canWrite = hasRole(user, 'lehrkraft')
  const base: Omit<
    AssetPreviewInfo,
    'mode' | 'inlineUrl' | 'collaboraUrl' | 'hinweis' | 'thumbnailUrl' | 'pdfPageCount'
  > = {
    assetId: asset.id,
    title,
    fileName: asset.fileName,
    mimeType: asset.mimeType,
    kind: asset.kind,
    url: asset.url,
    downloadUrl,
    canWrite,
  }

  if (asset.kind === 'link') {
    return {
      ...base,
      mode: 'link',
      inlineUrl: null,
      thumbnailUrl: null,
      collaboraUrl: null,
      hinweis: null,
      pdfPageCount: null,
    }
  }

  const thumb =
    canHaveThumbnail(asset.mimeType, asset.fileName)
      ? `/api/assets/${asset.id}/thumbnail`
      : null

  const mime = asset.mimeType ?? ''

  if (mime === 'application/pdf' || (asset.fileName ?? '').toLowerCase().endsWith('.pdf')) {
    let pdfPageCount: number | null = null
    if (asset.storageKey) {
      try {
        const buffer = await readFile(resolveStoragePath(asset.storageKey))
        pdfPageCount = await getPdfPageCount(buffer)
      } catch {
        pdfPageCount = null
      }
    }
    return {
      ...base,
      mode: 'pdf',
      inlineUrl: `${downloadUrl}?inline=1`,
      thumbnailUrl: thumb,
      collaboraUrl: null,
      hinweis: null,
      pdfPageCount,
    }
  }

  if (mime.startsWith('image/') && mime !== 'image/svg+xml') {
    return {
      ...base,
      mode: 'bild',
      inlineUrl: `${downloadUrl}?inline=1`,
      thumbnailUrl: thumb,
      collaboraUrl: null,
      hinweis: null,
      pdfPageCount: null,
    }
  }

  if (mime === 'text/plain' || mime === 'text/markdown' || mime === 'text/csv') {
    return {
      ...base,
      mode: 'text',
      inlineUrl: `${downloadUrl}?inline=1`,
      thumbnailUrl: null,
      collaboraUrl: null,
      hinweis: null,
      pdfPageCount: null,
    }
  }

  if (isCollaboraCandidate(asset.fileName, asset.mimeType) && (await isCollaboraConfigured())) {
    const settings = await getCollaboraSettings()
    const wopiHost = settings.wopiHostUrl.trim() || requestOrigin
    const accessToken = createWopiAccessToken({
      assetId: asset.id,
      userId: user.id,
      userName: user.name || user.email,
      canWrite,
    })
    const collaboraUrl = await buildCollaboraIframeUrl({
      assetId: asset.id,
      fileName: asset.fileName ?? 'dokument.docx',
      accessToken,
      wopiHost,
      canWrite,
    })

    if (collaboraUrl) {
      const configuredBase = settings.baseUrl.replace(/\/+$/, '')
      let collaboraOrigin = configuredBase
      try {
        collaboraOrigin = new URL(collaboraUrl).origin
      } catch {
        /* ignore */
      }
      const schemeMismatch =
        configuredBase.startsWith('http://') && collaboraUrl.startsWith('https://')
      const showCertHint =
        collaboraUrl.startsWith('https://') && shouldShowCollaboraCertHint(collaboraOrigin)
      const hinweise: string[] = []
      if (schemeMismatch) {
        hinweise.push(
          `Collabora antwortet unter ${collaboraOrigin}, obwohl in den Einstellungen ${configuredBase} steht. Für HTTP: Collabora mit ssl.enable=false neu starten (Port 9980 muss wirklich HTTP sprechen).`,
        )
      }
      if (showCertHint) {
        hinweise.push(
          `Falls der iframe leer bleibt: öffnen Sie ${collaboraOrigin} einmal im Browser und akzeptieren Sie das selbstsignierte Zertifikat, dann Vorschau neu laden.`,
        )
      }
      return {
        ...base,
        mode: 'collabora',
        inlineUrl: null,
        thumbnailUrl: thumb,
        collaboraUrl,
        hinweis: hinweise.length ? hinweise.join(' ') : null,
        pdfPageCount: null,
      }
    }

    return {
      ...base,
      mode: 'download',
      inlineUrl: null,
      thumbnailUrl: thumb,
      collaboraUrl: null,
      hinweis:
        process.env.NODE_ENV === 'production'
          ? 'Office-Vorschau konnte nicht geladen werden. Bitte wenden Sie sich an die Administration. Der Download bleibt verfügbar.'
          : 'Collabora ist konfiguriert, aber die Discovery-URL ist nicht erreichbar. Port 9980 antwortet oft nur auf https (trotz ssl.enable=false). Basis-URL prüfen und Collabora-Container neu starten. Der Download bleibt verfügbar.',
      pdfPageCount: null,
    }
  }

  if (isCollaboraCandidate(asset.fileName, asset.mimeType)) {
    return {
      ...base,
      mode: 'download',
      inlineUrl: null,
      thumbnailUrl: thumb,
      collaboraUrl: null,
      hinweis:
        'Für Office-Dokumente kann unter Einstellungen → Office-Vorschau eine Collabora-Online-URL hinterlegt werden. Bis dahin steht nur der Download zur Verfügung.',
      pdfPageCount: null,
    }
  }

  return {
    ...base,
    mode: 'download',
    inlineUrl: null,
    thumbnailUrl: thumb,
    collaboraUrl: null,
    hinweis: 'Für diesen Dateityp ist keine In-App-Vorschau verfügbar.',
    pdfPageCount: null,
  }
}
