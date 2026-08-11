<script setup lang="ts">
import type { EventView, EventStatus } from '#shared/event-view'

definePageMeta({ layout: 'public' })

const { user } = useAuth()
// No top-level `await`: keeps this a SYNCHRONOUS component (no <Suspense>
// boundary). An async (suspensing) page rendered through the layout's <slot/>
// triggered a client-side `renderSlot` with no active rendering instance on
// hydration (`null is not an object: currentRenderingInstance.ce`). Nuxt's SSR
// renderer still awaits the registered useFetch promise, so the data is
// populated server-side and serialized into the payload.
const { data: events } = useFetch<EventView[]>('/api/events/public')

const statusLabel: Record<EventStatus, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  live: 'Live now',
  ended: 'Ended',
  archived: 'Archived',
}
const statusVariant: Record<EventStatus, 'secondary' | 'warning' | 'success' | 'destructive'> = {
  draft: 'secondary',
  scheduled: 'warning',
  live: 'success',
  ended: 'secondary',
  archived: 'destructive',
}

function when(e: EventView): string {
  if (!e.startsAt) return '—'
  const s = new Date(e.startsAt).toLocaleString('en-US', { hour12: false })
  if (!e.endsAt) return s
  return `${s} → ${new Date(e.endsAt).toLocaleString('en-US', { hour12: false })}`
}
</script>

<template>
  <div class="space-y-6">
    <section class="space-y-3">
      <h1 class="text-3xl font-bold tracking-tight">Constrainable Ingest</h1>
      <p class="max-w-2xl leading-relaxed text-muted-foreground">
        ICPC proctoring stream ingest and event management. Browse public events
        below, or sign in to access your schedule and details.
      </p>
      <div>
        <Button as-child>
          <NuxtLink v-if="user" to="/dashboard">Go to dashboard</NuxtLink>
          <NuxtLink v-else to="/login">Sign in / Register</NuxtLink>
        </Button>
      </div>
    </section>

    <Card>
      <CardHeader><CardTitle>Public events</CardTitle></CardHeader>
      <CardContent>
        <p v-if="!events || !events.length" class="p-6 text-center text-muted-foreground">
          No public events right now. Check back later.
        </p>
        <Table v-else>
          <TableHeader>
            <TableRow>
              <TableHead>Event</TableHead>
              <TableHead>When</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="e in events" :key="e.id">
              <TableCell>
                <div class="font-medium">{{ e.name }}</div>
                <div v-if="e.description" class="text-xs text-muted-foreground">{{ e.description }}</div>
              </TableCell>
              <TableCell class="text-muted-foreground">{{ when(e) }}</TableCell>
              <TableCell><Badge :variant="statusVariant[e.status]">{{ statusLabel[e.status] }}</Badge></TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  </div>
</template>
