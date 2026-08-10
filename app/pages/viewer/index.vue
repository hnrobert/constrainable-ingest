<script lang="ts">
definePageMeta({ layout: 'viewer' })
</script>

<script setup lang="ts">
interface ViewerEvent {
  id: number
  name: string
  slug: string
  description: string | null
  status: string
  startsAt: number | null
  endsAt: number | null
}

const { data: events, refresh } = await useFetch<ViewerEvent[]>('/api/viewer/events')

const statusLabel: Record<string, string> = {
  scheduled: 'Upcoming',
  live: 'In progress',
  ended: 'Ended',
  draft: 'Draft',
  archived: 'Archived',
}

function fmt(ms: number | null): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleString('en-US', { hour12: false })
}

function windowLabel(e: ViewerEvent): string {
  if (e.startsAt && e.endsAt) return `${fmt(e.startsAt)} → ${fmt(e.endsAt)}`
  if (e.startsAt) return `From ${fmt(e.startsAt)}`
  if (e.endsAt) return `Until ${fmt(e.endsAt)}`
  return 'Time TBD'
}

// keep the schedule fresh while the page is open
let timer: ReturnType<typeof setInterval> | null = null
onMounted(() => { timer = setInterval(refresh, 30000) })
onBeforeUnmount(() => { if (timer) clearInterval(timer) })
</script>

<template>
  <div class="stack">
    <div>
      <h1>Event Schedule</h1>
      <p class="muted">Scheduled times for each event. Live viewing is restricted to admins/proctors.</p>
    </div>

    <div v-if="!events?.length" class="card muted empty">No scheduled events.</div>

    <section v-for="e in events" :key="e.id" class="card">
      <div class="between">
        <div>
          <h2>{{ e.name }}</h2>
          <p class="muted">{{ e.description ?? '' }}</p>
        </div>
        <span class="badge" :class="e.status === 'live' ? 'ok' : 'warn'">
          {{ statusLabel[e.status] ?? e.status }}
        </span>
      </div>
      <p class="row schedule">
        <span class="badge muted">Time</span>
        <span>{{ windowLabel(e) }}</span>
      </p>
      <p class="row">
        <span class="badge muted">slug</span>
        <span class="mono">{{ e.slug }}</span>
      </p>
    </section>
  </div>
</template>

<style scoped>
.empty { padding: 1.5rem; text-align: center; }
.schedule { margin-top: 0.4rem; font-size: 0.95rem; }
.mono { font-family: ui-monospace, monospace; font-size: 0.85rem; }
</style>
