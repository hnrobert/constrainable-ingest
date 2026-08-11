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
const levelVariant: Record<string, 'success' | 'warning' | 'destructive'> = {
  info: 'success',
  warn: 'warning',
  error: 'destructive',
}
function prettyDetail(d: unknown): string {
  if (d == null) return ''
  return typeof d === 'string' ? d : JSON.stringify(d, null, 2)
}
</script>

<template>
  <div class="space-y-6">
    <div class="space-y-1">
      <h1 class="text-2xl font-semibold">Audit log</h1>
      <p class="text-muted-foreground">Append-only record of auth, publish, access, config, recording, and admin events.</p>
    </div>

    <Card>
      <CardContent class="space-y-4 pt-6">
        <div class="flex flex-wrap items-end gap-3">
          <div class="min-w-[140px] space-y-1.5">
            <Label>Level</Label>
            <Select v-model="filters.level">
              <SelectTrigger class="w-full"><SelectValue placeholder="All" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">All</SelectItem>
                <SelectItem v-for="l in AUDIT_LEVELS" :key="l" :value="l">{{ l }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="min-w-[140px] space-y-1.5">
            <Label>Category</Label>
            <Select v-model="filters.category">
              <SelectTrigger class="w-full"><SelectValue placeholder="All" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">All</SelectItem>
                <SelectItem v-for="c in AUDIT_CATEGORIES" :key="c" :value="c">{{ c }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="min-w-[140px] space-y-1.5">
            <Label>Event</Label>
            <Select v-model="filters.eventId">
              <SelectTrigger class="w-full"><SelectValue placeholder="All" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">All</SelectItem>
                <SelectItem v-for="e in events" :key="e.id" :value="String(e.id)">{{ e.name }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="min-w-[180px] flex-1 space-y-1.5">
            <Label>Search (message / stream)</Label>
            <Input type="text" v-model="filters.q" placeholder="Message or stream name…" @keyup.enter="apply" />
          </div>
        </div>
        <div class="flex justify-end gap-2">
          <Button variant="outline" @click="resetFilters">Clear</Button>
          <Button @click="apply">Search</Button>
        </div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <div class="flex items-center justify-between">
          <CardTitle>Showing {{ data?.length ?? 0 }} (newest first, max 200)</CardTitle>
          <Button variant="outline" size="sm" :disabled="pending" @click="refresh()">{{ pending ? 'Refreshing…' : 'Refresh' }}</Button>
        </div>
      </CardHeader>
      <CardContent>
        <p v-if="!data || data.length === 0" class="p-6 text-center text-muted-foreground">No audit entries.</p>
        <Table v-else>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Level</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Stream</TableHead>
              <TableHead>Message</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <template v-for="row in data" :key="row.id">
              <TableRow>
                <TableCell class="whitespace-nowrap text-xs text-muted-foreground">{{ fmtDate(row.ts) }}</TableCell>
                <TableCell>
                  <Badge :variant="levelVariant[row.level] ?? 'secondary'">{{ row.level }}</Badge>
                </TableCell>
                <TableCell class="text-muted-foreground">{{ row.category }}</TableCell>
                <TableCell class="text-muted-foreground">{{ row.eventId ? (eventName.get(row.eventId) ?? `#${row.eventId}`) : '—' }}</TableCell>
                <TableCell class="text-muted-foreground">{{ row.streamName ?? '—' }}</TableCell>
                <TableCell>{{ row.message }}</TableCell>
              </TableRow>
              <TableRow v-if="row.detail != null">
                <TableCell colspan="6" class="p-0">
                  <pre class="m-0 max-h-48 overflow-auto whitespace-pre-wrap break-words border-t border-dashed bg-muted/40 px-3 py-2 text-xs">{{ prettyDetail(row.detail) }}</pre>
                </TableCell>
              </TableRow>
            </template>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  </div>
</template>
