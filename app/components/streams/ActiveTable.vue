<script setup lang="ts">
import type { SessionSnapshot, SessionStatus } from '#shared/events'

const props = defineProps<{ sessions: SessionSnapshot[] }>()

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
  pending: '等待',
  allowed: '推流中',
  compliant: '合规',
  violating: '违规',
  killed: '已踢除',
  rejected: '已拒绝',
  ended: '已结束',
}

function resolution(s: SessionSnapshot): string {
  if (s.width && s.height) return `${s.width}×${s.height}`
  return '—'
}
function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('zh-CN', { hour12: false })
}
</script>

<template>
  <div v-if="props.sessions.length === 0" class="muted empty">暂无活跃推流。</div>
  <table v-else>
    <thead>
      <tr>
        <th>流名称</th>
        <th>状态</th>
        <th>分辨率</th>
        <th>帧率</th>
        <th>码率</th>
        <th>合规</th>
        <th>开始</th>
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
      </tr>
    </tbody>
  </table>
</template>

<style scoped>
.empty { padding: 2rem; text-align: center; }
</style>
