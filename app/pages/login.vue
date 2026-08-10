<script setup lang="ts">
import type { SessionUser } from '~/composables/useAuth'

definePageMeta({ layout: false })

const { login, register, sendCode, fetchBootstrap } = useAuth()
const toast = useToast()
const route = useRoute()

const mode = ref<'login' | 'register'>('login')
const email = ref('')
const password = ref('')
const confirm = ref('')
const code = ref('')
const loading = ref(false)
const error = ref('')

// bootstrap = no users yet → first registrant is super admin, no code needed.
const bootstrap = ref(false)
onMounted(async () => {
  bootstrap.value = await fetchBootstrap()
})

// client flow token keying the verification code (email:session); generated once
// per registration attempt.
const session = ref('')
const sendingCode = ref(false)
const cooldown = ref(0)
let cooldownTimer: ReturnType<typeof setInterval> | null = null

function newSession(): string {
  if (import.meta.client && globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

/** Admins go to the panel; viewer-role accounts can only watch, so → /viewer. */
function homeFor(u: SessionUser): string {
  return u.role === 'admin' ? '/' : '/viewer'
}

async function doSendCode(): Promise<void> {
  error.value = ''
  const e = email.value.trim()
  if (!e) {
    error.value = 'Please enter your email first'
    return
  }
  if (!session.value) session.value = newSession()
  sendingCode.value = true
  try {
    const r = await sendCode(e, session.value)
    if (r.bootstrap) {
      bootstrap.value = true
      toast.info('No admin exists yet; the first registration does not require a verification code')
      return
    }
    toast.success('Verification code sent, please check your inbox (valid for 10 minutes)')
    cooldown.value = 60
    cooldownTimer = setInterval(() => {
      cooldown.value -= 1
      if (cooldown.value <= 0 && cooldownTimer) {
        clearInterval(cooldownTimer)
        cooldownTimer = null
      }
    }, 1000)
  } catch (e: any) {
    error.value = e?.data?.statusMessage || e?.message || 'Failed to send verification code'
  } finally {
    sendingCode.value = false
  }
}

async function submit(): Promise<void> {
  error.value = ''
  if (!email.value.trim() || !password.value) {
    error.value = 'Please enter your email and password'
    return
  }
  if (mode.value === 'register' && password.value !== confirm.value) {
    error.value = 'The two passwords do not match'
    return
  }
  if (mode.value === 'register' && !bootstrap.value && !code.value.trim()) {
    error.value = 'Please enter the email verification code'
    return
  }
  loading.value = true
  try {
    const u =
      mode.value === 'login'
        ? await login(email.value.trim(), password.value)
        : await register(email.value.trim(), password.value, code.value.trim(), session.value)
    toast.success(mode.value === 'login' ? 'Signed in successfully' : 'Registered successfully')
    const fallback = homeFor(u)
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : fallback
    // A viewer-role account must never be sent to an admin route.
    await navigateTo(u.role === 'admin' ? redirect : fallback, { replace: true })
  } catch (e: any) {
    error.value = e?.data?.statusMessage || e?.message || (mode.value === 'login' ? 'Sign in failed' : 'Registration failed')
  } finally {
    loading.value = false
  }
}

function switchMode(next: 'login' | 'register'): void {
  mode.value = next
  error.value = ''
  confirm.value = ''
  code.value = ''
}

onUnmounted(() => {
  if (cooldownTimer) clearInterval(cooldownTimer)
})
</script>

<template>
  <div class="login-wrap">
    <form class="login-card card" @submit.prevent="submit">
      <h1>Constrainable Ingest</h1>
      <p class="muted">{{ mode === 'login' ? 'Admin console sign in' : 'Register account' }}</p>

      <div class="tabs">
        <button type="button" :class="{ active: mode === 'login' }" @click="switchMode('login')">Sign in</button>
        <button type="button" :class="{ active: mode === 'register' }" @click="switchMode('register')">Register</button>
      </div>

      <label class="field">
        <span class="field-label">Email</span>
        <input v-model="email" type="email" autocomplete="email" autofocus />
      </label>
      <label class="field">
        <span class="field-label">Password</span>
        <input v-model="password" type="password" autocomplete="current-password" />
      </label>
      <label v-if="mode === 'register'" class="field">
        <span class="field-label">Confirm password</span>
        <input v-model="confirm" type="password" autocomplete="new-password" />
      </label>

      <!-- Two-step verification code (skipped for the bootstrap super-admin). -->
      <div v-if="mode === 'register' && !bootstrap" class="code-row">
        <label class="field code-field">
          <span class="field-label">Email verification code</span>
          <input v-model="code" inputmode="numeric" autocomplete="one-time-code" placeholder="6-digit code" />
        </label>
        <button type="button" class="code-btn" :disabled="sendingCode || cooldown > 0" @click="doSendCode">
          {{ cooldown > 0 ? `${cooldown}s` : sendingCode ? 'Sending…' : 'Get code' }}
        </button>
      </div>

      <p v-if="mode === 'register'" class="hint muted">
        <template v-if="bootstrap">
          No admin exists yet: the first registered user becomes the super admin (no email verification code required). Please use a personal email you can receive mail at.
        </template>
        <template v-else>
          You must first request an email verification code; after registration you become a regular viewer (can only watch live streams).
        </template>
      </p>

      <p v-if="error" class="badge danger">{{ error }}</p>
      <button class="primary" type="submit" :disabled="loading">
        {{ loading ? 'Processing…' : mode === 'login' ? 'Sign in' : 'Register' }}
      </button>
    </form>
  </div>
</template>

<style scoped>
.login-wrap {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}
.login-card {
  width: 100%;
  max-width: 360px;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.login-card h1 { font-size: 1.3rem; margin: 0; }
.login-card .muted { margin: 0 0 0.5rem; font-size: 0.85rem; }
.tabs { display: flex; gap: 0.25rem; }
.tabs button {
  flex: 1;
  padding: 0.4rem;
  font-size: 0.85rem;
  background: transparent;
  color: var(--muted);
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
}
.tabs button.active { color: var(--text); border-color: var(--primary); }
.field { display: flex; flex-direction: column; gap: 0.25rem; }
.field-label { font-size: 0.8rem; color: var(--muted); }
.hint { font-size: 0.78rem; line-height: 1.4; margin: 0; }
.code-row { display: flex; gap: 0.5rem; align-items: flex-end; }
.code-field { flex: 1; }
.code-btn {
  white-space: nowrap;
  padding: 0.45rem 0.75rem;
  font-size: 0.8rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--primary);
  cursor: pointer;
}
.code-btn:disabled { opacity: 0.5; cursor: default; }
button.primary { margin-top: 0.5rem; }
</style>
