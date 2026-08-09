<script setup lang="ts">
import type { RecordingView } from '#shared/recordings'

const props = defineProps<{ recording: RecordingView }>()
const emit = defineEmits<{ deleted: [id: number] }>()
const toast = useToast()

const src = computed(() => `/api/recordings/${props.recording.id}/file`)
const downloadUrl = computed(() => `/api/recordings/${props.recording.id}/file?download`)
const removing = ref(false)

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

async function remove(): Promise<void> {
  if (!confirm(`删除录像「${props.recording.streamName}」？文件也会被删除。`)) return
  removing.value = true
  try {
    await $fetch(`/api/recordings/${props.recording.id}`, { method: 'DELETE' })
    toast.success('已删除录像')
    emit('deleted', props.recording.id)
  } catch (e: any) {
    toast.error('删除失败：' + (e?.data?.statusMessage || e?.message || ''))
  } finally {
    removing.value = false
  }
}
</script>

<template>
  <div class="player card">
    <video controls preload="metadata" :src="src" />
    <div class="between meta">
      <div>
        <strong>{{ recording.streamName }}</strong>
        <span v-if="recording.studentLabel" class="muted"> · {{ recording.studentLabel }}</span>
        <div class="muted small">
          {{ fmtSize(recording.sizeBytes) }}
          <span v-if="recording.width && recording.height"> · {{ recording.width }}×{{ recording.height }}</span>
          · {{ new Date(recording.startedAt).toLocaleString('zh-CN', { hour12: false }) }}
        </div>
      </div>
      <div class="row">
        <a class="btn-link" :href="downloadUrl" target="_blank">下载</a>
        <button class="danger" :disabled="removing" @click="remove">
          {{ removing ? '删除中…' : '删除' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.player video { width: 100%; border-radius: 8px; background: #000; max-height: 60vh; }
.meta { margin-top: 0.75rem; }
.small { font-size: 0.78rem; }
.btn-link {
  display: inline-block;
  padding: 0.4rem 0.8rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  font-size: 0.875rem;
}
.btn-link:hover { border-color: var(--primary); }
</style>
