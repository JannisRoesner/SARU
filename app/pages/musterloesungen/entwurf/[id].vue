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
  answerSlots: Array<{
    targetId: string
    page: number
    bbox: { x: number; y: number; w?: number; h?: number } | null
    promptContext: string
    capacity: { maxChars: number }
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
const laeuft = ref(false)
const meldung = ref<string | null>(null)
const fehler = ref<string | null>(null)

watch(
  () => data.value?.draft.solution,
  (solution) => {
    if (solution) solvedTasks.value = structuredClone(solution)
  },
  { immediate: true },
)

function taskPlan(taskId: string): PlanTask | undefined {
  return data.value?.draft.plan.tasks.find((task) => task.taskId === taskId)
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
  return (data.value?.draft.plan.tasks ?? []).flatMap((task, taskIndex) =>
    task.answerSlots.flatMap((slot, slotIndex) => {
      if (slot.page !== page) return []
      const value = answerValue(task.taskId, slot.targetId)
      const choice = slot.choiceTargets?.find((target) =>
        target.value.toLocaleLowerCase('de-DE') === value.trim().toLocaleLowerCase('de-DE'),
      )
      const bbox = choice?.bbox ?? slot.bbox
      if (!bbox) return []
      return [{
        targetId: choice?.targetId ?? slot.targetId,
        label: `A${taskIndex + 1}.${slotIndex + 1}`,
        bbox,
        hasAnswer: Boolean(value.trim()),
      }]
    }),
  )
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
  if (!window.confirm('Diesen Entwurf trotz der angezeigten KI-Warnungen fachlich freigeben?')) return
  laeuft.value = true
  fehler.value = null
  try {
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
      <h1 class="text-3xl tracking-tight text-ink">Prüfentwurf kontrollieren</h1>
      <p class="mt-2 max-w-3xl text-sm text-ink-muted">
        Dieser Lauf wurde nicht automatisch veröffentlicht. Korrigiere die Antworten und gib ihn anschließend bewusst frei.
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
          <div v-if="data.draft.hasFile" class="max-h-[75vh] space-y-4 overflow-auto rounded-lg bg-surface-muted p-2">
            <div
              v-for="page in data.draft.plan.document.pages"
              :key="page.page"
              class="space-y-1"
            >
              <p class="text-xs font-medium text-ink-muted">Seite {{ page.page }}</p>
              <div class="relative overflow-hidden rounded border border-line bg-white shadow-sm">
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
                >
                  <span class="absolute -top-5 left-0 rounded bg-ink px-1 text-[10px] leading-4 text-white">
                    {{ target.label }}
                  </span>
                </div>
              </div>
            </div>
            <a
              :href="`/api/solution-drafts/${id}/download`"
              class="inline-flex text-sm text-primary hover:underline"
              target="_blank"
            >Vollständigen Entwurf öffnen</a>
          </div>
          <p v-else class="text-sm text-ink-muted">Wegen eines frühen Strukturfehlers existiert noch keine Vorschau.</p>
        </UiCard>

        <div class="space-y-4">
          <UiCard
            v-for="task in solvedTasks"
            :key="task.taskId"
            :titel="taskPlan(task.taskId)?.instruction || task.taskId"
            icon="list-check"
          >
            <div class="space-y-4">
              <UiField
                v-for="answer in task.answers"
                :key="answer.targetId"
                :label="slotContext(task.taskId, answer.targetId)"
              >
                <UiTextarea v-model="answer.value" :rows="4" />
              </UiField>
            </div>
          </UiCard>
        </div>
      </div>

      <div class="sticky bottom-4 flex flex-wrap justify-end gap-2 rounded-xl border border-line bg-surface/95 p-3 shadow-lg backdrop-blur">
        <UiButton variante="gefahr" icon="trash" :disabled="laeuft" @click="verwerfen">Verwerfen</UiButton>
        <UiButton variante="sekundaer" icon="floppy-disk" :laedt="laeuft" @click="speichern">Neu rendern</UiButton>
        <UiButton variante="primaer" icon="circle-check" :disabled="laeuft" @click="veroeffentlichen">
          Fachlich freigeben
        </UiButton>
      </div>
    </template>
  </div>
</template>
