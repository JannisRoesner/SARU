import { PDFDocument, StandardFonts } from 'pdf-lib'
import { describe, expect, it, vi } from 'vitest'
import { buildPdfLayoutDocumentV2, buildTextOnlyLayoutDocumentV2, markedRowContextForTarget } from '../../../server/services/ai/solutions-v2/layout-document'
import { solutionTaskHandlersV2 } from '../../../server/services/ai/solutions-v2/handler-registry'
import { parseSemanticVerdict, parseTaskSolutionJson } from '../../../server/services/ai/solutions-v2/model-json'
import { buildSolutionPlanV2 } from '../../../server/services/ai/solutions-v2/plan-builder'
import { reconcileTasksWithPageLayoutV2 } from '../../../server/services/ai/solutions-v2/page-task-reconciler'
import { validateSolutionPlanV2 } from '../../../server/services/ai/solutions-v2/plan-validator'
import { buildCandidateDisagreementRepairV2, buildTargetedCandidateRepairV2, runSolutionPipelineV2, taskSolutionSchema } from '../../../server/services/ai/solutions-v2/pipeline'
import { projectSolutionForRenderV2 } from '../../../server/services/ai/solutions-v2/renderer-projection'
import { validateSolvedTaskV2 } from '../../../server/services/ai/solutions-v2/solution-validator'
import type { TaskBlock } from '../../../server/services/ai/solutions/types'
import type { AiSettings } from '../../../server/services/settings.service'

function freeTextTask(id: string, page: number, y: number, instruction: string): TaskBlock {
  return {
    id,
    page,
    bbox: { x: 0.05, y: y - 0.06, w: 0.9, h: 0.04 },
    instruction,
    kind: 'free_text_inplace',
    confidence: 0.95,
    evidence: ['answer line targets'],
    renderMode: 'overlay',
    renderConfidence: 'high',
    targets: [{
      id: `${id}-line`,
      kind: 'answer_line',
      page,
      bbox: { x: 0.05, y, w: 0.9, h: 0.12 },
      source: 'native',
    }],
  }
}

describe('solution pipeline v2 contract', () => {
  it('registriert für jede kanonische Aufgabenart einen vollständigen Handler', () => {
    expect(Object.keys(solutionTaskHandlersV2).sort()).toEqual([
      'cloze',
      'diagram_labeling',
      'free_text',
      'matching',
      'multi_choice',
      'single_choice',
      'table_completion',
      'unsupported',
    ])
    expect(Object.values(solutionTaskHandlersV2).every((handler) => Boolean(
      handler.promptRules && handler.semanticFocus && handler.validateValue && handler.renderKind,
    ))).toBe(true)
  })

  it('erzwingt Mindestumfang und verlangtes Sprachregister bei Freitext', () => {
    const document = buildTextOnlyLayoutDocumentV2('Nenne mindestens drei umgangssprachliche Begriffe.', 'register')
    const build = buildSolutionPlanV2({
      document,
      sourceFormat: 'pdf',
      tasks: [{
        id: 'register-task',
        page: 1,
        bbox: { x: 0.1, y: 0.2, w: 0.8, h: 0.08 },
        instruction: 'Nenne mindestens drei umgangssprachliche Begriffe für Hoden.',
        kind: 'free_text_separate',
        confidence: 0.9,
        evidence: [],
        targets: [],
        renderMode: 'appendix',
      }],
    })
    const task = build.plan.tasks[0]!
    const slot = task.answerSlots[0]!
    const invalid = solutionTaskHandlersV2.free_text.validateValue(task, slot, 'Klöten, Testis')
    expect(invalid.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['ANSWER_MINIMUM_NOT_MET', 'ANSWER_REGISTER_MISMATCH']),
    )
    expect(solutionTaskHandlersV2.free_text.validateValue(task, slot, 'Klöten, Eier, Kronjuwelen')).toEqual([])
  })

  it('erzwingt die verlangte Mindestzahl an Sätzen', () => {
    const document = buildTextOnlyLayoutDocumentV2('Erkläre den Zusammenhang in mindestens drei Sätzen.', 'sentences')
    const build = buildSolutionPlanV2({
      document,
      sourceFormat: 'pdf',
      tasks: [{
        id: 'sentence-task',
        page: 1,
        bbox: { x: 0.1, y: 0.2, w: 0.8, h: 0.08 },
        instruction: 'Erkläre den Zusammenhang in mindestens drei Sätzen.',
        kind: 'free_text_separate',
        confidence: 0.9,
        evidence: [],
        targets: [],
        renderMode: 'appendix',
      }],
    })
    const task = build.plan.tasks[0]!
    const slot = task.answerSlots[0]!
    expect(solutionTaskHandlersV2.free_text.validateValue(task, slot, 'Satz eins. Satz zwei.'))
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'ANSWER_MINIMUM_NOT_MET' })]))
    expect(solutionTaskHandlersV2.free_text.validateValue(task, slot, 'Satz eins. Satz zwei. Satz drei.')).toEqual([])
  })

  it('blockiert unbelegte Verhaltenssprünge im Hoden-Gedankenexperiment', () => {
    const document = buildTextOnlyLayoutDocumentV2('Stelle dir vor, ein Tritt würde weniger weh tun.', 'causal')
    const build = buildSolutionPlanV2({
      document,
      sourceFormat: 'pdf',
      tasks: [{
        id: 'causal-task',
        page: 1,
        bbox: { x: 0.1, y: 0.2, w: 0.8, h: 0.08 },
        instruction: 'Stelle dir vor, ein Tritt in die Hoden würde weniger weh tun. Warum wäre das schlecht für die Familienplanung und den Fortbestand der Menschheit?',
        kind: 'free_text_separate',
        confidence: 0.9,
        evidence: [],
        targets: [],
        renderMode: 'appendix',
      }],
    })
    const task = build.plan.tasks[0]!
    const slot = task.answerSlots[0]!
    const invalid = solutionTaskHandlersV2.free_text.validateValue(
      task,
      slot,
      'Die Jungen wären sexuell aktiver und gingen eher eine Schwangerschaft ein.',
    )
    expect(invalid.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'ANSWER_UNSUPPORTED_CAUSAL_LEAP',
      'ANSWER_CAUSAL_CHAIN_INCOMPLETE',
    ]))
    expect(solutionTaskHandlersV2.free_text.validateValue(
      task,
      slot,
      'Der schwächere Warnschmerz kann Verletzungen unbemerkt lassen. Hodengewebe und Spermienbildung können geschädigt werden. Dadurch kann die Fruchtbarkeit sinken.',
    )).toEqual([])
  })

  it('weist offenen Schreibbereichen stabile IDs und eigenen Aufgabenbezug zu', () => {
    const document = buildTextOnlyLayoutDocumentV2(
      '1. Worauf ist beim Rasieren zu achten?\n2. Wie funktioniert Epilieren?',
      'rasieren',
    )
    const build = buildSolutionPlanV2({
      document,
      sourceFormat: 'pdf',
      tasks: [
        freeTextTask('old-1', 1, 0.4, 'Worauf ist beim Rasieren zu achten?'),
        freeTextTask('old-2', 1, 0.75, 'Wie funktioniert Epilieren?'),
      ],
    })

    expect(build.plan.tasks).toHaveLength(2)
    expect(build.plan.tasks[0]!.kind).toBe('free_text')
    expect(build.plan.tasks[0]!.answerSlots[0]!.targetId).not.toBe(
      build.plan.tasks[1]!.answerSlots[0]!.targetId,
    )
    expect(build.plan.tasks[0]!.answerSlots[0]!.promptContext).toContain('Rasieren')
    expect(validateSolutionPlanV2(build.plan)).toEqual([])
  })

  it('trennt zielose Anhang-Aufgaben mit identischer Instruktionsgeometrie', () => {
    const document = buildTextOnlyLayoutDocumentV2('Mehrere offene Aufgaben', 'shared-appendix')
    const sharedBox = { x: 0.05, y: 0.2, w: 0.9, h: 0.1 }
    const build = buildSolutionPlanV2({
      document,
      sourceFormat: 'pdf',
      tasks: [
        {
          id: 'first-open-task',
          page: 1,
          bbox: sharedBox,
          instruction: 'Erkläre den ersten Zusammenhang.',
          kind: 'free_text_separate',
          confidence: 0.9,
          evidence: [],
          targets: [],
          renderMode: 'appendix',
        },
        {
          id: 'open-task',
          page: 1,
          bbox: sharedBox,
          instruction: 'Erkläre den Zusammenhang.',
          kind: 'free_text_separate',
          confidence: 0.9,
          evidence: [],
          targets: [],
          renderMode: 'appendix',
        },
      ],
    })

    const targetIds = build.plan.tasks.map((task) => task.answerSlots[0]!.targetId)
    expect(new Set(targetIds).size).toBe(2)
    expect(validateSolutionPlanV2(build.plan)).toEqual([])
  })

  it('erfindet für eine Bildbeschriftung ohne Zielkoordinaten keinen Appendix-Slot', () => {
    const build = buildSolutionPlanV2({
      document: buildTextOnlyLayoutDocumentV2('Ordne A, B und C dem Bild zu.', 'missing-diagram-targets'),
      sourceFormat: 'pdf',
      tasks: [{
        id: 'labels',
        page: 1,
        bbox: { x: 0.1, y: 0.2, w: 0.8, h: 0.1 },
        instruction: 'Ordne A, B und C dem Bild zu.',
        kind: 'matching_inline',
        confidence: 0.9,
        evidence: [],
        targets: [],
        candidateBank: {
          id: 'labels-bank',
          reusePolicy: 'once',
          source: 'instruction',
          candidates: ['A', 'B', 'C'].map((value) => ({ id: value, value, normalized: value.toLowerCase() })),
        },
        renderMode: 'appendix',
      }],
    })

    expect(build.plan.tasks[0]!.answerSlots).toEqual([])
    expect(validateSolutionPlanV2(build.plan).map((issue) => issue.code)).toContain('TASK_TARGETS_MISSING')
  })

  it('gruppiert Auswahlzellen pro Aussage und rendert nur die gewählte Zelle', () => {
    const task: TaskBlock = {
      id: 'choice',
      page: 1,
      bbox: { x: 0.1, y: 0.2, w: 0.8, h: 0.4 },
      instruction: 'Kreuze richtig oder falsch an.',
      kind: 'matching_table',
      confidence: 0.95,
      evidence: [],
      renderMode: 'overlay',
      targets: [
        { id: 'r1c1', kind: 'choice_cell', page: 1, cellRef: '0:1:1', choiceValue: 'richtig', bbox: { x: 0.7, y: 0.3, w: 0.05, h: 0.04 } },
        { id: 'r1c2', kind: 'choice_cell', page: 1, cellRef: '0:1:2', choiceValue: 'falsch', bbox: { x: 0.8, y: 0.3, w: 0.05, h: 0.04 } },
        { id: 'r2c1', kind: 'choice_cell', page: 1, cellRef: '0:2:1', choiceValue: 'richtig', bbox: { x: 0.7, y: 0.4, w: 0.05, h: 0.04 } },
        { id: 'r2c2', kind: 'choice_cell', page: 1, cellRef: '0:2:2', choiceValue: 'falsch', bbox: { x: 0.8, y: 0.4, w: 0.05, h: 0.04 } },
      ],
    }
    const build = buildSolutionPlanV2({
      document: buildTextOnlyLayoutDocumentV2('Aussage 1 Aussage 2', 'choice'),
      sourceFormat: 'pdf',
      tasks: [task],
    })
    const spec = build.plan.tasks[0]!
    expect(spec.kind).toBe('single_choice')
    expect(spec.answerSlots).toHaveLength(2)
    expect(spec.answerSlots[0]!.allowedValues).toEqual(['richtig', 'falsch'])

    const projection = projectSolutionForRenderV2({
      plan: build.plan,
      rendererTasks: build.rendererTasks,
      solvedTasks: [{
        taskId: spec.taskId,
        answers: [
          { targetId: spec.answerSlots[0]!.targetId, value: 'richtig' },
          { targetId: spec.answerSlots[1]!.targetId, value: 'falsch' },
        ],
        uncertainties: [],
      }],
    })
    expect(projection.solution.answers).toHaveLength(2)
    expect(projection.solution.answers.every((answer) => answer.answer !== 'richtig' || answer.targetId)).toBe(true)
    expect(projection.manifest.operations.map((operation) => operation.value)).toEqual(['X', 'X'])
    expect(new Set(projection.manifest.operations.map((operation) => operation.targetId)).size).toBe(2)
  })

  it('akzeptiert kein abgeschnittenes oder um IDs erweitertes Modell-JSON', () => {
    expect(parseTaskSolutionJson('{"taskId":"t","answers":[')).toBeNull()
    expect(parseTaskSolutionJson('```json\n{"taskId":"t","answers":[{"targetId":"x","value":"A"}]}\n```')).not.toBeNull()

    const build = buildSolutionPlanV2({
      document: buildTextOnlyLayoutDocumentV2('Frage', 'ids'),
      sourceFormat: 'pdf',
      tasks: [freeTextTask('one', 1, 0.5, 'Frage')],
    })
    const task = build.plan.tasks[0]!
    const issues = validateSolvedTaskV2(task, {
      taskId: task.taskId,
      answers: [{ targetId: 'vom-modell-erfunden', value: 'Antwort' }],
      uncertainties: [],
    })
    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['MODEL_EXTRA_TARGET', 'ANSWERS_PARTIAL']),
    )
  })

  it('begrenzt bereits das Modell-Schema auf die IDs der aktuellen Aufgabe', () => {
    const build = buildSolutionPlanV2({
      document: buildTextOnlyLayoutDocumentV2('Frage', 'schema-ids'),
      sourceFormat: 'pdf',
      tasks: [freeTextTask('schema', 1, 0.5, 'Frage')],
    })
    const task = build.plan.tasks[0]!
    const schema = taskSolutionSchema(task) as {
      properties: {
        taskId: { enum: string[] }
        answers: { minItems: number; maxItems: number; items: { properties: { targetId: { enum: string[] } } } }
      }
    }

    expect(schema.properties.taskId.enum).toEqual([task.taskId])
    expect(schema.properties.answers.minItems).toBe(task.answerSlots.length)
    expect(schema.properties.answers.maxItems).toBe(task.answerSlots.length)
    expect(schema.properties.answers.items.properties.targetId.enum).toEqual(
      task.answerSlots.map((slot) => slot.targetId),
    )
  })

  it('akzeptiert eine vollständige direkte Wortlistenzuordnung ohne quadratische Ranglisten', () => {
    const build = buildSolutionPlanV2({
      document: buildTextOnlyLayoutDocumentV2('Die ___ und der ___.', 'cloze-bank'),
      sourceFormat: 'pdf',
      tasks: [{
        id: 'cloze',
        page: 1,
        bbox: { x: 0.1, y: 0.2, w: 0.8, h: 0.1 },
        instruction: 'Setze die Wörter ein.',
        kind: 'cloze',
        confidence: 0.95,
        evidence: [],
        renderMode: 'overlay',
        candidateBank: {
          id: 'bank',
          reusePolicy: 'once',
          source: 'wordlist_section',
          candidates: [
            { id: 'c1', value: 'Sonne', normalized: 'sonne' },
            { id: 'c2', value: 'Mond', normalized: 'mond' },
          ],
        },
        targets: [
          { id: 'blank-1', kind: 'blank', page: 1, bbox: { x: 0.2, y: 0.25, w: 0.1, h: 0.03 } },
          { id: 'blank-2', kind: 'blank', page: 1, bbox: { x: 0.45, y: 0.25, w: 0.1, h: 0.03 } },
        ],
      }],
    })
    const task = build.plan.tasks[0]!
    const parsed = parseTaskSolutionJson(JSON.stringify({
      taskId: task.taskId,
      answers: task.answerSlots.map((slot, index) => ({
        targetId: slot.targetId,
        value: index === 0 ? 'Sonne' : 'Mond',
      })),
      uncertainties: [],
    }))

    expect(parsed?.parsedAnswers.every((answer) => answer.rankings.length === 0)).toBe(true)
    expect(validateSolvedTaskV2(task, parsed!)).toEqual([])
  })

  it('repariert bei einer Wortlisten-Kollision nur die strittigen Ziele', () => {
    const task = {
      taskId: 'cloze',
      kind: 'cloze' as const,
      page: 1,
      instruction: 'Setze die Wörter ein.',
      instructionBBox: null,
      confidence: 1,
      issues: [],
      candidateBank: {
        id: 'bank',
        reusePolicy: 'once' as const,
        source: 'wordlist_section' as const,
        candidates: [
          { id: 'c1', value: 'Sonne', normalized: 'sonne' },
          { id: 'c2', value: 'Mond', normalized: 'mond' },
          { id: 'c3', value: 'Sterne', normalized: 'sterne' },
        ],
      },
      answerSlots: ['one', 'two', 'three'].map((targetId) => ({
        targetId,
        page: 1,
        bbox: null,
        promptContext: `Kontext ${targetId}`,
        targetKind: 'blank' as const,
        valueType: 'text' as const,
        renderPolicy: 'pdf_text_overlay' as const,
        capacity: { maxChars: 20, maxLines: 1 },
        provenance: [{ source: 'pdf_text' as const, sourceRef: targetId }],
      })),
    }
    const repair = buildTargetedCandidateRepairV2(task, {
      taskId: 'cloze',
      answers: [
        { targetId: 'one', value: 'Sonne' },
        { targetId: 'two', value: 'Sonne' },
        { targetId: 'three', value: 'Mond' },
      ],
      uncertainties: [],
    })

    expect(repair?.fixedAnswers).toEqual([{ targetId: 'three', value: 'Mond' }])
    expect(repair?.repairTask.answerSlots.map((slot) => slot.targetId)).toEqual(['one', 'two'])
    expect(repair?.repairTask.candidateBank?.candidates.map((candidate) => candidate.value)).toEqual(['Sonne', 'Sterne'])
  })

  it('reduziert widersprüchliche Erst- und Kontrollzuordnungen auf die abweichenden Slots', () => {
    const task = {
      taskId: 'cloze-check',
      kind: 'cloze' as const,
      page: 1,
      instruction: 'Setze ein.',
      instructionBBox: null,
      confidence: 1,
      issues: [],
      candidateBank: {
        id: 'bank',
        reusePolicy: 'once' as const,
        source: 'wordlist_section' as const,
        candidates: [
          { id: 'c1', value: 'Sonne', normalized: 'sonne' },
          { id: 'c2', value: 'Mond', normalized: 'mond' },
          { id: 'c3', value: 'Sterne', normalized: 'sterne' },
        ],
      },
      answerSlots: ['one', 'two', 'three'].map((targetId) => ({
        targetId,
        page: 1,
        bbox: null,
        promptContext: `Satz ___ ${targetId}`,
        targetKind: 'blank' as const,
        valueType: 'text' as const,
        renderPolicy: 'pdf_text_overlay' as const,
        capacity: { maxChars: 20, maxLines: 1 },
        provenance: [{ source: 'pdf_text' as const, sourceRef: targetId }],
      })),
    }
    const repair = buildCandidateDisagreementRepairV2(
      task,
      {
        taskId: task.taskId,
        answers: [
          { targetId: 'one', value: 'Sonne' },
          { targetId: 'two', value: 'Mond' },
          { targetId: 'three', value: 'Sterne' },
        ],
        uncertainties: [],
      },
      {
        taskId: task.taskId,
        answers: [
          { targetId: 'one', value: 'Sterne' },
          { targetId: 'two', value: 'Mond' },
          { targetId: 'three', value: 'Sonne' },
        ],
        uncertainties: [],
      },
    )

    expect(repair?.fixedAnswers).toEqual([{ targetId: 'two', value: 'Mond' }])
    expect(repair?.repairTask.answerSlots.map((slot) => slot.targetId)).toEqual(['one', 'three'])
    expect(repair?.repairTask.candidateBank?.candidates.map((candidate) => candidate.value)).toEqual(['Sonne', 'Sterne'])
  })

  it('rekonstruiert für eine rein grafische Lücke den Satz mit Marker', () => {
    const document = {
      schemaVersion: 2 as const,
      sourceHash: 'marked-row',
      fullText: 'Links und rechts',
      pages: [{
        page: 1,
        width: 600,
        height: 800,
        extractionQuality: 'text_layer' as const,
        textSpans: [
          { id: 'left', page: 1, text: 'Das ist links', bbox: { x: 0.1, y: 0.4, w: 0.25, h: 0.02 } },
          { id: 'right', page: 1, text: 'und hier rechts.', bbox: { x: 0.62, y: 0.4, w: 0.25, h: 0.02 } },
        ],
      }],
    }

    expect(markedRowContextForTarget(
      document,
      1,
      { x: 0.36, y: 0.395, w: 0.24, h: 0.025 },
    )).toBe('Das ist links ___ und hier rechts.')
  })

  it('erkennt eine falsche Erstzuordnung und repariert nur widersprüchliche Slots', async () => {
    const build = buildSolutionPlanV2({
      document: buildTextOnlyLayoutDocumentV2('Drei eindeutige Lückensätze', 'independent-check'),
      sourceFormat: 'pdf',
      tasks: [{
        id: 'checked-cloze',
        page: 1,
        bbox: { x: 0.1, y: 0.2, w: 0.8, h: 0.2 },
        instruction: 'Setze die Wörter ein.',
        kind: 'cloze',
        confidence: 1,
        evidence: [],
        renderMode: 'overlay',
        candidateBank: {
          id: 'bank',
          reusePolicy: 'once',
          source: 'wordlist_section',
          candidates: [
            { id: 'c1', value: 'Sonne', normalized: 'sonne' },
            { id: 'c2', value: 'Mond', normalized: 'mond' },
            { id: 'c3', value: 'Sterne', normalized: 'sterne' },
          ],
        },
        targets: [
          { id: 'b1', kind: 'blank', page: 1, blankIndex: 0, leftText: 'Die', rightText: 'scheint.', bbox: { x: 0.2, y: 0.3, w: 0.1, h: 0.02 } },
          { id: 'b2', kind: 'blank', page: 1, blankIndex: 1, leftText: 'Der', rightText: 'leuchtet.', bbox: { x: 0.2, y: 0.4, w: 0.1, h: 0.02 } },
          { id: 'b3', kind: 'blank', page: 1, blankIndex: 2, leftText: 'Die', rightText: 'funkeln.', bbox: { x: 0.2, y: 0.5, w: 0.1, h: 0.02 } },
        ],
      }],
    })
    const task = build.plan.tasks[0]!
    const ids = task.answerSlots.map((slot) => slot.targetId)
    expect(task.answerSlots[0]!.promptContext).toBe('Die ___ scheint.')
    const solution = (values: string[], selectedIds = ids) => ({
      taskId: task.taskId,
      answers: selectedIds.map((targetId, index) => ({ targetId, value: values[index]! })),
      uncertainties: [],
    })
    const responses = [
      solution(['Sterne', 'Mond', 'Sonne']),
      solution(['Sonne', 'Sonne', 'Sterne']),
      solution(['Sonne', 'Mond', 'Sterne']),
      solution(['Sonne', 'Sterne'], [ids[0]!, ids[2]!]),
      solution(['Sonne', 'Mond', 'Sterne']),
      { taskId: task.taskId, verdict: 'pass', issues: [] },
    ]
    const requestBodies: Array<Record<string, unknown>> = []
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      const response = responses.shift()
      return new Response(JSON.stringify({
        model: 'gemma4:e4b-it-qat',
        message: { content: JSON.stringify(response) },
        done_reason: 'stop',
        prompt_eval_count: 100,
        eval_count: 50,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const settings: AiSettings = {
      enabled: true,
      provider: 'ollama',
      baseUrl: 'http://localhost:11434/v1',
      apiKey: '',
      chatModel: 'gemma4:e4b-it-qat',
      visionModel: 'gemma4:e4b-it-qat',
      useVision: true,
      embeddingsEnabled: false,
      embeddingModel: '',
      temperature: 0,
      maxOutputTokens: 4000,
      timeoutMs: 10_000,
      refererUrl: '',
      appTitle: 'SARU Test',
    }

    try {
      const result = await runSolutionPipelineV2({
        build,
        settings,
        model: settings.chatModel,
        pageParts: [],
      })
      expect(result.qualityReport.semantic).toBe('passed')
      expect(result.solvedTasks[0]?.answers.map((answer) => answer.value)).toEqual([
        'Sonne',
        'Mond',
        'Sterne',
      ])
      expect(fetchMock).toHaveBeenCalledTimes(6)
      const verifierRetryPrompt = JSON.stringify(requestBodies[2])
      expect(verifierRetryPrompt).toContain('mehrfach verwendet')
      const repairPrompt = JSON.stringify(requestBodies[3])
      expect(repairPrompt).toContain(ids[0]!)
      expect(repairPrompt).not.toContain(ids[1]!)
      expect(repairPrompt).toContain(ids[2]!)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('verlangt einen auswertbaren getrennten Semantik-Verdict', () => {
    expect(parseSemanticVerdict('{"taskId":"t","verdict":"pass","issues":[]}')).toEqual({
      taskId: 't',
      verdict: 'pass',
      issues: [],
    })
    expect(parseSemanticVerdict('{"taskId":"t","verdict":"vielleicht"}')).toBeNull()
  })

  it('bewahrt Seitennummern und Textgeometrie in mehrseitigen PDFs', async () => {
    const pdf = await PDFDocument.create()
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    const first = pdf.addPage([300, 400])
    first.drawText('Aufgabe auf Seite eins', { x: 30, y: 340, font, size: 12 })
    const second = pdf.addPage([300, 400])
    second.drawText('Aufgabe auf Seite zwei', { x: 30, y: 300, font, size: 12 })
    const document = await buildPdfLayoutDocumentV2(Buffer.from(await pdf.save()))
    expect(document.pages).toHaveLength(2)
    expect(document.pages[0]!.textSpans[0]!.page).toBe(1)
    expect(document.pages[1]!.textSpans[0]!.page).toBe(2)
    expect(document.pages[1]!.textSpans[0]!.bbox.y).toBeGreaterThan(0)
  })

  it('segmentiert ziel­lose Aufgaben pro Seite und bewahrt native Zielseiten', () => {
    const document = {
      schemaVersion: 2 as const,
      sourceHash: 'pages',
      fullText: 'Welche Vorteile hat Methode A?\n\nErkläre Methode B ausführlich.',
      pages: [
        {
          page: 1,
          width: 300,
          height: 400,
          extractionQuality: 'text_layer' as const,
          textSpans: [{
            id: 'p1-text',
            page: 1,
            text: 'Welche Vorteile hat Methode A?',
            bbox: { x: 0.1, y: 0.2, w: 0.7, h: 0.04 },
          }],
        },
        {
          page: 2,
          width: 300,
          height: 400,
          extractionQuality: 'text_layer' as const,
          textSpans: [{
            id: 'p2-text',
            page: 2,
            text: 'Erkläre Methode B ausführlich.',
            bbox: { x: 0.1, y: 0.6, w: 0.7, h: 0.04 },
          }],
        },
      ],
    }
    const misplacedAppendix: TaskBlock = {
      id: 'legacy-open',
      page: 1,
      bbox: { x: 0.05, y: 0.1, w: 0.9, h: 0.08 },
      instruction: 'Erkläre Methode B ausführlich.',
      kind: 'free_text_separate',
      confidence: 0.8,
      evidence: [],
      targets: [],
      renderMode: 'appendix',
    }
    const native = freeTextTask('native', 2, 0.8, 'Native Schreibfläche')
    const tasks = reconcileTasksWithPageLayoutV2(document, [misplacedAppendix, native])

    expect(tasks.find((task) => task.instruction.includes('Methode B'))?.page).toBe(2)
    expect(tasks.some((task) => task.instruction.includes('Methode A') && task.page === 1)).toBe(true)
    expect(tasks.find((task) => task.id === 'native')?.page).toBe(2)
    expect(tasks.find((task) => task.id === 'native')?.targets).toHaveLength(1)
  })

  it('verwirft einen seitenübergreifenden Linien-Sammelblock bei mehreren echten Aufgaben', () => {
    const document = {
      schemaVersion: 2 as const,
      sourceHash: 'ambiguous-lines',
      fullText: 'Erkläre Ursache A.\nNenne drei Beispiele.\nVervollständige das Glossar. Begriff Bedeutung Hoden',
      pages: [
        {
          page: 1,
          width: 300,
          height: 400,
          extractionQuality: 'text_layer' as const,
          textSpans: [{
            id: 'p1-text',
            page: 1,
            text: 'Erkläre Ursache A. Nenne drei Beispiele.',
            bbox: { x: 0.1, y: 0.2, w: 0.8, h: 0.08 },
          }],
        },
        {
          page: 2,
          width: 300,
          height: 400,
          extractionQuality: 'text_layer' as const,
          textSpans: [{
            id: 'p2-text',
            page: 2,
            text: 'Vervollständige das Glossar. Begriff Bedeutung Hoden',
            bbox: { x: 0.1, y: 0.2, w: 0.8, h: 0.08 },
          }],
        },
      ],
    }
    const carrier: TaskBlock = {
      id: 'p1-lines',
      page: 1,
      bbox: { x: 0.1, y: 0.4, w: 0.8, h: 0.03 },
      instruction: 'Erkläre Ursache A.',
      kind: 'free_text_inplace',
      confidence: 0.7,
      evidence: ['6 answer line blocks detected'],
      renderMode: 'overlay',
      targets: Array.from({ length: 6 }, (_, index) => ({
        id: `line-${index}`,
        kind: 'answer_line' as const,
        page: index < 4 ? 1 : 2,
        bbox: { x: 0.1, y: 0.4 + (index % 4) * 0.05, w: 0.8, h: 0.02 },
      })),
    }

    const tasks = reconcileTasksWithPageLayoutV2(document, [carrier])
    expect(tasks.some((task) => task.id === 'p1-lines')).toBe(false)
    expect(tasks.filter((task) => task.kind === 'free_text_separate').length).toBeGreaterThanOrEqual(2)
    expect(tasks.every((task) => task.targets.length === 0)).toBe(true)
  })

  it('unterscheidet keine Aufgaben von einer Aufgabe ohne Ziel', () => {
    const empty = buildSolutionPlanV2({
      document: buildTextOnlyLayoutDocumentV2('', 'empty'),
      sourceFormat: 'other',
      tasks: [],
    })
    expect(validateSolutionPlanV2(empty.plan).map((issue) => issue.code)).toEqual(['NO_TASKS_DETECTED'])

    const missingTarget = buildSolutionPlanV2({
      document: buildTextOnlyLayoutDocumentV2('Unbekannte Aufgabe', 'missing'),
      sourceFormat: 'other',
      tasks: [{
        id: 'unsupported',
        page: 1,
        bbox: { x: 0.1, y: 0.2, w: 0.8, h: 0.1 },
        instruction: 'Unbekannte Aufgabe',
        kind: 'unknown',
        confidence: 0.2,
        evidence: [],
        targets: [],
        renderMode: 'overlay',
      }],
    })
    missingTarget.plan.tasks[0]!.answerSlots = []
    expect(validateSolutionPlanV2(missingTarget.plan).map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['UNSUPPORTED_TASK', 'TASK_TARGETS_MISSING']),
    )
  })
})
