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
    toast.success('邮件配置已保存')
  } catch (e: any) {
    toast.error('保存失败：' + (e?.data?.statusMessage || e?.message || '未知错误'))
  } finally {
    saving.value = false
  }
}

async function sendTest(): Promise<void> {
  if (!testTo.value.trim()) {
    toast.error('请输入测试收件人邮箱')
    return
  }
  testing.value = true
  try {
    await $fetch('/api/mail/test', { method: 'POST', body: { to: testTo.value.trim() } })
    toast.success('测试邮件已发送，请查收')
  } catch (e: any) {
    toast.error('发送失败：' + (e?.data?.statusMessage || e?.message || '未知错误'))
  } finally {
    testing.value = false
  }
}
</script>

<template>
  <div class="stack">
    <div class="between">
      <div>
        <h1>邮件配置</h1>
        <p class="muted">用于发送注册验证码与系统通知。配置保存在数据库（非环境变量）。</p>
      </div>
      <div class="row">
        <span v-if="dirty" class="badge warn">有未保存更改</span>
        <button class="primary" :disabled="!dirty || saving" @click="save">
          {{ saving ? '保存中…' : '保存' }}
        </button>
      </div>
    </div>

    <div class="grid">
      <section class="card">
        <h2>发送方式</h2>
        <div class="fields">
          <label class="field">
            <span class="field-label">通道</span>
            <select v-model="form.provider">
              <option value="smtp">SMTP（直连邮件服务器，推荐）</option>
              <option value="post">HTTP Webhook（转发到下游自动化/邮件服务）</option>
            </select>
          </label>
        </div>
      </section>

      <section v-if="form.provider === 'smtp'" class="card">
        <h2>SMTP</h2>
        <div class="fields">
          <label class="field">
            <span class="field-label">服务器 (host)</span>
            <input v-model="form.host" placeholder="smtp.example.com" />
          </label>
          <label class="field">
            <span class="field-label">端口</span>
            <input v-model.number="form.port" type="number" />
          </label>
          <label class="field field-bool">
            <input v-model="form.useSsl" type="checkbox" />
            <span>隐式 TLS (SSL) <small class="muted">— 直连 TLS，通常端口 465</small></span>
          </label>
          <label class="field field-bool">
            <input v-model="form.useTls" type="checkbox" />
            <span>STARTTLS <small class="muted">— 升级为 TLS，通常端口 587/25</small></span>
          </label>
          <label class="field field-bool">
            <input v-model="form.usePassword" type="checkbox" />
            <span>需要登录认证</span>
          </label>
          <label class="field">
            <span class="field-label">发件邮箱 (登录账号)</span>
            <input v-model="form.senderEmail" placeholder="noreply@example.com" />
          </label>
          <label class="field">
            <span class="field-label">发件人显示名</span>
            <input v-model="form.senderDisplay" placeholder="监考收流平台" />
          </label>
          <label class="field">
            <span class="field-label">发件域名 (Message-ID，可选)</span>
            <input v-model="form.senderDomain" placeholder="example.com" />
          </label>
          <label class="field">
            <span class="field-label">
              SMTP 密码
              <small v-if="hasPassword" class="muted">（已设置；留空则保持不变）</small>
            </span>
            <input v-model="senderPassword" type="password" autocomplete="new-password" placeholder="留空保持不变" />
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
            <span class="field-label">数据格式</span>
            <select v-model="form.postSchema">
              <option value="smtogo">smtogo ({ from, to, subject, html })</option>
              <option value="powerautomate">Power Automate ({ email, content, subject })</option>
            </select>
          </label>
          <label class="field">
            <span class="field-label">
              Bearer Token（鉴权，可选）
              <small v-if="hasPostAuthToken" class="muted">（已设置；留空则保持不变）</small>
            </span>
            <input v-model="postAuthToken" type="password" autocomplete="new-password" placeholder="留空保持不变" />
          </label>
        </div>
      </section>

      <section class="card">
        <h2>发送测试</h2>
        <div class="fields">
          <p class="muted">使用当前配置向指定邮箱发送一封测试邮件（限 1 次/分钟、10 次/天）。</p>
          <label class="field">
            <span class="field-label">测试收件人</span>
            <input v-model="testTo" type="email" placeholder="you@example.com" />
          </label>
          <button :disabled="testing" @click="sendTest">
            {{ testing ? '发送中…' : '发送测试邮件' }}
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
