<script setup lang="ts">
import { NuxtLink } from '#components'
import { materialTypes, origins } from '#shared/utils/labels'
import { istKiMusterloesung, kiAutorAnzeige } from '#shared/utils/ki'
import { materialVorschauIcon, materialZeigtIconVorschau } from '#shared/utils/moodle'
import { isThumbnailCandidate } from '#shared/utils/thumbnail-candidate'
import type { MaterialSummary } from '~~/server/repositories/material.repository'

const props = withDefaults(
  defineProps<{
    material: MaterialSummary
    /** Kompakte Zeile statt großer Karte, z. B. auf dem Dashboard. */
    kompakt?: boolean
    auswaehlbar?: boolean
    ausgewaehlt?: boolean
  }>(),
  { kompakt: false, auswaehlbar: false, ausgewaehlt: false },
)

const emit = defineEmits<{
  favorit: [id: string, wert: boolean]
  auswahl: [id: string, wert: boolean]
}>()

const icon = computed(() => materialVorschauIcon(props.material.materialType, preview.value?.fileName))
const zeigtIconVorschau = computed(() =>
  materialZeigtIconVorschau(props.material.materialType, preview.value?.fileName),
)
const fachfarbe = computed(() => props.material.subjects[0]?.color ?? null)
const kiCredit = computed(() =>
  istKiMusterloesung(props.material)
    ? kiAutorAnzeige(props.material.aiMeta, props.material.author)
    : null,
)

const jetzt = useJetzt()
const preview = computed(() => props.material.preview)
const zeigtMiniatur = computed(() => {
  if (zeigtIconVorschau.value) return false
  const p = preview.value
  if (!p || p.kind !== 'datei') return false
  return isThumbnailCandidate(p.mimeType, p.fileName)
})
</script>

<template>
  <component
    :is="auswaehlbar ? 'div' : NuxtLink"
    :to="auswaehlbar ? undefined : `/materialien/${material.id}`"
    class="karte group relative flex gap-3"
    :class="[
      !auswaehlbar && 'karte-klickbar',
      kompakt ? 'items-center p-3' : 'flex-col p-4 sm:flex-row',
      ausgewaehlt && 'ring-2 ring-primary',
      material.isArchived && 'opacity-60',
    ]"
  >
    <label
      v-if="auswaehlbar"
      class="absolute left-2 top-2 z-10 flex cursor-pointer items-center p-1"
      @click.stop
    >
      <input
        type="checkbox"
        :checked="ausgewaehlt"
        class="size-4 accent-[var(--color-primary)]"
        :aria-label="`${material.title} auswählen`"
        @change="emit('auswahl', material.id, ($event.target as HTMLInputElement).checked)"
      >
    </label>

    <MaterialVorschauMiniatur
      v-if="zeigtIconVorschau || (zeigtMiniatur && preview?.assetId)"
      :asset-id="preview?.assetId"
      :file-name="preview?.fileName"
      :mime-type="preview?.mimeType"
      :material-type="material.materialType"
      :groesse="kompakt ? 'sm' : 'md'"
    />
    <span
      v-else
      class="flex shrink-0 items-center justify-center rounded-xl"
      :class="kompakt ? 'size-10 text-base' : 'size-12 text-lg'"
      :style="!zeigtIconVorschau && fachfarbe
        ? { backgroundColor: `${fachfarbe}22`, color: fachfarbe }
        : undefined"
      :data-standard="!zeigtIconVorschau && !fachfarbe ? '' : undefined"
    >
      <UiIcon :name="icon" fest class="group-data-[standard]:text-primary" />
    </span>

    <div class="min-w-0 flex-1">
      <div class="flex items-start gap-2">
        <NuxtLink
          v-if="auswaehlbar"
          :to="`/materialien/${material.id}`"
          class="min-w-0 flex-1 font-medium text-ink hover:text-primary"
        >
          {{ material.title }}
        </NuxtLink>
        <h3 v-else class="min-w-0 flex-1 font-medium text-ink group-hover:text-primary">
          {{ material.title }}
        </h3>

        <button
          type="button"
          class="shrink-0 rounded-md p-1 text-ink-subtle transition-colors hover:bg-surface-hover hover:text-warning"
          :class="material.isFavorite && 'text-warning'"
          :aria-label="material.isFavorite ? 'Favorit entfernen' : 'Als Favorit merken'"
          :aria-pressed="material.isFavorite"
          @click.stop.prevent="emit('favorit', material.id, !material.isFavorite)"
        >
          <UiIcon name="star" :stil="material.isFavorite ? 'fas' : 'far'" fest />
        </button>
      </div>

      <p
        v-if="material.description && !kompakt"
        class="mt-1 line-clamp-2 text-sm text-ink-muted"
      >
        {{ material.description }}
      </p>

      <div class="mt-2 flex flex-wrap items-center gap-1.5">
        <UiBadge groesse="sm" :ton="materialTypes.tone(material.materialType)" :icon="icon">
          {{ materialTypes.label(material.materialType) }}
        </UiBadge>
        <UiBadge
          v-for="fach in material.subjects.slice(0, kompakt ? 1 : 2)"
          :key="fach.id"
          groesse="sm"
          :farbe="fach.color"
        >
          {{ fach.name }}
        </UiBadge>
        <UiBadge v-if="material.gradeLevels.length" groesse="sm">
          {{ formatJahrgaenge(material.gradeLevels) }}
        </UiBadge>
        <template v-if="!kompakt">
          <UiBadge
            v-if="kiCredit"
            groesse="sm"
            ton="ki"
            icon="robot"
          >
            {{ kiCredit }}
          </UiBadge>
          <UiBadge
            v-else-if="material.origin !== 'manuell'"
            groesse="sm"
            :ton="origins.tone(material.origin)"
            :icon="origins.icon(material.origin)"
          >
            {{ origins.label(material.origin) }}
          </UiBadge>
          <UiBadge
            v-if="kiCredit && material.aiMeta?.reviewed"
            groesse="sm"
            ton="gruen"
            icon="circle-check"
          >
            Geprüft
          </UiBadge>
        </template>
        <UiBadge v-if="material.isArchived" groesse="sm" icon="box-archive">Archiviert</UiBadge>
      </div>

      <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-subtle">
        <template v-if="!kompakt">
          <span v-if="material.variantCount > 1" class="flex items-center gap-1">
            <UiIcon name="code-branch" fest />
            {{ material.variantCount }} Varianten
          </span>
          <span v-if="material.assetCount" class="flex items-center gap-1">
            <UiIcon name="paperclip" fest />
            {{ material.assetCount }}
            {{ material.assetCount === 1 ? 'Anhang' : 'Anhänge' }}
          </span>
          <span v-if="material.hasSolution" class="flex items-center gap-1 text-success-strong">
            <UiIcon name="circle-check" fest />
            Lösung vorhanden
          </span>
          <span v-if="material.usageCount" class="flex items-center gap-1">
            <UiIcon name="link" fest />
            {{ material.usageCount }}× verwendet
          </span>
        </template>
        <span v-else-if="material.assetCount" class="flex items-center gap-1">
          <UiIcon name="paperclip" fest />
          {{ material.assetCount }}
        </span>
        <span class="flex items-center gap-1">
          <UiIcon name="clock-rotate-left" fest />
          {{ formatRelativ(material.updatedAt, '–', jetzt) }}
        </span>
      </div>
    </div>
  </component>
</template>

<style scoped>
span[data-standard] {
  background: var(--surface-sunken);
  color: var(--ink-subtle);
}
</style>
