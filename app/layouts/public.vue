<script setup lang="ts">
// Minimal shell for public pages (landing + invite). Shows a brand link and an
// auth-aware CTA (Sign in / Dashboard). No management nav.
const { user } = useAuth()
</script>

<template>
  <div class="pub-shell">
    <header class="pub-header">
      <NuxtLink to="/" class="brand">Constrainable Ingest</NuxtLink>
      <div class="pub-auth">
        <NuxtLink v-if="user" to="/dashboard" class="primary">Dashboard</NuxtLink>
        <NuxtLink v-else to="/login" class="primary">Sign in</NuxtLink>
      </div>
    </header>
    <main class="pub-main">
      <slot />
    </main>
  </div>
</template>

<style scoped>
.pub-shell { min-height: 100vh; }
.pub-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1.25rem;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
}
.brand { font-weight: 600; font-size: 1rem; color: var(--text); }
.brand:hover { color: var(--primary); }
.pub-main { max-width: 960px; margin: 0 auto; padding: 2rem 1.25rem; }
.pub-auth .primary { font-size: 0.85rem; }
</style>
