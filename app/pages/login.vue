<script setup lang="ts">
definePageMeta({ layout: false })

const { login } = useAuth()
const toast = useToast()
const route = useRoute()

const username = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')

async function submit(): Promise<void> {
  error.value = ''
  if (!username.value.trim() || !password.value) {
    error.value = '请输入用户名和密码'
    return
  }
  loading.value = true
  try {
    await login(username.value.trim(), password.value)
    toast.success('登录成功')
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
    await navigateTo(redirect, { replace: true })
  } catch (e: any) {
    error.value = e?.data?.statusMessage || e?.message || '登录失败'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-wrap">
    <form class="login-card card" @submit.prevent="submit">
      <h1>Constrainable Ingest</h1>
      <p class="muted">管理控制台登录</p>
      <label class="field">
        <span class="field-label">用户名</span>
        <input v-model="username" autocomplete="username" autofocus />
      </label>
      <label class="field">
        <span class="field-label">密码</span>
        <input v-model="password" type="password" autocomplete="current-password" />
      </label>
      <p v-if="error" class="badge danger">{{ error }}</p>
      <button class="primary" type="submit" :disabled="loading">
        {{ loading ? '登录中…' : '登录' }}
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
.field { display: flex; flex-direction: column; gap: 0.25rem; }
.field-label { font-size: 0.8rem; color: var(--muted); }
button.primary { margin-top: 0.5rem; }
</style>
