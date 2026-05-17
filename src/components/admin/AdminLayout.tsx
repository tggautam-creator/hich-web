import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { env } from '@/lib/env'

/**
 * Two-pane chrome around every admin page: sidebar (nav) + main outlet.
 * Each entry in the sidebar links to a Phase-1 slice; placeholders are
 * fine while the slices are still being built.
 *
 * Top bar shows:
 *   - Environment badge (PROD / DEV) so an admin always knows which
 *     dataset they're touching before they hit "Send to 5,000 users".
 *   - Current admin email + a Sign out button.
 *
 * Design: keep this minimal — admin UI shouldn't try to match the
 * consumer app's aesthetic, that just bloats the codebase. Plain
 * `bg-surface` + `border-border` so it inherits dark/light tokens.
 */

interface NavItem {
  to: string
  label: string
  testId: string
  /** Optional badge (e.g. count of pending issues). */
  badge?: number
}

const NAV_ITEMS: readonly NavItem[] = [
  { to: '/admin',             label: 'Dashboard',  testId: 'admin-nav-dashboard' },
  { to: '/admin/funnel',      label: 'Funnel',     testId: 'admin-nav-funnel' },
  { to: '/admin/users',       label: 'Users',      testId: 'admin-nav-users' },
  { to: '/admin/campaigns',   label: 'Campaigns',  testId: 'admin-nav-campaigns' },
  { to: '/admin/live',        label: 'Live',       testId: 'admin-nav-live' },
  { to: '/admin/audit-log',   label: 'Audit Log',  testId: 'admin-nav-audit' },
  { to: '/admin/settings',    label: 'Settings',   testId: 'admin-nav-settings' },
] as const

export default function AdminLayout() {
  const session = useAuthStore((s) => s.session)
  const signOut = useAuthStore((s) => s.signOut)
  const navigate = useNavigate()

  const adminEmail = session?.user?.email ?? 'admin@tagorides.com'

  // Detect which Supabase project the build is talking to so the badge
  // accurately reflects "you're about to touch real users" vs "test data."
  // Heuristic: prod project ref `pdxtsw...` → PROD, anything else → DEV.
  const supabaseUrl = env.SUPABASE_URL ?? ''
  const isProd = supabaseUrl.includes('pdxtswlaxqbqkrfwailf')

  async function handleSignOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div
      data-testid="admin-layout"
      className="min-h-dvh w-full bg-surface flex"
    >
      {/* ── Sidebar ──────────────────────────────────────────────────── */}
      <aside
        data-testid="admin-sidebar"
        className="w-60 shrink-0 border-r border-border bg-white flex flex-col"
      >
        <div className="px-6 py-5 border-b border-border">
          <div className="text-lg font-bold text-text-primary">TAGO Admin</div>
          <div className="text-xs text-text-secondary mt-0.5">
            internal team panel
          </div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/admin'}
              data-testid={item.testId}
              className={({ isActive }) => [
                'block rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary-light text-primary'
                  : 'text-text-primary hover:bg-surface',
              ].join(' ')}
            >
              <div className="flex items-center justify-between">
                <span>{item.label}</span>
                {item.badge !== undefined && item.badge > 0 && (
                  <span className="rounded-full bg-warning px-2 py-0.5 text-xs font-semibold text-white">
                    {item.badge}
                  </span>
                )}
              </div>
            </NavLink>
          ))}
        </nav>
        <div className="px-6 py-4 border-t border-border text-xs text-text-secondary">
          Admin Panel · Phase 1
        </div>
      </aside>

      {/* ── Main pane (top bar + outlet) ─────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        <header
          data-testid="admin-topbar"
          className="h-14 px-6 border-b border-border bg-white flex items-center justify-between shrink-0"
        >
          <div className="flex items-center gap-3">
            <span
              data-testid="admin-env-badge"
              className={[
                'rounded-md px-2 py-1 text-xs font-semibold',
                isProd
                  ? 'bg-danger/10 text-danger'
                  : 'bg-warning/10 text-warning',
              ].join(' ')}
            >
              {isProd ? 'PROD' : 'DEV'}
            </span>
            <span className="text-sm text-text-secondary">
              You are touching{' '}
              <span className="font-semibold text-text-primary">
                {isProd ? 'real user data' : 'test data'}
              </span>
            </span>
          </div>
          <div className="flex items-center gap-4">
            <span
              data-testid="admin-current-email"
              className="text-sm text-text-secondary"
            >
              {adminEmail}
            </span>
            <button
              data-testid="admin-sign-out"
              type="button"
              onClick={handleSignOut}
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text-primary hover:bg-surface transition-colors"
            >
              Sign out
            </button>
          </div>
        </header>

        <main
          data-testid="admin-main"
          className="flex-1 overflow-auto p-6 bg-surface"
        >
          <Outlet />
        </main>
      </div>
    </div>
  )
}
