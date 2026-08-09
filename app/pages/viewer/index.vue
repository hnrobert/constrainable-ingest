<script lang="ts">
definePageMeta({ layout: 'viewer' })
</script>

<script setup lang="ts">
interface ViewerStream { streamName: string; studentLabel: string | null; width: number | null; height: number | null }
interface ViewerEvent {
  id: number
  name: string
  slug: string
  description: string | null
  status: string
  viewerAccess: 'public' | 'passphrase'
  liveStreams: ViewerStream[]
}

const toast = useToast()
const { data: events, refresh } = await useFetch<ViewerEvent[]>('/api/viewer/events')

// passphrase gate state, keyed by event id
const passInput = ref<Record<number, string>>({})
const checking = ref<number | null>(null)
const accessError = ref<Record<number, string>>({})

const statusLabel: Record<string, string> = {
  scheduled: '待开始',
  live: '直播中',
  ended: '已结束',
  draft: '草稿',
  archived: '已归档',
}

async function unlock(e: ViewerEvent): Promise<void> {
  checking.value = e.id
  accessError.value[e.id] = ''
  try {
    await $fetch('/api/viewer/access', {
      method: 'POST',
      body: { eventId: e.id, passphrase: passInput.value[e.id] ?? '' },
    })
    toast.success('口令正确')
    await navigateTo(`/viewer/${e.id}`)
  } catch (err: any) {
    accessError.value[e.id] = err?.data?.statusMessage || err?.message || '验证失败'
  } finally {
    checking.value = null
  }
}

// poll for live stream changes while the page is open
let timer: ReturnType<typeof setInterval> | null = null
onMounted(() => { timer = setInterval(refresh, 10000) })
onBeforeUnmount(() => { if (timer) clearInterval(timer) })
</script>

<template>
  <div class="stack">
    <div>
      <h1>赛事直播</h1>
      <p class="muted">直播中或即将开始的赛事。部分赛事需口令观看。</p>
    </div>

    <div v-if="!events?.length" class="card muted empty">暂无可观看的赛事。</div>

    <section v-for="e in events" :key="e.id" class="card">
      <div class="between">
        <div>
          <h2>{{ e.name }}</h2>
          <p class="muted">{{ e.description ?? '' }}</p>
          <p class="row">
            <span class="badge" :class="e.status === 'live' ? 'ok' : 'warn'">{{ statusLabel[e.status] ?? e.status }}</span>
            <span class="badge" :class="e.viewerAccess === 'public' ? 'muted' : 'warn'">
              {{ e.viewerAccess === 'public' ? '公开' : '需口令' }}
            </span>
            <span v-if="e.status === 'live'" class="badge muted">{{ e.liveStreams.length }} 路直播</span>
          </p>
        </div>
      </div>

      <!-- public: go straight in -->
      <div v-if="e.viewerAccess === 'public'" class="row">
        <NuxtLink v-if="e.status === 'live' && e.liveStreams.length" :to="`/viewer/${e.id}`">
          <button class="primary">进入观看</button>
        </NuxtLink>
        <span v-else class="muted">尚未开始</span>
      </div>

      <!-- passphrase gate -->
      <div v-else class="gate">
        <input
          :placeholder="`输入 ${e.name} 的观看口令`"
          type="password"
          v-model="passInput[e.id]"
          @keyup.enter="unlock(e)"
        />
        <button class="primary" :disabled="checking === e.id" @click="unlock(e)">
          {{ checking === e.id ? '验证中…' : '验证' }}
        </button>
        <span v-if="accessError[e.id]" class="badge danger">{{ accessError[e.id] }}</span>
      </div>
    </section>
  </div>
</template>

<style scoped>
.empty { padding: 1.5rem; text-align: center; }
.gate { display: flex; gap: 0.5rem; align-items: center; margin-top: 0.5rem; }
.gate input { max-width: 320px; }
</style>
