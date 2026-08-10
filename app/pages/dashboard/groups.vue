<script setup lang="ts">
import type { GroupView, InviteLinkView, InviteLinkInput } from '#shared/groups'

definePageMeta({ layout: 'default' })

const toast = useToast()
const { data: groups, refresh: refreshGroups } = await useFetch<GroupView[]>('/api/groups')
const { data: invites, refresh: refreshInvites } = await useFetch<InviteLinkView[]>('/api/invite-links')

async function reloadAll(): Promise<void> {
  await Promise.all([refreshGroups(), refreshInvites()])
}

// --- Group CRUD -----------------------------------------------------------
const newGroupName = ref('')
const newGroupDesc = ref('')
const creatingGroup = ref(false)
async function createGroup(): Promise<void> {
  const name = newGroupName.value.trim()
  if (!name) {
    toast.error('Group name is required')
    return
  }
  creatingGroup.value = true
  try {
    await $fetch('/api/groups', { method: 'POST', body: { name, description: newGroupDesc.value.trim() || null } })
    newGroupName.value = ''
    newGroupDesc.value = ''
    toast.success('Group created')
    await reloadAll()
  } catch (e: any) {
    toast.error('Create failed: ' + (e?.data?.statusMessage || e?.message || ''))
  } finally {
    creatingGroup.value = false
  }
}

// Inline edit state per group id.
const editId = ref<number | null>(null)
const editName = ref('')
const editDesc = ref('')
function startEdit(g: GroupView): void {
  editId.value = g.id
  editName.value = g.name
  editDesc.value = g.description ?? ''
}
function cancelEdit(): void {
  editId.value = null
}
async function saveEdit(g: GroupView): Promise<void> {
  const name = editName.value.trim()
  if (!name) {
    toast.error('Group name is required')
    return
  }
  try {
    await $fetch(`/api/groups/${g.id}`, { method: 'PATCH', body: { name, description: editDesc.value.trim() || null } })
    toast.success('Group updated')
    editId.value = null
    await reloadAll()
  } catch (e: any) {
    toast.error('Update failed: ' + (e?.data?.statusMessage || e?.message || ''))
  }
}
async function removeGroup(g: GroupView): Promise<void> {
  if (!confirm(`Delete group "${g.name}"? This removes it from all events and members.`)) return
  try {
    await $fetch(`/api/groups/${g.id}`, { method: 'DELETE' })
    toast.success('Group deleted')
    await reloadAll()
  } catch (e: any) {
    toast.error('Delete failed: ' + (e?.data?.statusMessage || e?.message || ''))
  }
}

// --- Invite links ---------------------------------------------------------
const inviteGroupId = ref<number | null>(null)
const inviteMaxUses = ref('')
const inviteTtlHours = ref('')
const inviteNote = ref('')
const creatingInvite = ref(false)
// The most recently created invite's shareable URL (code is shown once).
const lastInviteUrl = ref('')

async function createInvite(): Promise<void> {
  const groupId = inviteGroupId.value
  if (!groupId) {
    toast.error('Select a target group')
    return
  }
  const input: InviteLinkInput = { groupId }
  const mu = inviteMaxUses.value.trim()
  if (mu) {
    const n = Number(mu)
    if (!Number.isInteger(n) || n <= 0) {
      toast.error('Max uses must be a positive whole number')
      return
    }
    input.maxUses = n
  }
  const ttl = inviteTtlHours.value.trim()
  if (ttl) {
    const n = Number(ttl)
    if (!Number.isFinite(n) || n <= 0) {
      toast.error('TTL must be a positive number of hours')
      return
    }
    input.ttlHours = n
  }
  const note = inviteNote.value.trim()
  if (note) input.note = note

  creatingInvite.value = true
  try {
    const created = await $fetch<InviteLinkView>('/api/invite-links', { method: 'POST', body: input })
    lastInviteUrl.value = inviteUrl(created.code)
    inviteMaxUses.value = ''
    inviteTtlHours.value = ''
    inviteNote.value = ''
    toast.success('Invite link created')
    await reloadAll()
  } catch (e: any) {
    toast.error('Create failed: ' + (e?.data?.statusMessage || e?.message || ''))
  } finally {
    creatingInvite.value = false
  }
}

function inviteUrl(code: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}/invite?code=${code}`
}
async function copyInvite(url: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url)
    toast.success('Invite link copied')
  } catch {
    toast.error('Copy failed — select and copy manually')
  }
}
async function removeInvite(inv: InviteLinkView): Promise<void> {
  if (!confirm(`Delete invite link for ${inv.groupName}?`)) return
  try {
    await $fetch(`/api/invite-links/${inv.id}`, { method: 'DELETE' })
    toast.success('Invite link deleted')
    await reloadAll()
  } catch (e: any) {
    toast.error('Delete failed: ' + (e?.data?.statusMessage || e?.message || ''))
  }
}

// --- Formatting helpers ---------------------------------------------------
function fmtDate(ms: number): string {
  return new Date(ms).toLocaleString('en-US', { hour12: false })
}
function fmtExpires(ms: number | null): string {
  if (!ms) return 'never'
  const d = new Date(ms)
  return d.toLocaleString('en-US', { hour12: false })
}
function isExpired(ms: number | null): boolean {
  return ms != null && ms < Date.now()
}
</script>

<template>
  <div class="stack">
    <div>
      <h1>Groups &amp; invites</h1>
      <p class="muted">
        Organize users into groups, then restrict events to specific groups. Invite links let new
        registrants or existing users join a group automatically.
      </p>
    </div>

    <!-- Groups -->
    <section class="card">
      <div class="between">
        <h2>Groups</h2>
      </div>
      <table v-if="groups && groups.length">
        <thead>
          <tr><th>Name</th><th>Description</th><th>Members</th><th>Created</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="g in groups" :key="g.id">
            <template v-if="editId === g.id">
              <td><input v-model="editName" /></td>
              <td><input v-model="editDesc" placeholder="optional" /></td>
              <td class="muted">{{ g.memberCount }}</td>
              <td></td>
              <td class="actions">
                <button class="primary" @click="saveEdit(g)">Save</button>
                <button @click="cancelEdit">Cancel</button>
              </td>
            </template>
            <template v-else>
              <td><strong>{{ g.name }}</strong></td>
              <td class="muted">{{ g.description || '—' }}</td>
              <td>{{ g.memberCount }}</td>
              <td class="muted small">{{ fmtDate(g.createdAt) }}</td>
              <td class="actions">
                <button @click="startEdit(g)">Edit</button>
                <button class="danger" @click="removeGroup(g)">Delete</button>
              </td>
            </template>
          </tr>
        </tbody>
      </table>
      <p v-else class="muted empty">No groups yet.</p>

      <div class="create-row">
        <input v-model="newGroupName" placeholder="New group name" @keyup.enter="createGroup" />
        <input v-model="newGroupDesc" placeholder="Description (optional)" />
        <button class="primary" :disabled="creatingGroup" @click="createGroup">
          {{ creatingGroup ? 'Adding…' : 'Add group' }}
        </button>
      </div>
    </section>

    <!-- Invite links -->
    <section class="card">
      <div class="between">
        <h2>Invite links</h2>
      </div>

      <div v-if="lastInviteUrl" class="badge ok invite-banner">
        <span>New link created — copy it now (shown once):</span>
        <code>{{ lastInviteUrl }}</code>
        <button class="linkish" @click="copyInvite(lastInviteUrl)">Copy</button>
      </div>

      <table v-if="invites && invites.length">
        <thead>
          <tr><th>Group</th><th>Uses</th><th>Expires</th><th>State</th><th>Note</th><th>Created</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="inv in invites" :key="inv.id">
            <td><strong>{{ inv.groupName }}</strong></td>
            <td>{{ inv.usedCount }}{{ inv.maxUses != null ? ' / ' + inv.maxUses : ' / ∞' }}</td>
            <td class="muted small">{{ fmtExpires(inv.expiresAt) }}</td>
            <td>
              <span v-if="!inv.active" class="badge danger">inactive</span>
              <span v-else-if="isExpired(inv.expiresAt)" class="badge danger">expired</span>
              <span v-else-if="inv.maxUses != null && inv.usedCount >= inv.maxUses" class="badge warn">exhausted</span>
              <span v-else class="badge ok">active</span>
            </td>
            <td class="muted small">{{ inv.note || '—' }}</td>
            <td class="muted small">{{ fmtDate(inv.createdAt) }}</td>
            <td class="actions">
              <button class="linkish" @click="copyInvite(inviteUrl(inv.code))">Copy link</button>
              <button class="danger" @click="removeInvite(inv)">Delete</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="muted empty">No invite links yet.</p>

      <div class="create-grid" v-if="groups && groups.length">
        <label class="field">
          <span class="field-label">Target group</span>
          <select v-model="inviteGroupId">
            <option :value="null" disabled>Select a group…</option>
            <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }}</option>
          </select>
        </label>
        <label class="field">
          <span class="field-label">Max uses (blank = unlimited)</span>
          <input v-model="inviteMaxUses" inputmode="numeric" placeholder="∞" />
        </label>
        <label class="field">
          <span class="field-label">Expires in (hours, blank = never)</span>
          <input v-model="inviteTtlHours" inputmode="decimal" placeholder="24" />
        </label>
        <label class="field">
          <span class="field-label">Note (optional)</span>
          <input v-model="inviteNote" placeholder="e.g. Spring cohort" />
        </label>
        <div class="create-actions">
          <button class="primary" :disabled="creatingInvite" @click="createInvite">
            {{ creatingInvite ? 'Creating…' : 'Create invite link' }}
          </button>
        </div>
      </div>
      <p v-else class="muted small">Create a group first before generating invite links.</p>
    </section>
  </div>
</template>

<style scoped>
.create-row { display: flex; gap: 0.5rem; margin-top: 1rem; flex-wrap: wrap; }
.create-row input { flex: 1 1 180px; }
.create-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.75rem; margin-top: 1rem; align-items: end; }
.create-actions { grid-column: 1 / -1; }
.field { display: flex; flex-direction: column; gap: 0.25rem; }
.field-label { font-size: 0.78rem; color: var(--muted); }
.actions { display: flex; gap: 0.4rem; justify-content: flex-end; }
.linkish { background: none; border: none; color: var(--primary); cursor: pointer; font-size: 0.78rem; padding: 0; }
.invite-banner { display: flex; flex-direction: column; gap: 0.35rem; margin-bottom: 1rem; align-items: flex-start; }
.invite-banner code { word-break: break-all; font-size: 0.82rem; }
.small { font-size: 0.78rem; }
.empty { padding: 1.5rem; text-align: center; }
</style>
