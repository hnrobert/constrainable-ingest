/**
 * Auth state shared across the app. The server middleware is the real gate;
 * this composable drives UX (header user/logout, client-side redirect on
 * expired sessions).
 */
export interface SessionUser {
  id: number
  username: string
  role: 'admin' | 'viewer'
}

export function useAuth() {
  const user = useState<SessionUser | null>('auth:user', () => null)
  const probed = useState<boolean>('auth:probed', () => false)

  const isAuthenticated = computed(() => !!user.value)
  const isAdmin = computed(() => user.value?.role === 'admin')

  async function fetchSession(): Promise<SessionUser | null> {
    // On the server $fetch does NOT forward the incoming browser cookie
    // automatically (only useFetch does) — forward it manually so SSR hydrates
    // the real session. On the client the browser sends cookies itself.
    const { cookie } = useRequestHeaders(['cookie'])
    try {
      const u = await $fetch<SessionUser | null>('/api/auth/session', {
        headers: cookie ? { cookie } : undefined,
      })
      user.value = u
      probed.value = true
      return u
    } catch {
      user.value = null
      probed.value = true
      return null
    }
  }

  async function login(username: string, password: string): Promise<SessionUser> {
    const u = await $fetch<SessionUser>('/api/auth/login', {
      method: 'POST',
      body: { username, password },
    })
    user.value = u
    probed.value = true
    return u
  }

  /** Open registration: first user becomes admin, the rest are viewers. */
  async function register(username: string, password: string): Promise<SessionUser> {
    const u = await $fetch<SessionUser>('/api/auth/register', {
      method: 'POST',
      body: { username, password },
    })
    user.value = u
    probed.value = true
    return u
  }

  async function logout(): Promise<void> {
    try {
      await $fetch('/api/auth/logout', { method: 'POST' })
    } finally {
      user.value = null
      await navigateTo('/login')
    }
  }

  return { user, probed, isAuthenticated, isAdmin, fetchSession, login, register, logout }
}
