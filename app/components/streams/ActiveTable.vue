<script setup lang="ts">
import type { SessionSnapshot, SessionStatus } from '#shared/events'

const props = defineProps<{ sessions: SessionSnapshot[] }>()
const emit = defineEmits<{ watch: [streamName: string] }>()

const statusClass: Record<SessionStatus, string> = {
  pending: 'muted',
  allowed: 'warn',
  compliant: 'ok',
  violating: 'danger',
  killed: 'danger',
  rejected: 'muted',
  ended: 'muted',
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
  <div v-if="props.sessions.length === 0" class="muted empty">No active streams.</div>
  <table v-else>
    <thead>
      <tr>
        <th>Stream name</th>
        <th>Status</th>
        <th>Resolution</th>
        <th>Framerate</th>
        <th>Bitrate</th>
        <th>Compliant</th>
        <th>Started</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="s in props.sessions" :key="s.sessionId">
        <td>{{ s.streamName }}</td>
        <td><span class="badge" :class="statusClass[s.status]">{{ statusLabel[s.status] }}</span></td>
        <td>{{ resolution(s) }}</td>
        <td>{{ s.fps != null ? s.fps.toFixed(2) : '—' }}</td>
        <td>{{ s.bitrateKbps != null ? `${s.bitrateKbps} kbps` : '—' }}</td>
        <td>
          <span v-if="s.compliant" class="badge ok">✓</span>
          <span v-else class="muted">—</span>
        </td>
        <td class="muted">{{ fmtTime(s.startedAt) }}</td>
        <td><button @click="emit('watch', s.streamName)">Watch</button></td>
      </tr>
    </tbody>
  </table>
</template>

<style scoped>
.empty { padding: 2rem; text-align: center; }
</style>
