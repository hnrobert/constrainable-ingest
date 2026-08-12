<script setup lang="ts">
import type { UserWithGroupsView, GroupView } from '#shared/groups'
import type { DataTableColumn } from '~/components/DataTable.vue'

definePageMeta({ layout: 'default' })

const toast = useToast()
const confirm = useConfirm()
const { data: users, refresh } = useFetch<UserWithGroupsView[]>('/api/users')
const { data: groups } = useFetch<GroupView[]>('/api/groups')

// Editable per-user working copies (role + selected group ids), populated
// lazily on first edit. The template reads the live user values as a fallback
// when no draft exists yet (roleOf/inGroup), so rendering never depends on a
// watcher having run first — SSR-safe even though the users list resolves
// asynchronously after setup.
const draft = ref<Record<number, { role: 'admin' | 'user'; groupIds: number[] }>>({})
function ensureDraft(u: UserWithGroupsView): void {
  if (!draft.value[u.id]) {
    draft.value[u.id] = { role: u.role, groupIds: u.groups.map((g) => g.id) }
  }
}
function roleOf(u: UserWithGroupsView): 'admin' | 'user' {
  return draft.value[u.id]?.role ?? u.role
}
function inGroup(u: UserWithGroupsView, groupId: number): boolean {
  const d = draft.value[u.id]
  return d ? d.groupIds.includes(groupId) : u.groups.some((g) => g.id === groupId)
}
function setRole(u: UserWithGroupsView, role: unknown): void {
  ensureDraft(u)
  if (role === 'admin' || role === 'user') draft.value[u.id]!.role = role
}
function toggleGroup(u: UserWithGroupsView, groupId: number): void {
  ensureDraft(u)
  const d = draft.value[u.id]!
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

function toggleRole(u: UserWithGroupsView): void {
  const next = u.role === 'admin' ? 'user' : 'admin'
  const apply = async () => {
    try {
      await $fetch(`/api/users/${u.id}`, { method: 'PATCH', body: { role: next } })
      toast.success(`${u.email} is now ${next}`)
      await refresh()
    } catch (e: any) {
      toast.error('Role change failed: ' + (e?.data?.statusMessage || e?.message || ''))
    }
  }
  if (next === 'admin') {
    confirm.ask(`Promote ${u.email} to admin?`, apply, { actionLabel: 'Promote' })
  } else {
    apply()
  }
}

const columns: DataTableColumn[] = [
  { key: 'email', header: 'Email', class: 'font-medium' },
  { key: 'role', header: 'Role' },
  { key: 'groups', header: 'Groups' },
  { key: 'createdAt', header: 'Created' },
  { key: 'actions', header: '', headClass: 'w-0' },
]
</script>

<template>
  <div class="space-y-6">
    <div class="space-y-1">
      <h1 class="text-2xl font-semibold">Users</h1>
      <p class="text-muted-foreground">Manage roles and group membership. The first registered account is the super admin.</p>
    </div>

    <Card>
      <CardContent>
        <DataTable
          :columns="columns"
          :rows="users ?? []"
          :row-key="(u: UserWithGroupsView) => u.id"
          empty="No users yet."
        >
          <template #cell-role="{ row }">
            <div class="flex items-center gap-2">
              <Select
                :model-value="roleOf(row)"
                :disabled="saving === row.id"
                @update:model-value="setRole(row, $event)"
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">user</SelectItem>
                  <SelectItem value="admin">admin</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="link" class="h-auto p-0 text-xs" @click="toggleRole(row)">flip</Button>
            </div>
          </template>
          <template #cell-groups="{ row }">
            <div class="flex max-w-[320px] flex-col gap-1">
              <label v-for="g in groups" :key="g.id" class="flex items-center gap-1.5 text-xs">
                <Checkbox
                  :model-value="inGroup(row, g.id)"
                  :disabled="saving === row.id"
                  @update:model-value="toggleGroup(row, g.id)"
                />
                <span>{{ g.name }}</span>
              </label>
              <span v-if="!groups || !groups.length" class="text-xs text-muted-foreground">No groups defined.</span>
            </div>
          </template>
          <template #cell-createdAt="{ row }">
            <span class="text-xs text-muted-foreground">{{ new Date(row.createdAt).toLocaleDateString('en-US') }}</span>
          </template>
          <template #cell-actions="{ row }">
            <Button size="sm" :disabled="!dirty(row) || saving === row.id" @click="save(row)">
              {{ saving === row.id ? 'Saving…' : 'Save' }}
            </Button>
          </template>
        </DataTable>
      </CardContent>
    </Card>

    <ConfirmDialog
      v-model:open="confirm.state.open"
      :message="confirm.state.message"
      :action-label="confirm.state.actionLabel"
      :destructive="confirm.state.destructive"
      @accept="confirm.accept"
    />
  </div>
</template>
