<script setup lang="ts">
import type { RecordingView } from '#shared/recordings'

const toast = useToast()

// events for the filter dropdown (full EventView type lands in Phase 7)
const { data: events } = await useFetch<{ id: number; name: string }[]>('/api/events')

const filters = reactive<{ eventId: string; date: string; q: string }>({
  eventId: '',
  date: '',
  q: '',
})
// applied filters drive the query; updated on 查询
const applied = ref({ ...filters })
const { data, refresh, pending } = await useFetch<RecordingView[]>('/api/recordings', {
  query: applied,
})

function apply(): void {
  applied.value = { ...filters }
}
function resetFilters(): void {
  filters.eventId = ''
  filters.date = ''
  filters.q = ''
  apply()
}

const selectedId = ref<number | null>(null)
const selected = computed(
  () => data.value?.find((r) => r.id === selectedId.value) ?? null,
)
function play(r: RecordingView): void {
  selectedId.value = r.id
}
async function onDeleted(id: number): Promise<void> {
  selectedId.value = null
  await refresh()
  toast.info(`已从列表移除 #${id}`)
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
function fmtDate(ms: number): string {
  return new Date(ms).toLocaleString('zh-CN', { hour12: false })
}
</script>

<template>
  <div class="stack">
    <div>
      <h1>录像</h1>
      <p class="muted">合规流的存档录像，支持在线播放、下载与删除。</p>
    </div>

    <section class="card filters">
      <div class="row">
        <label class="field">
          <span class="field-label">赛事</span>
          <select v-model="filters.eventId">
            <option value="">全部</option>
            <option v-for="e in events" :key="e.id" :value="String(e.id)">{{ e.name }}</option>
          </select>
        </label>
        <label class="field">
          <span class="field-label">日期</span>
          <input type="date" v-model="filters.date" />
        </label>
        <label class="field grow">
          <span class="field-label">搜索（流名/学生）</span>
          <input type="text" v-model="filters.q" placeholder="学号、姓名或流名…" @keyup.enter="apply" />
        </label>
      </div>
      <div class="row right">
        <button @click="resetFilters">清空</button>
        <button class="primary" @click="apply">查询</button>
      </div>
    </section>

    <RecordingsPlayer v-if="selected" :recording="selected" @deleted="onDeleted" />

    <section class="card">
      <div class="between">
        <h2>共 {{ data?.length ?? 0 }} 条</h2>
        <button :disabled="pending" @click="refresh()">{{ pending ? '刷新中…' : '刷新' }}</button>
      </div>
      <div v-if="!data || data.length === 0" class="muted empty">暂无录像。</div>
      <table v-else>
        <thead>
          <tr>
            <th>流名</th>
            <th>学生</th>
            <th>大小</th>
            <th>分辨率</th>
            <th>开始时间</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in data" :key="r.id" :class="{ active: r.id === selectedId }">
            <td>{{ r.streamName }}</td>
            <td class="muted">{{ r.studentLabel ?? '—' }}</td>
            <td>{{ fmtSize(r.sizeBytes) }}</td>
            <td class="muted">{{ r.width && r.height ? `${r.width}×${r.height}` : '—' }}</td>
            <td class="muted">{{ fmtDate(r.startedAt) }}</td>
            <td><button @click="play(r)">播放</button></td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<style scoped>
.filters .field { min-width: 160px; }
.field { display: flex; flex-direction: column; gap: 0.25rem; }
.field-label { font-size: 0.8rem; color: var(--muted); }
.right { justify-content: flex-end; margin-top: 0.75rem; }
.empty { padding: 2rem; text-align: center; }
tbody tr.active { background: var(--panel-2); }
</style>
