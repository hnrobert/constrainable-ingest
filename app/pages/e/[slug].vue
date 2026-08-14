<script setup lang="ts">
/**
 * Participant push-streaming guide for one event, keyed by slug. Identical for
 * every viewer of the same event. The organizer's shared publish key is shown in
 * full; each contestant pastes it as the `?token=` part of the OBS stream key and
 * uses their OWN account email as the stream name (unique per person, so the
 * whole class can stream concurrently with one shared key).
 */
import type { EventGuide } from '#shared/event-view'

definePageMeta({ layout: 'public' })

const route = useRoute()
const slug = computed(() => String(route.params.slug ?? ''))
const { user } = useAuth()
const toast = useToast()

// No top-level await: keeps this a sync component (avoids the Suspense/hydration
// pitfall documented on index.vue / dashboard/events/[id].vue).
const { data: guide, error: fetchError } = useFetch<EventGuide>(
  () => `/api/events/slug/${slug.value}/guide`,
)

const statusCode = computed(
  () => (fetchError.value as { statusCode?: number } | null)?.statusCode,
)
const notFound = computed(() => statusCode.value === 404)
const unauthorized = computed(() => statusCode.value === 403)

const publishKey = computed(() => guide.value?.publishKey ?? null)
const email = computed(() => user.value?.email ?? null)
/** ready-to-paste key when the viewer is signed in */
const myStreamKey = computed(() =>
  email.value && publishKey.value ? `${email.value}?token=${publishKey.value}` : null,
)
/** template shown to everyone (placeholder for the account email) */
const streamKeyTemplate = computed(() =>
  publishKey.value ? `<your-account-email>?token=${publishKey.value}` : null,
)
/** whichever stream key to render/copy in the current state */
const displayStreamKey = computed(() => myStreamKey.value ?? streamKeyTemplate.value)

const ffmpegCmd = computed(
  () => `ffmpeg -re -i your-video.mp4 -c copy -f flv "${displayStreamKey.value ?? ''}"`,
)

async function copy(text: string, label = 'Copied'): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(label)
  } catch {
    toast.error('Copy failed, please copy manually')
  }
}

function fmt(ts: number | null): string {
  return ts ? new Date(ts).toLocaleString() : ''
}
</script>

<template>
  <div class="space-y-6">
    <!-- not found / draft / archived -->
    <Card v-if="notFound">
      <CardHeader><CardTitle>Event not found</CardTitle></CardHeader>
      <CardContent class="space-y-3">
        <p class="text-sm text-muted-foreground">This event doesn't exist or isn't available.</p>
        <Button as-child variant="link" class="h-auto p-0"><NuxtLink to="/">Back to home</NuxtLink></Button>
      </CardContent>
    </Card>

    <!-- registered/groups event the viewer can't see -->
    <Card v-else-if="unauthorized">
      <CardHeader><CardTitle>Sign in required</CardTitle></CardHeader>
      <CardContent class="space-y-3">
        <p class="text-sm text-muted-foreground">
          You need to sign in to view this event's streaming guide.
        </p>
        <Button as-child><NuxtLink to="/login">Sign in</NuxtLink></Button>
      </CardContent>
    </Card>

    <template v-else-if="guide">
      <div class="space-y-1">
        <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Push-streaming guide
        </p>
        <h1 class="text-2xl font-semibold tracking-tight">{{ guide.name }}</h1>
      </div>

      <!-- organizer hasn't published a key yet -->
      <Card v-if="!publishKey">
        <CardContent class="pt-6 text-sm text-muted-foreground">
          The organizer hasn't published a stream key for this event yet. Check back later.
        </CardContent>
      </Card>

      <template v-else>
        <!-- OBS connection -->
        <Card>
          <CardHeader><CardTitle>OBS connection</CardTitle></CardHeader>
          <CardContent class="space-y-4">
            <div class="space-y-1.5">
              <Label>Server</Label>
              <div class="flex items-center gap-2">
                <code class="font-mono text-sm">{{ guide.server }}</code>
                <Button variant="link" class="h-auto p-0 text-xs" @click="copy(guide.server, 'Copied server address')">Copy</Button>
              </div>
            </div>

            <div class="space-y-1.5">
              <Label>Stream key</Label>
              <div class="flex flex-wrap items-center gap-2">
                <code class="break-all font-mono text-sm">{{ displayStreamKey }}</code>
                <Button variant="link" class="h-auto p-0 text-xs" @click="copy(displayStreamKey ?? '', 'Copied stream key')">Copy</Button>
              </div>
              <p v-if="myStreamKey" class="text-xs text-muted-foreground">
                This uses your account email (<code>{{ email }}</code>) as the stream name.
              </p>
              <p v-else class="text-xs text-muted-foreground">
                Replace <code>&lt;your-account-email&gt;</code> with the email you signed up with — each
                contestant uses their own email as the stream name, so everyone can stream at the same time.
              </p>
            </div>
          </CardContent>
        </Card>

        <!-- recommended output settings -->
        <Card>
          <CardHeader><CardTitle>Recommended output settings</CardTitle></CardHeader>
          <CardContent>
            <ul class="space-y-1.5 text-sm text-muted-foreground">
              <li>Resolution: up to <code>{{ guide.limits.maxWidth }}×{{ guide.limits.maxHeight }}</code></li>
              <li>Frame rate: up to <code>{{ guide.limits.maxFps }} fps</code></li>
              <li>Video bitrate: up to <code>{{ guide.limits.maxBitrateKbps }} kbps</code></li>
            </ul>
            <p class="mt-3 text-xs text-muted-foreground">
              Streams that exceed these limits are flagged and may be disconnected. Set your canvas FPS to
              at least 2 (30 recommended) — a 1 FPS canvas fails to connect.
            </p>
          </CardContent>
        </Card>

        <!-- time window -->
        <Card v-if="guide.startsAt || guide.endsAt">
          <CardHeader><CardTitle>When you can stream</CardTitle></CardHeader>
          <CardContent class="space-y-1 text-sm text-muted-foreground">
            <p v-if="guide.startsAt">Opens: {{ fmt(guide.startsAt) }}</p>
            <p v-if="guide.endsAt">Closes: {{ fmt(guide.endsAt) }}</p>
            <p class="pt-1 text-xs">Publishing is rejected outside this window.</p>
          </CardContent>
        </Card>

        <!-- organizer's custom instructions -->
        <Card v-if="guide.streamGuide">
          <CardHeader><CardTitle>Notes from the organizer</CardTitle></CardHeader>
          <CardContent>
            <p class="whitespace-pre-wrap text-sm">{{ guide.streamGuide }}</p>
          </CardContent>
        </Card>

        <!-- step by step -->
        <Card>
          <CardHeader><CardTitle>Setup steps (OBS Studio)</CardTitle></CardHeader>
          <CardContent>
            <ol class="list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
              <li>Open OBS Studio → <strong>Settings → Stream</strong>.</li>
              <li>Set <strong>Service</strong> to <em>Custom…</em> and paste the <strong>Server</strong> above.</li>
              <li>Paste your <strong>Stream key</strong> above.</li>
              <li>In <strong>Settings → Video / Output</strong>, keep resolution, FPS, and bitrate within the recommended values.</li>
              <li>Click <strong>Start Streaming</strong>. Your stream appears once it connects.</li>
            </ol>
          </CardContent>
        </Card>

        <!-- ffmpeg alternative -->
        <Card>
          <CardHeader><CardTitle>Alternative: ffmpeg</CardTitle></CardHeader>
          <CardContent class="space-y-2">
            <p class="text-xs text-muted-foreground">If you prefer the command line:</p>
            <pre class="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs"><code>{{ ffmpegCmd }}</code></pre>
            <Button variant="link" class="h-auto p-0 text-xs" @click="copy(ffmpegCmd, 'Copied ffmpeg command')">Copy</Button>
          </CardContent>
        </Card>
      </template>
    </template>
  </div>
</template>
