<script setup lang="ts">
import type { RecordingView } from '#shared/recordings'

const toast = useToast()

// events for the filter dropdown (full EventView type lands in Phase 7)
const { data: events } = await useFetch<{ id: number; name: string }[]>('/api/events')

const filters = reactive<{ eventId: string; date: string; q: string }>({
  eventId: '',
  date: '',
  q: '',
})
// applied filters drive the query; updated on search
const applied = ref({ ...filters })
const { data, refresh, pending } = await useFetch<RecordingView[]>('/api/recordings', {
  query: applied,
})

function apply(): void {
  applied.value = { ...filters }
}
function resetFilters(): void {
  filters.eventId = ''
  filters.date = ''
  filters.q = ''
  apply()
}

const selectedId = ref<number | null>(null)
const selected = computed(
  () => data.value?.find((r) => r.id === selectedId.value) ?? null,
)
function play(r: RecordingView): void {
  selectedId.value = r.id
}
async function onDeleted(id: number): Promise<void> {
  selectedId.value = null
  await refresh()
  toast.info(`Removed from list #${id}`)
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
function fmtDate(ms: number): string {
  return new Date(ms).toLocaleString('en-US', { hour12: false })
}
</script>

<template>
  <div class="stack">
    <div>
      <h1>Recordings</h1>
      <p class="muted">Archived recordings of compliant streams, with online playback, download, and deletion.</p>
    </div>

    <section class="card filters">
      <div class="row">
        <label class="field">
          <span class="field-label">Event</span>
          <select v-model="filters.eventId">
            <option value="">All</option>
            <option v-for="e in events" :key="e.id" :value="String(e.id)">{{ e.name }}</option>
          </select>
        </label>
        <label class="field">
          <span class="field-label">Date</span>
          <input type="date" v-model="filters.date" />
        </label>
        <label class="field grow">
          <span class="field-label">Search (stream name / student)</span>
          <input type="text" v-model="filters.q" placeholder="Student ID, name, or stream name…" @keyup.enter="apply" />
        </label>
      </div>
      <div class="row right">
        <button @click="resetFilters">Clear</button>
        <button class="primary" @click="apply">Search</button>
      </div>
    </section>

    <RecordingsPlayer v-if="selected" :recording="selected" @deleted="onDeleted" />

    <section class="card">
      <div class="between">
        <h2>Total {{ data?.length ?? 0 }}</h2>
        <button :disabled="pending" @click="refresh()">{{ pending ? 'Refreshing…' : 'Refresh' }}</button>
      </div>
      <div v-if="!data || data.length === 0" class="muted empty">No recordings.</div>
      <table v-else>
        <thead>
          <tr>
            <th>Stream name</th>
            <th>Student</th>
            <th>Size</th>
            <th>Resolution</th>
            <th>Start time</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in data" :key="r.id" :class="{ active: r.id === selectedId }">
            <td>{{ r.streamName }}</td>
            <td class="muted">{{ r.studentLabel ?? '—' }}</td>
            <td>{{ fmtSize(r.sizeBytes) }}</td>
            <td class="muted">{{ r.width && r.height ? `${r.width}×${r.height}` : '—' }}</td>
            <td class="muted">{{ fmtDate(r.startedAt) }}</td>
            <td><button @click="play(r)">Play</button></td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<style scoped>
.filters .field { min-width: 160px; }
.field { display: flex; flex-direction: column; gap: 0.25rem; }
.field-label { font-size: 0.8rem; color: var(--muted); }
.right { justify-content: flex-end; margin-top: 0.75rem; }
.empty { padding: 2rem; text-align: center; }
tbody tr.active { background: var(--panel-2); }
</style>
