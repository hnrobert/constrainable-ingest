<script setup lang="ts">
import type { RecordingView } from '#shared/recordings'
import type { DataTableColumn } from '~/components/DataTable.vue'

const toast = useToast()

// events for the filter dropdown (full EventView type lands in Phase 7)
const { data: events } = useFetch<{ id: number; name: string }[]>('/api/events')

// "All" filter option uses a non-empty sentinel — reka-ui forbids an empty
// SelectItem value (empty is reserved for clearing the selection). apply() maps
// the sentinel back to '' so the API treats it as "no filter".
const ALL = 'all'

const filters = reactive<{ eventId: string; date: string; q: string }>({
  eventId: ALL,
  date: '',
  q: '',
})
// applied filters drive the query; updated on search
const applied = ref({ eventId: '', date: '', q: '' })
const { data, refresh, pending } = useFetch<RecordingView[]>('/api/recordings', {
  query: applied,
})

function apply(): void {
  applied.value = {
    eventId: filters.eventId === ALL ? '' : filters.eventId,
    date: filters.date,
    q: filters.q,
  }
}
function resetFilters(): void {
  filters.eventId = ALL
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

const columns: DataTableColumn[] = [
  { key: 'streamName', header: 'Stream name', class: 'font-medium' },
  { key: 'studentLabel', header: 'Student', class: 'text-muted-foreground' },
  { key: 'sizeBytes', header: 'Size' },
  { key: 'resolution', header: 'Resolution', class: 'text-muted-foreground' },
  { key: 'startedAt', header: 'Start time', class: 'text-muted-foreground' },
  { key: 'actions', header: '', headClass: 'w-0' },
]

function rowClass(r: RecordingView): string | undefined {
  return r.id === selectedId.value ? 'bg-muted' : undefined
}
</script>

<template>
  <div class="space-y-6">
    <div class="space-y-1">
      <h1 class="text-2xl font-semibold">Recordings</h1>
      <p class="text-muted-foreground">
        Archived recordings of compliant streams, with online playback, download, and deletion.
      </p>
    </div>

    <Card>
      <CardContent class="space-y-3">
        <div class="flex flex-wrap items-end gap-3">
          <div class="space-y-1.5 min-w-40">
            <Label>Event</Label>
            <Select v-model="filters.eventId">
              <SelectTrigger class="w-full">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem :value="ALL">All</SelectItem>
                <SelectItem v-for="e in events" :key="e.id" :value="String(e.id)">{{ e.name }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="space-y-1.5 min-w-40">
            <Label>Date</Label>
            <Input type="date" v-model="filters.date" />
          </div>
          <div class="space-y-1.5 min-w-40 flex-1">
            <Label>Search (stream name / student)</Label>
            <Input
              v-model="filters.q"
              type="text"
              placeholder="Student ID, name, or stream name…"
              @keyup.enter="apply"
            />
          </div>
        </div>
        <div class="flex justify-end gap-2">
          <Button variant="outline" @click="resetFilters">Clear</Button>
          <Button @click="apply">Search</Button>
        </div>
      </CardContent>
    </Card>

    <RecordingsPlayer v-if="selected" :recording="selected" @deleted="onDeleted" />

    <Card>
      <CardHeader>
        <div class="flex items-center justify-between">
          <CardTitle>Total {{ data?.length ?? 0 }}</CardTitle>
          <Button variant="outline" size="sm" :disabled="pending" @click="refresh()">
            {{ pending ? 'Refreshing…' : 'Refresh' }}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <DataTable
          :columns="columns"
          :rows="data ?? []"
          :row-key="(r: RecordingView) => r.id"
          :row-class="rowClass"
          empty="No recordings."
        >
          <template #cell-studentLabel="{ row }">
            {{ row.studentLabel ?? '—' }}
          </template>
          <template #cell-sizeBytes="{ row }">
            {{ fmtSize(row.sizeBytes) }}
          </template>
          <template #cell-resolution="{ row }">
            {{ row.width && row.height ? `${row.width}×${row.height}` : '—' }}
          </template>
          <template #cell-startedAt="{ row }">
            {{ fmtDate(row.startedAt) }}
          </template>
          <template #cell-actions="{ row }">
            <Button size="sm" variant="outline" @click="play(row)">Play</Button>
          </template>
        </DataTable>
      </CardContent>
    </Card>
  </div>
</template>
