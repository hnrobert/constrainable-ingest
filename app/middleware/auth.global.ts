/**
 * Client UX gate + SSR session hydration. The server middleware is the real
 * boundary; this mirrors it on the client so SPA navigations after a session
 * expiry redirect to /login instead of showing 401s. A logged-in non-admin
 * (viewer-role account) is bounced to /viewer — the panel is admin-only.
 */
const PUBLIC = ['/login', '/viewer']
const isPublic = (p: string): boolean => PUBLIC.some((x) => x === p || p.startsWith(x + '/'))

export default defineNuxtRouteMiddleware(async (to) => {
  if (isPublic(to.path)) return

  const { user, probed, fetchSession } = useAuth()
  if (!probed.value) await fetchSession()

  // No session at all → login (client-side only; SSR lets the server middleware
  // handle the redirect so a hard load still works).
  if (!user.value && import.meta.client) {
    return navigateTo(`/login?redirect=${encodeURIComponent(to.fullPath)}`, { replace: true })
  }

  // Authenticated but not admin → the panel is off-limits; send to the viewer.
  if (user.value && user.value.role !== 'admin') {
    return navigateTo('/viewer', { replace: true })
  }
})
