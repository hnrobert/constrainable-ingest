<script setup lang="ts">
import type { EventView, EventStatus } from '#shared/event-view'

const toast = useToast()
const { data: events, refresh } = await useFetch<EventView[]>('/api/events')

const creating = ref(false)
const saving = ref(false)
const form = reactive({ name: '', slug: '', description: '' })

const statusClass: Record<EventStatus, string> = {
  draft: 'muted',
  scheduled: 'warn',
  live: 'ok',
  ended: 'muted',
  archived: 'danger',
}
const statusLabel: Record<EventStatus, string> = {
  draft: '草稿',
  scheduled: '待开始',
  live: '进行中',
  ended: '已结束',
  archived: '已归档',
}

async function create(): Promise<void> {
  if (!form.name.trim()) {
    toast.error('请填写赛事名称')
    return
  }
  saving.value = true
  try {
    await $fetch('/api/events', {
      method: 'POST',
      body: { name: form.name, slug: form.slug || undefined, description: form.description || undefined },
    })
    toast.success('赛事已创建')
    form.name = ''
    form.slug = ''
    form.description = ''
    creating.value = false
    await refresh()
  } catch (e: any) {
    toast.error('创建失败：' + (e?.data?.statusMessage || e?.message || ''))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="stack">
    <div class="between">
      <div>
        <h1>赛事</h1>
        <p class="muted">每场赛事有独立名单、推流密钥与配置覆盖。</p>
      </div>
      <button class="primary" @click="creating = !creating">
        {{ creating ? '取消' : '＋ 新建赛事' }}
      </button>
    </div>

    <section v-if="creating" class="card">
      <h2>新建赛事</h2>
      <div class="form-grid">
        <label class="field">
          <span class="field-label">名称 *</span>
          <input v-model="form.name" placeholder="例如：2026 区域赛" />
        </label>
        <label class="field">
          <span class="field-label">slug（留空自动生成）</span>
          <input v-model="form.slug" placeholder="例如：regional-2026" />
        </label>
        <label class="field full">
          <span class="field-label">描述</span>
          <input v-model="form.description" />
        </label>
      </div>
      <div class="row right">
        <button class="primary" :disabled="saving" @click="create">{{ saving ? '创建中…' : '创建' }}</button>
      </div>
    </section>

    <section class="card">
      <table>
        <thead>
          <tr><th>名称</th><th>slug</th><th>状态</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="e in events" :key="e.id">
            <td>{{ e.name }}</td>
            <td class="muted">{{ e.slug }}</td>
            <td><span class="badge" :class="statusClass[e.status]">{{ statusLabel[e.status] }}</span></td>
            <td><NuxtLink :to="`/events/${e.id}`"><button>管理</button></NuxtLink></td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<style scoped>
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
.field { display: flex; flex-direction: column; gap: 0.25rem; }
.field.full { grid-column: 1 / -1; }
.field-label { font-size: 0.8rem; color: var(--muted); }
.right { justify-content: flex-end; margin-top: 0.75rem; }
</style>
