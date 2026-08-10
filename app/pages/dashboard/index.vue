<script setup lang="ts">
import type { EventView, EventStatus } from '#shared/event-view'

definePageMeta({ layout: 'default' })

const { user } = useAuth()
const isAdmin = computed(() => user.value?.role === 'admin')

// /api/events is authorization-filtered server-side: admins see all, regular
// users see only the events they may view.
const { data: events } = await useFetch<EventView[]>('/api/events')

const statusLabel: Record<EventStatus, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  live: 'Live',
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
</script>

<template>
  <div class="stack">
    <div>
      <h1>Dashboard</h1>
      <p class="muted">
        Welcome, {{ user?.email }}.
        <template v-if="isAdmin">You have admin access — full event and system management.</template>
        <template v-else>You can view the schedule and details for events you have access to.</template>
      </p>
    </div>

    <section v-if="isAdmin" class="quick card">
      <h2>Management</h2>
      <div class="quick-grid">
        <NuxtLink to="/dashboard/events" class="quick-link">Events →</NuxtLink>
        <NuxtLink to="/dashboard/streams" class="quick-link">Live streams →</NuxtLink>
        <NuxtLink to="/dashboard/recordings" class="quick-link">Recordings →</NuxtLink>
        <NuxtLink to="/dashboard/users" class="quick-link">Users →</NuxtLink>
        <NuxtLink to="/dashboard/groups" class="quick-link">Groups &amp; invites →</NuxtLink>
        <NuxtLink to="/dashboard/config" class="quick-link">Config →</NuxtLink>
      </div>
    </section>

    <section class="card">
      <div class="between">
        <h2>{{ isAdmin ? 'All events' : 'Your events' }}</h2>
        <NuxtLink to="/dashboard/events" class="muted">View all →</NuxtLink>
      </div>
      <table v-if="events && events.length">
        <thead><tr><th>Event</th><th>Status</th><th></th></tr></thead>
        <tbody>
          <tr v-for="e in events" :key="e.id">
            <td>{{ e.name }}</td>
            <td><span class="badge" :class="statusClass[e.status]">{{ statusLabel[e.status] }}</span></td>
            <td><NuxtLink :to="`/dashboard/events/${e.id}`"><button>{{ isAdmin ? 'Manage' : 'View' }}</button></NuxtLink></td>
          </tr>
        </tbody>
      </table>
      <p v-else class="muted empty">No events available.</p>
    </section>
  </div>
</template>

<style scoped>
.quick-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 0.75rem; }
.quick-link {
  display: block;
  padding: 0.75rem 1rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  font-size: 0.9rem;
}
.quick-link:hover { border-color: var(--primary); color: var(--primary); }
.empty { padding: 1.5rem; text-align: center; }
</style>
