import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { isAdminEmail } from '@/lib/validation'

/**
 * Admin-only route wrapper. Sits BEHIND `<AuthGuard />` (which handles
 * session + profile), so by the time we render, the user is signed in
 * and `useAuthStore().profile` is whatever Supabase returned.
 *
 * Permission check — two layers, mirroring the iOS RootView gate:
 *   1. `auth.user.email` matches `@tagorides.com` — UX shortcut that
 *      works even when `public.users` row hasn't been bootstrapped.
 *   2. `profile.is_admin === true` — the server-side authoritative flag
 *      set by migration 069.
 *
 * Either layer grants access. Server-side `/api/admin/*` still enforces
 * `users.is_admin = true` independently — this is purely the client-side
 * gate for the admin UI.
 *
 * Non-admins get redirected to `/` (their normal home). Logged in but
 * trying to access `/admin/*` without permission is a routing accident
 * (e.g. someone typed the URL), not malicious; silent redirect rather
 * than a "403" page keeps the consumer app clean for ordinary users.
 */
export default function AdminGuard() {
  const session = useAuthStore((s) => s.session)
  const profile = useAuthStore((s) => s.profile)
  const isLoading = useAuthStore((s) => s.isLoading)
  const location = useLocation()

  // AuthGuard above us ensures session is non-null + isLoading is false,
  // but double-check to be safe (in case of router order regression).
  if (isLoading) {
    return (
      <div
        data-testid="admin-guard-loading"
        className="min-h-dvh w-full bg-surface flex items-center justify-center"
      >
        <div className="h-8 w-8 rounded-full border-4 border-primary border-t-transparent animate-spin" />
      </div>
    )
  }

  if (!session) {
    return <Navigate to="/signup" replace state={{ from: location }} />
  }

  const authEmail = session.user?.email ?? null
  const isAdminByEmail = authEmail !== null && isAdminEmail(authEmail)
  const isAdmin = isAdminByEmail || profile?.is_admin === true

  if (!isAdmin) {
    // Silently send the wrong-permission user to their normal home,
    // not a "permission denied" page. Most "I typed /admin by accident"
    // cases just want to bounce out.
    return <Navigate to="/" replace />
  }

  return <Outlet />
}
