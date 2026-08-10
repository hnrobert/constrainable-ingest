<script setup lang="ts">
import type { AuditView } from '#shared/audit'
import { AUDIT_CATEGORIES, AUDIT_LEVELS } from '#shared/audit'

// Events feed the filter dropdown and resolve eventId → name in the table.
const { data: events } = await useFetch<{ id: number; name: string }[]>('/api/events')
const eventName = computed(() => {
  const m = new Map<number, string>()
  for (const e of events.value ?? []) m.set(e.id, e.name)
  return m
})

const filters = reactive<{ level: string; category: string; eventId: string; q: string }>({
  level: '',
  category: '',
  eventId: '',
  q: '',
})
// applied filters drive the query; updated on search.
const applied = ref({ ...filters })
const { data, refresh, pending } = await useFetch<AuditView[]>('/api/audit', { query: applied })

function apply(): void {
  applied.value = { ...filters }
}
function resetFilters(): void {
  filters.level = ''
  filters.category = ''
  filters.eventId = ''
  filters.q = ''
  apply()
}

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleString('en-US', { hour12: false })
}
const levelClass: Record<string, string> = {
  info: 'badge ok',
  warn: 'badge warn',
  error: 'badge danger',
}
function prettyDetail(d: unknown): string {
  if (d == null) return ''
  return typeof d === 'string' ? d : JSON.stringify(d, null, 2)
}
</script>

<template>
  <div class="stack">
    <div>
      <h1>Audit log</h1>
      <p class="muted">Append-only record of auth, publish, access, config, recording, and admin events.</p>
    </div>

    <section class="card filters">
      <div class="row">
        <label class="field">
          <span class="field-label">Level</span>
          <select v-model="filters.level">
            <option value="">All</option>
            <option v-for="l in AUDIT_LEVELS" :key="l" :value="l">{{ l }}</option>
          </select>
        </label>
        <label class="field">
          <span class="field-label">Category</span>
          <select v-model="filters.category">
            <option value="">All</option>
            <option v-for="c in AUDIT_CATEGORIES" :key="c" :value="c">{{ c }}</option>
          </select>
        </label>
        <label class="field">
          <span class="field-label">Event</span>
          <select v-model="filters.eventId">
            <option value="">All</option>
            <option v-for="e in events" :key="e.id" :value="String(e.id)">{{ e.name }}</option>
          </select>
        </label>
        <label class="field grow">
          <span class="field-label">Search (message / stream)</span>
          <input type="text" v-model="filters.q" placeholder="Message or stream name…" @keyup.enter="apply" />
        </label>
      </div>
      <div class="row right">
        <button @click="resetFilters">Clear</button>
        <button class="primary" @click="apply">Search</button>
      </div>
    </section>

    <section class="card">
      <div class="between">
        <h2>Showing {{ data?.length ?? 0 }} (newest first, max 200)</h2>
        <button :disabled="pending" @click="refresh()">{{ pending ? 'Refreshing…' : 'Refresh' }}</button>
      </div>
      <div v-if="!data || data.length === 0" class="muted empty">No audit entries.</div>
      <table v-else class="audit-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Level</th>
            <th>Category</th>
            <th>Event</th>
            <th>Stream</th>
            <th>Message</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="row in data" :key="row.id">
            <tr>
              <td class="muted nowrap">{{ fmtDate(row.ts) }}</td>
              <td><span :class="levelClass[row.level] ?? 'badge muted'">{{ row.level }}</span></td>
              <td class="muted">{{ row.category }}</td>
              <td class="muted">{{ row.eventId ? (eventName.get(row.eventId) ?? `#${row.eventId}`) : '—' }}</td>
              <td class="muted">{{ row.streamName ?? '—' }}</td>
              <td>{{ row.message }}</td>
            </tr>
            <tr v-if="row.detail != null" class="detail-row">
              <td colspan="6"><pre>{{ prettyDetail(row.detail) }}</pre></td>
            </tr>
          </template>
        </tbody>
      </table>
    </section>
  </div>
</template>

<style scoped>
.filters .field { min-width: 140px; }
.field { display: flex; flex-direction: column; gap: 0.25rem; }
.field-label { font-size: 0.8rem; color: var(--muted); }
.right { justify-content: flex-end; margin-top: 0.75rem; }
.empty { padding: 2rem; text-align: center; }
.audit-table { table-layout: auto; }
.nowrap { white-space: nowrap; }
.detail-row td { padding: 0; }
.detail-row pre {
  margin: 0;
  padding: 0.5rem 0.75rem;
  background: var(--bg);
  border-top: 1px dashed var(--border);
  font-size: 0.75rem;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 12em;
  overflow: auto;
}
</style>
