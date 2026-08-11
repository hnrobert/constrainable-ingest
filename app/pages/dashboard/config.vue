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
    title: 'Resolution / Framerate / Bitrate Limits',
    fields: [
      { path: 'limits.maxWidth', label: 'Max width (px)', kind: 'number', hint: '0 = no limit' },
      { path: 'limits.maxHeight', label: 'Max height (px)', kind: 'number', hint: '0 = no limit' },
      { path: 'limits.maxFps', label: 'Max framerate (fps)', kind: 'number', hint: '0 = no limit' },
      { path: 'limits.maxBitrateKbps', label: 'Max bitrate (kbps)', kind: 'number', hint: '0 = no limit' },
    ],
  },
  {
    title: 'Violation Handling',
    fields: [
      {
        path: 'enforce',
        label: 'Enforcement mode',
        kind: 'select',
        options: [
          { value: 'kick', label: 'Kick (kick) — disconnect on limit breach' },
          { value: 'flag', label: 'Flag only (flag) — alert without disconnecting' },
        ],
      },
    ],
  },
  {
    title: 'Probe (ffprobe)',
    fields: [
      { path: 'probe.waitMs', label: 'Wait before first probe (ms)', kind: 'number' },
      { path: 'probe.retries', label: 'Retry count on failure', kind: 'number' },
      { path: 'probe.retryIntervalMs', label: 'Retry interval (ms)', kind: 'number' },
      { path: 'probe.timeoutMs', label: 'Single probe timeout (ms)', kind: 'number' },
      { path: 'probe.pollIntervalMs', label: 'Polling interval (ms)', kind: 'number', hint: 'Interval between probes for active sessions' },
    ],
  },
  {
    title: 'Concurrency',
    fields: [
      { path: 'concurrency.probeMax', label: 'ffprobe max concurrency', kind: 'number' },
    ],
  },
  {
    title: 'Recording',
    fields: [
      { path: 'record.enabled', label: 'Enable recording', kind: 'bool' },
      { path: 'record.maxConcurrency', label: 'ffmpeg recording max concurrency', kind: 'number' },
      { path: 'record.retentionDays', label: 'Recording retention days', kind: 'number', hint: '0 = retain forever; takes effect on next cleanup' },
      { path: 'record.remuxTimeoutMs', label: 'FLV→MP4 remux timeout (ms)', kind: 'number' },
    ],
  },
  {
    title: 'Publish Admission',
    fields: [
      { path: 'access.rejectUnknownPublishers', label: 'Reject unregistered publishes', kind: 'bool', hint: 'Off allows any streamName to publish' },
    ],
  },
  {
    title: 'SRS Connection (Advanced)',
    fields: [
      { path: 'srs.apiBase', label: 'SRS HTTP API', kind: 'text' },
      { path: 'srs.rtmpHost', label: 'SRS RTMP host', kind: 'text', hint: 'Server pull address (in-container hostname)' },
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

// Registration email whitelist + disallowed patterns are string arrays — edited
// as line-separated textareas, split/joined here. Empty whitelist + enabled is
// treated as "allow all" server-side (can't lock the app out).
const whitelistText = computed<string>({
  get: () => form.value.registration.emailWhitelist.patterns.join('\n'),
  set: (v) => {
    form.value.registration.emailWhitelist.patterns = v
      .split('\n')
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
  },
})
const disallowedText = computed<string>({
  get: () => form.value.registration.disallowedPatterns.join('\n'),
  set: (v) => {
    form.value.registration.disallowedPatterns = v
      .split('\n')
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
  },
})

const dirty = computed(() => JSON.stringify(form.value) !== JSON.stringify(data.value))

async function save(): Promise<void> {
  saving.value = true
  try {
    const updated = await $fetch<AppConfig>('/api/config', { method: 'PATCH', body: form.value })
    data.value = updated
    form.value = structuredClone(updated)
    toast.success('Configuration saved and hot-reloaded')
  } catch (e: any) {
    toast.error('Save failed: ' + (e?.data?.statusMessage || e?.message || 'Unknown error'))
  } finally {
    saving.value = false
  }
}
function reset(): void {
  if (data.value) form.value = structuredClone(data.value)
  toast.info('Reverted to server configuration')
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div class="space-y-1">
        <h1 class="text-2xl font-semibold">Runtime Configuration</h1>
        <p class="text-muted-foreground">Hot-reloads on save: new sessions use the new values immediately; active sessions pick them up on the next probe.</p>
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <Badge v-if="dirty" variant="warning">Unsaved changes</Badge>
        <Button variant="outline" :disabled="!dirty || saving" @click="reset">Revert</Button>
        <Button :disabled="!dirty || saving" @click="save">
          {{ saving ? 'Saving…' : 'Save & hot-reload' }}
        </Button>
      </div>
    </div>

    <div class="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] items-start gap-4">
      <Card v-for="s in sections" :key="s.title">
        <CardHeader><CardTitle>{{ s.title }}</CardTitle></CardHeader>
        <CardContent class="space-y-3">
          <template v-for="f in s.fields" :key="f.path">
            <div v-if="f.kind === 'bool'" class="flex items-center gap-2">
              <Checkbox
                :model-value="getPath(form, f.path)"
                @update:model-value="setPath(form, f.path, $event)"
              />
              <span class="text-sm">
                {{ f.label }}
                <span v-if="f.hint" class="text-muted-foreground">— {{ f.hint }}</span>
              </span>
            </div>

            <div v-else class="space-y-1.5">
              <Label>{{ f.label }}</Label>
              <Select
                v-if="f.kind === 'select'"
                :model-value="getPath(form, f.path)"
                @update:model-value="onInput(f.path, 'select', $event)"
              >
                <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="o in f.options" :key="o.value" :value="o.value">{{ o.label }}</SelectItem>
                </SelectContent>
              </Select>
              <Input
                v-else
                :type="f.kind === 'number' ? 'number' : 'text'"
                :model-value="getPath(form, f.path)"
                @update:model-value="onInput(f.path, f.kind, $event)"
              />
              <p v-if="f.hint" class="text-xs text-muted-foreground">{{ f.hint }}</p>
            </div>
          </template>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Registration Email Restrictions</CardTitle></CardHeader>
        <CardContent class="space-y-3">
          <div class="flex items-center gap-2">
            <Checkbox v-model="form.registration.emailWhitelist.enabled" />
            <span class="text-sm">
              Enable email whitelist
              <span class="text-muted-foreground">— When enabled, only emails matching the wildcards below may register; leave empty to allow all</span>
            </span>
          </div>
          <div class="space-y-1.5">
            <Label>Allowed email wildcards (one per line)</Label>
            <Textarea v-model="whitelistText" rows="4" placeholder="*@nottingham.edu.cn&#10;*@*.nottingham.edu.cn" />
            <p class="text-xs text-muted-foreground">picomatch wildcards, e.g. <code class="rounded bg-muted px-1 text-[0.85em]">*@nottingham.edu.cn</code>. The first admin registration is exempt.</p>
          </div>
          <div class="space-y-1.5">
            <Label>Disallowed email patterns (one per line)</Label>
            <Textarea v-model="disallowedText" rows="3" placeholder="student&#10;staff" />
            <p class="text-xs text-muted-foreground">Emails containing these words (case-insensitive) are always rejected, e.g. institutional mailing lists <code class="rounded bg-muted px-1 text-[0.85em]">student</code> / <code class="rounded bg-muted px-1 text-[0.85em]">staff</code>.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  </div>
</template>
