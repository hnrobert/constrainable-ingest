<script lang="ts">
definePageMeta({ layout: 'viewer' })
</script>

<script setup lang="ts">
interface ViewerStream { streamName: string; studentLabel: string | null; width: number | null; height: number | null }
interface ViewerEvent {
  id: number
  name: string
  description: string | null
  status: string
  viewerAccess: 'public' | 'passphrase'
  liveStreams: ViewerStream[]
}

const route = useRoute()
const eventId = Number(route.params.eventId)
const toast = useToast()
const { user, fetchSession } = useAuth()
await callOnce('viewer:session', () => fetchSession())
const authed = computed(() => !!user.value)

const { data: ev, refresh } = await useFetch<ViewerEvent[]>(`/api/viewer/events`)
const event = computed(() => (ev.value ?? []).find((e) => e.id === eventId) ?? null)

const selected = ref<string | null>(null)
watchEffect(() => {
  if (event.value && !selected.value && event.value.liveStreams.length) {
    const first = event.value.liveStreams[0]
    if (first) selected.value = first.streamName
  }
})

// poll for live stream list while watching
let timer: ReturnType<typeof setInterval> | null = null
onMounted(() => { timer = setInterval(refresh, 8000) })
onBeforeUnmount(() => { if (timer) clearInterval(timer) })

watch(
  () => event.value,
  (e) => {
    if (!e) return
    if (e.viewerAccess === 'passphrase' && selected.value === null && !authed.value) {
      // the stream-url endpoint will 403 if not unlocked; surface a hint
      toast.info('如需播放请先在列表页输入口令')
    }
  },
)
</script>

<template>
  <div class="stack">
    <NuxtLink to="/viewer" class="muted">← 返回赛事列表</NuxtLink>

    <div v-if="!event">
      <h1>赛事不可见</h1>
      <p class="muted">该赛事不在公开列表中（可能未开始或需口令）。</p>
    </div>

    <template v-else>
      <div class="between">
        <div>
          <h1>{{ event.name }}</h1>
          <p class="muted">{{ event.description ?? '' }}</p>
        </div>
        <span class="badge" :class="event.status === 'live' ? 'ok' : 'warn'">
          {{ event.status === 'live' ? '直播中' : '待开始' }}
        </span>
      </div>

      <div v-if="!event.liveStreams.length" class="card muted empty">
        暂无直播流。页面会自动刷新。
      </div>

      <div v-else class="layout">
        <aside class="card stream-list">
          <h3>直播流（{{ event.liveStreams.length }}）</h3>
          <button
            v-for="s in event.liveStreams"
            :key="s.streamName"
            class="stream-btn"
            :class="{ active: selected === s.streamName }"
            @click="selected = s.streamName"
          >
            <span class="mono">{{ s.streamName }}</span>
            <span class="muted small">{{ s.width }}×{{ s.height }}</span>
          </button>
        </aside>

        <div v-if="selected" class="player-wrap">
          <ClientOnly>
            <ViewerPlayer :event-id="event.id" :stream-name="selected" />
            <template #fallback>
              <div class="card muted">播放器加载中…</div>
            </template>
          </ClientOnly>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.empty { padding: 1.5rem; text-align: center; }
.layout { display: grid; grid-template-columns: 240px 1fr; gap: 0.75rem; align-items: start; }
.stream-list { display: flex; flex-direction: column; gap: 0.4rem; }
.stream-list h3 { margin-bottom: 0.25rem; }
.stream-btn { display: flex; flex-direction: column; align-items: flex-start; gap: 0.1rem; text-align: left; }
.stream-btn.active { border-color: var(--primary); background: var(--panel-2); }
.mono { font-family: ui-monospace, monospace; font-size: 0.82rem; }
.small { font-size: 0.72rem; }
@media (max-width: 640px) {
  .layout { grid-template-columns: 1fr; }
}
</style>
