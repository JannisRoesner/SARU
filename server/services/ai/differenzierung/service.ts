import { and, desc, eq } from 'drizzle-orm'
import { istH5pMaterial, istMoodleKursMaterial } from '#shared/utils/moodle'
import { isAiMaterialFileName } from '#shared/utils/ai-material-formats'
import type { DifferenzierungProfil } from '#shared/types/domain'
import { aiJobs, materialAssets, type AiMeta } from '../../../database/schema'
import { useDatabase } from '../../../database/client'
import { appError, notFound } from '../../../utils/errors'
import { createLogger } from '../../../utils/logger'
import { recordAudit } from '../../audit.service'
import { getMaterialDetail } from '../../../repositories/material.repository'
import { addFileAsset, addVariant } from '../../material.service'
import { deleteFile, storeFile } from '../../storage.service'
import { getAiSettings } from '../../settings.service'
import { chatCompletion } from '../client'
import { ensureExtractedText } from '../document-text'
import { loadPrimarySourceAsset } from '../solutions'
import { requireDifferenzierungProfil } from './profiles'
import {
  DIFFERENZIERUNG_PROMPT_VERSION,
  buildDifferentiationSystemPrompt,
  buildDifferentiationUserPrompt,
  type DifferentiatedWorksheet,
} from './prompts'
import {
  parseDifferentiatedWorksheetFromText,
  worksheetFileName,
  worksheetToPreviewMarkdown,
} from './parse'
import { buildWorksheetDocx } from './render'
import { wakeDifferentiationWorker } from './worker'

const log = createLogger('ai:differenzierung')

const BLOCKED_TYPES = new Set([
  'lehrwerk',
  'serviceband',
  'loesungsbuch',
  'lehrbuchseite',
  'moodle_kurs',
  'h5p',
  'video',
  'link',
  'bild',
])

export interface DifferentiationEnqueueOptions {
  profile: string
  variantId?: string | null
  userInstructions?: string | null
}

export interface QueuedDifferentiationJob {
  jobId: string
  status: 'wartend'
}

export interface DifferentiationDraftPayload {
  profile: DifferenzierungProfil
  profileLabel: string
  sourceVariantId: string
  title: string
  intro: string | null
  tasks: DifferentiatedWorksheet['tasks']
  wordBank: string[]
  glossary: DifferentiatedWorksheet['glossary']
  uncertainties: string | null
  previewMarkdown: string
  draftStorageKey: string
  draftFileName: string
  draftMimeType: string
  model: string
  provider: string
  resultVariantId?: string
}

export interface DifferentiationJobView {
  id: string
  status: string
  errorMessage: string | null
  createdAt: Date
  finishedAt: Date | null
  profile: DifferenzierungProfil | null
  profileLabel: string | null
  title: string | null
  previewMarkdown: string | null
  tasks: DifferentiatedWorksheet['tasks']
  wordBank: string[]
  glossary: DifferentiatedWorksheet['glossary']
  uncertainties: string | null
  draftFileName: string | null
  hasDraftFile: boolean
  resultVariantId: string | null
}

function parseOptions(prompt: string | null): DifferentiationEnqueueOptions | null {
  if (!prompt?.trim()) return null
  try {
    const parsed = JSON.parse(prompt) as DifferentiationEnqueueOptions
    if (!parsed?.profile) return null
    return parsed
  } catch {
    return null
  }
}

export function parseDraftPayload(result: string | null): DifferentiationDraftPayload | null {
  if (!result?.trim()) return null
  try {
    const parsed = JSON.parse(result) as DifferentiationDraftPayload
    if (!parsed?.draftStorageKey || !parsed.profile) return null
    return parsed
  } catch {
    return null
  }
}

function toJobView(
  job: {
    id: string
    status: string
    errorMessage: string | null
    createdAt: Date
    finishedAt: Date | null
    prompt: string | null
    result: string | null
  },
): DifferentiationJobView {
  const options = parseOptions(job.prompt)
  const draft = parseDraftPayload(job.result)
  const spec = options?.profile
    ? requireDifferenzierungProfilSafe(options.profile)
    : draft
      ? requireDifferenzierungProfilSafe(draft.profile)
      : null
  return {
    id: job.id,
    status: job.status,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt,
    profile: spec?.id ?? draft?.profile ?? null,
    profileLabel: spec?.label ?? draft?.profileLabel ?? null,
    title: draft?.title ?? null,
    previewMarkdown: draft?.previewMarkdown ?? null,
    tasks: draft?.tasks ?? [],
    wordBank: draft?.wordBank ?? [],
    glossary: draft?.glossary ?? [],
    uncertainties: draft?.uncertainties ?? null,
    draftFileName: draft?.draftFileName ?? null,
    hasDraftFile: Boolean(draft?.draftStorageKey) && job.status === 'pruefung_noetig',
    resultVariantId: draft?.resultVariantId ?? null,
  }
}

function requireDifferenzierungProfilSafe(profile: string) {
  try {
    return requireDifferenzierungProfil(profile)
  } catch {
    return null
  }
}

async function ownedJob(jobId: string, userId: string) {
  const [job] = await useDatabase()
    .select()
    .from(aiJobs)
    .where(and(eq(aiJobs.id, jobId), eq(aiJobs.userId, userId), eq(aiJobs.kind, 'differenzierung')))
    .limit(1)
  if (!job) throw notFound('Der Differenzierungsentwurf')
  return job
}

export async function enqueueDifferentiation(
  materialId: string,
  userId: string,
  options: DifferentiationEnqueueOptions,
): Promise<QueuedDifferentiationJob> {
  const spec = requireDifferenzierungProfil(options.profile)
  const settings = await getAiSettings()
  if (!settings.enabled || !settings.chatModel.trim()) {
    throw appError(
      'KI_NICHT_KONFIGURIERT',
      'Die KI-Unterstützung ist nicht aktiviert. Bitte in den Einstellungen einrichten.',
    )
  }

  const material = await getMaterialDetail(materialId)
  if (!material) throw notFound('Das Material')
  if (BLOCKED_TYPES.has(material.materialType) || istMoodleKursMaterial(material.materialType) || istH5pMaterial(material.materialType)) {
    throw appError(
      'UNGUELTIGE_EINGABE',
      'Für diesen Materialtyp kann keine Differenzierungsfassung erzeugt werden.',
    )
  }

  const variant =
    material.variants.find((item) => item.id === options.variantId) ??
    material.variants.find((item) => item.isDefault) ??
    material.variants[0]
  if (!variant) throw appError('UNGUELTIGE_EINGABE', 'Dieses Material hat keine Fassung mit einer Datei.')

  const sourceFile = variant.assets.find(
    (asset) => asset.kind === 'datei' && asset.fileName && isAiMaterialFileName(asset.fileName),
  )
  if (!sourceFile) {
    throw appError(
      'UNGUELTIGE_EINGABE',
      'Bitte zuerst eine PDF- oder Office-Datei an der gewählten Fassung hochladen.',
    )
  }

  const [job] = await useDatabase()
    .insert(aiJobs)
    .values({
      userId,
      materialId,
      kind: 'differenzierung',
      provider: settings.provider,
      model: settings.chatModel,
      status: 'wartend',
      prompt: JSON.stringify({
        profile: spec.id,
        variantId: variant.id,
        userInstructions: options.userInstructions?.trim() || null,
      }),
    })
    .returning({ id: aiJobs.id })

  wakeDifferentiationWorker()
  return { jobId: job!.id, status: 'wartend' }
}

export async function getLatestDifferentiationJob(
  materialId: string,
  userId: string,
): Promise<DifferentiationJobView | null> {
  const [job] = await useDatabase()
    .select()
    .from(aiJobs)
    .where(and(
      eq(aiJobs.materialId, materialId),
      eq(aiJobs.userId, userId),
      eq(aiJobs.kind, 'differenzierung'),
    ))
    .orderBy(desc(aiJobs.createdAt))
    .limit(1)
  return job ? toJobView(job) : null
}

export async function generateDifferentiation(jobId: string): Promise<void> {
  const db = useDatabase()
  const [job] = await db.select().from(aiJobs).where(eq(aiJobs.id, jobId)).limit(1)
  if (!job?.materialId) throw appError('NICHT_GEFUNDEN', 'Der Differenzierungsauftrag wurde nicht gefunden.')

  const options = parseOptions(job.prompt)
  if (!options) throw appError('KI_FEHLER', 'Der Differenzierungsauftrag ist unvollständig.')
  const spec = requireDifferenzierungProfil(options.profile)

  const settings = await getAiSettings()
  if (!settings.enabled || !settings.chatModel.trim()) {
    throw appError(
      'KI_NICHT_KONFIGURIERT',
      'Die KI-Unterstützung ist nicht aktiviert. Bitte in den Einstellungen einrichten.',
    )
  }

  const material = await getMaterialDetail(job.materialId, db)
  if (!material) throw appError('NICHT_GEFUNDEN', 'Das Material wurde nicht gefunden.')

  const variant =
    material.variants.find((item) => item.id === options.variantId) ??
    material.variants.find((item) => item.isDefault) ??
    material.variants[0]
  if (!variant) throw appError('UNGUELTIGE_EINGABE', 'Die Quellfassung fehlt.')

  const source = await loadPrimarySourceAsset(variant.id)
  if (!source) {
    throw appError('UNGUELTIGE_EINGABE', 'An der gewählten Fassung liegt keine Datei.')
  }

  const storedText = (
    await db
      .select({ text: materialAssets.extractedText })
      .from(materialAssets)
      .where(eq(materialAssets.variantId, variant.id))
  )
    .map((row) => row.text)
    .filter((text): text is string => Boolean(text?.trim()))
    .join('\n\n')
    .slice(0, 60_000)

  let documentText = storedText
  if (!documentText.trim()) {
    const extracted = await ensureExtractedText(source.buffer, source.fileName, settings)
    documentText = extracted.text.trim().slice(0, 60_000)
  }
  if (!documentText) {
    throw appError(
      'KI_FEHLER',
      'Aus der Quelldatei konnte kein Text gelesen werden. Bitte eine durchsuchbare PDF oder eine Word-Datei verwenden.',
    )
  }

  const completion = await chatCompletion(
    settings,
    [
      {
        role: 'system',
        parts: [{ type: 'text', text: buildDifferentiationSystemPrompt(spec.promptRules) }],
      },
      {
        role: 'user',
        parts: [{
          type: 'text',
          text: buildDifferentiationUserPrompt({
            materialTitle: material.title,
            profileLabel: spec.label,
            sourceFileName: source.fileName,
            documentText,
            userInstructions: options.userInstructions,
          }),
        }],
      },
    ],
    {
      model: settings.chatModel,
      temperature: 0.2,
      maxOutputTokens: Math.min(Math.max(settings.maxOutputTokens || 4000, 3000), 8000),
      jsonMode: true,
    },
  )

  const sheet = parseDifferentiatedWorksheetFromText(completion.text, material.title)
  if (!sheet) {
    throw appError('KI_FEHLER', 'Die KI-Antwort konnte nicht als Arbeitsblatt gelesen werden.')
  }

  const buffer = buildWorksheetDocx(sheet, { profileLabel: spec.label })
  const fileName = worksheetFileName(source.fileName, spec.label)
  const stored = await storeFile(buffer, fileName)
  const previewMarkdown = worksheetToPreviewMarkdown(sheet)

  const payload: DifferentiationDraftPayload = {
    profile: spec.id,
    profileLabel: spec.label,
    sourceVariantId: variant.id,
    title: sheet.title,
    intro: sheet.intro,
    tasks: sheet.tasks,
    wordBank: sheet.wordBank,
    glossary: sheet.glossary,
    uncertainties: sheet.uncertainties,
    previewMarkdown,
    draftStorageKey: stored.storageKey,
    draftFileName: fileName,
    draftMimeType: stored.mimeType,
    model: completion.model,
    provider: settings.provider,
  }

  await db
    .update(aiJobs)
    .set({
      status: 'pruefung_noetig',
      result: JSON.stringify(payload),
      model: completion.model,
      inputTokens: completion.inputTokens ?? null,
      outputTokens: completion.outputTokens ?? null,
      errorMessage: null,
    })
    .where(eq(aiJobs.id, jobId))

  log.info('Differenzierungsentwurf erzeugt', {
    jobId,
    materialId: job.materialId,
    profile: spec.id,
    tasks: sheet.tasks.length,
  })
}

export async function getDifferentiationDraftDownload(jobId: string, userId: string) {
  const job = await ownedJob(jobId, userId)
  if (job.status !== 'pruefung_noetig') {
    throw appError('UNGUELTIGE_EINGABE', 'Für diesen Auftrag liegt kein Prüfentwurf vor.')
  }
  const draft = parseDraftPayload(job.result)
  if (!draft) throw notFound('Die Entwurfsdatei')
  return {
    storageKey: draft.draftStorageKey,
    fileName: draft.draftFileName,
    mimeType: draft.draftMimeType,
  }
}

export async function publishDifferentiationDraft(
  jobId: string,
  userId: string,
): Promise<{ variantId: string; materialId: string }> {
  const job = await ownedJob(jobId, userId)
  if (job.status !== 'pruefung_noetig' || !job.materialId) {
    throw appError('UNGUELTIGE_EINGABE', 'Dieser Entwurf kann nicht übernommen werden.')
  }
  const draft = parseDraftPayload(job.result)
  if (!draft) throw notFound('Der Differenzierungsentwurf')

  const spec = requireDifferenzierungProfil(draft.profile)
  const { readFile } = await import('node:fs/promises')
  const { resolveStoragePath } = await import('../../storage.service')
  const buffer = await readFile(resolveStoragePath(draft.draftStorageKey))

  const aiMeta: AiMeta = {
    provider: draft.provider,
    model: draft.model,
    generatedAt: new Date().toISOString(),
    promptVersion: DIFFERENZIERUNG_PROMPT_VERSION,
    sourceVariantId: draft.sourceVariantId,
    reviewed: true,
    reviewedAt: new Date().toISOString(),
    reviewedBy: userId,
    differenzierungProfil: spec.id,
  }

  const variantId = await addVariant(job.materialId, {
    label: spec.label,
    variantKind: spec.variantKind,
    differentiationLevel: spec.differentiationLevel,
    notes: draft.uncertainties,
    aiMeta,
  })

  await addFileAsset(
    variantId,
    { buffer, fileName: draft.draftFileName },
    { role: 'haupt', title: `${spec.label} (KI)`, skipContentAutofill: true },
  )

  const published: DifferentiationDraftPayload = { ...draft, resultVariantId: variantId }
  await useDatabase()
    .update(aiJobs)
    .set({
      status: 'erfolgreich',
      result: JSON.stringify(published),
      finishedAt: new Date(),
    })
    .where(eq(aiJobs.id, jobId))

  await deleteFile(draft.draftStorageKey)

  await recordAudit({
    userId,
    action: 'ki.differenzierung_erzeugt',
    entityType: 'material',
    entityId: job.materialId,
    details: {
      profil: spec.id,
      variante: variantId,
      modell: draft.model,
    },
  })

  return { variantId, materialId: job.materialId }
}

export async function discardDifferentiationDraft(jobId: string, userId: string): Promise<void> {
  const job = await ownedJob(jobId, userId)
  if (job.status !== 'pruefung_noetig') {
    throw appError('UNGUELTIGE_EINGABE', 'Dieser Entwurf kann nicht verworfen werden.')
  }
  const draft = parseDraftPayload(job.result)
  if (draft?.draftStorageKey) await deleteFile(draft.draftStorageKey)
  await useDatabase()
    .update(aiJobs)
    .set({
      status: 'fehlgeschlagen',
      errorMessage: 'Der Prüfentwurf wurde verworfen.',
      finishedAt: new Date(),
    })
    .where(eq(aiJobs.id, jobId))
}
