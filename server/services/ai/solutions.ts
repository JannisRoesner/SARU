import { readFile } from 'node:fs/promises'
import { eq } from 'drizzle-orm'
import { useDatabase } from '../../database/client'
import { aiJobs, materialAssets } from '../../database/schema'
import { appError } from '../../utils/errors'
import { createLogger } from '../../utils/logger'
import { materialTypes, schoolForms } from '#shared/utils/labels'
import { getMaterialDetail } from '../../repositories/material.repository'
import {
  addRelation,
  createMaterial,
  updateMaterial,
} from '../material.service'
import { resolveStoragePath } from '../storage.service'
import { getAiSettings, getPrivacySettings } from '../settings.service'
import { chatCompletion, supportsNativePdf, type ChatPart } from './client'
import {
  AI_CONTENT_NOTICE,
  SOLUTION_PROMPT_VERSION,
  SOLUTION_SYSTEM_PROMPT,
  buildSolutionPrompt,
} from './prompts'
import { rasterizePdf } from './rasterize'

const log = createLogger('ai:solutions')

/** Obergrenze für an das Modell übergebene Dateien – schützt vor sehr großen Anhängen. */
const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024
const MAX_VISION_PAGES = 8

export interface GenerateSolutionOptions {
  /** Nur diese Variante berücksichtigen; sonst die Standardfassung. */
  variantId?: string | null
  userInstructions?: string | null
  /** Bilder/PDFs mitschicken, sofern der Anbieter das kann. */
  useVision?: boolean
  model?: string
}

export interface GenerateSolutionResult {
  jobId: string
  solutionMaterialId: string
  model: string
  attachments: number
  usedVision: boolean
}

/**
 * Erzeugt eine Musterlösung zu einem Material und legt sie als eigenständiges,
 * deutlich als KI-Erzeugnis gekennzeichnetes Material an.
 */
export async function generateSolution(
  materialId: string,
  userId: string | null,
  options: GenerateSolutionOptions = {},
): Promise<GenerateSolutionResult> {
  const db = useDatabase()
  const settings = await getAiSettings()

  if (!settings.enabled) {
    throw appError(
      'KI_NICHT_KONFIGURIERT',
      'Die KI-Unterstützung ist nicht aktiviert. Bitte in den Einstellungen einrichten.',
    )
  }

  const material = await getMaterialDetail(materialId, db)
  if (!material) throw appError('NICHT_GEFUNDEN', 'Das Material wurde nicht gefunden.')

  const variant =
    material.variants.find((v) => v.id === options.variantId) ??
    material.variants.find((v) => v.isDefault) ??
    material.variants[0]

  const useVision = options.useVision ?? settings.useVision
  const model = options.model || settings.visionModel || settings.chatModel

  // Bereits extrahierten Text als verlässliche Textgrundlage nutzen.
  const documentText = variant
    ? (
        await db
          .select({ text: materialAssets.extractedText })
          .from(materialAssets)
          .where(eq(materialAssets.variantId, variant.id))
      )
        .map((row) => row.text)
        .filter((text): text is string => !!text)
        .join('\n\n---\n\n')
        .slice(0, 60_000)
    : ''

  const prompt = buildSolutionPrompt({
    title: material.title,
    description: material.description,
    materialType: materialTypes.label(material.materialType),
    subjects: material.subjects.map((s) => s.name),
    gradeLevels: material.gradeLevels,
    schoolForm: material.schoolForm ? schoolForms.label(material.schoolForm) : null,
    topics: material.topics.map((t) => t.name),
    competencies: material.competencies.map((c) => c.name),
    learningObjectives: material.learningObjectives,
    pages: material.pages,
    documentText: documentText || null,
    userInstructions: options.userInstructions,
  })

  const parts: ChatPart[] = [{ type: 'text', text: prompt }]
  let attachments = 0
  let visionUsed = false

  if (useVision && variant) {
    const media = await collectVisionParts(variant.id, settings.provider)
    parts.push(...media.parts)
    attachments = media.parts.length
    visionUsed = media.parts.length > 0
    if (media.skipped.length) {
      log.info('Einige Anhänge wurden nicht an das Modell übergeben', { skipped: media.skipped })
    }
  }

  if (!documentText && !visionUsed) {
    throw appError(
      'KI_FEHLER',
      'Zu diesem Material liegt weder auslesbarer Text noch eine übertragbare Datei vor. Bitte eine Datei hinterlegen oder den Inhalt im Feld „Inhalt“ erfassen.',
    )
  }

  const privacy = await getPrivacySettings()
  const startedAt = Date.now()

  const [job] = await db
    .insert(aiJobs)
    .values({
      userId,
      materialId,
      kind: 'musterloesung',
      provider: settings.provider,
      model,
      status: 'laeuft',
      prompt: privacy.storeAiPrompts ? prompt.slice(0, 100_000) : null,
    })
    .returning({ id: aiJobs.id })

  const jobId = job!.id

  try {
    const completion = await chatCompletion(
      settings,
      [
        { role: 'system', parts: [{ type: 'text', text: SOLUTION_SYSTEM_PROMPT }] },
        { role: 'user', parts },
      ],
      { model, maxOutputTokens: settings.maxOutputTokens },
    )

    const body = `${AI_CONTENT_NOTICE}\n\n${completion.text.trim()}`

    const solutionMaterialId = await createMaterial(
      {
        title: `Musterlösung – ${material.title}`,
        description: `Automatisch erstellte Musterlösung zum Material „${material.title}“.`,
        content: body,
        materialType: 'musterloesung',
        schoolForm: material.schoolForm,
        pages: material.pages,
        origin: 'ki',
        aiMeta: {
          provider: settings.provider,
          model: completion.model,
          generatedAt: new Date().toISOString(),
          sourceMaterialId: materialId,
          promptVersion: SOLUTION_PROMPT_VERSION,
          reviewed: false,
        },
        // Fachliche Zuordnung vom Ausgangsmaterial übernehmen.
        subjectIds: material.subjects.map((s) => s.id),
        topicIds: material.topics.map((t) => t.id),
        competencyIds: material.competencies.map((c) => c.id),
        learningGroupIds: material.learningGroups.map((g) => g.id),
        gradeLevels: material.gradeLevels,
        tagNames: [...material.tags.map((t) => t.name), 'KI-Musterlösung'],
      },
      userId,
      db,
    )

    await addRelation(materialId, solutionMaterialId, 'musterloesung', 'Automatisch erstellt', db)

    await db
      .update(aiJobs)
      .set({
        status: 'erfolgreich',
        result: completion.text.slice(0, 200_000),
        resultMaterialId: solutionMaterialId,
        inputTokens: completion.inputTokens ?? null,
        outputTokens: completion.outputTokens ?? null,
        durationMs: Date.now() - startedAt,
        finishedAt: new Date(),
      })
      .where(eq(aiJobs.id, jobId))

    log.info('Musterlösung erzeugt', { materialId, solutionMaterialId, model: completion.model })

    return {
      jobId,
      solutionMaterialId,
      model: completion.model,
      attachments,
      usedVision: visionUsed,
    }
  } catch (error) {
    await db
      .update(aiJobs)
      .set({
        status: 'fehlgeschlagen',
        errorMessage: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
        finishedAt: new Date(),
      })
      .where(eq(aiJobs.id, jobId))
    throw error
  }
}

/**
 * Bereitet die Dateien einer Variante für das Modell auf.
 * PDFs gehen direkt an Anbieter, die das unterstützen; andernfalls werden die
 * ersten Seiten als Bilder gerendert.
 */
async function collectVisionParts(
  variantId: string,
  provider: 'openai' | 'ollama' | 'openrouter',
): Promise<{ parts: ChatPart[]; skipped: string[] }> {
  const db = useDatabase()
  const assets = await db
    .select()
    .from(materialAssets)
    .where(eq(materialAssets.variantId, variantId))

  const parts: ChatPart[] = []
  const skipped: string[] = []

  for (const asset of assets) {
    if (asset.kind !== 'datei' || !asset.storageKey || !asset.mimeType) continue
    if ((asset.sizeBytes ?? 0) > MAX_ATTACHMENT_BYTES) {
      skipped.push(`${asset.fileName} (zu groß)`)
      continue
    }

    try {
      const buffer = await readFile(resolveStoragePath(asset.storageKey))

      if (asset.mimeType.startsWith('image/') && asset.mimeType !== 'image/svg+xml') {
        parts.push({ type: 'image', mimeType: asset.mimeType, base64: buffer.toString('base64') })
        continue
      }

      if (asset.mimeType === 'application/pdf') {
        if (supportsNativePdf(provider)) {
          parts.push({
            type: 'file',
            mimeType: 'application/pdf',
            base64: buffer.toString('base64'),
            fileName: asset.fileName ?? 'material.pdf',
          })
        } else {
          // Lokale Modelle nehmen nur Bilder entgegen.
          const pages = await rasterizePdf(buffer, { maxPages: MAX_VISION_PAGES })
          if (pages.length === 0) {
            skipped.push(`${asset.fileName} (Bildumwandlung nicht möglich)`)
            continue
          }
          for (const page of pages) {
            parts.push({ type: 'image', mimeType: page.mimeType, base64: page.base64 })
          }
        }
        continue
      }

      skipped.push(`${asset.fileName} (Format wird nicht als Bild übergeben)`)
    } catch (error) {
      log.warn('Anhang konnte nicht gelesen werden', { assetId: asset.id, error })
      skipped.push(asset.fileName ?? asset.id)
    }
  }

  return { parts, skipped }
}

/** Markiert eine KI-Musterlösung als fachlich geprüft. */
export async function markSolutionReviewed(
  materialId: string,
  userId: string,
  reviewed: boolean,
): Promise<void> {
  const db = useDatabase()
  const material = await getMaterialDetail(materialId, db)
  if (!material) throw appError('NICHT_GEFUNDEN', 'Das Material wurde nicht gefunden.')

  await updateMaterial(
    materialId,
    {
      aiMeta: {
        ...(material.aiMeta ?? {}),
        reviewed,
        reviewedAt: reviewed ? new Date().toISOString() : undefined,
        reviewedBy: reviewed ? userId : undefined,
      },
    },
    db,
  )
}
