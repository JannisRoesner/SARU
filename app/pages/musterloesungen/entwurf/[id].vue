<script setup lang="ts">
interface DraftAnswer {
  targetId: string
  value: string
}

interface DraftTask {
  taskId: string
  answers: DraftAnswer[]
  uncertainties: string[]
}

interface PlanTask {
  taskId: string
  kind: string
  page: number
  instruction: string
  candidateBank?: {
    candidates: Array<{ value: string }>
  } | null
  answerSlots: Array<{
    targetId: string
    page: number
    bbox: { x: number; y: number; w?: number; h?: number } | null
    promptContext: string
    capacity: { maxChars: number }
    targetKind?: string
    choiceTargets?: Array<{
      value: string
      targetId: string
      bbox: { x: number; y: number; w?: number; h?: number } | null
    }>
  }>
}

interface DraftResponse {
  draft: {
    id: string
    publishedMaterialId: string | null
    plan: { document: { pages: Array<{ page: number }> }; tasks: PlanTask[] }
    solution: DraftTask[]
    issues: Array<{ code: string; message: string; taskId?: string; targetIds?: string[] }>
    hasFile: boolean
    fileName: string | null
  }
}

const route = useRoute()
const id = computed(() => String(route.params.id))
const { data, error, status, refresh } = await useAsyncData(
  () => `solution-draft-${id.value}`,
  () => $fetch<DraftResponse>(`/api/solution-drafts/${id.value}`),
)

const solvedTasks = ref<DraftTask[]>([])
const planTasks = ref<PlanTask[]>([])
const kandidatentexte = ref<Record<string, string>>({})
const laeuft = ref(false)
const aktiveAufgabe = ref<string | null>(null)
const markierAufgabe = ref<string | null>(null)
const meldung = ref<string | null>(null)
const fehler = ref<string | null>(null)
const istVeroeffentlicht = computed(() => Boolean(data.value?.draft.publishedMaterialId))

watch(
  () => data.value?.draft,
  (draft) => {
    if (!draft) return
    solvedTasks.value = structuredClone(draft.solution)
    planTasks.value = structuredClone(draft.plan.tasks)
    kandidatentexte.value = Object.fromEntries(
      draft.plan.tasks.map((task) => [
        task.taskId,
        task.candidateBank?.candidates.map((candidate) => candidate.value).join('\n') ?? '',
      ]),
    )
  },
  { immediate: true },
)

const aufgabenTypen = [
  { value: 'cloze', label: 'Lückentext' },
  { value: 'free_text', label: 'Freitext' },
  { value: 'single_choice', label: 'Einfachauswahl' },
  { value: 'multi_choice', label: 'Mehrfachauswahl' },
  { value: 'matching', label: 'Zuordnung' },
  { value: 'table_completion', label: 'Tabelle ausfüllen' },
  { value: 'diagram_labeling', label: 'Bild beschriften' },
]

function taskPlan(taskId: string): PlanTask | undefined {
  return planTasks.value.find((task) => task.taskId === taskId)
}

function slotContext(taskId: string, targetId: string): string {
  return taskPlan(taskId)?.answerSlots.find((slot) => slot.targetId === targetId)?.promptContext ?? targetId
}

function answerValue(taskId: string, targetId: string): string {
  return solvedTasks.value
    .find((task) => task.taskId === taskId)
    ?.answers.find((answer) => answer.targetId === targetId)?.value ?? ''
}

function pageTargets(page: number) {
  return planTasks.value.flatMap((task, taskIndex) =>
    task.answerSlots.flatMap((slot, slotIndex) => {
      if (slot.page !== page) return []
      const value = answerValue(task.taskId, slot.targetId)
      const choice = slot.choiceTargets?.find((target) =>
        target.value.toLocaleLowerCase('de-DE') === value.trim().toLocaleLowerCase('de-DE'),
      )
      const bbox = choice?.bbox ?? slot.bbox
      if (!bbox) return []
      return [{
        taskId: task.taskId,
        targetId: choice?.targetId ?? slot.targetId,
        label: `A${taskIndex + 1}.${slotIndex + 1}`,
        bbox,
        hasAnswer: Boolean(value.trim()),
      }]
    }),
  )
}

function solvedTask(taskId: string): DraftTask | undefined {
  return solvedTasks.value.find((task) => task.taskId === taskId)
}

function kandidaten(taskId: string): string[] {
  return (kandidatentexte.value[taskId] ?? '')
    .split(/[\n,;/]+/)
    .map((value) => value.trim())
    .filter(Boolean)
}

function zielHinzufuegen(task: PlanTask, page = task.page, x = 0.1, y = 0.4) {
  task.answerSlots.push({
    targetId: `${task.taskId}-manual-${Date.now()}-${task.answerSlots.length + 1}`,
    page,
    bbox: { x, y, w: 0.2, h: 0.04 },
    promptContext: task.instruction,
    capacity: { maxChars: 80 },
  })
}

function neueAufgabe() {
  const taskId = `manual-task-${Date.now()}`
  const task: PlanTask = {
    taskId,
    kind: 'free_text',
    page: 1,
    instruction: 'Neue Aufgabe',
    candidateBank: null,
    answerSlots: [],
  }
  planTasks.value.push(task)
  kandidatentexte.value[taskId] = ''
  markierAufgabe.value = taskId
}

function zielEntfernen(task: PlanTask, targetId: string) {
  task.answerSlots = task.answerSlots.filter((slot) => slot.targetId !== targetId)
}

function koordinateSetzen(
  slot: PlanTask['answerSlots'][number],
  key: 'x' | 'y' | 'w' | 'h',
  value: unknown,
) {
  if (!slot.bbox) slot.bbox = { x: 0.1, y: 0.4, w: 0.2, h: 0.04 }
  const number = Number(value)
  if (!Number.isFinite(number)) return
  slot.bbox[key] = Math.max(0.001, Math.min(1, number))
}

function seiteMarkiert(event: MouseEvent, page: number) {
  if (!markierAufgabe.value) return
  const task = taskPlan(markierAufgabe.value)
  if (!task) return
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const x = Math.max(0, Math.min(0.8, (event.clientX - rect.left) / rect.width))
  const y = Math.max(0, Math.min(0.96, (event.clientY - rect.top) / rect.height))
  zielHinzufuegen(task, page, x, y)
  markierAufgabe.value = null
}

async function aufgabeNeuLoesen(task: PlanTask, redetectTargets: boolean) {
  if (!redetectTargets && task.answerSlots.length === 0) {
    fehler.value = 'Füge mindestens einen Zielbereich hinzu oder starte die visuelle Zielerkennung.'
    return
  }
  laeuft.value = true
  aktiveAufgabe.value = task.taskId
  fehler.value = null
  meldung.value = null
  try {
    await $fetch(
      `/api/solution-drafts/${id.value}/tasks/${encodeURIComponent(task.taskId)}/retry`,
      {
        method: 'POST',
        body: {
          kind: task.kind,
          instruction: task.instruction,
          candidateValues: kandidaten(task.taskId),
          redetectTargets,
          answerSlots: task.answerSlots.map((slot) => ({
            targetId: slot.targetId,
            page: slot.page,
            bbox: slot.bbox
              ? {
                  x: slot.bbox.x,
                  y: slot.bbox.y,
                  w: slot.bbox.w ?? 0.2,
                  h: slot.bbox.h ?? 0.04,
                }
              : null,
            promptContext: slot.promptContext,
          })),
        },
      },
    )
    await refresh()
    meldung.value = redetectTargets
      ? 'Zielbereiche erkannt, Aufgabe neu gelöst und Entwurf gerendert.'
      : 'Aufgabe mit den manuellen Angaben neu gelöst und gerendert.'
  } catch (cause: unknown) {
    fehler.value = toApiFehler(cause).nachricht
  } finally {
    laeuft.value = false
    aktiveAufgabe.value = null
  }
}

function targetStyle(target: ReturnType<typeof pageTargets>[number]) {
  return {
    left: `${target.bbox.x * 100}%`,
    top: `${target.bbox.y * 100}%`,
    width: `${(target.bbox.w ?? 0.04) * 100}%`,
    height: `${(target.bbox.h ?? 0.025) * 100}%`,
  }
}

async function speichern() {
  laeuft.value = true
  fehler.value = null
  meldung.value = null
  try {
    await $fetch(`/api/solution-drafts/${id.value}`, {
      method: 'PATCH',
      body: { solvedTasks: solvedTasks.value },
    })
    await refresh()
    meldung.value = 'Antworten gespeichert und Entwurf neu gerendert.'
  } catch (cause: unknown) {
    fehler.value = toApiFehler(cause).nachricht
  } finally {
    laeuft.value = false
  }
}

async function veroeffentlichen() {
  const frage = istVeroeffentlicht.value
    ? 'Die korrigierte Fassung neu rendern und in die bestehende Musterlösung übernehmen?'
    : 'Diesen Entwurf trotz der angezeigten KI-Warnungen fachlich freigeben?'
  if (!window.confirm(frage)) return
  laeuft.value = true
  fehler.value = null
  try {
    // Freigeben ist eine speichernde Aktion: Korrekturen dürfen nicht davon
    // abhängen, ob zuvor zusätzlich „Neu rendern“ geklickt wurde.
    await $fetch(`/api/solution-drafts/${id.value}`, {
      method: 'PATCH',
      body: { solvedTasks: solvedTasks.value },
    })
    const result = await $fetch<{ solutionMaterialId: string }>(
      `/api/solution-drafts/${id.value}/publish`,
      { method: 'POST' },
    )
    await navigateTo(`/materialien/${result.solutionMaterialId}`)
  } catch (cause: unknown) {
    fehler.value = toApiFehler(cause).nachricht
  } finally {
    laeuft.value = false
  }
}

async function verwerfen() {
  if (!window.confirm('Prüfentwurf endgültig verwerfen?')) return
  laeuft.value = true
  try {
    await $fetch(`/api/solution-drafts/${id.value}`, { method: 'DELETE' })
    await navigateTo('/materialien')
  } catch (cause: unknown) {
    fehler.value = toApiFehler(cause).nachricht
    laeuft.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-7xl space-y-5">
    <NuxtLink to="/materialien" class="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-primary">
      <UiIcon name="arrow-left" fest /> Materialien
    </NuxtLink>

    <header>
      <p class="seitenkopf-kicker">KI-Musterlösung V2</p>
      <h1 class="text-3xl tracking-tight text-ink">
        {{ istVeroeffentlicht ? 'Musterlösung korrigieren' : 'Prüfentwurf kontrollieren' }}
      </h1>
      <p class="mt-2 max-w-3xl text-sm text-ink-muted">
        {{ istVeroeffentlicht
          ? 'Korrigiere Antworten oder erzeuge einzelne Aufgaben neu. Beim Übernehmen wird dieselbe Musterlösung aktualisiert.'
          : 'Dieser Lauf wurde nicht automatisch veröffentlicht. Korrigiere die Antworten und gib ihn anschließend bewusst frei.' }}
      </p>
    </header>

    <UiFehlerzustand v-if="error" text="Der Prüfentwurf konnte nicht geladen werden." @erneut="refresh()" />
    <UiSkelett v-else-if="status === 'pending' || !data" art="liste" :zeilen="8" />

    <template v-else>
      <div v-if="data.draft.issues.length" class="space-y-2">
        <div
          v-for="issue in data.draft.issues"
          :key="`${issue.code}-${issue.taskId ?? ''}-${issue.message}`"
          class="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-ink"
        >
          <UiIcon name="triangle-exclamation" class="mt-0.5 shrink-0 text-warning" fest />
          <span><strong>{{ issue.code }}</strong>: {{ issue.message }}</span>
        </div>
      </div>
      <p v-if="meldung" class="rounded-lg bg-success-soft px-3 py-2 text-sm text-success-strong">{{ meldung }}</p>
      <p v-if="fehler" class="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{{ fehler }}</p>

      <div class="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.8fr)]">
        <UiCard titel="Gerenderter Entwurf mit Zielboxen" icon="file-pdf">
          <div class="max-h-[75vh] space-y-4 overflow-auto rounded-lg bg-surface-muted p-2">
            <div
              v-for="page in data.draft.plan.document.pages"
              :key="page.page"
              class="space-y-1"
            >
              <p class="text-xs font-medium text-ink-muted">Seite {{ page.page }}</p>
              <div class="relative overflow-hidden rounded border border-line bg-white shadow-sm">
              <div
                class="relative"
                :class="markierAufgabe ? 'cursor-crosshair ring-2 ring-primary' : ''"
                @click="seiteMarkiert($event, page.page)"
              >
                <img
                  :src="`/api/solution-drafts/${id}/pages/${page.page}`"
                  :alt="`Entwurfsseite ${page.page}`"
                  class="block h-auto w-full"
                >
                <div
                  v-for="target in pageTargets(page.page)"
                  :key="target.targetId"
                  class="absolute min-h-3 min-w-3 border-2 bg-primary/10"
                  :class="target.hasAnswer ? 'border-primary' : 'border-danger'"
                  :style="targetStyle(target)"
                  :title="target.targetId"
                  @click.stop
                >
                  <span class="absolute -top-5 left-0 rounded bg-ink px-1 text-[10px] leading-4 text-white">
                    {{ target.label }}
                  </span>
                </div>
              </div>
              </div>
            </div>
            <a
              v-if="data.draft.hasFile"
              :href="`/api/solution-drafts/${id}/download`"
              class="inline-flex text-sm text-primary hover:underline"
              target="_blank"
            >Vollständigen Entwurf öffnen</a>
          </div>
        </UiCard>

        <div class="space-y-4">
          <div class="flex justify-end">
            <UiButton
              variante="sekundaer"
              icon="plus"
              :disabled="laeuft"
              @click="neueAufgabe"
            >Nicht erkannte Aufgabe hinzufügen</UiButton>
          </div>
          <UiCard
            v-for="task in planTasks"
            :key="task.taskId"
            :titel="task.instruction || task.taskId"
            icon="list-check"
          >
            <div class="space-y-4">
              <div class="grid gap-3 sm:grid-cols-2">
                <UiField label="Aufgabentyp">
                  <UiSelect v-model="task.kind" :optionen="aufgabenTypen" :disabled="laeuft" />
                </UiField>
                <UiField label="Seite">
                  <UiInput v-model="task.page" type="number" min="1" :disabled="laeuft" />
                </UiField>
              </div>
              <UiField label="Aufgabenstellung">
                <UiTextarea v-model="task.instruction" :rows="3" :disabled="laeuft" />
              </UiField>
              <UiField label="Wortliste / erlaubte Werte (optional, je Zeile ein Eintrag)">
                <UiTextarea v-model="kandidatentexte[task.taskId]" :rows="3" :disabled="laeuft" />
              </UiField>

              <details
                class="group rounded-lg border border-line"
                data-testid="target-areas"
              >
                <summary class="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-sm font-semibold text-ink">
                  <span>Zielbereiche <span class="font-normal text-ink-muted">({{ task.answerSlots.length }})</span></span>
                  <UiIcon name="chevron-down" class="transition-transform group-open:rotate-180" fest />
                </summary>
                <div class="space-y-2 border-t border-line p-3">
                  <div class="flex flex-wrap justify-end gap-2">
                    <UiButton
                      variante="sekundaer"
                      groesse="sm"
                      icon="crosshairs"
                      :disabled="laeuft"
                      @click="markierAufgabe = task.taskId"
                    >Auf Seite markieren</UiButton>
                    <UiButton
                      variante="sekundaer"
                      groesse="sm"
                      icon="plus"
                      :disabled="laeuft"
                      @click="zielHinzufuegen(task)"
                    >Ziel hinzufügen</UiButton>
                  </div>
                  <p v-if="markierAufgabe === task.taskId" class="text-xs text-primary">
                    Klicke links auf die gewünschte Position im Dokument.
                  </p>
                  <p v-if="task.answerSlots.length === 0" class="text-xs text-danger">
                    Noch kein Zielbereich vorhanden.
                  </p>
                  <div
                    v-for="(slot, slotIndex) in task.answerSlots"
                    :key="slot.targetId"
                    class="space-y-2 rounded border border-line bg-surface-muted p-2"
                  >
                    <div class="flex items-center justify-between gap-2">
                      <span class="text-xs font-medium text-ink">Ziel {{ slotIndex + 1 }} · Seite {{ slot.page }}</span>
                      <UiButton
                        variante="still"
                        groesse="sm"
                        icon="trash"
                        :disabled="laeuft"
                        @click="zielEntfernen(task, slot.targetId)"
                      >Entfernen</UiButton>
                    </div>
                    <div class="grid grid-cols-5 gap-2">
                      <UiField label="Seite">
                        <UiInput v-model="slot.page" type="number" min="1" :disabled="laeuft" />
                      </UiField>
                      <UiField v-for="key in (['x', 'y', 'w', 'h'] as const)" :key="key" :label="key">
                        <UiInput
                          type="number"
                          step="0.001"
                          :model-value="slot.bbox?.[key] ?? ''"
                          :disabled="laeuft"
                          @update:model-value="koordinateSetzen(slot, key, $event)"
                        />
                      </UiField>
                    </div>
                    <UiField label="Kontext">
                      <UiInput v-model="slot.promptContext" :disabled="laeuft" />
                    </UiField>
                  </div>
                </div>
              </details>

              <UiField
                v-for="answer in solvedTask(task.taskId)?.answers ?? []"
                :key="answer.targetId"
                :label="slotContext(task.taskId, answer.targetId)"
              >
                <UiTextarea v-model="answer.value" :rows="4" />
              </UiField>
              <div class="flex flex-wrap justify-end gap-2">
                <UiButton
                  variante="sekundaer"
                  icon="eye"
                  :laedt="laeuft && aktiveAufgabe === task.taskId"
                  :disabled="laeuft && aktiveAufgabe !== task.taskId"
                  @click="aufgabeNeuLoesen(task, true)"
                >Ziele erkennen & neu lösen</UiButton>
                <UiButton
                  variante="primaer"
                  icon="wand-magic-sparkles"
                  :laedt="laeuft && aktiveAufgabe === task.taskId"
                  :disabled="laeuft && aktiveAufgabe !== task.taskId"
                  @click="aufgabeNeuLoesen(task, false)"
                >Aufgabe neu lösen</UiButton>
              </div>
            </div>
          </UiCard>
        </div>
      </div>

      <div class="sticky bottom-4 flex flex-wrap justify-end gap-2 rounded-xl border border-line bg-surface/95 p-3 shadow-lg backdrop-blur">
        <UiButton v-if="!istVeroeffentlicht" variante="gefahr" icon="trash" :disabled="laeuft" @click="verwerfen">Verwerfen</UiButton>
        <UiButton variante="sekundaer" icon="floppy-disk" :laedt="laeuft" @click="speichern">Neu rendern</UiButton>
        <UiButton variante="primaer" icon="circle-check" :disabled="laeuft" @click="veroeffentlichen">
          {{ istVeroeffentlicht ? 'Änderungen übernehmen' : 'Fachlich freigeben' }}
        </UiButton>
      </div>
    </template>
  </div>
</template>
