<script setup lang="ts">
import type { SessionUser } from '~/composables/useAuth'

definePageMeta({ layout: false })

const { login, register } = useAuth()
const toast = useToast()
const route = useRoute()

const mode = ref<'login' | 'register'>('login')
const username = ref('')
const password = ref('')
const confirm = ref('')
const loading = ref(false)
const error = ref('')

/** Admins go to the panel; viewer-role accounts can only watch, so → /viewer. */
function homeFor(u: SessionUser): string {
  return u.role === 'admin' ? '/' : '/viewer'
}

async function submit(): Promise<void> {
  error.value = ''
  if (!username.value.trim() || !password.value) {
    error.value = '请输入用户名和密码'
    return
  }
  if (mode.value === 'register' && password.value !== confirm.value) {
    error.value = '两次输入的密码不一致'
    return
  }
  loading.value = true
  try {
    const u =
      mode.value === 'login'
        ? await login(username.value.trim(), password.value)
        : await register(username.value.trim(), password.value)
    toast.success(mode.value === 'login' ? '登录成功' : '注册成功')
    const fallback = homeFor(u)
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : fallback
    // A viewer-role account must never be sent to an admin route.
    await navigateTo(u.role === 'admin' ? redirect : fallback, { replace: true })
  } catch (e: any) {
    error.value = e?.data?.statusMessage || e?.message || (mode.value === 'login' ? '登录失败' : '注册失败')
  } finally {
    loading.value = false
  }
}

function switchMode(next: 'login' | 'register'): void {
  mode.value = next
  error.value = ''
  confirm.value = ''
}
</script>

<template>
  <div class="login-wrap">
    <form class="login-card card" @submit.prevent="submit">
      <h1>Constrainable Ingest</h1>
      <p class="muted">{{ mode === 'login' ? '管理控制台登录' : '注册账号' }}</p>

      <div class="tabs">
        <button type="button" :class="{ active: mode === 'login' }" @click="switchMode('login')">登录</button>
        <button type="button" :class="{ active: mode === 'register' }" @click="switchMode('register')">注册</button>
      </div>

      <label class="field">
        <span class="field-label">用户名</span>
        <input v-model="username" autocomplete="username" autofocus />
      </label>
      <label class="field">
        <span class="field-label">密码</span>
        <input v-model="password" type="password" autocomplete="current-password" />
      </label>
      <label v-if="mode === 'register'" class="field">
        <span class="field-label">确认密码</span>
        <input v-model="confirm" type="password" autocomplete="new-password" />
      </label>

      <p v-if="mode === 'register'" class="hint muted">
        首位注册用户将成为超级管理员；之后注册的用户为普通观看者（仅可观看直播）。
      </p>

      <p v-if="error" class="badge danger">{{ error }}</p>
      <button class="primary" type="submit" :disabled="loading">
        {{ loading ? '处理中…' : mode === 'login' ? '登录' : '注册' }}
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
button.primary { margin-top: 0.5rem; }
</style>
