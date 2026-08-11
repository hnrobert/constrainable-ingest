<script setup lang="ts">
import type { UserWithGroupsView, GroupView } from '#shared/groups'

definePageMeta({ layout: 'default' })

const toast = useToast()
const confirm = useConfirm()
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
</script>

<template>
  <div class="space-y-6">
    <div class="space-y-1">
      <h1 class="text-2xl font-semibold">Users</h1>
      <p class="text-muted-foreground">Manage roles and group membership. The first registered account is the super admin.</p>
    </div>

    <Card>
      <CardContent>
        <Table v-if="users && users.length">
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Groups</TableHead>
              <TableHead>Created</TableHead>
              <TableHead class="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="u in users" :key="u.id">
              <TableCell class="font-medium">{{ u.email }}</TableCell>
              <TableCell>
                <div class="flex items-center gap-2">
                  <Select v-model="draft[u.id]!.role" :disabled="saving === u.id">
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">user</SelectItem>
                      <SelectItem value="admin">admin</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="link" class="h-auto p-0 text-xs" @click="toggleRole(u)">flip</Button>
                </div>
              </TableCell>
              <TableCell>
                <div class="flex max-w-[320px] flex-col gap-1">
                  <label v-for="g in groups" :key="g.id" class="flex items-center gap-1.5 text-xs">
                    <Checkbox
                      :model-value="inGroup(u.id, g.id)"
                      :disabled="saving === u.id"
                      @update:model-value="toggleGroup(u.id, g.id)"
                    />
                    <span>{{ g.name }}</span>
                  </label>
                  <span v-if="!groups || !groups.length" class="text-xs text-muted-foreground">No groups defined.</span>
                </div>
              </TableCell>
              <TableCell class="text-xs text-muted-foreground">{{ new Date(u.createdAt).toLocaleDateString('en-US') }}</TableCell>
              <TableCell>
                <Button size="sm" :disabled="!dirty(u) || saving === u.id" @click="save(u)">
                  {{ saving === u.id ? 'Saving…' : 'Save' }}
                </Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <p v-else class="p-6 text-center text-muted-foreground">No users yet.</p>
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
