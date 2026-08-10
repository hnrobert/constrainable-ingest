<script setup lang="ts">
import type { EventView, EventStatus, EventVisibility } from '#shared/event-view'
import type { GroupView } from '#shared/groups'

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
const { user } = useAuth()
const isAdmin = computed(() => user.value?.role === 'admin')

const { data: event, refresh: refreshEvent } = await useFetch<EventView>(`/api/events/${id}`)
const { data: roster, refresh: refreshRoster } = await useFetch<RosterEntry[]>(`/api/events/${id}/roster`)
const { data: keys, refresh: refreshKeys } = await useFetch<KeyView[]>(`/api/events/${id}/keys`)

// ---- settings (admin-only) ----
const settings = ref<EventView | null>(null)
const selectedGroupIds = ref<number[]>([])
const allGroups = ref<GroupView[]>([])
watchEffect(() => {
  if (event.value && !settings.value) {
    settings.value = structuredClone(toRaw(event.value))
    selectedGroupIds.value = event.value.groups.map((g) => g.id)
  }
})
// Groups catalog is admin-only; fetch lazily on the client for admins only.
onMounted(async () => {
  if (!isAdmin.value) return
  try {
    allGroups.value = await $fetch<GroupView[]>('/api/groups')
  } catch {
    /* non-admin or transient — leave empty */
  }
})

function sameSet(a: number[], b: number[]): boolean {
  return a.slice().sort().join(',') === b.slice().sort().join(',')
}
const settingsDirty = computed(() => {
  if (!settings.value || !event.value) return false
  const s = settings.value
  const e = event.value
  const scalarChanged =
    s.name !== e.name ||
    s.slug !== e.slug ||
    s.description !== e.description ||
    s.status !== e.status ||
    s.recordEnabled !== e.recordEnabled ||
    s.visibility !== e.visibility
  return scalarChanged || !sameSet(selectedGroupIds.value, e.groups.map((g) => g.id))
})

const visibilityLabel: Record<EventVisibility, string> = {
  public: 'Public',
  registered: 'Registered users',
  groups: 'Specific groups',
}

async function saveSettings(): Promise<void> {
  if (!settings.value) return
  try {
    const s = settings.value
    const updated = await $fetch<EventView>(`/api/events/${id}`, {
      method: 'PATCH',
      body: {
        name: s.name,
        slug: s.slug,
        description: s.description,
        status: s.status,
        recordEnabled: s.recordEnabled,
        visibility: s.visibility,
        groupIds: selectedGroupIds.value,
      },
    })
    event.value = updated
    settings.value = structuredClone(updated)
    selectedGroupIds.value = updated.groups.map((g) => g.id)
    toast.success('Event updated')
  } catch (e: any) {
    toast.error('Save failed: ' + (e?.data?.statusMessage || e?.message || ''))
  }
}

// ---- roster CSV import (admin) ----
const csvText = ref('')
const importing = ref(false)
function parseCsv(text: string): { studentNumber: string; name: string; email?: string; seatLabel?: string }[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  let rows = lines.map((l) => l.split(/[,\t;]/).map((c) => c.trim()))
  if (rows.length && /name|student/i.test(rows[0]?.join(' ') ?? '')) rows = rows.slice(1)
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
    toast.error('No valid rows parsed (student ID, name)')
    return
  }
  importing.value = true
  try {
    const r = await $fetch<{ created: number; updated: number }>(`/api/events/${id}/roster/bulk`, {
      method: 'POST',
      body: { students },
    })
    toast.success(`Import complete: ${r.created} new, ${r.updated} updated`)
    csvText.value = ''
    await refreshRoster()
  } catch (e: any) {
    toast.error('Import failed: ' + (e?.data?.statusMessage || e?.message || ''))
  } finally {
    importing.value = false
  }
}
async function removeEntry(enrollmentId: number): Promise<void> {
  if (!confirm('Remove this student from the roster? (Their stream key will be revoked)')) return
  try {
    await $fetch(`/api/events/${id}/roster/${enrollmentId}`, { method: 'DELETE' })
    await Promise.all([refreshRoster(), refreshKeys()])
    toast.info('Removed')
  } catch (e: any) {
    toast.error('Remove failed: ' + (e?.data?.statusMessage || e?.message || ''))
  }
}

// ---- keys (admin) ----
const freshKeys = ref<GeneratedKey[]>([])
const genForm = reactive({ studentNumber: '', name: '', email: '', seatLabel: '', streamName: '' })

// ---- per-event publish token (admin) ----
const freshPublishToken = ref<{ token: string; preview: string; isCustom: boolean } | null>(null)
const rotatingToken = ref(false)
const customToken = ref('')
const TOKEN_RE = /^[A-Za-z0-9._~-]+$/
const customTokenValid = computed(() => {
  const t = customToken.value.trim()
  return t.length >= 8 && t.length <= 128 && TOKEN_RE.test(t)
})
async function rotatePublishToken(): Promise<void> {
  if (event.value?.publishTokenPreview && !confirm('Regenerating will invalidate the old publish token immediately. Continue?')) return
  rotatingToken.value = true
  try {
    const r = await $fetch<{ token: string; preview: string; isCustom: boolean }>(
      `/api/events/${id}/publish-token`,
      { method: 'POST' },
    )
    freshPublishToken.value = r
    await refreshEvent()
    if (event.value) settings.value = structuredClone(toRaw(event.value))
    toast.success('Publish token generated (copy it now, shown only once)')
  } catch (e: any) {
    toast.error('Generation failed: ' + (e?.data?.statusMessage || e?.message || ''))
  } finally {
    rotatingToken.value = false
  }
}
async function setCustomPublishToken(): Promise<void> {
  if (!customTokenValid.value) return
  if (event.value?.publishTokenPreview && !confirm('Setting a custom token will invalidate the old publish token immediately. Continue?')) return
  rotatingToken.value = true
  try {
    const r = await $fetch<{ token: string; preview: string; isCustom: boolean }>(
      `/api/events/${id}/publish-token`,
      { method: 'POST', body: { token: customToken.value.trim() } },
    )
    freshPublishToken.value = r
    customToken.value = ''
    await refreshEvent()
    if (event.value) settings.value = structuredClone(toRaw(event.value))
    toast.success('Custom publish token set')
  } catch (e: any) {
    toast.error('Set failed: ' + (e?.data?.statusMessage || e?.message || ''))
  } finally {
    rotatingToken.value = false
  }
}
async function clearPublishToken(): Promise<void> {
  if (!confirm('Clear publish token? Publishes using this token will be rejected.')) return
  try {
    await $fetch(`/api/events/${id}/publish-token`, { method: 'DELETE' })
    freshPublishToken.value = null
    await refreshEvent()
    toast.info('Cleared')
  } catch (e: any) {
    toast.error('Clear failed: ' + (e?.data?.statusMessage || e?.message || ''))
  }
}

const generating = ref(false)
async function generateOne(): Promise<void> {
  if (!genForm.studentNumber.trim() || !genForm.name.trim()) {
    toast.error('Please fill in student ID and name')
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
    toast.success('Stream key generated (copy it now, shown only once)')
  } catch (e: any) {
    toast.error('Generation failed: ' + (e?.data?.statusMessage || e?.message || ''))
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
    toast.success(ks.length ? `Stream keys generated for ${ks.length} students` : 'All students already have stream keys')
  } catch (e: any) {
    toast.error('Generation failed: ' + (e?.data?.statusMessage || e?.message || ''))
  } finally {
    generating.value = false
  }
}
async function revokeKey(keyId: number): Promise<void> {
  if (!confirm('Revoke this stream key? The student will not be able to publish until it is regenerated.')) return
  try {
    await $fetch(`/api/events/${id}/keys/${keyId}`, { method: 'DELETE' })
    await refreshKeys()
    toast.info('Revoked')
  } catch (e: any) {
    toast.error('Revoke failed: ' + (e?.data?.statusMessage || e?.message || ''))
  }
}

async function copy(text: string, label = 'Copied'): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(label)
  } catch {
    toast.error('Copy failed, please copy manually')
  }
}

const statusOptions: { value: EventStatus; label: string }[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'live', label: 'Live' },
  { value: 'ended', label: 'Ended' },
  { value: 'archived', label: 'Archived' },
]
</script>

<template>
  <div v-if="event" class="stack">
    <div class="between">
      <div>
        <NuxtLink to="/dashboard/events" class="muted">← Back to events</NuxtLink>
        <h1>{{ event.name }}</h1>
        <p class="muted">slug: {{ event.slug }}</p>
        <p v-if="event.description" class="muted">{{ event.description }}</p>
        <p class="muted small">
          Status: {{ event.status }} · Visibility: {{ visibilityLabel[event.visibility] }}
          <template v-if="event.visibility === 'groups' && event.groups.length">
            · Groups: {{ event.groups.map((g) => g.name).join(', ') }}
          </template>
        </p>
      </div>
    </div>

    <!-- freshly generated keys (plaintext shown once) -->
    <section v-if="isAdmin && freshKeys.length" class="card fresh">
      <div class="between">
        <h2>Newly generated stream keys (shown only once, copy them now)</h2>
        <button @click="freshKeys = []">Close</button>
      </div>
      <div v-for="k in freshKeys" :key="k.id" class="fresh-row">
        <div><strong>{{ k.studentLabel }}</strong> ({{ k.studentNumber }})</div>
        <div class="kv"><span>OBS server</span><code>{{ obs.server.value }}</code>
          <button @click="copy(obs.server.value, 'Copied server address')">Copy</button></div>
        <div class="kv"><span>Stream key</span><code>{{ obs.streamKey(k.streamName, k.token) }}</code>
          <button @click="copy(obs.streamKey(k.streamName, k.token), 'Copied stream key')">Copy</button></div>
      </div>
    </section>

    <!-- settings (admin-only) -->
    <section v-if="isAdmin" class="card">
      <h2>Event settings</h2>
      <div v-if="settings" class="form-grid">
        <label class="field"><span class="field-label">Name</span><input v-model="settings.name" /></label>
        <label class="field"><span class="field-label">slug</span><input v-model="settings.slug" /></label>
        <label class="field full"><span class="field-label">Description</span><input v-model="settings.description" /></label>
        <label class="field"><span class="field-label">Status</span>
          <select v-model="settings.status">
            <option v-for="o in statusOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </label>
        <label class="field"><span class="field-label">Visibility</span>
          <select v-model="settings.visibility">
            <option value="registered">Registered users</option>
            <option value="public">Public (anyone, incl. homepage)</option>
            <option value="groups">Specific groups</option>
          </select>
        </label>
        <label class="field-bool">
          <input type="checkbox" v-model="settings.recordEnabled" />
          <span>Enable recording</span>
        </label>
        <div v-if="settings.visibility === 'groups'" class="field full">
          <span class="field-label">Allowed groups</span>
          <div class="group-checks">
            <label v-for="g in allGroups" :key="g.id" class="group-check">
              <input type="checkbox" :value="g.id" v-model="selectedGroupIds" />
              <span>{{ g.name }} <span class="muted">({{ g.memberCount }})</span></span>
            </label>
            <p v-if="!allGroups.length" class="muted small">No groups exist yet — create some on the Groups page first.</p>
          </div>
        </div>
      </div>
      <div class="row right">
        <span v-if="settingsDirty" class="badge warn">Unsaved changes</span>
        <button class="primary" :disabled="!settingsDirty" @click="saveSettings">Save</button>
      </div>
    </section>

    <!-- per-event publish token (admin-only) -->
    <section v-if="isAdmin" class="card">
      <div class="between">
        <h2>Event publish token</h2>
        <span v-if="event.publishTokenPreview" class="badge ok">Set <code class="mono">{{ event.publishTokenPreview }}…</code></span>
        <span v-else class="badge muted">Not set</span>
      </div>
      <p class="muted small">
        One publish token per event, shared with all publishers for this event. The OBS stream key is <code class="mono">&lt;stream-name&gt;?token=&lt;token&gt;</code>,
        valid only within the event time window (use either this or per-student stream keys).
      </p>

      <div v-if="freshPublishToken" class="fresh-token">
        <strong>{{ freshPublishToken.isCustom ? 'Token applied' : 'New token (shown only once, copy it now)' }}</strong>
        <div class="kv"><span>Token</span><code>{{ freshPublishToken.token }}</code>
          <button @click="copy(freshPublishToken.token, 'Copied token')">Copy</button></div>
        <div class="kv"><span>OBS server</span><code>{{ obs.server.value }}</code>
          <button @click="copy(obs.server.value, 'Copied server address')">Copy</button></div>
        <div class="kv"><span>Stream key example</span>
          <code>{{ obs.streamKey('stream-name', freshPublishToken.token) }}</code></div>
      </div>

      <div class="row right">
        <button v-if="event.publishTokenPreview" :disabled="rotatingToken" @click="clearPublishToken">Clear</button>
        <button class="primary" :disabled="rotatingToken" @click="rotatePublishToken">
          {{ rotatingToken ? 'Generating…' : event.publishTokenPreview ? 'Regenerate' : 'Generate random token' }}
        </button>
      </div>

      <div class="row custom-token">
        <input
          v-model="customToken"
          placeholder="Or custom token (8–128 chars, alphanumeric and . _ - ~)"
          @keyup.enter="setCustomPublishToken"
        />
        <button
          class="primary"
          :disabled="rotatingToken || !customTokenValid"
          @click="setCustomPublishToken"
        >Apply custom</button>
      </div>
      <p v-if="customToken && !customTokenValid" class="muted small warn-text">
        Token must be 8–128 chars, containing only letters, digits, and <code class="mono">. _ - ~</code>.
      </p>
    </section>

    <!-- roster (admin-only) -->
    <section v-if="isAdmin" class="card">
      <div class="between">
        <h2>Roster ({{ roster?.length ?? 0 }})</h2>
      </div>
      <p class="muted small">Paste CSV: one row per line as <code>student_id,name[,email][,seat]</code>. A header row is skipped automatically.</p>
      <textarea v-model="csvText" rows="4" placeholder="2024001,Alice,alice@x.edu,A1&#10;2024002,Bob,,B2" />
      <div class="row right">
        <button :disabled="importing" @click="importRoster">{{ importing ? 'Importing…' : 'Import' }}</button>
      </div>
      <table v-if="roster && roster.length">
        <thead><tr><th>Student ID</th><th>Name</th><th>Seat</th><th>Stream key</th><th></th></tr></thead>
        <tbody>
          <tr v-for="r in roster" :key="r.enrollmentId">
            <td>{{ r.studentNumber }}</td>
            <td>{{ r.name }}</td>
            <td class="muted">{{ r.seatLabel ?? '—' }}</td>
            <td><span class="badge" :class="r.hasKey ? 'ok' : 'muted'">{{ r.hasKey ? 'Generated' : 'None' }}</span></td>
            <td><button class="danger" @click="removeEntry(r.enrollmentId)">Remove</button></td>
          </tr>
        </tbody>
      </table>
      <div v-else class="muted empty">No roster yet.</div>
    </section>

    <!-- keys (admin-only) -->
    <section v-if="isAdmin" class="card">
      <div class="between">
        <h2>Stream keys ({{ keys?.length ?? 0 }})</h2>
        <button class="primary" :disabled="generating" @click="generateAll">Bulk generate for students without keys</button>
      </div>

      <details class="gen-one">
        <summary>Generate single key</summary>
        <div class="form-grid">
          <label class="field"><span class="field-label">Student ID *</span><input v-model="genForm.studentNumber" /></label>
          <label class="field"><span class="field-label">Name *</span><input v-model="genForm.name" /></label>
          <label class="field"><span class="field-label">Email</span><input v-model="genForm.email" /></label>
          <label class="field"><span class="field-label">Seat</span><input v-model="genForm.seatLabel" /></label>
          <label class="field full"><span class="field-label">Custom stream name (leave blank to use student ID)</span><input v-model="genForm.streamName" /></label>
        </div>
        <div class="row right">
          <button class="primary" :disabled="generating" @click="generateOne">Generate</button>
        </div>
      </details>

      <table v-if="keys && keys.length">
        <thead><tr><th>Stream name</th><th>Student</th><th>Preview</th><th>Status</th><th>Last used</th><th></th></tr></thead>
        <tbody>
          <tr v-for="k in keys" :key="k.id">
            <td>{{ k.streamName }}</td>
            <td>{{ k.studentLabel ?? '—' }}</td>
            <td class="muted mono">{{ k.tokenPreview }}</td>
            <td><span class="badge" :class="k.revoked ? 'danger' : 'ok'">{{ k.revoked ? 'Revoked' : 'Active' }}</span></td>
            <td class="muted">{{ k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString('en-US', { hour12: false }) : '—' }}</td>
            <td>
              <button @click="copy(k.streamName, 'Copied stream name')">Copy stream name</button>
              <button v-if="!k.revoked" class="danger" @click="revokeKey(k.id)">Revoke</button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-else class="muted empty">No stream keys yet.</div>
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
.custom-token { gap: 0.5rem; align-items: center; margin-top: 0.5rem; }
.custom-token input { flex: 1; min-width: 200px; }
.warn-text { color: var(--danger); }
.kv { display: flex; align-items: center; gap: 0.5rem; margin: 0.2rem 0; flex-wrap: wrap; }
.kv span { color: var(--muted); font-size: 0.78rem; min-width: 5rem; }
code, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.82rem; }
.gen-one { margin: 0.5rem 0; }
textarea { width: 100%; margin: 0.5rem 0; resize: vertical; }
.group-checks { display: flex; flex-direction: column; gap: 0.35rem; }
.group-check { display: flex; align-items: center; gap: 0.5rem; font-size: 0.88rem; }
.group-check input { width: auto; }
</style>
