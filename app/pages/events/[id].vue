<script setup lang="ts">
import type { EventView, EventStatus } from '#shared/event-view'

interface RosterEntry {
  enrollmentId: number
  studentNumber: string
  name: string
  email: string | null
  seatLabel: string | null
  hasKey: boolean
}
interface KeyView {
  id: number
  streamName: string
  tokenPreview: string
  revoked: boolean
  lastUsedAt: number | null
  studentNumber: string | null
  studentLabel: string | null
}
interface GeneratedKey {
  id: number
  streamName: string
  token: string
  tokenPreview: string
  studentLabel: string
  studentNumber: string
}

const route = useRoute()
const id = Number(route.params.id)
const toast = useToast()
const obs = useObsConfig()

const { data: event, refresh: refreshEvent } = await useFetch<EventView>(`/api/events/${id}`)
const { data: roster, refresh: refreshRoster } = await useFetch<RosterEntry[]>(`/api/events/${id}/roster`)
const { data: keys, refresh: refreshKeys } = await useFetch<KeyView[]>(`/api/events/${id}/keys`)

// ---- settings ----
const settings = ref<EventView | null>(null)
const viewerPassphrase = ref('') // set-only; never returned by the server
watchEffect(() => { if (event.value && !settings.value) settings.value = structuredClone(toRaw(event.value)) })
const settingsDirty = computed(
  () => JSON.stringify(settings.value) !== JSON.stringify(event.value) || viewerPassphrase.value !== '',
)

async function saveSettings(): Promise<void> {
  if (!settings.value) return
  try {
    const body: Record<string, unknown> = { ...settings.value }
    if (viewerPassphrase.value !== '') body.viewerPassphrase = viewerPassphrase.value
    const updated = await $fetch<EventView>(`/api/events/${id}`, { method: 'PATCH', body })
    event.value = updated
    settings.value = structuredClone(updated)
    viewerPassphrase.value = ''
    toast.success('赛事已更新')
  } catch (e: any) {
    toast.error('保存失败：' + (e?.data?.statusMessage || e?.message || ''))
  }
}

// ---- roster CSV import ----
const csvText = ref('')
const importing = ref(false)
function parseCsv(text: string): { studentNumber: string; name: string; email?: string; seatLabel?: string }[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  let rows = lines.map((l) => l.split(/[,\t;]/).map((c) => c.trim()))
  if (rows.length && /姓名|学号|name|student/i.test(rows[0]?.join(' ') ?? '')) rows = rows.slice(1)
  return rows
    .map((r) => ({
      studentNumber: r[0] ?? '',
      name: r[1] ?? '',
      email: r[2] || undefined,
      seatLabel: r[3] || undefined,
    }))
    .filter((r) => r.studentNumber && r.name)
}
async function importRoster(): Promise<void> {
  const students = parseCsv(csvText.value)
  if (students.length === 0) {
    toast.error('未解析到有效行（学号,姓名）')
    return
  }
  importing.value = true
  try {
    const r = await $fetch<{ created: number; updated: number }>(`/api/events/${id}/roster/bulk`, {
      method: 'POST',
      body: { students },
    })
    toast.success(`导入完成：新增 ${r.created}，更新 ${r.updated}`)
    csvText.value = ''
    await refreshRoster()
  } catch (e: any) {
    toast.error('导入失败：' + (e?.data?.statusMessage || e?.message || ''))
  } finally {
    importing.value = false
  }
}
async function removeEntry(enrollmentId: number): Promise<void> {
  if (!confirm('从名单移除该学生？（其密钥将被吊销）')) return
  try {
    await $fetch(`/api/events/${id}/roster/${enrollmentId}`, { method: 'DELETE' })
    await Promise.all([refreshRoster(), refreshKeys()])
    toast.info('已移除')
  } catch (e: any) {
    toast.error('移除失败：' + (e?.data?.statusMessage || e?.message || ''))
  }
}

// ---- keys ----
const freshKeys = ref<GeneratedKey[]>([])
const genForm = reactive({ studentNumber: '', name: '', email: '', seatLabel: '', streamName: '' })

// ---- per-event publish token ----
const freshPublishToken = ref<{ token: string; preview: string } | null>(null)
const rotatingToken = ref(false)
async function rotatePublishToken(): Promise<void> {
  if (event.value?.publishTokenPreview && !confirm('重新生成将使旧推流令牌立即失效，确定？')) return
  rotatingToken.value = true
  try {
    const r = await $fetch<{ token: string; preview: string }>(`/api/events/${id}/publish-token`, {
      method: 'POST',
    })
    freshPublishToken.value = r
    await refreshEvent()
    if (event.value) settings.value = structuredClone(toRaw(event.value))
    toast.success('推流令牌已生成（请立即复制，仅显示一次）')
  } catch (e: any) {
    toast.error('生成失败：' + (e?.data?.statusMessage || e?.message || ''))
  } finally {
    rotatingToken.value = false
  }
}
async function clearPublishToken(): Promise<void> {
  if (!confirm('清除推流令牌？使用该令牌的推流将被拒绝。')) return
  try {
    await $fetch(`/api/events/${id}/publish-token`, { method: 'DELETE' })
    freshPublishToken.value = null
    await refreshEvent()
    toast.info('已清除')
  } catch (e: any) {
    toast.error('清除失败：' + (e?.data?.statusMessage || e?.message || ''))
  }
}

const generating = ref(false)
async function generateOne(): Promise<void> {
  if (!genForm.studentNumber.trim() || !genForm.name.trim()) {
    toast.error('请填写学号和姓名')
    return
  }
  generating.value = true
  try {
    const k = await $fetch<GeneratedKey>(`/api/events/${id}/keys`, { method: 'POST', body: genForm })
    freshKeys.value = [k]
    genForm.studentNumber = ''
    genForm.name = ''
    genForm.email = ''
    genForm.seatLabel = ''
    genForm.streamName = ''
    await Promise.all([refreshRoster(), refreshKeys()])
    toast.success('密钥已生成（请立即复制，仅显示一次）')
  } catch (e: any) {
    toast.error('生成失败：' + (e?.data?.statusMessage || e?.message || ''))
  } finally {
    generating.value = false
  }
}
async function generateAll(): Promise<void> {
  generating.value = true
  try {
    const ks = await $fetch<GeneratedKey[]>(`/api/events/${id}/keys/bulk`, { method: 'POST' })
    freshKeys.value = ks
    await Promise.all([refreshRoster(), refreshKeys()])
    toast.success(ks.length ? `已为 ${ks.length} 名学生生成密钥` : '所有学生均已持有密钥')
  } catch (e: any) {
    toast.error('生成失败：' + (e?.data?.statusMessage || e?.message || ''))
  } finally {
    generating.value = false
  }
}
async function revokeKey(keyId: number): Promise<void> {
  if (!confirm('吊销该密钥？学生将无法推流，需重新生成。')) return
  try {
    await $fetch(`/api/events/${id}/keys/${keyId}`, { method: 'DELETE' })
    await refreshKeys()
    toast.info('已吊销')
  } catch (e: any) {
    toast.error('吊销失败：' + (e?.data?.statusMessage || e?.message || ''))
  }
}

async function copy(text: string, label = '已复制'): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(label)
  } catch {
    toast.error('复制失败，请手动复制')
  }
}

const statusOptions: { value: EventStatus; label: string }[] = [
  { value: 'draft', label: '草稿' },
  { value: 'scheduled', label: '待开始' },
  { value: 'live', label: '进行中' },
  { value: 'ended', label: '已结束' },
  { value: 'archived', label: '已归档' },
]
</script>

<template>
  <div v-if="event" class="stack">
    <div class="between">
      <div>
        <NuxtLink to="/events" class="muted">← 返回赛事列表</NuxtLink>
        <h1>{{ event.name }}</h1>
        <p class="muted">slug: {{ event.slug }}</p>
      </div>
    </div>

    <!-- freshly generated keys (plaintext shown once) -->
    <section v-if="freshKeys.length" class="card fresh">
      <div class="between">
        <h2>新生成的密钥（仅显示一次，请立即复制）</h2>
        <button @click="freshKeys = []">关闭</button>
      </div>
      <div v-for="k in freshKeys" :key="k.id" class="fresh-row">
        <div><strong>{{ k.studentLabel }}</strong>（{{ k.studentNumber }}）</div>
        <div class="kv"><span>OBS 服务器</span><code>{{ obs.server.value }}</code>
          <button @click="copy(obs.server.value, '已复制服务器地址')">复制</button></div>
        <div class="kv"><span>推流密钥</span><code>{{ obs.streamKey(k.streamName, k.token) }}</code>
          <button @click="copy(obs.streamKey(k.streamName, k.token), '已复制推流密钥')">复制</button></div>
      </div>
    </section>

    <!-- settings -->
    <section class="card">
      <h2>赛事设置</h2>
      <div v-if="settings" class="form-grid">
        <label class="field"><span class="field-label">名称</span><input v-model="settings.name" /></label>
        <label class="field"><span class="field-label">slug</span><input v-model="settings.slug" /></label>
        <label class="field full"><span class="field-label">描述</span><input v-model="settings.description" /></label>
        <label class="field"><span class="field-label">状态</span>
          <select v-model="settings.status">
            <option v-for="o in statusOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </label>
        <label class="field"><span class="field-label">观看</span>
          <select v-model="settings.viewerAccess">
            <option value="public">公开</option>
            <option value="passphrase">口令</option>
          </select>
        </label>
        <label class="field-bool">
          <input type="checkbox" v-model="settings.recordEnabled" />
          <span>启用录制</span>
        </label>
        <label v-if="settings.viewerAccess === 'passphrase'" class="field full">
          <span class="field-label">观看口令{{ event.hasViewerPassphrase ? '（已设置，留空保持不变）' : '' }}</span>
          <input v-model="viewerPassphrase" type="password" placeholder="设置观看口令" />
        </label>
      </div>
      <div class="row right">
        <span v-if="settingsDirty" class="badge warn">有未保存更改</span>
        <button class="primary" :disabled="!settingsDirty" @click="saveSettings">保存</button>
      </div>
    </section>

    <!-- per-event publish token -->
    <section class="card">
      <div class="between">
        <h2>赛事推流令牌</h2>
        <span v-if="event.publishTokenPreview" class="badge ok">已设置 <code class="mono">{{ event.publishTokenPreview }}…</code></span>
        <span v-else class="badge muted">未设置</span>
      </div>
      <p class="muted small">
        每个赛事一个推流令牌，发给本赛事全体推流者。OBS 推流密钥为 <code class="mono">&lt;流名&gt;?token=&lt;令牌&gt;</code>，
        仅在赛事时间窗口内有效（与按学生生成的密钥二选一即可）。
      </p>

      <div v-if="freshPublishToken" class="fresh-token">
        <strong>新令牌（仅显示一次，请立即复制）</strong>
        <div class="kv"><span>令牌</span><code>{{ freshPublishToken.token }}</code>
          <button @click="copy(freshPublishToken.token, '已复制令牌')">复制</button></div>
        <div class="kv"><span>OBS 服务器</span><code>{{ obs.server.value }}</code>
          <button @click="copy(obs.server.value, '已复制服务器地址')">复制</button></div>
        <div class="kv"><span>推流密钥示例</span>
          <code>{{ obs.streamKey('流名', freshPublishToken.token) }}</code></div>
      </div>

      <div class="row right">
        <button v-if="event.publishTokenPreview" :disabled="rotatingToken" @click="clearPublishToken">清除</button>
        <button class="primary" :disabled="rotatingToken" @click="rotatePublishToken">
          {{ rotatingToken ? '生成中…' : event.publishTokenPreview ? '重新生成' : '生成推流令牌' }}
        </button>
      </div>
    </section>

    <!-- roster -->
    <section class="card">
      <div class="between">
        <h2>名单（{{ roster?.length ?? 0 }}）</h2>
      </div>
      <p class="muted small">粘贴 CSV：每行 <code>学号,姓名[,邮箱][,座位]</code>。首行若为表头会自动跳过。</p>
      <textarea v-model="csvText" rows="4" placeholder="2024001,张三,zs@x.edu,A1&#10;2024002,李四,,B2" />
      <div class="row right">
        <button :disabled="importing" @click="importRoster">{{ importing ? '导入中…' : '导入' }}</button>
      </div>
      <table v-if="roster && roster.length">
        <thead><tr><th>学号</th><th>姓名</th><th>座位</th><th>密钥</th><th></th></tr></thead>
        <tbody>
          <tr v-for="r in roster" :key="r.enrollmentId">
            <td>{{ r.studentNumber }}</td>
            <td>{{ r.name }}</td>
            <td class="muted">{{ r.seatLabel ?? '—' }}</td>
            <td><span class="badge" :class="r.hasKey ? 'ok' : 'muted'">{{ r.hasKey ? '已生成' : '无' }}</span></td>
            <td><button class="danger" @click="removeEntry(r.enrollmentId)">移除</button></td>
          </tr>
        </tbody>
      </table>
      <div v-else class="muted empty">暂无名单。</div>
    </section>

    <!-- keys -->
    <section class="card">
      <div class="between">
        <h2>推流密钥（{{ keys?.length ?? 0 }}）</h2>
        <button class="primary" :disabled="generating" @click="generateAll">为未生成学生批量生成</button>
      </div>

      <details class="gen-one">
        <summary>生成单个密钥</summary>
        <div class="form-grid">
          <label class="field"><span class="field-label">学号 *</span><input v-model="genForm.studentNumber" /></label>
          <label class="field"><span class="field-label">姓名 *</span><input v-model="genForm.name" /></label>
          <label class="field"><span class="field-label">邮箱</span><input v-model="genForm.email" /></label>
          <label class="field"><span class="field-label">座位</span><input v-model="genForm.seatLabel" /></label>
          <label class="field full"><span class="field-label">自定义流名（留空用学号）</span><input v-model="genForm.streamName" /></label>
        </div>
        <div class="row right">
          <button class="primary" :disabled="generating" @click="generateOne">生成</button>
        </div>
      </details>

      <table v-if="keys && keys.length">
        <thead><tr><th>流名</th><th>学生</th><th>预览</th><th>状态</th><th>最近使用</th><th></th></tr></thead>
        <tbody>
          <tr v-for="k in keys" :key="k.id">
            <td>{{ k.streamName }}</td>
            <td>{{ k.studentLabel ?? '—' }}</td>
            <td class="muted mono">{{ k.tokenPreview }}</td>
            <td><span class="badge" :class="k.revoked ? 'danger' : 'ok'">{{ k.revoked ? '已吊销' : '有效' }}</span></td>
            <td class="muted">{{ k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString('zh-CN', { hour12: false }) : '—' }}</td>
            <td>
              <button @click="copy(k.streamName, '已复制流名')">复制流名</button>
              <button v-if="!k.revoked" class="danger" @click="revokeKey(k.id)">吊销</button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-else class="muted empty">暂无密钥。</div>
    </section>
  </div>
</template>

<style scoped>
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin-bottom: 0.5rem; }
.field { display: flex; flex-direction: column; gap: 0.25rem; }
.field.full { grid-column: 1 / -1; }
.field-label { font-size: 0.8rem; color: var(--muted); }
.field-bool { display: flex; flex-direction: row; align-items: center; gap: 0.5rem; align-self: end; padding-bottom: 0.5rem; }
.field-bool input { width: auto; }
.right { justify-content: flex-end; margin-top: 0.5rem; }
.small { font-size: 0.78rem; }
.empty { padding: 1.5rem; text-align: center; }
.fresh { border-color: var(--ok); }
.fresh-row { border-top: 1px solid var(--border); padding: 0.6rem 0; }
.fresh-token { border: 1px solid var(--ok); border-radius: 8px; padding: 0.6rem 0.75rem; margin: 0.5rem 0; display: flex; flex-direction: column; gap: 0.25rem; }
.kv { display: flex; align-items: center; gap: 0.5rem; margin: 0.2rem 0; flex-wrap: wrap; }
.kv span { color: var(--muted); font-size: 0.78rem; min-width: 5rem; }
code, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.82rem; }
.gen-one { margin: 0.5rem 0; }
textarea { width: 100%; margin: 0.5rem 0; resize: vertical; }
</style>
