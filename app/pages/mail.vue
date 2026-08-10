<script setup lang="ts">
import type { MailConfigClient } from '#shared/mail'

const toast = useToast()
const { data, refresh } = await useFetch<MailConfigClient>('/api/mail/config')

// editable copy of the non-secret fields; secrets are entered into separate
// boxes and only sent when non-empty (server preserves the stored value then).
const form = reactive({
  provider: data.value?.provider ?? 'smtp',
  host: data.value?.host ?? '',
  port: data.value?.port ?? 587,
  useSsl: data.value?.useSsl ?? false,
  useTls: data.value?.useTls ?? true,
  usePassword: data.value?.usePassword ?? true,
  senderEmail: data.value?.senderEmail ?? '',
  senderDisplay: data.value?.senderDisplay ?? '',
  senderDomain: data.value?.senderDomain ?? '',
  postUrl: data.value?.postUrl ?? '',
  postSchema: data.value?.postSchema ?? 'smtogo',
})
const senderPassword = ref('')
const postAuthToken = ref('')
const hasPassword = ref(data.value?.hasPassword ?? false)
const hasPostAuthToken = ref(data.value?.hasPostAuthToken ?? false)

const saving = ref(false)
const testing = ref(false)
const testTo = ref(data.value?.senderEmail ?? '')

const dirty = computed(() => {
  if (!data.value) return true
  for (const k of Object.keys(form) as (keyof typeof form)[]) {
    if ((form[k] as unknown) !== (data.value as Record<string, unknown>)[k]) return true
  }
  return senderPassword.value !== '' || postAuthToken.value !== ''
})

async function save(): Promise<void> {
  saving.value = true
  try {
    const updated = await $fetch<MailConfigClient>('/api/mail/config', {
      method: 'PUT',
      body: { ...form, senderPassword: senderPassword.value, postAuthToken: postAuthToken.value },
    })
    data.value = updated
    hasPassword.value = updated.hasPassword
    hasPostAuthToken.value = updated.hasPostAuthToken
    senderPassword.value = ''
    postAuthToken.value = ''
    toast.success('Mail configuration saved')
  } catch (e: any) {
    toast.error('Save failed: ' + (e?.data?.statusMessage || e?.message || 'Unknown error'))
  } finally {
    saving.value = false
  }
}

async function sendTest(): Promise<void> {
  if (!testTo.value.trim()) {
    toast.error('Please enter a test recipient email')
    return
  }
  testing.value = true
  try {
    await $fetch('/api/mail/test', { method: 'POST', body: { to: testTo.value.trim() } })
    toast.success('Test email sent, please check your inbox')
  } catch (e: any) {
    toast.error('Send failed: ' + (e?.data?.statusMessage || e?.message || 'Unknown error'))
  } finally {
    testing.value = false
  }
}
</script>

<template>
  <div class="stack">
    <div class="between">
      <div>
        <h1>Mail Configuration</h1>
        <p class="muted">Used to send registration verification codes and system notifications. Configuration is stored in the database (not environment variables).</p>
      </div>
      <div class="row">
        <span v-if="dirty" class="badge warn">Unsaved changes</span>
        <button class="primary" :disabled="!dirty || saving" @click="save">
          {{ saving ? 'Saving…' : 'Save' }}
        </button>
      </div>
    </div>

    <div class="grid">
      <section class="card">
        <h2>Delivery Method</h2>
        <div class="fields">
          <label class="field">
            <span class="field-label">Provider</span>
            <select v-model="form.provider">
              <option value="smtp">SMTP (direct connection to mail server, recommended)</option>
              <option value="post">HTTP Webhook (forward to downstream automation/mail service)</option>
            </select>
          </label>
        </div>
      </section>

      <section v-if="form.provider === 'smtp'" class="card">
        <h2>SMTP</h2>
        <div class="fields">
          <label class="field">
            <span class="field-label">Server (host)</span>
            <input v-model="form.host" placeholder="smtp.example.com" />
          </label>
          <label class="field">
            <span class="field-label">Port</span>
            <input v-model.number="form.port" type="number" />
          </label>
          <label class="field field-bool">
            <input v-model="form.useSsl" type="checkbox" />
            <span>Implicit TLS (SSL) <small class="muted">— direct TLS, typically port 465</small></span>
          </label>
          <label class="field field-bool">
            <input v-model="form.useTls" type="checkbox" />
            <span>STARTTLS <small class="muted">— upgrade to TLS, typically port 587/25</small></span>
          </label>
          <label class="field field-bool">
            <input v-model="form.usePassword" type="checkbox" />
            <span>Requires login authentication</span>
          </label>
          <label class="field">
            <span class="field-label">Sender email (login account)</span>
            <input v-model="form.senderEmail" placeholder="noreply@example.com" />
          </label>
          <label class="field">
            <span class="field-label">Sender display name</span>
            <input v-model="form.senderDisplay" placeholder="Proctoring Ingest Platform" />
          </label>
          <label class="field">
            <span class="field-label">Sender domain (Message-ID, optional)</span>
            <input v-model="form.senderDomain" placeholder="example.com" />
          </label>
          <label class="field">
            <span class="field-label">
              SMTP password
              <small v-if="hasPassword" class="muted">(set; leave blank to keep unchanged)</small>
            </span>
            <input v-model="senderPassword" type="password" autocomplete="new-password" placeholder="Leave blank to keep unchanged" />
          </label>
        </div>
      </section>

      <section v-if="form.provider === 'post'" class="card">
        <h2>HTTP Webhook</h2>
        <div class="fields">
          <label class="field">
            <span class="field-label">Webhook URL</span>
            <input v-model="form.postUrl" placeholder="https://..." />
          </label>
          <label class="field">
            <span class="field-label">Data format</span>
            <select v-model="form.postSchema">
              <option value="smtogo">smtogo ({ from, to, subject, html })</option>
              <option value="powerautomate">Power Automate ({ email, content, subject })</option>
            </select>
          </label>
          <label class="field">
            <span class="field-label">
              Bearer Token (auth, optional)
              <small v-if="hasPostAuthToken" class="muted">(set; leave blank to keep unchanged)</small>
            </span>
            <input v-model="postAuthToken" type="password" autocomplete="new-password" placeholder="Leave blank to keep unchanged" />
          </label>
        </div>
      </section>

      <section class="card">
        <h2>Send Test</h2>
        <div class="fields">
          <p class="muted">Send a test email to the specified address using the current configuration (limit: 1/min, 10/day).</p>
          <label class="field">
            <span class="field-label">Test recipient</span>
            <input v-model="testTo" type="email" placeholder="you@example.com" />
          </label>
          <button :disabled="testing" @click="sendTest">
            {{ testing ? 'Sending…' : 'Send test email' }}
          </button>
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
.field-bool { flex-direction: row; align-items: center; gap: 0.5rem; }
.field-bool input { width: auto; }
</style>
