<script setup lang="ts">
import type { StoredSolutionAnswer, StoredStructuredSolution } from '~~/server/database/schema/materials'

const props = defineProps<{
  disabled?: boolean
  aktiveId?: string | null
  /** Anhang-Editor: kein Bezug zur Seitenvorschau. */
  nurText?: boolean
}>()

const emit = defineEmits<{
  'update:aktiveId': [id: string | null]
}>()

const loesung = defineModel<StoredStructuredSolution>({ required: true })

const feldTypen = [
  { value: 'luecke', label: 'Lücke' },
  { value: 'freitext', label: 'Freitext' },
]

const listeEl = ref<HTMLElement | null>(null)

useSortierbar(listeEl, {
  griff: '[data-griff]',
  deaktiviert: () => Boolean(props.disabled),
  beiUmsortierung: (ids) => {
    const map = new Map(loesung.value.answers.map((a) => [a.id, a]))
    loesung.value = {
      ...loesung.value,
      answers: ids.map((id) => map.get(id)).filter((a): a is StoredSolutionAnswer => Boolean(a)),
    }
  },
})

function antwortWaehlen(id: string) {
  emit('update:aktiveId', id)
}

function antwortTauschen(index: number, richtung: -1 | 1) {
  const answers = [...loesung.value.answers]
  const ziel = index + richtung
  if (ziel < 0 || ziel >= answers.length) return
  const tmp = answers[index]!
  answers[index] = answers[ziel]!
  answers[ziel] = tmp
  loesung.value = { ...loesung.value, answers }
}

function antwortAktualisieren(id: string, patch: Partial<StoredSolutionAnswer>) {
  loesung.value = {
    ...loesung.value,
    answers: loesung.value.answers.map((a) => (a.id === id ? { ...a, ...patch } : a)),
  }
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-3">
    <div class="shrink-0 space-y-2">
      <UiField label="Kurzüberblick">
        <UiTextarea
          :model-value="loesung.summary"
          :disabled="disabled"
          :zeilen="2"
          @update:model-value="loesung = { ...loesung, summary: String($event ?? '') }"
        />
      </UiField>
      <p class="text-xs text-ink-muted">
        <template v-if="nurText">
          Antworten bearbeiten, tauschen oder per Anfasser umsortieren.
        </template>
        <template v-else>
          Antworten bearbeiten, tauschen oder per Anfasser umsortieren. Klick auf ein Feld
          markiert die Position in der Seitenvorschau.
        </template>
      </p>
    </div>

    <div ref="listeEl" class="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
      <div
        v-for="(antwort, index) in loesung.answers"
        :id="`antwort-${antwort.id}`"
        :key="antwort.id"
        :data-id="antwort.id"
        class="rounded-lg border bg-surface p-3 shadow-sm transition"
        :class="aktiveId === antwort.id ? 'border-primary ring-2 ring-primary/25' : 'border-line'"
        @click="antwortWaehlen(antwort.id)"
      >
        <div class="mb-2 flex items-center gap-2">
          <button
            type="button"
            data-griff
            class="cursor-grab rounded p-1 text-ink-subtle hover:bg-surface-hover hover:text-ink"
            title="Reihenfolge ändern"
            :disabled="disabled"
            @click.stop
          >
            <UiIcon name="grip-vertical" fest />
          </button>
          <span class="text-xs font-semibold text-ink-muted">#{{ index + 1 }}</span>
          <UiBadge
            v-if="!nurText && antwort.page"
            groesse="sm"
            class="!text-[0.65rem]"
          >
            S. {{ antwort.page }}
          </UiBadge>
          <div class="ml-auto flex gap-0.5">
            <UiButton
              variante="still"
              groesse="sm"
              icon="arrow-up"
              nur-icon
              title="Nach oben"
              :disabled="disabled || index === 0"
              @click.stop="antwortTauschen(index, -1)"
            />
            <UiButton
              variante="still"
              groesse="sm"
              icon="arrow-down"
              nur-icon
              title="Nach unten"
              :disabled="disabled || index >= loesung.answers.length - 1"
              @click.stop="antwortTauschen(index, 1)"
            />
          </div>
        </div>

        <div class="space-y-2" @click.stop>
          <UiField label="Bezeichnung">
            <UiInput
              :model-value="antwort.label"
              :disabled="disabled"
              @update:model-value="antwortAktualisieren(antwort.id, { label: String($event ?? '') })"
            />
          </UiField>
          <UiField label="Antwort">
            <UiTextarea
              :model-value="antwort.answer"
              :disabled="disabled"
              :zeilen="antwort.fieldType === 'freitext' ? 3 : 2"
              @update:model-value="antwortAktualisieren(antwort.id, { answer: String($event ?? '') })"
            />
          </UiField>
          <div v-if="!nurText" class="grid grid-cols-2 gap-2">
            <UiField label="Feldtyp">
              <UiSelect
                :model-value="antwort.fieldType ?? 'luecke'"
                :optionen="feldTypen"
                :disabled="disabled"
                @update:model-value="
                  antwortAktualisieren(antwort.id, {
                    fieldType: ($event as 'luecke' | 'freitext') || 'luecke',
                  })
                "
              />
            </UiField>
            <UiField label="Seite">
              <UiInput
                type="number"
                :model-value="antwort.page ?? 1"
                :disabled="disabled"
                @update:model-value="
                  antwortAktualisieren(antwort.id, {
                    page: Math.max(1, Number($event) || 1),
                  })
                "
              />
            </UiField>
          </div>
          <p
            v-if="!nurText && (antwort.leftContext || antwort.rightContext)"
            class="truncate text-[0.7rem] text-ink-subtle"
            :title="`${antwort.leftContext ?? '…'} ___ ${antwort.rightContext ?? '…'}`"
          >
            Kontext: „{{ antwort.leftContext || '…' }}
            <span class="text-primary">___</span>
            {{ antwort.rightContext || '…' }}“
          </p>
        </div>
      </div>

      <p v-if="!loesung.answers.length" class="py-6 text-center text-sm text-ink-muted">
        Keine strukturierten Antworten vorhanden.
      </p>
    </div>

    <div v-if="nurText" class="shrink-0 space-y-2 border-t border-line pt-3">
      <UiField label="Hinweise für die Lehrkraft">
        <UiTextarea
          :model-value="loesung.notesForTeacher ?? ''"
          :disabled="disabled"
          :zeilen="2"
          @update:model-value="
            loesung = { ...loesung, notesForTeacher: String($event ?? '') || null }
          "
        />
      </UiField>
    </div>
  </div>
</template>
