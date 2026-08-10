<script lang="ts">
definePageMeta({ layout: 'viewer' })
</script>

<script setup lang="ts">
interface ViewerEvent {
  id: number
  name: string
  slug: string
  description: string | null
  status: string
  startsAt: number | null
  endsAt: number | null
}

const { data: events, refresh } = await useFetch<ViewerEvent[]>('/api/viewer/events')

const statusLabel: Record<string, string> = {
  scheduled: '待开始',
  live: '进行中',
  ended: '已结束',
  draft: '草稿',
  archived: '已归档',
}

function fmt(ms: number | null): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleString('zh-CN', { hour12: false })
}

function windowLabel(e: ViewerEvent): string {
  if (e.startsAt && e.endsAt) return `${fmt(e.startsAt)} → ${fmt(e.endsAt)}`
  if (e.startsAt) return `起 ${fmt(e.startsAt)}`
  if (e.endsAt) return `止 ${fmt(e.endsAt)}`
  return '时间未定'
}

// keep the schedule fresh while the page is open
let timer: ReturnType<typeof setInterval> | null = null
onMounted(() => { timer = setInterval(refresh, 30000) })
onBeforeUnmount(() => { if (timer) clearInterval(timer) })
</script>

<template>
  <div class="stack">
    <div>
      <h1>赛事时间表</h1>
      <p class="muted">各赛事的安排时间。直播仅限管理员/监考观看。</p>
    </div>

    <div v-if="!events?.length" class="card muted empty">暂无已安排的赛事。</div>

    <section v-for="e in events" :key="e.id" class="card">
      <div class="between">
        <div>
          <h2>{{ e.name }}</h2>
          <p class="muted">{{ e.description ?? '' }}</p>
        </div>
        <span class="badge" :class="e.status === 'live' ? 'ok' : 'warn'">
          {{ statusLabel[e.status] ?? e.status }}
        </span>
      </div>
      <p class="row schedule">
        <span class="badge muted">时间</span>
        <span>{{ windowLabel(e) }}</span>
      </p>
      <p class="row">
        <span class="badge muted">slug</span>
        <span class="mono">{{ e.slug }}</span>
      </p>
    </section>
  </div>
</template>

<style scoped>
.empty { padding: 1.5rem; text-align: center; }
.schedule { margin-top: 0.4rem; font-size: 0.95rem; }
.mono { font-family: ui-monospace, monospace; font-size: 0.85rem; }
</style>
