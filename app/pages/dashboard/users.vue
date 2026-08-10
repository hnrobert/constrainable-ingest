<script setup lang="ts">
import type { UserWithGroupsView, GroupView } from '#shared/groups'

definePageMeta({ layout: 'default' })

const toast = useToast()
const { data: users, refresh } = await useFetch<UserWithGroupsView[]>('/api/users')
const { data: groups } = await useFetch<GroupView[]>('/api/groups')

// Editable per-user working copies (role + selected group ids).
const draft = ref<Record<number, { role: 'admin' | 'user'; groupIds: number[] }>>({})
function ensureDraft(u: UserWithGroupsView): void {
  if (!draft.value[u.id]) {
    draft.value[u.id] = { role: u.role, groupIds: u.groups.map((g) => g.id) }
  }
}
watchEffect(() => {
  for (const u of users.value ?? []) ensureDraft(u)
})

function inGroup(userId: number, groupId: number): boolean {
  return draft.value[userId]?.groupIds.includes(groupId) ?? false
}
function toggleGroup(userId: number, groupId: number): void {
  const d = draft.value[userId]
  if (!d) return
  const i = d.groupIds.indexOf(groupId)
  if (i >= 0) d.groupIds.splice(i, 1)
  else d.groupIds.push(groupId)
}

function dirty(u: UserWithGroupsView): boolean {
  const d = draft.value[u.id]
  if (!d) return false
  if (d.role !== u.role) return true
  return d.groupIds.slice().sort().join(',') !== u.groups.map((g) => g.id).sort().join(',')
}

const saving = ref<number | null>(null)
async function save(u: UserWithGroupsView): Promise<void> {
  const d = draft.value[u.id]
  if (!d) return
  saving.value = u.id
  try {
    await $fetch(`/api/users/${u.id}`, { method: 'PATCH', body: { role: d.role, groupIds: d.groupIds } })
    toast.success(`Updated ${u.email}`)
    await refresh()
  } catch (e: any) {
    toast.error('Save failed: ' + (e?.data?.statusMessage || e?.message || ''))
  } finally {
    saving.value = null
  }
}

async function toggleRole(u: UserWithGroupsView): Promise<void> {
  const next = u.role === 'admin' ? 'user' : 'admin'
  if (next === 'admin' && !confirm(`Promote ${u.email} to admin?`)) return
  try {
    await $fetch(`/api/users/${u.id}`, { method: 'PATCH', body: { role: next } })
    toast.success(`${u.email} is now ${next}`)
    await refresh()
  } catch (e: any) {
    toast.error('Role change failed: ' + (e?.data?.statusMessage || e?.message || ''))
  }
}
</script>

<template>
  <div class="stack">
    <div>
      <h1>Users</h1>
      <p class="muted">Manage roles and group membership. The first registered account is the super admin.</p>
    </div>

    <section class="card">
      <table>
        <thead>
          <tr><th>Email</th><th>Role</th><th>Groups</th><th>Created</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="u in users" :key="u.id">
            <td>{{ u.email }}</td>
            <td>
              <select v-model="draft[u.id]!.role" :disabled="saving === u.id">
                <option value="user">user</option>
                <option value="admin">admin</option>
              </select>
              <button class="linkish" @click="toggleRole(u)">flip</button>
            </td>
            <td class="groups-cell">
              <div class="group-checks">
                <label v-for="g in groups" :key="g.id" class="group-check">
                  <input
                    type="checkbox"
                    :checked="inGroup(u.id, g.id)"
                    :disabled="saving === u.id"
                    @change="toggleGroup(u.id, g.id)"
                  />
                  <span>{{ g.name }}</span>
                </label>
                <span v-if="!groups || !groups.length" class="muted small">No groups defined.</span>
              </div>
            </td>
            <td class="muted small">{{ new Date(u.createdAt).toLocaleDateString('en-US') }}</td>
            <td>
              <button class="primary" :disabled="!dirty(u) || saving === u.id" @click="save(u)">
                {{ saving === u.id ? 'Saving…' : 'Save' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!users || !users.length" class="muted empty">No users yet.</p>
    </section>
  </div>
</template>

<style scoped>
.groups-cell { max-width: 320px; }
.group-checks { display: flex; flex-direction: column; gap: 0.2rem; }
.group-check { display: flex; align-items: center; gap: 0.4rem; font-size: 0.82rem; }
.group-check input { width: auto; }
.linkish { background: none; border: none; color: var(--primary); cursor: pointer; font-size: 0.75rem; padding: 0 0.25rem; }
.small { font-size: 0.78rem; }
.empty { padding: 1.5rem; text-align: center; }
</style>
