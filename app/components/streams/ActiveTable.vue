<script setup lang="ts">
import type { SessionSnapshot, SessionStatus } from '#shared/events'

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
</script>

<template>
  <p v-if="props.sessions.length === 0" class="p-6 text-center text-muted-foreground">No active streams.</p>
  <Table v-else>
    <TableHeader>
      <TableRow>
        <TableHead>Stream name</TableHead>
        <TableHead>Status</TableHead>
        <TableHead>Resolution</TableHead>
        <TableHead>Framerate</TableHead>
        <TableHead>Bitrate</TableHead>
        <TableHead>Compliant</TableHead>
        <TableHead>Started</TableHead>
        <TableHead class="w-0" />
      </TableRow>
    </TableHeader>
    <TableBody>
      <TableRow v-for="s in props.sessions" :key="s.sessionId">
        <TableCell class="font-medium">{{ s.streamName }}</TableCell>
        <TableCell>
          <Badge :variant="statusVariant[s.status]">{{ statusLabel[s.status] }}</Badge>
        </TableCell>
        <TableCell>{{ resolution(s) }}</TableCell>
        <TableCell>{{ s.fps != null ? s.fps.toFixed(2) : '—' }}</TableCell>
        <TableCell>{{ s.bitrateKbps != null ? `${s.bitrateKbps} kbps` : '—' }}</TableCell>
        <TableCell>
          <Badge v-if="s.compliant" variant="success">✓</Badge>
          <span v-else class="text-muted-foreground">—</span>
        </TableCell>
        <TableCell class="text-muted-foreground">{{ fmtTime(s.startedAt) }}</TableCell>
        <TableCell>
          <Button size="sm" variant="outline" @click="emit('watch', s.streamName)">Watch</Button>
        </TableCell>
      </TableRow>
    </TableBody>
  </Table>
</template>
