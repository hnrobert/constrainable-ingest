/**
 * Auth state shared across the app. The server middleware is the real gate;
 * this composable drives UX (header user/logout, client-side redirect on
 * expired sessions).
 *
 * Email is the login identifier. Registration is two-step: send-code emails a
 * 6-digit code keyed by a client-chosen `session` token, then register consumes
 * it. The first registration (bootstrap) needs no code.
 */
export interface SessionUser {
  id: number
  email: string
  role: 'admin' | 'viewer'
}

export interface BootstrapStatus {
  /** true when no users exist yet → next registrant becomes super admin, no code needed. */
  bootstrap: boolean
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

  async function login(email: string, password: string): Promise<SessionUser> {
    const u = await $fetch<SessionUser>('/api/auth/login', {
      method: 'POST',
      body: { email, password },
    })
    user.value = u
    probed.value = true
    return u
  }

  /** Step 1: email a verification code. `session` is a client flow token. */
  async function sendCode(email: string, session: string): Promise<{ ok: boolean; bootstrap?: boolean }> {
    return await $fetch<{ ok: boolean; bootstrap?: boolean }>('/api/auth/send-code', {
      method: 'POST',
      body: { email, session },
    })
  }

  /**
   * Step 2 (or bootstrap): create the account. In bootstrap mode (first user)
   * `code`/`session` are ignored by the server. On success the caller is logged
   * in immediately.
   */
  async function register(email: string, password: string, code: string, session: string): Promise<SessionUser> {
    const u = await $fetch<SessionUser>('/api/auth/register', {
      method: 'POST',
      body: { email, password, code, session },
    })
    user.value = u
    probed.value = true
    return u
  }

  /** Whether the system is still in bootstrap (first registrant = super admin). */
  async function fetchBootstrap(): Promise<boolean> {
    try {
      // URL widened to `string` to bypass Nuxt's typed-route union (the literal
      // form trips TS's recursion limit once the route registry grows).
      const r = await $fetch<BootstrapStatus>('/api/auth/bootstrap' as string)
      return r.bootstrap
    } catch {
      return false
    }
  }

  async function logout(): Promise<void> {
    try {
      await $fetch('/api/auth/logout', { method: 'POST' })
    } finally {
      user.value = null
      await navigateTo('/login')
    }
  }

  return {
    user,
    probed,
    isAuthenticated,
    isAdmin,
    fetchSession,
    login,
    sendCode,
    register,
    fetchBootstrap,
    logout,
  }
}
