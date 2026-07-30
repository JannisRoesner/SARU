import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { useDatabase } from '../../database/client'
import { aiJobs, materialAssets, materialVariants } from '../../database/schema'
import { oeffentlicheFehlermeldung } from '#shared/utils/public-error'
import { appError } from '../../utils/errors'
import { createLogger } from '../../utils/logger'
import { materialTypes, schoolForms } from '#shared/utils/labels'
import { getMaterialDetail } from '../../repositories/material.repository'
import {
  addFileAsset,
  addRelation,
  createMaterial,
  deleteAsset,
  updateMaterial,
} from '../material.service'
import { extensionOf, resolveStoragePath } from '../storage.service'
import { convertOfficeFileToPdf } from '../office-convert.service'
import {
  getAiSettings,
  getHermesSettings,
  getPrivacySettings,
  type AiSettings,
} from '../settings.service'
import { chatCompletion, supportsNativePdf, type ChatPart } from './client'
import { PDFDocument } from 'pdf-lib'
import {
  alignAnswersToBlanks,
  buildAnswerListPdf,
  buildSolutionDocx,
  classifySolutionFillMode,
  detectDocxBlanks,
  detectPdfBlankRegions,
  enrichSolutionPlacements,
  fillDocxDocument,
  fillPdfAcroForm,
  formatBlankInventory,
  formatTextBlankInventory,
  overlayPdfAnswers,
  parseStructuredSolution,
  solutionFileName,
  solutionToMarkdown,
  type FilledDocument,
  type PdfBlankRegion,
  type SolutionFillMode,
  type StructuredSolution,
  type TextBlankInfo,
} from './document-fill'
import { kiAutorAnzeige } from '#shared/utils/ki'
import { tryHermesDocumentFill } from './hermes'
import {
  AI_CONTENT_NOTICE,
  AI_CONTENT_NOTICE_MD,
  SOLUTION_PROMPT_VERSION,
  buildSolutionPrompt,
  solutionSystemPromptForMode,
} from './prompts'
import { rasterizePdf } from './rasterize'

const log = createLogger('ai:solutions')

/** Obergrenze für an das Modell übergebene Dateien – schützt vor sehr großen Anhängen. */
const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024
const MAX_VISION_PAGES = 8

const OFFICE_EXTENSIONS = new Set(['docx', 'odt', 'doc', 'rtf'])
const PDF_EXTENSIONS = new Set(['pdf'])
/** Office-Formate, die LibreOffice für Vision/Vorschau nach PDF wandeln kann. */
const OFFICE_VISION_EXTENSIONS = new Set([
  'docx',
  'doc',
  'odt',
  'rtf',
  'pptx',
  'ppt',
  'odp',
  'xlsx',
  'xls',
  'ods',
])

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
  fillStrategy: string
  hermesUsed: boolean
  fileName: string | null
}

interface SourceAsset {
  id: string
  fileName: string
  mimeType: string
  storageKey: string
  sizeBytes: number | null
  buffer: Buffer
  extension: string
}

/**
 * Erzeugt eine dokumentbasierte Musterlösung: Kopie des Originals mit
 * ausgefüllten Lücken/Feldern bzw. visuellem Text-Overlay auf PDF-Seiten.
 */
export async function generateSolution(
  materialId: string,
  userId: string | null,
  options: GenerateSolutionOptions = {},
): Promise<GenerateSolutionResult> {
  const db = useDatabase()
  const settings = await getAiSettings()
  const hermes = await getHermesSettings()

  if (!settings.enabled && !(hermes.enabled && hermes.baseUrl.trim())) {
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

  const source = variant ? await loadPrimarySourceAsset(variant.id) : null

  // PDF-Arbeitsblätter brauchen Seitenbilder für Lückenpositionen (bbox).
  const forceVisionForPdf = Boolean(source && PDF_EXTENSIONS.has(source.extension))
  const useVision = options.useVision ?? (settings.useVision || forceVisionForPdf)
  const model = pickSolutionModel(settings, options.model, useVision, {
    allowEmpty: hermes.enabled && Boolean(hermes.baseUrl.trim()),
  })

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

  // Lücken vor dem Modellaufruf erkennen (PDF-Geometrie oder DOCX-Textebene).
  let detectedBlanks: PdfBlankRegion[] = []
  let docxBlanks: TextBlankInfo[] = []
  if (source && PDF_EXTENSIONS.has(source.extension)) {
    try {
      detectedBlanks = await detectPdfBlankRegions(source.buffer)
      log.info('PDF-Lücken für Prompt erkannt', {
        count: detectedBlanks.length,
        sample: detectedBlanks.slice(0, 3).map((b) => ({
          i: b.blankIndex,
          left: b.leftText,
          right: b.rightText,
          kind: b.kind,
        })),
      })
    } catch (error) {
      log.warn('PDF-Lückenerkennung vor Prompt fehlgeschlagen', error)
    }
  } else if (source?.extension === 'docx') {
    try {
      docxBlanks = detectDocxBlanks(source.buffer)
      log.info('DOCX-Lücken für Prompt erkannt', {
        count: docxBlanks.length,
        sample: docxBlanks.slice(0, 3),
      })
    } catch (error) {
      log.warn('DOCX-Lückenerkennung vor Prompt fehlgeschlagen', error)
    }
  }

  const blankCount = detectedBlanks.length || docxBlanks.length
  // Ohne zuverlässige Lücken: offener Erwartungshorizont statt erzwungener Lückentext-Füllung.
  const fillMode: SolutionFillMode = classifySolutionFillMode(
    detectedBlanks.length ? detectedBlanks : docxBlanks,
  )
  log.info('Musterlösungs-Füllmodus', {
    fillMode,
    blanks: blankCount,
    source: source?.fileName ?? null,
  })

  const blankInventory =
    fillMode === 'lueckentext'
      ? detectedBlanks.length
        ? formatBlankInventory(detectedBlanks)
        : docxBlanks.length
          ? formatTextBlankInventory(docxBlanks)
          : null
      : null

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
    sourceFileName: source?.fileName ?? null,
    sourceMimeType: source?.mimeType ?? null,
    blankInventory,
    detectedBlankCount: fillMode === 'lueckentext' ? blankCount || null : null,
    fillMode,
  })

  if (!documentText && !source && !material.content?.trim()) {
    throw appError(
      'KI_FEHLER',
      'Zu diesem Material liegt weder eine Datei noch auslesbarer Text vor. Bitte eine Datei hinterlegen.',
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
      // Enum kennt nur OpenAI-kompatible Anbieter; Hermes wird in aiMeta vermerkt.
      provider: settings.provider,
      model,
      status: 'laeuft',
      prompt: privacy.storeAiPrompts ? prompt.slice(0, 100_000) : null,
    })
    .returning({ id: aiJobs.id })

  const jobId = job!.id

  try {
    let filled: FilledDocument | null = null
    let hermesUsed = false
    let attachments = 0
    let visionUsed = false
    let usedModel = model
    let structured: StructuredSolution | null = null

    // 1) Optional: Hermes document-fill (agentisch, ausgefülltes Dokument zurück).
    if (source && hermes.enabled && hermes.baseUrl.trim()) {
      const hermesResult = await tryHermesDocumentFill(hermes, {
        task: 'fill_solution',
        instructions: [
          prompt,
          options.userInstructions?.trim() ? `\nHinweise: ${options.userInstructions.trim()}` : '',
        ].join(''),
        fileName: source.fileName,
        mimeType: source.mimeType,
        documentBase64: source.buffer.toString('base64'),
        meta: {
          title: material.title,
          materialId,
          subjects: material.subjects.map((s) => s.name),
          gradeLevels: material.gradeLevels,
        },
      })

      if (hermesResult) {
        hermesUsed = true
        usedModel = hermesResult.model
        filled = {
          buffer: hermesResult.buffer,
          fileName: hermesResult.fileName || solutionFileName(source.fileName, extensionOf(hermesResult.fileName || source.fileName)),
          mimeType: hermesResult.mimeType,
          strategy: 'hermes',
          summary: hermesResult.summary,
        }
      }
    }

    // 2) Lokaler Pfad: multimodales Modell → strukturierte Antworten → Dokument füllen.
    if (!filled) {
      if (!settings.enabled) {
        throw appError(
          'KI_NICHT_KONFIGURIERT',
          hermes.enabled
            ? 'Hermes konnte kein Dokument liefern und die lokale KI ist nicht aktiviert.'
            : 'Die KI-Unterstützung ist nicht aktiviert. Bitte in den Einstellungen einrichten.',
        )
      }

      const parts: ChatPart[] = [{ type: 'text', text: prompt }]
      if (useVision && variant) {
        const media = await collectVisionParts(variant.id, settings.provider)
        parts.push(...media.parts)
        attachments = media.parts.length
        visionUsed = media.parts.length > 0
        if (media.skipped.length) {
          log.info('Einige Anhänge wurden nicht an das Modell übergeben', {
            skipped: media.skipped,
          })
        }
      }

      // Textinhalt als zusätzliche Grundlage, falls keine Vision/Datei.
      if (!documentText && !visionUsed && material.content?.trim()) {
        parts.push({
          type: 'text',
          text: `\n\n## Manueller Inhalt\n\n${material.content.trim().slice(0, 40_000)}`,
        })
      }

      if (!documentText && !visionUsed && !material.content?.trim() && !source) {
        throw appError(
          'KI_FEHLER',
          'Zu diesem Material liegt weder auslesbarer Text noch eine übertragbare Datei vor.',
        )
      }

      const completion = await chatCompletion(
        settings,
        [
          {
            role: 'system',
            parts: [{ type: 'text', text: solutionSystemPromptForMode(fillMode) }],
          },
          { role: 'user', parts },
        ],
        { model, maxOutputTokens: settings.maxOutputTokens },
      )

      usedModel = completion.model
      structured = parseStructuredSolution(completion.text)
      if (fillMode === 'offen') {
        structured = {
          ...structured,
          answers: structured.answers.map((a) => ({
            ...a,
            fieldType: 'freitext' as const,
            blankIndex: null,
            leftContext: null,
            rightContext: null,
            bbox: null,
          })),
        }
      } else if (detectedBlanks.length > 0) {
        structured = alignAnswersToBlanks(structured, detectedBlanks)
        log.info('Antworten an erkannte Lücken ausgerichtet', {
          answers: structured.answers.length,
          blanks: detectedBlanks.length,
          blankIndexes: structured.answers.map((a) => a.blankIndex),
        })
      }
      if (source && PDF_EXTENSIONS.has(source.extension)) {
        structured = await enrichFromPdfBuffer(
          source.buffer,
          structured,
          fillMode === 'lueckentext' ? detectedBlanks : [],
        )
      } else {
        structured = {
          ...structured,
          answers: structured.answers.map((a) => ({
            ...a,
            fieldType:
              a.fieldType ??
              (fillMode === 'offen' || a.answer.length > 90 || /\n/.test(a.answer)
                ? 'freitext'
                : 'luecke'),
          })),
        }
      }
      filled = await buildFilledDocument(source, structured, material.title, fillMode)
    }

    if (!filled) {
      throw appError('KI_FEHLER', 'Es konnte kein Lösungsdokument erzeugt werden.')
    }

    const summaryMd = [
      AI_CONTENT_NOTICE_MD,
      '',
      filled.summary,
      structured ? `\n${solutionToMarkdown(structured)}` : '',
      '',
      `_Erzeugt als Dokument (${filled.strategy})._`,
    ]
      .filter(Boolean)
      .join('\n')
      .slice(0, 20_000)

    const authorCredit =
      kiAutorAnzeige({ model: usedModel, provider: hermesUsed ? 'hermes' : settings.provider }) ??
      `KI · ${usedModel}`

    const solutionMaterialId = await createMaterial(
      {
        title: `Musterlösung – ${material.title}`,
        description: `Automatisch erstellte Musterlösung zum Material „${material.title}“.`,
        content: summaryMd,
        materialType: 'musterloesung',
        schoolForm: material.schoolForm,
        pages: material.pages,
        author: authorCredit,
        origin: 'ki',
        aiMeta: {
          provider: hermesUsed ? 'hermes' : settings.provider,
          model: usedModel,
          generatedAt: new Date().toISOString(),
          sourceMaterialId: materialId,
          sourceVariantId: variant?.id ?? null,
          sourceAssetId: source?.id ?? null,
          promptVersion: SOLUTION_PROMPT_VERSION,
          reviewed: false,
          fillMode,
          fillStrategy: filled.strategy,
          hermesUsed,
          sourceFileName: source?.fileName,
          structuredSolution: structured,
        },
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

    const [solutionVariant] = await db
      .select({ id: materialVariants.id })
      .from(materialVariants)
      .where(eq(materialVariants.materialId, solutionMaterialId))
      .limit(1)

    if (solutionVariant) {
      await addFileAsset(
        solutionVariant.id,
        { buffer: filled.buffer, fileName: filled.fileName },
        { role: 'haupt', title: 'Musterlösung (Dokument)' },
        db,
      )
    }

    await addRelation(materialId, solutionMaterialId, 'musterloesung', 'Automatisch erstellt', db)

    await db
      .update(aiJobs)
      .set({
        status: 'erfolgreich',
        result: filled.summary.slice(0, 200_000),
        resultMaterialId: solutionMaterialId,
        durationMs: Date.now() - startedAt,
        finishedAt: new Date(),
      })
      .where(eq(aiJobs.id, jobId))

    log.info('Musterlösung erzeugt', {
      materialId,
      solutionMaterialId,
      model: usedModel,
      strategy: filled.strategy,
      hermesUsed,
    })

    return {
      jobId,
      solutionMaterialId,
      model: usedModel,
      attachments,
      usedVision: visionUsed,
      fillStrategy: filled.strategy,
      hermesUsed,
      fileName: filled.fileName,
    }
  } catch (error) {
    await db
      .update(aiJobs)
      .set({
        status: 'fehlgeschlagen',
        errorMessage: oeffentlicheFehlermeldung(
          error,
          'Die KI-Musterlösung konnte nicht erzeugt werden.',
        ),
        durationMs: Date.now() - startedAt,
        finishedAt: new Date(),
      })
      .where(eq(aiJobs.id, jobId))
    throw error
  }
}

function pickSolutionModel(
  settings: AiSettings,
  override: string | undefined,
  useVision: boolean,
  options: { allowEmpty?: boolean } = {},
): string {
  if (override?.trim()) return override.trim()
  if (useVision && settings.visionModel?.trim()) return settings.visionModel.trim()
  if (settings.chatModel?.trim()) return settings.chatModel.trim()
  if (options.allowEmpty) return 'hermes-agent'
  throw appError('KI_NICHT_KONFIGURIERT', 'Es ist kein Sprach-/Vision-Modell konfiguriert.')
}

async function loadPrimarySourceAsset(variantId: string): Promise<SourceAsset | null> {
  const db = useDatabase()
  const assets = await db
    .select()
    .from(materialAssets)
    .where(eq(materialAssets.variantId, variantId))

  const file =
    assets.find((a) => a.kind === 'datei' && a.role === 'haupt' && a.storageKey) ??
    assets.find((a) => a.kind === 'datei' && a.storageKey)

  if (!file?.storageKey || !file.fileName || !file.mimeType) return null
  if ((file.sizeBytes ?? 0) > MAX_ATTACHMENT_BYTES) {
    log.warn('Quelldatei zu groß für Dokumentfüllung', { assetId: file.id })
    return null
  }

  const buffer = await readFile(resolveStoragePath(file.storageKey))
  return {
    id: file.id,
    fileName: file.fileName,
    mimeType: file.mimeType,
    storageKey: file.storageKey,
    sizeBytes: file.sizeBytes,
    buffer,
    extension: extensionOf(file.fileName),
  }
}

async function buildFilledDocument(
  source: SourceAsset | null,
  solution: StructuredSolution,
  materialTitle: string,
  fillMode: SolutionFillMode = 'lueckentext',
): Promise<FilledDocument> {
  const title = `Musterlösung – ${materialTitle}`
  const sourceBaseName = source?.fileName ?? materialTitle

  // Offene Aufgabe ohne Antwortfelder: separates blankes PDF (Aufgabennummer + Lösung).
  if (fillMode === 'offen') {
    if (source && PDF_EXTENSIONS.has(source.extension)) {
      const acro = await fillPdfAcroForm(source.buffer, solution)
      if (acro) {
        return {
          buffer: acro.buffer,
          fileName: solutionFileName(source.fileName, 'pdf'),
          mimeType: 'application/pdf',
          strategy: 'pdf_acroform',
          summary: solution.summary,
        }
      }
    }
    if (source?.extension === 'docx') {
      // Word bleibt Word: Lücken blau füllen oder Lösungsteil anhängen – kein PDF-Overlay.
      const result = fillDocxDocument(source.buffer, solution, {
        title,
        notice: AI_CONTENT_NOTICE,
      })
      return {
        buffer: result.buffer,
        fileName: solutionFileName(source.fileName, 'docx'),
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        strategy: result.strategy,
        summary: solution.summary,
      }
    }

    const buffer = await buildAnswerListPdf(title, solution, { notice: AI_CONTENT_NOTICE })
    log.info('Separates Musterlösungs-PDF erzeugt', { answers: solution.answers.length })
    return {
      buffer,
      fileName: solutionFileName(sourceBaseName, 'pdf'),
      mimeType: 'application/pdf',
      strategy: 'pdf_separate',
      summary: solution.summary,
    }
  }

  if (source && OFFICE_EXTENSIONS.has(source.extension)) {
    // DOCX: Antworten direkt in die Textlücken (blaue Schrift) – bleibt Word-Dokument.
    if (source.extension === 'docx') {
      const result = fillDocxDocument(source.buffer, solution, {
        title,
        notice: AI_CONTENT_NOTICE,
      })
      log.info('DOCX-Musterlösung befüllt', {
        strategy: result.strategy,
        filled: result.filled,
        answers: solution.answers.length,
      })
      return {
        buffer: result.buffer,
        fileName: solutionFileName(source.fileName, 'docx'),
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        strategy: result.strategy,
        summary: solution.summary,
      }
    }

    // Andere Office-Formate: neues DOCX mit Lösungen (Collabora kann es öffnen).
    const buffer = buildSolutionDocx(title, solution, { notice: AI_CONTENT_NOTICE })
    return {
      buffer,
      fileName: solutionFileName(source.fileName, 'docx'),
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      strategy: 'docx_from_structure',
      summary: solution.summary,
    }
  }

  if (source && PDF_EXTENSIONS.has(source.extension)) {
    const acro = await fillPdfAcroForm(source.buffer, solution)
    if (acro) {
      return {
        buffer: acro.buffer,
        fileName: solutionFileName(source.fileName, 'pdf'),
        mimeType: 'application/pdf',
        strategy: 'pdf_acroform',
        summary: solution.summary,
      }
    }

    // PDFs ohne AcroForm: Originalseiten behalten und Lösungen als Text-Overlay einzeichnen.
    const overlay = await overlayPdfAnswers(source.buffer, solution)
    log.info('PDF-Overlay erzeugt', {
      overlays: overlay.overlays,
      usedGeometry: overlay.usedGeometry,
      usedBBox: overlay.usedBBox,
      answers: solution.answers.length,
    })
    return {
      buffer: overlay.buffer,
      fileName: solutionFileName(source.fileName, 'pdf'),
      mimeType: 'application/pdf',
      strategy: 'pdf_overlay',
      summary: solution.summary,
    }
  }

  // Keine Datei: DOCX aus Struktur erzeugen.
  const buffer = buildSolutionDocx(title, solution, { notice: AI_CONTENT_NOTICE })
  return {
    buffer,
    fileName: solutionFileName(materialTitle, 'docx'),
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    strategy: 'docx_from_structure',
    summary: solution.summary,
  }
}

/**
 * Bereitet die Dateien einer Variante für das Modell auf.
 * PDFs gehen direkt an Anbieter, die das unterstützen; andernfalls werden die
 * ersten Seiten als Bilder gerendert (typisch für multimodale Ollama-Modelle).
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
          // Multimodale lokale Modelle (z. B. gemma4): Seiten als Bilder.
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

      const ext = extensionOf(asset.fileName ?? '')
      if (OFFICE_VISION_EXTENSIONS.has(ext)) {
        const pdfBuffer = await convertOfficeBufferToPdf(buffer, asset.fileName ?? `datei.${ext}`)
        if (!pdfBuffer) {
          skipped.push(`${asset.fileName} (Office→PDF nicht möglich – Text kommt separat)`)
          continue
        }
        if (supportsNativePdf(provider)) {
          parts.push({
            type: 'file',
            mimeType: 'application/pdf',
            base64: pdfBuffer.toString('base64'),
            fileName: (asset.fileName ?? 'material').replace(/\.[^.]+$/, '') + '.pdf',
          })
        } else {
          const pages = await rasterizePdf(pdfBuffer, { maxPages: MAX_VISION_PAGES })
          if (pages.length === 0) {
            skipped.push(`${asset.fileName} (Bildumwandlung nach Office→PDF nicht möglich)`)
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

/** Schreibt einen Office-Puffer temporär und konvertiert ihn per LibreOffice nach PDF. */
async function convertOfficeBufferToPdf(
  buffer: Buffer,
  fileName: string,
): Promise<Buffer | null> {
  const workDir = await mkdtemp(join(tmpdir(), 'saru-sol-office-'))
  const safe =
    fileName.replace(/[^\w.\-()+äöüÄÖÜß ]/g, '_').slice(0, 120) || `datei.${extensionOf(fileName)}`
  const inputPath = join(workDir, safe)
  try {
    await writeFile(inputPath, buffer)
    return await convertOfficeFileToPdf(inputPath)
  } catch (error) {
    log.warn('Office→PDF für Musterlösung fehlgeschlagen', { fileName, error })
    return null
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}

async function enrichFromPdfBuffer(
  buffer: Buffer,
  structured: StructuredSolution,
  blanks: PdfBlankRegion[],
): Promise<StructuredSolution> {
  try {
    const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true })
    const pageSizes = pdf.getPages().map((page) => page.getSize())
    return enrichSolutionPlacements(structured, blanks, pageSizes)
  } catch (error) {
    log.warn('Platzierungen konnten nicht angereichert werden', error)
    return {
      ...structured,
      answers: structured.answers.map((a) => ({
        ...a,
        fieldType:
          a.fieldType ?? (a.answer.length > 90 || /\n/.test(a.answer) ? 'freitext' : 'luecke'),
      })),
    }
  }
}

export interface UpdateSolutionOptions {
  structuredSolution: StructuredSolution
  /** PDF neu aus Quelldokument + Struktur zeichnen (Standard: true bei PDF-Overlay). */
  reRender?: boolean
  reviewed?: boolean
}

/**
 * Speichert korrigierte Antworten und erzeugt optional das Overlay-PDF neu.
 */
export async function updateSolutionStructure(
  materialId: string,
  userId: string,
  options: UpdateSolutionOptions,
): Promise<{ materialId: string; reRendered: boolean; fillStrategy: string | null }> {
  const db = useDatabase()
  const material = await getMaterialDetail(materialId, db)
  if (!material) throw appError('NICHT_GEFUNDEN', 'Das Material wurde nicht gefunden.')
  if (material.materialType !== 'musterloesung' || material.origin !== 'ki') {
    throw appError(
      'UNGUELTIGE_EINGABE',
      'Nur KI-Musterlösungen können so nachbearbeitet werden.',
    )
  }

  const meta = material.aiMeta ?? {}
  const sourceMaterialId = meta.sourceMaterialId
  if (!sourceMaterialId) {
    throw appError(
      'KI_FEHLER',
      'Zu dieser Musterlösung ist kein Quellmaterial hinterlegt – Neuzeichnen nicht möglich.',
    )
  }

  let structured = normalizeStructuredSolution(options.structuredSolution)
  const sourceMaterial = await getMaterialDetail(sourceMaterialId, db)
  if (!sourceMaterial) {
    throw appError('NICHT_GEFUNDEN', 'Das Quellmaterial der Musterlösung wurde nicht gefunden.')
  }

  const sourceVariant =
    sourceMaterial.variants.find((v) => v.id === meta.sourceVariantId) ??
    sourceMaterial.variants.find((v) => v.isDefault) ??
    sourceMaterial.variants[0]
  const source = sourceVariant ? await loadPrimarySourceAsset(sourceVariant.id) : null

  const fillStrategy = meta.fillStrategy ?? null
  const wantsRender = options.reRender !== false
  let reRendered = false
  let newStrategy = fillStrategy

  const storedFillMode: SolutionFillMode =
    meta.fillMode === 'offen' || meta.fillStrategy === 'pdf_separate'
      ? 'offen'
      : 'lueckentext'

  if (wantsRender && storedFillMode === 'offen') {
    const filled = await buildFilledDocument(
      source,
      structured,
      sourceMaterial.title,
      'offen',
    )
    await replaceHauptAsset(
      material,
      { buffer: filled.buffer, fileName: filled.fileName, mimeType: filled.mimeType },
      db,
    )
    reRendered = true
    newStrategy = filled.strategy
  } else if (wantsRender && source && PDF_EXTENSIONS.has(source.extension)) {
    // Antworten mit blankIndex an Geometrie ausrichten; manuell verschobene
    // (blankIndex = null) behalten ihre bbox. Anschließend preferBBox zeichnen.
    let blanks: PdfBlankRegion[] = []
    try {
      blanks = await detectPdfBlankRegions(source.buffer)
    } catch (error) {
      log.warn('Lückenerkennung beim Neuzeichnen fehlgeschlagen', error)
    }
    structured = await enrichFromPdfBuffer(source.buffer, structured, blanks)
    const overlay = await overlayPdfAnswers(source.buffer, structured, { preferBBox: true })
    await replaceHauptAsset(
      material,
      {
        buffer: overlay.buffer,
        fileName: solutionFileName(source.fileName, 'pdf'),
        mimeType: 'application/pdf',
      },
      db,
    )
    reRendered = true
    newStrategy = 'pdf_overlay'
  } else if (wantsRender && source && OFFICE_EXTENSIONS.has(source.extension)) {
    const filled = await buildFilledDocument(
      source,
      structured,
      sourceMaterial.title,
      storedFillMode,
    )
    await replaceHauptAsset(
      material,
      { buffer: filled.buffer, fileName: filled.fileName, mimeType: filled.mimeType },
      db,
    )
    reRendered = true
    newStrategy = filled.strategy
  } else if (wantsRender && !source) {
    throw appError(
      'KI_FEHLER',
      'Die Quelldatei wurde nicht gefunden – das Dokument kann nicht neu erzeugt werden.',
    )
  }

  const summaryMd = [
    AI_CONTENT_NOTICE_MD,
    '',
    structured.summary,
    `\n${solutionToMarkdown(structured)}`,
    '',
    reRendered ? `_Dokument neu erzeugt (${newStrategy})._` : `_Struktur gespeichert._`,
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 20_000)

  const authorCredit =
    kiAutorAnzeige({ model: meta.model, provider: meta.provider }, material.author) ??
    material.author

  const reviewed =
    options.reviewed !== undefined ? options.reviewed : Boolean(meta.reviewed)

  await updateMaterial(
    materialId,
    {
      content: summaryMd,
      author: authorCredit,
      aiMeta: {
        ...meta,
        structuredSolution: structured,
        fillStrategy: newStrategy ?? meta.fillStrategy,
        reviewed,
        reviewedAt: reviewed ? (meta.reviewedAt ?? new Date().toISOString()) : undefined,
        reviewedBy: reviewed ? (meta.reviewedBy ?? userId) : undefined,
        editedAt: new Date().toISOString(),
        editedBy: userId,
      },
    },
    db,
  )

  return { materialId, reRendered, fillStrategy: newStrategy }
}

async function replaceHauptAsset(
  material: NonNullable<Awaited<ReturnType<typeof getMaterialDetail>>>,
  file: { buffer: Buffer; fileName: string; mimeType: string },
  db: ReturnType<typeof useDatabase>,
): Promise<void> {
  const variant =
    material.variants.find((v) => v.isDefault) ?? material.variants[0]
  if (!variant) throw appError('KI_FEHLER', 'Die Lösungsvariante fehlt.')

  const oldHaupt =
    variant.assets.find((a) => a.kind === 'datei' && a.role === 'haupt') ??
    variant.assets.find((a) => a.kind === 'datei')

  if (oldHaupt) {
    await deleteAsset(oldHaupt.id, db)
  }

  await addFileAsset(
    variant.id,
    { buffer: file.buffer, fileName: file.fileName },
    { role: 'haupt', title: 'Musterlösung (Dokument)' },
    db,
  )
}

function normalizeStructuredSolution(raw: StructuredSolution): StructuredSolution {
  const answers: StructuredSolution['answers'] = []
  for (const [index, row] of (raw.answers ?? []).entries()) {
    const answer = String(row.answer ?? '').trim()
    if (!answer) continue
    const fieldRaw = String(row.fieldType ?? '').toLowerCase()
    const parsedType =
      fieldRaw === 'freitext' ? 'freitext' : fieldRaw === 'luecke' ? 'luecke' : null
    answers.push({
      id: String(row.id ?? index + 1),
      label: String(row.label ?? `Aufgabe ${index + 1}`).trim() || `Aufgabe ${index + 1}`,
      answer,
      page: typeof row.page === 'number' ? row.page : null,
      blankIndex: typeof row.blankIndex === 'number' ? row.blankIndex : null,
      leftContext: row.leftContext ? String(row.leftContext) : null,
      rightContext: row.rightContext ? String(row.rightContext) : null,
      bbox: row.bbox ?? null,
      fieldType:
        parsedType ??
        (answer.length > 90 || /\n/.test(answer) ? 'freitext' : 'luecke'),
    })
  }

  return {
    summary: String(raw.summary ?? 'Korrigierte Musterlösung.').trim(),
    answers,
    formFields: Array.isArray(raw.formFields)
      ? raw.formFields
          .map((f) => ({
            name: String(f.name ?? '').trim(),
            value: String(f.value ?? '').trim(),
          }))
          .filter((f) => f.name && f.value)
      : [],
    notesForTeacher: raw.notesForTeacher ? String(raw.notesForTeacher) : null,
    uncertainties: raw.uncertainties ? String(raw.uncertainties) : null,
  }
}

/**
 * Liefert die strukturierte Lösung mit an PDF-Geometrie ausgerichteten bboxes
 * für den Korrektur-Editor (Browser-Vorschau ≈ Overlay-PDF).
 * Antworten ohne blankIndex (manuell verschoben) behalten ihre bbox.
 */
export async function prepareEditableSolutionStructure(
  materialId: string,
): Promise<StructuredSolution | null> {
  const material = await getMaterialDetail(materialId)
  if (!material?.aiMeta?.structuredSolution) return null

  let structured = normalizeStructuredSolution(material.aiMeta.structuredSolution)
  const meta = material.aiMeta
  const sourceMaterialId = meta.sourceMaterialId
  if (!sourceMaterialId) return structured

  const sourceMaterial = await getMaterialDetail(sourceMaterialId)
  if (!sourceMaterial) return structured

  const sourceVariant =
    sourceMaterial.variants.find((v) => v.id === meta.sourceVariantId) ??
    sourceMaterial.variants.find((v) => v.isDefault) ??
    sourceMaterial.variants[0]
  const source = sourceVariant ? await loadPrimarySourceAsset(sourceVariant.id) : null
  if (!source || !PDF_EXTENSIONS.has(source.extension)) return structured

  try {
    const blanks = await detectPdfBlankRegions(source.buffer)
    structured = await enrichFromPdfBuffer(source.buffer, structured, blanks)
  } catch (error) {
    log.warn('Editor-Platzierungen konnten nicht an Geometrie ausgerichtet werden', error)
  }
  return structured
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
