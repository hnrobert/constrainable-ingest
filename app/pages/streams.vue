<script setup lang="ts">
import type { SessionSnapshot, ViolationSnapshot, RecordingSnapshot } from '#shared/events'

const toast = useToast()

// seed from the API (SSR), then live-update over the socket
const { data } = await useFetch<SessionSnapshot[]>('/api/streams')

const sessions = ref<Map<number, SessionSnapshot>>(new Map())
const connected = ref(false)
const lastViolation = ref<ViolationSnapshot | null>(null)

const list = computed(() =>
  [...sessions.value.values()].sort((a, b) => b.startedAt - a.startedAt),
)

function upsert(s: SessionSnapshot): void {
  sessions.value.set(s.sessionId, s)
}

onMounted(() => {
  if (data.value) for (const s of data.value) sessions.value.set(s.sessionId, s)

  const socket = useSocket()
  socket.on('connect', () => (connected.value = true))
  socket.on('disconnect', () => (connected.value = false))
  socket.on('session:start', (s: SessionSnapshot) => upsert(s))
  socket.on('session:metric', (s: SessionSnapshot) => upsert(s))
  socket.on('session:violation', (s: ViolationSnapshot) => {
    upsert(s)
    lastViolation.value = s
    toast.error(`违规：${s.streamName}（${s.reasons.join('；')}）`)
  })
  socket.on('session:stop', (s: SessionSnapshot) => {
    sessions.value.delete(s.sessionId)
  })
  socket.on('recording:ready', (r: RecordingSnapshot) =>
    toast.success(`录像就绪：${r.streamName}`),
  )
  socket.on('config:changed', () => toast.info('运行配置已热重载'))
})

onBeforeUnmount(() => disposeSocket())
</script>

<template>
  <div class="stack">
    <div class="between">
      <div>
        <h1>实时推流</h1>
        <p class="muted">活跃会话与实时指标，违规即时告警。</p>
      </div>
      <span class="badge" :class="connected ? 'ok' : 'warn'">
        {{ connected ? '● 已连接' : '○ 连接中…' }}
      </span>
    </div>

    <section class="card">
      <StreamsActiveTable :sessions="list" />
    </section>

    <section v-if="lastViolation" class="card violation">
      <strong>最近一次违规：</strong>
      {{ lastViolation.streamName }} —
      {{ lastViolation.reasons.join('；') }}
      <span class="muted">（{{ new Date(lastViolation.startedAt).toLocaleTimeString('zh-CN', { hour12: false }) }}）</span>
    </section>
  </div>
</template>

<style scoped>
.violation { border-color: var(--danger); }
</style>
