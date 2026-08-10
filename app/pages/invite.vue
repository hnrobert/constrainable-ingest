<script setup lang="ts">
import { setPendingInvite } from '~/composables/useAuth'

definePageMeta({ layout: 'public' })

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { user } = useAuth()

const code = computed(() => (typeof route.query.code === 'string' ? route.query.code.trim() : ''))

// If there's no code at all, this isn't a real invite visit — bounce home.
onMounted(() => {
  if (!code.value) {
    router.replace('/')
  }
})

// Unauthenticated visitors: stash the code and send them to register/login.
// The composable re-attaches it on register(); existing users can also claim
// from the dashboard, but the primary invite path is sign-in → claim.
const claiming = ref(false)
const joined = ref<{ groupId: number; groupName: string } | null>(null)

async function claim(): Promise<void> {
  if (!code.value || claiming.value) return
  claiming.value = true
  try {
    const res = await $fetch<{ ok: true; groupId: number; groupName: string }>(
      `/api/invite-links/${encodeURIComponent(code.value)}/claim`,
      { method: 'POST' },
    )
    joined.value = { groupId: res.groupId, groupName: res.groupName }
    toast.success(`You joined ${res.groupName}`)
  } catch (e: any) {
    toast.error('Invite is invalid or expired')
  } finally {
    claiming.value = false
  }
}

function goSignIn(): void {
  if (code.value) setPendingInvite(code.value)
  router.push({ path: '/login', query: code.value ? { invite: code.value } : undefined })
}
</script>

<template>
  <section class="invite">
    <div v-if="!code" class="card">
      <p class="muted">No invite code provided.</p>
    </div>

    <!-- Already joined (or already a member — idempotent success). -->
    <div v-else-if="joined" class="card success">
      <h1>You're in 🎉</h1>
      <p>You joined the group <strong>{{ joined.groupName }}</strong>.</p>
      <p class="muted">Events restricted to this group will now appear on your dashboard.</p>
      <NuxtLink to="/dashboard" class="primary">Go to dashboard</NuxtLink>
    </div>

    <!-- Logged-in user: claim directly. -->
    <div v-else-if="user" class="card">
      <h1>Join a group</h1>
      <p>Sign in user <strong>{{ user.email }}</strong> — claim this invite to join its group.</p>
      <button class="primary" :disabled="claiming" @click="claim">
        {{ claiming ? 'Claiming…' : 'Join group' }}
      </button>
    </div>

    <!-- Not logged in: stash the invite, send to auth. -->
    <div v-else class="card">
      <h1>You're invited</h1>
      <p>Register or sign in to accept this invite and join its group.</p>
      <button class="primary" @click="goSignIn">Sign in / Register</button>
    </div>
  </section>
</template>

<style scoped>
.invite { max-width: 420px; }
.invite .card { display: flex; flex-direction: column; gap: 0.75rem; }
.invite h1 { font-size: 1.4rem; margin: 0; }
.success { border-color: var(--ok, #2ea043); }
</style>
