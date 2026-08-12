<script setup lang="ts">
/**
 * Shared labelled field row for the config/mail cards. Every field — Input,
 * Select, Checkbox, Textarea — renders as Label → control band → optional
 * hint, so rows share one vertical rhythm instead of the previous two ad-hoc
 * patterns (label-over-input vs. inline-checkbox) whose heights never matched.
 *
 * The control band is `min-h-9` + `items-center`: an h-9 Input/Select fills it
 * exactly, while a lone size-4 Checkbox centers in the same 36px, so a bool
 * row ends up the same height as its input neighbours. Textareas legitimately
 * exceed it (multi-line).
 */
defineProps<{ label?: string; hint?: string }>()
</script>

<template>
  <div class="space-y-1.5">
    <Label v-if="label">{{ label }}</Label>
    <div class="flex min-h-9 items-center gap-2">
      <slot />
    </div>
    <!-- plain string hint via prop, or rich markup (e.g. <code>) via #hint -->
    <p v-if="hint || $slots.hint" class="text-xs text-muted-foreground">
      <template v-if="$slots.hint"><slot name="hint" /></template>
      <template v-else>{{ hint }}</template>
    </p>
  </div>
</template>
