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
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div class="space-y-1">
        <h1 class="text-2xl font-semibold">Mail Configuration</h1>
        <p class="text-muted-foreground">Used to send registration verification codes and system notifications. Configuration is stored in the database (not environment variables).</p>
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <Badge v-if="dirty" variant="warning">Unsaved changes</Badge>
        <Button :disabled="!dirty || saving" @click="save">
          {{ saving ? 'Saving…' : 'Save' }}
        </Button>
      </div>
    </div>

    <div class="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] items-start gap-4">
      <Card>
        <CardHeader><CardTitle>Delivery Method</CardTitle></CardHeader>
        <CardContent>
          <div class="space-y-1.5">
            <Label>Provider</Label>
            <Select v-model="form.provider">
              <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="smtp">SMTP (direct connection to mail server, recommended)</SelectItem>
                <SelectItem value="post">HTTP Webhook (forward to downstream automation/mail service)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card v-if="form.provider === 'smtp'">
        <CardHeader><CardTitle>SMTP</CardTitle></CardHeader>
        <CardContent class="space-y-3">
          <div class="space-y-1.5">
            <Label>Server (host)</Label>
            <Input v-model="form.host" placeholder="smtp.example.com" />
          </div>
          <div class="space-y-1.5">
            <Label>Port</Label>
            <Input v-model.number="form.port" type="number" />
          </div>
          <div class="flex items-center gap-2">
            <Checkbox v-model="form.useSsl" />
            <span class="text-sm">Implicit TLS (SSL) <span class="text-muted-foreground">— direct TLS, typically port 465</span></span>
          </div>
          <div class="flex items-center gap-2">
            <Checkbox v-model="form.useTls" />
            <span class="text-sm">STARTTLS <span class="text-muted-foreground">— upgrade to TLS, typically port 587/25</span></span>
          </div>
          <div class="flex items-center gap-2">
            <Checkbox v-model="form.usePassword" />
            <span class="text-sm">Requires login authentication</span>
          </div>
          <div class="space-y-1.5">
            <Label>Sender email (login account)</Label>
            <Input v-model="form.senderEmail" placeholder="noreply@example.com" />
          </div>
          <div class="space-y-1.5">
            <Label>Sender display name</Label>
            <Input v-model="form.senderDisplay" placeholder="Proctoring Ingest Platform" />
          </div>
          <div class="space-y-1.5">
            <Label>Sender domain (Message-ID, optional)</Label>
            <Input v-model="form.senderDomain" placeholder="example.com" />
          </div>
          <div class="space-y-1.5">
            <Label>
              SMTP password
              <span v-if="hasPassword" class="text-muted-foreground">(set; leave blank to keep unchanged)</span>
            </Label>
            <Input v-model="senderPassword" type="password" autocomplete="new-password" placeholder="Leave blank to keep unchanged" />
          </div>
        </CardContent>
      </Card>

      <Card v-if="form.provider === 'post'">
        <CardHeader><CardTitle>HTTP Webhook</CardTitle></CardHeader>
        <CardContent class="space-y-3">
          <div class="space-y-1.5">
            <Label>Webhook URL</Label>
            <Input v-model="form.postUrl" placeholder="https://..." />
          </div>
          <div class="space-y-1.5">
            <Label>Data format</Label>
            <Select v-model="form.postSchema">
              <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="smtogo">smtogo ({ from, to, subject, html })</SelectItem>
                <SelectItem value="powerautomate">Power Automate ({ email, content, subject })</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="space-y-1.5">
            <Label>
              Bearer Token (auth, optional)
              <span v-if="hasPostAuthToken" class="text-muted-foreground">(set; leave blank to keep unchanged)</span>
            </Label>
            <Input v-model="postAuthToken" type="password" autocomplete="new-password" placeholder="Leave blank to keep unchanged" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Send Test</CardTitle></CardHeader>
        <CardContent class="space-y-3">
          <p class="text-sm text-muted-foreground">Send a test email to the specified address using the current configuration (limit: 1/min, 10/day).</p>
          <div class="space-y-1.5">
            <Label>Test recipient</Label>
            <Input v-model="testTo" type="email" placeholder="you@example.com" />
          </div>
          <Button variant="outline" :disabled="testing" @click="sendTest">
            {{ testing ? 'Sending…' : 'Send test email' }}
          </Button>
        </CardContent>
      </Card>
    </div>
  </div>
</template>
