<script setup lang="ts">
// Dashboard shell. Nav is role-aware: both roles see Dashboard + Events (their
// authorized catalog); management pages are admin-only. Brand links to the
// public homepage. The server middleware + requireAdmin are the real gates;
// this nav just hides unreachable routes from regular users.
const { user, logout } = useAuth()
const isAdmin = computed(() => user.value?.role === 'admin')

const baseNav: { label: string; to: string }[] = [
  { label: 'Dashboard', to: '/dashboard' },
  { label: 'Events', to: '/dashboard/events' },
]
const adminNav: { label: string; to: string }[] = [
  { label: 'Live', to: '/dashboard/streams' },
  { label: 'Recordings', to: '/dashboard/recordings' },
  { label: 'Users', to: '/dashboard/users' },
  { label: 'Groups', to: '/dashboard/groups' },
  { label: 'Config', to: '/dashboard/config' },
  { label: 'Mail', to: '/dashboard/mail' },
  { label: 'Audit', to: '/dashboard/audit' },
]
const nav = computed(() => (isAdmin.value ? [...baseNav, ...adminNav] : baseNav))
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <NuxtLink to="/" class="brand">Constrainable Ingest</NuxtLink>
      <nav class="app-nav">
        <NuxtLink v-for="item in nav" :key="item.to" :to="item.to">{{ item.label }}</NuxtLink>
      </nav>
      <div class="app-auth">
        <span v-if="user" class="app-user">{{ user.email }}</span>
        <span v-if="user" class="app-role">{{ isAdmin ? 'admin' : 'user' }}</span>
        <button v-if="user" class="ghost" @click="logout">Sign out</button>
      </div>
    </header>
    <main class="app-main">
      <slot />
    </main>
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
.app-nav { display: flex; gap: 1rem; flex-wrap: wrap; }
.app-nav a { color: var(--muted); font-size: 0.9rem; }
.app-nav a.router-link-active { color: var(--text); }
.app-main { padding: 1.25rem; max-width: 1200px; margin: 0 auto; }
.app-auth { margin-left: auto; display: flex; align-items: center; gap: 0.75rem; }
.app-user { font-size: 0.85rem; color: var(--muted); }
.app-role { font-size: 0.7rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
.app-auth .ghost { font-size: 0.8rem; }
</style>
