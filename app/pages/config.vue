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
  <div class="stack">
    <div class="between">
      <div>
        <h1>Runtime Configuration</h1>
        <p class="muted">Hot-reloads on save: new sessions use the new values immediately; active sessions pick them up on the next probe.</p>
      </div>
      <div class="row">
        <span v-if="dirty" class="badge warn">Unsaved changes</span>
        <button :disabled="!dirty || saving" @click="reset">Revert</button>
        <button class="primary" :disabled="!dirty || saving" @click="save">
          {{ saving ? 'Saving…' : 'Save & hot-reload' }}
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

      <section class="card">
        <h2>Registration Email Restrictions</h2>
        <div class="fields">
          <label class="field field-bool">
            <input
              type="checkbox"
              v-model="form.registration.emailWhitelist.enabled"
            />
            <span>Enable email whitelist <small class="muted">— When enabled, only emails matching the wildcards below may register; leave empty to allow all</small></span>
          </label>
          <label class="field">
            <span class="field-label">Allowed email wildcards (one per line)</span>
            <textarea v-model="whitelistText" rows="4" placeholder="*@nottingham.edu.cn&#10;*@*.nottingham.edu.cn"></textarea>
            <small class="muted field-hint">picomatch wildcards, e.g. <code>*@nottingham.edu.cn</code>. The first admin registration is exempt.</small>
          </label>
          <label class="field">
            <span class="field-label">Disallowed email patterns (one per line)</span>
            <textarea v-model="disallowedText" rows="3" placeholder="student&#10;staff"></textarea>
            <small class="muted field-hint">Emails containing these words (case-insensitive) are always rejected, e.g. institutional mailing lists <code>student</code> / <code>staff</code>.</small>
          </label>
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
textarea {
  font: inherit;
  resize: vertical;
  min-height: 4lh;
}
code {
  background: var(--border);
  padding: 0 0.25rem;
  border-radius: 3px;
  font-size: 0.85em;
}
</style>
