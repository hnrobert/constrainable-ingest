<script setup lang="ts">
// Minimal public-facing shell — no admin nav. Shows the event schedule;
// logged-in accounts (admin/viewer) see their name + a logout link.
const { user, fetchSession, logout } = useAuth()
await callOnce('viewer:session', () => fetchSession())
</script>

<template>
  <div class="viewer-shell">
    <header class="viewer-header">
      <NuxtLink to="/viewer" class="brand">Constrainable Ingest · 时间表</NuxtLink>
      <div class="auth">
        <template v-if="user">
          <span class="user">{{ user.email }}</span>
          <button class="ghost" @click="logout">登出</button>
        </template>
        <NuxtLink v-else to="/login" class="login-link">登录</NuxtLink>
      </div>
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
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.75rem 1.25rem;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
  position: sticky; top: 0; z-index: 10;
}
.brand { font-weight: 600; color: var(--text); }
.auth { margin-left: auto; display: flex; align-items: center; gap: 0.6rem; }
.user { font-size: 0.85rem; color: var(--muted); }
.auth .ghost { font-size: 0.8rem; }
.login-link { font-size: 0.85rem; color: var(--muted); }
.viewer-main { padding: 1.25rem; max-width: 900px; margin: 0 auto; }
</style>
