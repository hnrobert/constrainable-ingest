<script setup lang="ts">
import type { EventView, EventStatus } from '#shared/event-view'

definePageMeta({ layout: 'public' })

const { user } = useAuth()
// No top-level `await`: keeps this a SYNCHRONOUS component (no <Suspense>
// boundary). An async (suspensing) page rendered through the layout's <slot/>
// triggered a client-side `renderSlot` with no active rendering instance on
// hydration (`null is not an object: currentRenderingInstance.ce`). Nuxt's SSR
// renderer still awaits the registered useFetch promise, so the data is
// populated server-side and serialized into the payload.
const { data: events } = useFetch<EventView[]>('/api/events/public')

const statusLabel: Record<EventStatus, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  live: 'Live now',
  ended: 'Ended',
  archived: 'Archived',
}
const statusClass: Record<EventStatus, string> = {
  draft: 'muted',
  scheduled: 'warn',
  live: 'ok',
  ended: 'muted',
  archived: 'danger',
}

function when(e: EventView): string {
  if (!e.startsAt) return '—'
  const s = new Date(e.startsAt).toLocaleString('en-US', { hour12: false })
  if (!e.endsAt) return s
  return `${s} → ${new Date(e.endsAt).toLocaleString('en-US', { hour12: false })}`
}
</script>

<template>
  <section class="hero">
    <h1>Constrainable Ingest</h1>
    <p class="lede">
      ICPC proctoring stream ingest and event management. Browse public events
      below, or sign in to access your schedule and details.
    </p>
    <div class="cta">
      <NuxtLink v-if="user" to="/dashboard" class="primary">Go to dashboard</NuxtLink>
      <NuxtLink v-else to="/login" class="primary">Sign in / Register</NuxtLink>
    </div>
  </section>

  <section class="card">
    <h2>Public events</h2>
    <p v-if="!events || !events.length" class="muted empty">No public events right now. Check back later.</p>
    <table v-else>
      <thead>
        <tr><th>Event</th><th>When</th><th>Status</th></tr>
      </thead>
      <tbody>
        <tr v-for="e in events" :key="e.id">
          <td>
            <strong>{{ e.name }}</strong>
            <span v-if="e.description" class="muted small block">{{ e.description }}</span>
          </td>
          <td class="muted">{{ when(e) }}</td>
          <td><span class="badge" :class="statusClass[e.status]">{{ statusLabel[e.status] }}</span></td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
.hero { margin-bottom: 1.5rem; }
.hero h1 { font-size: 1.8rem; margin: 0 0 0.5rem; }
.lede { color: var(--muted); max-width: 42rem; margin: 0 0 1rem; line-height: 1.5; }
.cta { display: flex; gap: 0.75rem; }
.empty { padding: 1.5rem; text-align: center; }
.block { display: block; }
.small { font-size: 0.78rem; }
</style>
