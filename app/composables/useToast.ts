/**
 * Minimal global toast store. Shared across components via module state.
 * Used for save/error feedback throughout the admin UI.
 */
import { reactive } from 'vue'

export type ToastType = 'info' | 'success' | 'error'

export interface Toast {
  id: number
  message: string
  type: ToastType
}

const toasts = reactive<Toast[]>([])
let nextId = 1

function remove(id: number): void {
  const i = toasts.findIndex((t) => t.id === id)
  if (i >= 0) toasts.splice(i, 1)
}

function push(message: string, type: ToastType = 'info', timeout = 3500): void {
  const id = nextId++
  toasts.push({ id, message, type })
  if (timeout) setTimeout(() => remove(id), timeout)
}

export function useToast() {
  return {
    toasts,
    remove,
    info: (m: string) => push(m, 'info'),
    success: (m: string) => push(m, 'success'),
    error: (m: string, timeout = 6000) => push(m, 'error', timeout),
  }
}
