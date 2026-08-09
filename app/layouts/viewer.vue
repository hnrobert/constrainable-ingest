<script setup lang="ts">
// Minimal public-facing shell — no admin nav. Viewers are unauthenticated.
</script>

<template>
  <div class="viewer-shell">
    <header class="viewer-header">
      <NuxtLink to="/viewer" class="brand">Constrainable Ingest · 观看</NuxtLink>
    </header>
    <main class="viewer-main">
      <slot />
    </main>
    <UiAppToast />
  </div>
</template>

<style scoped>
.viewer-shell { min-height: 100vh; }
.viewer-header {
  padding: 0.75rem 1.25rem;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
  position: sticky; top: 0; z-index: 10;
}
.brand { font-weight: 600; color: var(--text); }
.viewer-main { padding: 1.25rem; max-width: 900px; margin: 0 auto; }
</style>
