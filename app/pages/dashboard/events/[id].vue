<script setup lang="ts">
import type { EventView, EventStatus, EventVisibility } from '#shared/event-view'
import type { GroupView } from '#shared/groups'
import type { DataTableColumn } from '~/components/DataTable.vue'

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
const confirm = useConfirm()
const obs = useObsConfig()
const { user } = useAuth()
const isAdmin = computed(() => user.value?.role === 'admin')

// Sync fetch (NO top-level await) so this page doesn't drag the dashboard
// layout into an async Suspense boundary (client hydration mismatch). Nuxt
// still awaits the registered useFetch promises during SSR and serializes the
// results; the template reads event/roster/keys directly (populated on SSR for
// direct reads), and the watchEffect below (flush:'sync') populates the editable
// `settings` copy at the instant `event` is assigned, before the render pass.
const { data: event, refresh: refreshEvent } = useFetch<EventView>(`/api/events/${id}`)
const { data: roster, refresh: refreshRoster } = useFetch<RosterEntry[]>(`/api/events/${id}/roster`)
const { data: keys, refresh: refreshKeys } = useFetch<KeyView[]>(`/api/events/${id}/keys`)

// ---- settings (admin-only) ----
const settings = ref<EventView | null>(null)
const selectedGroupIds = ref<number[]>([])
const allGroups = ref<GroupView[]>([])
// flush:'sync' (with watch, not watchEffect) so settings/selectedGroupIds
// populate at the moment `event` is assigned during SSR, before the render pass.
// watchEffect's flush:'sync' does NOT re-fire on the SSR assignment the way
// watch's does, so the editable copy stayed null server-side (card content
// absent → hydration mismatch). The !settings guard makes this one-shot init.
watch(
  event,
  (e) => {
    if (e && !settings.value) {
      settings.value = structuredClone(toRaw(e))
      selectedGroupIds.value = e.groups.map((g) => g.id)
    }
  },
  { immediate: true, flush: 'sync' },
)
// Groups catalog is admin-only; fetch lazily on the client for admins only.
onMounted(async () => {
  if (!isAdmin.value) return
  try {
    allGroups.value = await $fetch<GroupView[]>('/api/groups')
  } catch {
    /* non-admin or transient — leave empty */
  }
  loadPublishKey()
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
    s.visibility !== e.visibility ||
    s.streamGuide !== e.streamGuide
  return scalarChanged || !sameSet(selectedGroupIds.value, e.groups.map((g) => g.id))
})

const visibilityLabel: Record<EventVisibility, string> = {
  public: 'Public',
  registered: 'Registered users',
  groups: 'Specific groups',
}

const saving = ref(false)
const saved = ref(false)
async function saveSettings(): Promise<boolean> {
  if (!settings.value) return false
  saving.value = true
  saved.value = false
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
        streamGuide: s.streamGuide,
        groupIds: selectedGroupIds.value,
      },
    })
    event.value = updated
    settings.value = structuredClone(updated)
    selectedGroupIds.value = updated.groups.map((g) => g.id)
    toast.success('Event updated')
    saved.value = true
    setTimeout(() => {
      saved.value = false
    }, 2000)
    return true
  } catch (e: any) {
    toast.error('Save failed: ' + (e?.data?.statusMessage || e?.message || ''))
    return false
  } finally {
    saving.value = false
  }
}
function resetSettings(): void {
  if (event.value) {
    settings.value = structuredClone(toRaw(event.value))
    selectedGroupIds.value = event.value.groups.map((g) => g.id)
  }
}

// Warn before leaving with unsaved settings; the SaveBar + dialog provide the UI.
const { confirmLeave, proceed } = useUnsavedLeaveGuard(settingsDirty, saving)
async function saveAndLeave(): Promise<void> {
  if (await saveSettings()) proceed()
}
function discardAndLeave(): void {
  resetSettings()
  proceed()
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
function removeEntry(enrollmentId: number): void {
  confirm.ask('Remove this student from the roster? (Their stream key will be revoked)', async () => {
    try {
      await $fetch(`/api/events/${id}/roster/${enrollmentId}`, { method: 'DELETE' })
      await Promise.all([refreshRoster(), refreshKeys()])
      toast.info('Removed')
    } catch (e: any) {
      toast.error('Remove failed: ' + (e?.data?.statusMessage || e?.message || ''))
    }
  }, { actionLabel: 'Remove' })
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
function rotatePublishToken(): void {
  const run = async (): Promise<void> => {
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
  if (event.value?.publishTokenPreview) {
    confirm.ask('Regenerating will invalidate the old publish token immediately. Continue?', run, { actionLabel: 'Regenerate' })
  } else {
    run()
  }
}
function setCustomPublishToken(): void {
  if (!customTokenValid.value) return
  const run = async (): Promise<void> => {
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
  if (event.value?.publishTokenPreview) {
    confirm.ask('Setting a custom token will invalidate the old publish token immediately. Continue?', run, { actionLabel: 'Apply custom' })
  } else {
    run()
  }
}
function clearPublishToken(): void {
  confirm.ask('Clear publish token? Publishes using this token will be rejected.', async () => {
    try {
      await $fetch(`/api/events/${id}/publish-token`, { method: 'DELETE' })
      freshPublishToken.value = null
      await refreshEvent()
      toast.info('Cleared')
    } catch (e: any) {
      toast.error('Clear failed: ' + (e?.data?.statusMessage || e?.message || ''))
    }
  }, { actionLabel: 'Clear' })
}

// ---- per-event publish key (admin) — the shared key on the participant guide ----
// Unlike the publish token, the publish key is retrievable (stored verbatim), so
// we display the current value and re-fetch it after any change rather than only
// showing it once.
const currentPublishKey = ref<string | null>(null)
const rotatingKey = ref(false)
const customKey = ref('')
const customKeyValid = computed(() => {
  const t = customKey.value.trim()
  return t.length >= 8 && t.length <= 128 && TOKEN_RE.test(t)
})
async function loadPublishKey(): Promise<void> {
  try {
    const r = await $fetch<{ key: string | null }>(`/api/events/${id}/publish-key`)
    currentPublishKey.value = r.key
  } catch {
    /* transient — leave as-is */
  }
}
function generatePublishKey(): void {
  const run = async (): Promise<void> => {
    rotatingKey.value = true
    try {
      await $fetch(`/api/events/${id}/publish-key`, { method: 'POST' })
      await Promise.all([loadPublishKey(), refreshEvent()])
      if (event.value) settings.value = structuredClone(toRaw(event.value))
      toast.success('Publish key generated')
    } catch (e: any) {
      toast.error('Generation failed: ' + (e?.data?.statusMessage || e?.message || ''))
    } finally {
      rotatingKey.value = false
    }
  }
  if (currentPublishKey.value || event.value?.publishKeyPreview) {
    confirm.ask('Generating a new key invalidates the old one immediately. Continue?', run, { actionLabel: 'Regenerate' })
  } else {
    run()
  }
}
function setCustomPublishKey(): void {
  if (!customKeyValid.value) return
  const run = async (): Promise<void> => {
    rotatingKey.value = true
    try {
      await $fetch(`/api/events/${id}/publish-key`, {
        method: 'POST',
        body: { key: customKey.value.trim() },
      })
      customKey.value = ''
      await Promise.all([loadPublishKey(), refreshEvent()])
      if (event.value) settings.value = structuredClone(toRaw(event.value))
      toast.success('Custom publish key set')
    } catch (e: any) {
      toast.error('Set failed: ' + (e?.data?.statusMessage || e?.message || ''))
    } finally {
      rotatingKey.value = false
    }
  }
  if (currentPublishKey.value || event.value?.publishKeyPreview) {
    confirm.ask('Setting a custom key invalidates the old one immediately. Continue?', run, { actionLabel: 'Apply custom' })
  } else {
    run()
  }
}
function clearPublishKey(): void {
  confirm.ask('Clear the publish key? Publishes using this key will be rejected.', async () => {
    try {
      await $fetch(`/api/events/${id}/publish-key`, { method: 'DELETE' })
      currentPublishKey.value = null
      await refreshEvent()
      toast.info('Cleared')
    } catch (e: any) {
      toast.error('Clear failed: ' + (e?.data?.statusMessage || e?.message || ''))
    }
  }, { actionLabel: 'Clear' })
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
function revokeKey(keyId: number): void {
  confirm.ask('Revoke this stream key? The student will not be able to publish until it is regenerated.', async () => {
    try {
      await $fetch(`/api/events/${id}/keys/${keyId}`, { method: 'DELETE' })
      await refreshKeys()
      toast.info('Revoked')
    } catch (e: any) {
      toast.error('Revoke failed: ' + (e?.data?.statusMessage || e?.message || ''))
    }
  }, { actionLabel: 'Revoke' })
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

const rosterColumns: DataTableColumn[] = [
  { key: 'studentNumber', header: 'Student ID' },
  { key: 'name', header: 'Name' },
  { key: 'seatLabel', header: 'Seat', class: 'text-muted-foreground' },
  { key: 'hasKey', header: 'Stream key' },
  { key: 'actions', header: '', headClass: 'w-0' },
]

const keyColumns: DataTableColumn[] = [
  { key: 'streamName', header: 'Stream name' },
  { key: 'studentLabel', header: 'Student' },
  { key: 'tokenPreview', header: 'Preview', class: 'font-mono text-xs text-muted-foreground' },
  { key: 'revoked', header: 'Status' },
  { key: 'lastUsedAt', header: 'Last used', class: 'text-muted-foreground' },
  { key: 'actions', header: '', headClass: 'w-0' },
]
</script>

<template>
  <div v-if="event" class="space-y-6 pb-24">
    <div class="space-y-1">
      <NuxtLink to="/dashboard/events" class="text-sm text-muted-foreground hover:text-foreground">← Back to events</NuxtLink>
      <h1 class="text-2xl font-semibold">{{ event.name }}</h1>
      <p class="text-muted-foreground">slug: {{ event.slug }}</p>
      <p v-if="event.description" class="text-muted-foreground">{{ event.description }}</p>
      <p class="text-xs text-muted-foreground">
        Status: {{ event.status }} · Visibility: {{ visibilityLabel[event.visibility] }}
        <template v-if="event.visibility === 'groups' && event.groups.length">
          · Groups: {{ event.groups.map((g) => g.name).join(', ') }}
        </template>
      </p>
    </div>

    <!-- freshly generated keys (plaintext shown once) -->
    <Card v-if="isAdmin && freshKeys.length" class="border-ok/50">
      <CardHeader>
        <div class="flex items-center justify-between">
          <CardTitle>Newly generated stream keys (shown only once, copy them now)</CardTitle>
          <Button variant="ghost" size="sm" @click="freshKeys = []">Close</Button>
        </div>
      </CardHeader>
      <CardContent class="space-y-3">
        <div v-for="k in freshKeys" :key="k.id" class="space-y-1 border-t pt-3 first:border-t-0 first:pt-0">
          <div class="font-medium">{{ k.studentLabel }} ({{ k.studentNumber }})</div>
          <div class="flex flex-wrap items-center gap-2 text-sm">
            <span class="min-w-20 text-xs text-muted-foreground">OBS server</span>
            <code class="font-mono text-xs">{{ obs.server.value }}</code>
            <Button variant="link" class="h-auto p-0 text-xs" @click="copy(obs.server.value, 'Copied server address')">Copy</Button>
          </div>
          <div class="flex flex-wrap items-center gap-2 text-sm">
            <span class="min-w-20 text-xs text-muted-foreground">Stream key</span>
            <code class="font-mono text-xs">{{ obs.streamKey(k.streamName, k.token) }}</code>
            <Button variant="link" class="h-auto p-0 text-xs" @click="copy(obs.streamKey(k.streamName, k.token), 'Copied stream key')">Copy</Button>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- settings (admin-only) -->
    <Card v-if="isAdmin">
      <CardHeader><CardTitle>Event settings</CardTitle></CardHeader>
      <CardContent v-if="settings" class="space-y-4">
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div class="space-y-1.5">
            <Label>Name</Label>
            <Input v-model="settings.name" />
          </div>
          <div class="space-y-1.5">
            <Label>slug</Label>
            <Input v-model="settings.slug" />
          </div>
          <div class="space-y-1.5 sm:col-span-2">
            <Label>Description</Label>
            <!-- description is string | null; bind explicitly so null renders
                 empty but is preserved untouched on save (native-input parity). -->
            <Input
              :model-value="settings.description ?? ''"
              @update:model-value="settings.description = String($event)"
            />
          </div>
          <div class="space-y-1.5">
            <Label>Status</Label>
            <Select v-model="settings.status">
              <SelectTrigger class="w-full"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="o in statusOptions" :key="o.value" :value="o.value">{{ o.label }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="space-y-1.5">
            <Label>Visibility</Label>
            <Select v-model="settings.visibility">
              <SelectTrigger class="w-full"><SelectValue placeholder="Visibility" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="registered">Registered users</SelectItem>
                <SelectItem value="public">Public (anyone, incl. homepage)</SelectItem>
                <SelectItem value="groups">Specific groups</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="flex items-center gap-2 self-end pb-1 sm:col-span-2">
            <Checkbox v-model="settings.recordEnabled" />
            <span class="text-sm">Enable recording</span>
          </div>
          <div v-if="settings.visibility === 'groups'" class="space-y-1.5 sm:col-span-2">
            <Label>Allowed groups</Label>
            <div class="flex flex-col gap-2">
              <!-- Native checkbox here: reka Checkbox only models a boolean, but
                   this is an array binding (selectedGroupIds). Keeping <input> preserves
                   the exact multi-select semantics without changing script logic. -->
              <label v-for="g in allGroups" :key="g.id" class="flex items-center gap-2 text-sm">
                <input type="checkbox" :value="g.id" v-model="selectedGroupIds" class="size-4" />
                <span>{{ g.name }} <span class="text-muted-foreground">({{ g.memberCount }})</span></span>
              </label>
              <p v-if="!allGroups.length" class="text-xs text-muted-foreground">No groups exist yet — create some on the Groups page first.</p>
            </div>
          </div>
          <div class="space-y-1.5 sm:col-span-2">
            <Label>Participant guide instructions</Label>
            <Textarea
              :model-value="settings.streamGuide ?? ''"
              @update:model-value="settings.streamGuide = String($event) || null"
              rows="3"
              placeholder="Optional notes shown on the participant guide (e.g. join 5 min early, use wired ethernet…)"
            />
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- per-event publish token (admin-only) -->
    <Card v-if="isAdmin">
      <CardHeader>
        <div class="flex items-center justify-between">
          <CardTitle>Event publish token</CardTitle>
          <Badge v-if="event.publishTokenPreview" variant="success">Set <code class="ml-1 font-mono text-xs">{{ event.publishTokenPreview }}…</code></Badge>
          <Badge v-else variant="secondary">Not set</Badge>
        </div>
      </CardHeader>
      <CardContent class="space-y-3">
        <p class="text-xs text-muted-foreground">
          One publish token per event, shared with all publishers for this event. The OBS stream key is
          <code class="font-mono">&lt;stream-name&gt;?token=&lt;token&gt;</code>, valid only within the event time window
          (use either this or per-student stream keys).
        </p>

        <div v-if="freshPublishToken" class="space-y-1 rounded-md border border-ok/50 p-3 text-sm">
          <strong>{{ freshPublishToken.isCustom ? 'Token applied' : 'New token (shown only once, copy it now)' }}</strong>
          <div class="flex flex-wrap items-center gap-2">
            <span class="min-w-20 text-xs text-muted-foreground">Token</span>
            <code class="font-mono text-xs">{{ freshPublishToken.token }}</code>
            <Button variant="link" class="h-auto p-0 text-xs" @click="copy(freshPublishToken.token, 'Copied token')">Copy</Button>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <span class="min-w-20 text-xs text-muted-foreground">OBS server</span>
            <code class="font-mono text-xs">{{ obs.server.value }}</code>
            <Button variant="link" class="h-auto p-0 text-xs" @click="copy(obs.server.value, 'Copied server address')">Copy</Button>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <span class="min-w-20 text-xs text-muted-foreground">Stream key example</span>
            <code class="font-mono text-xs">{{ obs.streamKey('stream-name', freshPublishToken.token) }}</code>
          </div>
        </div>

        <div class="flex items-center justify-end gap-3">
          <Button v-if="event.publishTokenPreview" variant="outline" :disabled="rotatingToken" @click="clearPublishToken">Clear</Button>
          <Button :disabled="rotatingToken" @click="rotatePublishToken">
            {{ rotatingToken ? 'Generating…' : event.publishTokenPreview ? 'Regenerate' : 'Generate random token' }}
          </Button>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <Input
            v-model="customToken"
            placeholder="Or custom token (8–128 chars, alphanumeric and . _ - ~)"
            class="min-w-50 flex-1"
            @keyup.enter="setCustomPublishToken"
          />
          <Button :disabled="rotatingToken || !customTokenValid" @click="setCustomPublishToken">Apply custom</Button>
        </div>
        <p v-if="customToken && !customTokenValid" class="text-xs text-destructive">
          Token must be 8–128 chars, containing only letters, digits, and <code class="font-mono">. _ - ~</code>.
        </p>
      </CardContent>
    </Card>

    <!-- per-event publish key (admin-only) — the shared key on the participant guide -->
    <Card v-if="isAdmin">
      <CardHeader>
        <div class="flex items-center justify-between">
          <CardTitle>Event publish key (participant guide)</CardTitle>
          <Badge v-if="event.publishKeyPreview" variant="success">Set <code class="ml-1 font-mono text-xs">{{ event.publishKeyPreview }}…</code></Badge>
          <Badge v-else variant="secondary">Not set</Badge>
        </div>
      </CardHeader>
      <CardContent class="space-y-3">
        <p class="text-xs text-muted-foreground">
          One shared key per event, shown in full on the
          <NuxtLink :to="`/e/${event.slug}`" target="_blank" class="underline hover:text-primary">participant guide</NuxtLink>.
          Each contestant pastes it as <code class="font-mono">&lt;their-email&gt;?token=&lt;key&gt;</code> — the stream NAME
          is their own account email (unique per person), so the whole class can stream at once. This is distinct from
          the hashed publish token above.
        </p>

        <div v-if="currentPublishKey" class="space-y-1 rounded-md border border-ok/50 p-3 text-sm">
          <strong>Publish key</strong>
          <div class="flex flex-wrap items-center gap-2">
            <code class="break-all font-mono text-xs">{{ currentPublishKey }}</code>
            <Button variant="link" class="h-auto p-0 text-xs" @click="copy(currentPublishKey, 'Copied publish key')">Copy</Button>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <span class="min-w-20 text-xs text-muted-foreground">OBS server</span>
            <code class="font-mono text-xs">{{ obs.server.value }}</code>
            <Button variant="link" class="h-auto p-0 text-xs" @click="copy(obs.server.value, 'Copied server address')">Copy</Button>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <span class="min-w-20 text-xs text-muted-foreground">Stream key example</span>
            <code class="font-mono text-xs">{{ obs.streamKey('account@example.com', currentPublishKey) }}</code>
          </div>
        </div>

        <div class="flex items-center justify-end gap-3">
          <Button v-if="event.publishKeyPreview || currentPublishKey" variant="outline" :disabled="rotatingKey" @click="clearPublishKey">Clear</Button>
          <Button :disabled="rotatingKey" @click="generatePublishKey">
            {{ rotatingKey ? 'Generating…' : event.publishKeyPreview || currentPublishKey ? 'Regenerate' : 'Generate random key' }}
          </Button>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <Input
            v-model="customKey"
            placeholder="Or custom key (8–128 chars, alphanumeric and . _ - ~)"
            class="min-w-50 flex-1"
            @keyup.enter="setCustomPublishKey"
          />
          <Button :disabled="rotatingKey || !customKeyValid" @click="setCustomPublishKey">Apply custom</Button>
        </div>
        <p v-if="customKey && !customKeyValid" class="text-xs text-destructive">
          Key must be 8–128 chars, containing only letters, digits, and <code class="font-mono">. _ - ~</code>.
        </p>
      </CardContent>
    </Card>

    <!-- roster (admin-only) -->
    <Card v-if="isAdmin">
      <CardHeader><CardTitle>Roster ({{ roster?.length ?? 0 }})</CardTitle></CardHeader>
      <CardContent class="space-y-4">
        <p class="text-xs text-muted-foreground">Paste CSV: one row per line as <code>student_id,name[,email][,seat]</code>. A header row is skipped automatically.</p>
        <Textarea v-model="csvText" rows="4" placeholder="2024001,Alice,alice@x.edu,A1&#10;2024002,Bob,,B2" />
        <div class="flex items-center justify-end gap-3">
          <Button variant="outline" :disabled="importing" @click="importRoster">{{ importing ? 'Importing…' : 'Import' }}</Button>
        </div>
        <DataTable
          :columns="rosterColumns"
          :rows="roster ?? []"
          :row-key="(r: RosterEntry) => r.enrollmentId"
          empty="No roster yet."
        >
          <template #cell-seatLabel="{ row }">{{ row.seatLabel ?? '—' }}</template>
          <template #cell-hasKey="{ row }">
            <Badge :variant="row.hasKey ? 'success' : 'secondary'">{{ row.hasKey ? 'Generated' : 'None' }}</Badge>
          </template>
          <template #cell-actions="{ row }">
            <Button size="sm" variant="destructive" @click="removeEntry(row.enrollmentId)">Remove</Button>
          </template>
        </DataTable>
      </CardContent>
    </Card>

    <!-- keys (admin-only) -->
    <Card v-if="isAdmin">
      <CardHeader>
        <div class="flex items-center justify-between">
          <CardTitle>Stream keys ({{ keys?.length ?? 0 }})</CardTitle>
          <Button :disabled="generating" @click="generateAll">Bulk generate for students without keys</Button>
        </div>
      </CardHeader>
      <CardContent class="space-y-4">
        <details class="group">
          <summary class="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground">Generate single key</summary>
          <div class="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div class="space-y-1.5">
              <Label>Student ID *</Label>
              <Input v-model="genForm.studentNumber" />
            </div>
            <div class="space-y-1.5">
              <Label>Name *</Label>
              <Input v-model="genForm.name" />
            </div>
            <div class="space-y-1.5">
              <Label>Email</Label>
              <Input v-model="genForm.email" />
            </div>
            <div class="space-y-1.5">
              <Label>Seat</Label>
              <Input v-model="genForm.seatLabel" />
            </div>
            <div class="space-y-1.5 sm:col-span-2">
              <Label>Custom stream name (leave blank to use student ID)</Label>
              <Input v-model="genForm.streamName" />
            </div>
          </div>
          <div class="mt-3 flex items-center justify-end">
            <Button :disabled="generating" @click="generateOne">Generate</Button>
          </div>
        </details>

        <DataTable
          :columns="keyColumns"
          :rows="keys ?? []"
          :row-key="(k: KeyView) => k.id"
          empty="No stream keys yet."
        >
          <template #cell-studentLabel="{ row }">{{ row.studentLabel ?? '—' }}</template>
          <template #cell-revoked="{ row }">
            <Badge :variant="row.revoked ? 'destructive' : 'success'">{{ row.revoked ? 'Revoked' : 'Active' }}</Badge>
          </template>
          <template #cell-lastUsedAt="{ row }">
            {{ row.lastUsedAt ? new Date(row.lastUsedAt).toLocaleString('en-US', { hour12: false }) : '—' }}
          </template>
          <template #cell-actions="{ row }">
            <div class="flex justify-end gap-2">
              <Button size="sm" variant="outline" @click="copy(row.streamName, 'Copied stream name')">Copy stream name</Button>
              <Button v-if="!row.revoked" size="sm" variant="destructive" @click="revokeKey(row.id)">Revoke</Button>
            </div>
          </template>
        </DataTable>
      </CardContent>
    </Card>

    <SaveBar :dirty="settingsDirty" :saving="saving" :saved="saved" @save="saveSettings" @discard="resetSettings" />
    <UnsavedLeaveDialog
      :open="confirmLeave"
      :saving="saving"
      @stay="confirmLeave = false"
      @discard="discardAndLeave"
      @save="saveAndLeave"
    />

    <ConfirmDialog
      v-model:open="confirm.state.open"
      :message="confirm.state.message"
      :action-label="confirm.state.actionLabel"
      :destructive="confirm.state.destructive"
      @accept="confirm.accept"
    />
  </div>
</template>
