<script setup lang="ts">
import type { RecordingView } from '#shared/recordings'

const toast = useToast()

// events for the filter dropdown (full EventView type lands in Phase 7)
const { data: events } = useFetch<{ id: number; name: string }[]>('/api/events')

const filters = reactive<{ eventId: string; date: string; q: string }>({
  eventId: '',
  date: '',
  q: '',
})
// applied filters drive the query; updated on search
const applied = ref({ ...filters })
const { data, refresh, pending } = useFetch<RecordingView[]>('/api/recordings', {
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
                <SelectItem value="">All</SelectItem>
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
        <Table v-if="data && data.length">
          <TableHeader>
            <TableRow>
              <TableHead>Stream name</TableHead>
              <TableHead>Student</TableHead>
              <TableHead>Size</TableHead>
              <TableHead>Resolution</TableHead>
              <TableHead>Start time</TableHead>
              <TableHead class="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow
              v-for="r in data"
              :key="r.id"
              :data-state="r.id === selectedId ? 'selected' : undefined"
            >
              <TableCell class="font-medium">{{ r.streamName }}</TableCell>
              <TableCell class="text-muted-foreground">{{ r.studentLabel ?? '—' }}</TableCell>
              <TableCell>{{ fmtSize(r.sizeBytes) }}</TableCell>
              <TableCell class="text-muted-foreground">{{ r.width && r.height ? `${r.width}×${r.height}` : '—' }}</TableCell>
              <TableCell class="text-muted-foreground">{{ fmtDate(r.startedAt) }}</TableCell>
              <TableCell>
                <Button size="sm" variant="outline" @click="play(r)">Play</Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <p v-else class="p-6 text-center text-muted-foreground">No recordings.</p>
      </CardContent>
    </Card>
  </div>
</template>
