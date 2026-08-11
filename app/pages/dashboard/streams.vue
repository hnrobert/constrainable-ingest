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
  <div class="space-y-6">
    <div class="flex items-start justify-between gap-3">
      <div class="space-y-1">
        <h1 class="text-2xl font-semibold">Live Streams</h1>
        <p class="text-muted-foreground">Active sessions and real-time metrics with instant violation alerts.</p>
      </div>
      <Badge :variant="connected ? 'success' : 'warning'">
        {{ connected ? '● Connected' : '○ Connecting…' }}
      </Badge>
    </div>

    <Card>
      <CardContent>
        <StreamsActiveTable :sessions="list" @watch="watchStream" />
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Watch Live</CardTitle>
        <CardDescription>
          Click "Watch" in the table above, or enter a stream name to play manually. The browser connects directly to SRS.
        </CardDescription>
      </CardHeader>
      <CardContent class="space-y-3">
        <div class="flex flex-wrap items-center gap-3">
          <Input
            v-model="manualStream"
            placeholder="Stream name"
            class="max-w-[320px]"
            @keyup.enter="watchStream(manualStream)"
          />
          <Button @click="watchStream(manualStream)">Play</Button>
          <Button v-if="watching" variant="outline" @click="watching = null">Close</Button>
        </div>
        <StreamsPlayer v-if="watching" :stream-name="watching" />
      </CardContent>
    </Card>

    <Card v-if="lastViolation" class="border-destructive">
      <CardContent class="text-sm">
        <strong>Last violation:</strong>
        {{ lastViolation.streamName }} —
        {{ lastViolation.reasons.join('; ') }}
        <span class="text-muted-foreground">({{ new Date(lastViolation.startedAt).toLocaleTimeString('en-US', { hour12: false }) }})</span>
      </CardContent>
    </Card>
  </div>
</template>
