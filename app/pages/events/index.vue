<script setup lang="ts">
import type { EventView, EventStatus } from '#shared/event-view'

const toast = useToast()
const { data: events, refresh } = await useFetch<EventView[]>('/api/events')

const creating = ref(false)
const saving = ref(false)
const form = reactive({ name: '', slug: '', description: '' })

const statusClass: Record<EventStatus, string> = {
  draft: 'muted',
  scheduled: 'warn',
  live: 'ok',
  ended: 'muted',
  archived: 'danger',
}
const statusLabel: Record<EventStatus, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  live: 'Live',
  ended: 'Ended',
  archived: 'Archived',
}

async function create(): Promise<void> {
  if (!form.name.trim()) {
    toast.error('Please fill in the event name')
    return
  }
  saving.value = true
  try {
    await $fetch('/api/events', {
      method: 'POST',
      body: { name: form.name, slug: form.slug || undefined, description: form.description || undefined },
    })
    toast.success('Event created')
    form.name = ''
    form.slug = ''
    form.description = ''
    creating.value = false
    await refresh()
  } catch (e: any) {
    toast.error('Create failed: ' + (e?.data?.statusMessage || e?.message || ''))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="stack">
    <div class="between">
      <div>
        <h1>Events</h1>
        <p class="muted">Each event has its own roster, stream keys, and config overrides.</p>
      </div>
      <button class="primary" @click="creating = !creating">
        {{ creating ? 'Cancel' : '+ New event' }}
      </button>
    </div>

    <section v-if="creating" class="card">
      <h2>New event</h2>
      <div class="form-grid">
        <label class="field">
          <span class="field-label">Name *</span>
          <input v-model="form.name" placeholder="e.g. 2026 Regional" />
        </label>
        <label class="field">
          <span class="field-label">slug (auto-generated if blank)</span>
          <input v-model="form.slug" placeholder="e.g. regional-2026" />
        </label>
        <label class="field full">
          <span class="field-label">Description</span>
          <input v-model="form.description" />
        </label>
      </div>
      <div class="row right">
        <button class="primary" :disabled="saving" @click="create">{{ saving ? 'Creating…' : 'Create' }}</button>
      </div>
    </section>

    <section class="card">
      <table>
        <thead>
          <tr><th>Name</th><th>slug</th><th>Status</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="e in events" :key="e.id">
            <td>{{ e.name }}</td>
            <td class="muted">{{ e.slug }}</td>
            <td><span class="badge" :class="statusClass[e.status]">{{ statusLabel[e.status] }}</span></td>
            <td><NuxtLink :to="`/events/${e.id}`"><button>Manage</button></NuxtLink></td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<style scoped>
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
.field { display: flex; flex-direction: column; gap: 0.25rem; }
.field.full { grid-column: 1 / -1; }
.field-label { font-size: 0.8rem; color: var(--muted); }
.right { justify-content: flex-end; margin-top: 0.75rem; }
</style>
