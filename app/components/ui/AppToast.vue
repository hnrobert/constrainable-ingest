<script setup lang="ts">
const { toasts, remove } = useToast()
</script>

<template>
  <div class="toast-wrap" aria-live="polite">
    <div
      v-for="t in toasts"
      :key="t.id"
      class="toast"
      :class="t.type"
      @click="remove(t.id)"
    >
      {{ t.message }}
    </div>
  </div>
</template>

<style scoped>
.toast-wrap {
  position: fixed;
  top: 1rem;
  right: 1rem;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-width: 22rem;
}
.toast {
  padding: 0.6rem 0.9rem;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--panel-2);
  font-size: 0.85rem;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
}
.toast.success { border-color: var(--ok); color: var(--ok); }
.toast.error { border-color: var(--danger); color: var(--danger); }
.toast.info { border-color: var(--primary); color: var(--primary); }
</style>
