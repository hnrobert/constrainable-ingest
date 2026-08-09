/**
 * Client UX gate + SSR session hydration. The server middleware is the real
 * boundary; this mirrors it on the client so SPA navigations after a session
 * expiry redirect to /login instead of showing 401s.
 */
const PUBLIC = ['/login', '/viewer']
const isPublic = (p: string): boolean => PUBLIC.some((x) => p === x || p.startsWith(x + '/'))

export default defineNuxtRouteMiddleware(async (to) => {
  if (isPublic(to.path)) return

  const { user, probed, fetchSession } = useAuth()
  if (!probed.value) await fetchSession()

  if (!user.value && import.meta.client) {
    return navigateTo(`/login?redirect=${encodeURIComponent(to.fullPath)}`, { replace: true })
  }
})
