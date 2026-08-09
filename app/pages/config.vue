<script setup lang="ts">
import type { AppConfig } from '#shared/config'

const toast = useToast()
const { data, refresh } = await useFetch<AppConfig>('/api/config')

// editable copy; reset re-syncs from the server value
const form = ref<AppConfig>(structuredClone(toRaw(data.value!)))
const saving = ref(false)

type Kind = 'number' | 'text' | 'select' | 'bool'
interface Field {
  path: string
  label: string
  hint?: string
  kind: Kind
  options?: { value: string; label: string }[]
}
interface Section {
  title: string
  fields: Field[]
}

const sections: Section[] = [
  {
    title: '分辨率 / 帧率 / 码率 限制',
    fields: [
      { path: 'limits.maxWidth', label: '最大宽度 (px)', kind: 'number', hint: '0 = 不限制' },
      { path: 'limits.maxHeight', label: '最大高度 (px)', kind: 'number', hint: '0 = 不限制' },
      { path: 'limits.maxFps', label: '最大帧率 (fps)', kind: 'number', hint: '0 = 不限制' },
      { path: 'limits.maxBitrateKbps', label: '最大码率 (kbps)', kind: 'number', hint: '0 = 不限制' },
    ],
  },
  {
    title: '违规处置',
    fields: [
      {
        path: 'enforce',
        label: '执行方式',
        kind: 'select',
        options: [
          { value: 'kick', label: '踢流 (kick) — 超限即断开' },
          { value: 'flag', label: '仅标记 (flag) — 告警不断流' },
        ],
      },
    ],
  },
  {
    title: '探测 (ffprobe)',
    fields: [
      { path: 'probe.waitMs', label: '首发前等待 (ms)', kind: 'number' },
      { path: 'probe.retries', label: '失败重试次数', kind: 'number' },
      { path: 'probe.retryIntervalMs', label: '重试间隔 (ms)', kind: 'number' },
      { path: 'probe.timeoutMs', label: '单次超时 (ms)', kind: 'number' },
      { path: 'probe.pollIntervalMs', label: '轮询间隔 (ms)', kind: 'number', hint: '活跃会话每次探测的间隔' },
    ],
  },
  {
    title: '并发',
    fields: [
      { path: 'concurrency.probeMax', label: 'ffprobe 最大并发', kind: 'number' },
    ],
  },
  {
    title: '录制',
    fields: [
      { path: 'record.enabled', label: '启用录制', kind: 'bool' },
      { path: 'record.maxConcurrency', label: 'ffmpeg 录制最大并发', kind: 'number' },
      { path: 'record.retentionDays', label: '录像保留天数', kind: 'number', hint: '0 = 永久保留；下次清理生效' },
      { path: 'record.remuxTimeoutMs', label: 'FLV→MP4 转封装超时 (ms)', kind: 'number' },
    ],
  },
  {
    title: '推流准入',
    fields: [
      { path: 'access.rejectUnknownPublishers', label: '拒绝未登记的推流', kind: 'bool', hint: '关闭则允许任意 streamName 推流' },
    ],
  },
  {
    title: 'SRS 连接（高级）',
    fields: [
      { path: 'srs.apiBase', label: 'SRS HTTP API', kind: 'text' },
      { path: 'srs.rtmpHost', label: 'SRS RTMP 主机', kind: 'text', hint: '服务端拉流地址（容器内主机名）' },
    ],
  },
]

function getPath(obj: any, path: string): any {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)
}
function setPath(obj: any, path: string, val: any): void {
  const ks = path.split('.')
  const last = ks.pop()!
  ks.reduce((o, k) => o[k], obj)[last] = val
}
function onInput(path: string, kind: Kind, raw: any): void {
  let v: any = raw
  if (kind === 'number') v = raw === '' ? 0 : Number(raw)
  setPath(form.value, path, v)
}

const dirty = computed(() => JSON.stringify(form.value) !== JSON.stringify(data.value))

async function save(): Promise<void> {
  saving.value = true
  try {
    const updated = await $fetch<AppConfig>('/api/config', { method: 'PATCH', body: form.value })
    data.value = updated
    form.value = structuredClone(updated)
    toast.success('配置已保存并热重载')
  } catch (e: any) {
    toast.error('保存失败：' + (e?.data?.statusMessage || e?.message || '未知错误'))
  } finally {
    saving.value = false
  }
}
function reset(): void {
  if (data.value) form.value = structuredClone(data.value)
  toast.info('已还原为服务器配置')
}
</script>

<template>
  <div class="stack">
    <div class="between">
      <div>
        <h1>运行配置</h1>
        <p class="muted">保存后立即热重载：新会话即用新值，活跃会话下一轮探测生效。</p>
      </div>
      <div class="row">
        <span v-if="dirty" class="badge warn">有未保存更改</span>
        <button :disabled="!dirty || saving" @click="reset">还原</button>
        <button class="primary" :disabled="!dirty || saving" @click="save">
          {{ saving ? '保存中…' : '保存并热重载' }}
        </button>
      </div>
    </div>

    <div class="grid">
      <section v-for="s in sections" :key="s.title" class="card">
        <h2>{{ s.title }}</h2>
        <div class="fields">
          <template v-for="f in s.fields" :key="f.path">
            <label v-if="f.kind === 'bool'" class="field field-bool">
              <input
                type="checkbox"
                :checked="getPath(form, f.path)"
                @change="setPath(form, f.path, ($event.target as HTMLInputElement).checked)"
              />
              <span>
                {{ f.label }}
                <small v-if="f.hint" class="muted">— {{ f.hint }}</small>
              </span>
            </label>

            <label v-else class="field">
              <span class="field-label">{{ f.label }}</span>
              <select
                v-if="f.kind === 'select'"
                :value="getPath(form, f.path)"
                @input="onInput(f.path, 'select', ($event.target as HTMLSelectElement).value)"
              >
                <option v-for="o in f.options" :key="o.value" :value="o.value">{{ o.label }}</option>
              </select>
              <input
                v-else
                :type="f.kind === 'number' ? 'number' : 'text'"
                :value="getPath(form, f.path)"
                @input="onInput(f.path, f.kind, ($event.target as HTMLInputElement).value)"
              />
              <small v-if="f.hint" class="muted field-hint">{{ f.hint }}</small>
            </label>
          </template>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 1rem;
  align-items: start;
}
.fields { display: flex; flex-direction: column; gap: 0.75rem; }
.field { display: flex; flex-direction: column; gap: 0.25rem; }
.field-label { font-size: 0.8rem; color: var(--muted); }
.field-hint { font-size: 0.75rem; }
.field-bool { flex-direction: row; align-items: center; gap: 0.5rem; }
.field-bool input { width: auto; }
</style>
