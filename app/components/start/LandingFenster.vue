<script setup lang="ts">
defineProps<{
  titel: string
}>()
</script>

<template>
  <div class="landing-fenster">
    <div class="landing-fenster-leiste">
      <span class="landing-fenster-punkte" aria-hidden="true">
        <i class="bg-[#ff5f57]" />
        <i class="bg-[#febc2e]" />
        <i class="bg-[#28c840]" />
      </span>
      <span class="landing-fenster-titel">{{ titel }}</span>
    </div>
    <div class="landing-fenster-inhalt">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.landing-fenster {
  overflow: hidden;
  border-radius: 0.9rem;
  border: 1px solid var(--surface-line-strong);
  background: var(--surface-base);
  box-shadow:
    var(--shadow-raised),
    0 0 0 1px color-mix(in oklab, var(--palette-primary) 8%, transparent);
}

.landing-fenster-leiste {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  border-bottom: 1px solid var(--surface-line);
  background: color-mix(in oklab, var(--surface-sunken) 70%, var(--surface-base));
  padding: 0.65rem 0.9rem;
}

.landing-fenster-punkte {
  display: flex;
  gap: 0.35rem;
}

.landing-fenster-punkte i {
  display: block;
  width: 0.65rem;
  height: 0.65rem;
  border-radius: 999px;
}

.landing-fenster-titel {
  font-size: 0.72rem;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: var(--text-subtle);
}

.landing-fenster-inhalt {
  background: var(--surface-canvas);
}
</style>
