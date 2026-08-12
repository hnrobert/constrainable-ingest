<script setup lang="ts">
import type { SessionSnapshot, SessionStatus } from '#shared/events'
import type { DataTableColumn } from '~/components/DataTable.vue'

const props = defineProps<{ sessions: SessionSnapshot[] }>()
const emit = defineEmits<{ watch: [streamName: string] }>()

const statusVariant: Record<SessionStatus, 'secondary' | 'warning' | 'success' | 'destructive'> = {
  pending: 'secondary',
  allowed: 'warning',
  compliant: 'success',
  violating: 'destructive',
  killed: 'destructive',
  rejected: 'secondary',
  ended: 'secondary',
}
const statusLabel: Record<SessionStatus, string> = {
  pending: 'Pending',
  allowed: 'Publishing',
  compliant: 'Compliant',
  violating: 'Violating',
  killed: 'Kicked',
  rejected: 'Rejected',
  ended: 'Ended',
}

function resolution(s: SessionSnapshot): string {
  if (s.width && s.height) return `${s.width}×${s.height}`
  return '—'
}
function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-US', { hour12: false })
}

const columns: DataTableColumn[] = [
  { key: 'streamName', header: 'Stream name', class: 'font-medium' },
  { key: 'status', header: 'Status' },
  { key: 'resolution', header: 'Resolution' },
  { key: 'fps', header: 'Framerate' },
  { key: 'bitrateKbps', header: 'Bitrate' },
  { key: 'compliant', header: 'Compliant' },
  { key: 'startedAt', header: 'Started', class: 'text-muted-foreground' },
  { key: 'actions', header: '', headClass: 'w-0' },
]
</script>

<template>
  <DataTable
    :columns="columns"
    :rows="props.sessions"
    :row-key="(s: SessionSnapshot) => s.sessionId"
    empty="No active streams."
  >
    <template #cell-status="{ row }">
      <Badge :variant="statusVariant[row.status]">{{ statusLabel[row.status] }}</Badge>
    </template>
    <template #cell-resolution="{ row }">{{ resolution(row) }}</template>
    <template #cell-fps="{ row }">{{ row.fps != null ? row.fps.toFixed(2) : '—' }}</template>
    <template #cell-bitrateKbps="{ row }">{{ row.bitrateKbps != null ? `${row.bitrateKbps} kbps` : '—' }}</template>
    <template #cell-compliant="{ row }">
      <Badge v-if="row.compliant" variant="success">✓</Badge>
      <span v-else class="text-muted-foreground">—</span>
    </template>
    <template #cell-startedAt="{ row }">{{ fmtTime(row.startedAt) }}</template>
    <template #cell-actions="{ row }">
      <Button size="sm" variant="outline" @click="emit('watch', row.streamName)">Watch</Button>
    </template>
  </DataTable>
</template>
