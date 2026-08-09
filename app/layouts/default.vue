<script setup lang="ts">
// Admin shell. Nav items enable as each phase's page lands; unbuilt ones are
// muted and non-navigating. The server middleware + global auth middleware gate
// this whole layout; logout clears the session.
const { user, logout } = useAuth()

const nav = [
  { label: '概览', to: '/' },
  { label: '实时', to: '/streams' },
  { label: '赛事', to: '/events' },
  { label: '录像', to: '/recordings' },
  { label: '配置', to: '/config' },
  { label: '审计', to: '/audit', enabled: false },
]
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <NuxtLink to="/" class="brand">Constrainable Ingest</NuxtLink>
      <nav class="app-nav">
        <template v-for="item in nav" :key="item.to">
          <NuxtLink v-if="item.enabled !== false" :to="item.to">{{ item.label }}</NuxtLink>
          <span v-else class="nav-disabled" :title="`未实现（${item.label}）`">{{ item.label }}</span>
        </template>
      </nav>
      <div class="app-auth">
        <NuxtLink to="/viewer" class="viewer-link" target="_blank">观看页</NuxtLink>
        <span v-if="user" class="app-user">{{ user.username }}</span>
        <button v-if="user" class="ghost" @click="logout">登出</button>
      </div>
    </header>
    <main class="app-main">
      <slot />
    </main>
    <UiAppToast />
  </div>
</template>

<style scoped>
.app-shell { min-height: 100vh; }
.app-header {
  display: flex;
  align-items: center;
  gap: 1.5rem;
  padding: 0.75rem 1.25rem;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
  position: sticky;
  top: 0;
  z-index: 10;
}
.brand { font-weight: 600; font-size: 1rem; color: var(--text); }
.brand:hover { color: var(--primary); }
.app-nav { display: flex; gap: 1rem; }
.app-nav a { color: var(--muted); font-size: 0.9rem; }
.app-nav a.router-link-active { color: var(--text); }
.nav-disabled { color: var(--muted); opacity: 0.4; font-size: 0.9rem; cursor: default; }
.app-main { padding: 1.25rem; max-width: 1200px; margin: 0 auto; }
.app-auth { margin-left: auto; display: flex; align-items: center; gap: 0.75rem; }
.app-user { font-size: 0.85rem; color: var(--muted); }
.app-auth .ghost { font-size: 0.8rem; }
.viewer-link { font-size: 0.8rem; color: var(--muted); }
</style>
