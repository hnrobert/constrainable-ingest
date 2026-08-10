<script setup lang="ts">
import type { SessionSnapshot, ViolationSnapshot, RecordingSnapshot } from '#shared/events'

const toast = useToast()

// seed from the API (SSR), then live-update over the socket
const { data } = await useFetch<SessionSnapshot[]>('/api/streams')

const sessions = ref<Map<number, SessionSnapshot>>(new Map())
const connected = ref(false)
const lastViolation = ref<ViolationSnapshot | null>(null)
const watching = ref<string | null>(null)
const manualStream = ref('')

function watchStream(name: string): void {
  watching.value = name.trim() || null
}

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
    toast.error(`Violation: ${s.streamName} (${s.reasons.join('; ')})`)
  })
  socket.on('session:stop', (s: SessionSnapshot) => {
    sessions.value.delete(s.sessionId)
  })
  socket.on('recording:ready', (r: RecordingSnapshot) =>
    toast.success(`Recording ready: ${r.streamName}`),
  )
  socket.on('config:changed', () => toast.info('Runtime config hot-reloaded'))
})

onBeforeUnmount(() => disposeSocket())
</script>

<template>
  <div class="stack">
    <div class="between">
      <div>
        <h1>Live Streams</h1>
        <p class="muted">Active sessions and real-time metrics with instant violation alerts.</p>
      </div>
      <span class="badge" :class="connected ? 'ok' : 'warn'">
        {{ connected ? '● Connected' : '○ Connecting…' }}
      </span>
    </div>

    <section class="card">
      <StreamsActiveTable :sessions="list" @watch="watchStream" />
    </section>

    <section class="card">
      <h2>Watch Live</h2>
      <p class="muted small">Click "Watch" in the table above, or enter a stream name to play manually. The browser connects directly to SRS.</p>
      <div class="row watch-input">
        <input v-model="manualStream" placeholder="Stream name" @keyup.enter="watchStream(manualStream)" />
        <button class="primary" @click="watchStream(manualStream)">Play</button>
        <button v-if="watching" @click="watching = null">Close</button>
      </div>
      <StreamsPlayer v-if="watching" :stream-name="watching" />
    </section>

    <section v-if="lastViolation" class="card violation">
      <strong>Last violation:</strong>
      {{ lastViolation.streamName }} —
      {{ lastViolation.reasons.join('; ') }}
      <span class="muted">({{ new Date(lastViolation.startedAt).toLocaleTimeString('en-US', { hour12: false }) }})</span>
    </section>
  </div>
</template>

<style scoped>
.violation { border-color: var(--danger); }
.watch-input { gap: 0.5rem; align-items: center; margin-bottom: 0.75rem; }
.watch-input input { max-width: 320px; }
.small { font-size: 0.78rem; }
</style>
