<script setup lang="ts">
import type { EventView, EventStatus } from '#shared/event-view'

const toast = useToast()
const { data: events, refresh } = useFetch<EventView[]>('/api/events')
const { user } = useAuth()
const isAdmin = computed(() => user.value?.role === 'admin')

const creating = ref(false)
const saving = ref(false)
const form = reactive({ name: '', slug: '', description: '' })

const statusVariant: Record<EventStatus, 'secondary' | 'warning' | 'success' | 'destructive'> = {
  draft: 'secondary',
  scheduled: 'warning',
  live: 'success',
  ended: 'secondary',
  archived: 'destructive',
}
const statusLabel: Record<EventStatus, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  live: 'Live',
  ended: 'Ended',
  archived: 'Archived',
}

async function create(): Promise<void> {
  if (!form.name.trim()) {
    toast.error('Please fill in the event name')
    return
  }
  saving.value = true
  try {
    await $fetch('/api/events', {
      method: 'POST',
      body: { name: form.name, slug: form.slug || undefined, description: form.description || undefined },
    })
    toast.success('Event created')
    form.name = ''
    form.slug = ''
    form.description = ''
    creating.value = false
    await refresh()
  } catch (e: any) {
    toast.error('Create failed: ' + (e?.data?.statusMessage || e?.message || ''))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div class="space-y-1">
        <h1 class="text-2xl font-semibold">Events</h1>
        <p class="text-muted-foreground">Each event has its own roster, stream keys, and config overrides.</p>
      </div>
      <Button v-if="isAdmin" @click="creating = !creating">
        {{ creating ? 'Cancel' : '+ New event' }}
      </Button>
    </div>

    <Card v-if="creating">
      <CardHeader><CardTitle>New event</CardTitle></CardHeader>
      <CardContent class="space-y-4">
        <div class="grid grid-cols-2 gap-3">
          <div class="space-y-1.5">
            <Label>Name *</Label>
            <Input v-model="form.name" placeholder="e.g. 2026 Regional" />
          </div>
          <div class="space-y-1.5">
            <Label>slug (auto-generated if blank)</Label>
            <Input v-model="form.slug" placeholder="e.g. regional-2026" />
          </div>
          <div class="space-y-1.5 col-span-full">
            <Label>Description</Label>
            <Input v-model="form.description" />
          </div>
        </div>
        <div class="flex justify-end">
          <Button :disabled="saving" @click="create">{{ saving ? 'Creating…' : 'Create' }}</Button>
        </div>
      </CardContent>
    </Card>

    <Card>
      <CardContent class="p-0">
        <Table v-if="events && events.length">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>slug</TableHead>
              <TableHead>Status</TableHead>
              <TableHead class="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="e in events" :key="e.id">
              <TableCell class="font-medium">{{ e.name }}</TableCell>
              <TableCell class="text-muted-foreground">{{ e.slug }}</TableCell>
              <TableCell>
                <Badge :variant="statusVariant[e.status]">{{ statusLabel[e.status] }}</Badge>
              </TableCell>
              <TableCell>
                <Button as-child size="sm">
                  <NuxtLink :to="`/dashboard/events/${e.id}`">{{ isAdmin ? 'Manage' : 'View' }}</NuxtLink>
                </Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <p v-else class="p-6 text-center text-muted-foreground">No events yet.</p>
      </CardContent>
    </Card>
  </div>
</template>
