import { useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { env } from '@/lib/env'
import { useAdminAlerts } from '@/hooks/useAdminAlerts'
import { useAdminReportInbox } from '@/hooks/useAdminReports'
import EmergencyBanner from './EmergencyBanner'

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

// 2026-05-23 — sidebar reorg per Tarun feedback. The recently-added
// admin tools (Rides, Ghost refunds, Decline reasons, future Stats)
// collapse into an expandable "More tools" section so the top-level
// list stays scannable. Items in MORE_TOOLS still get their own
// route + page; this is purely a sidebar grouping decision.
const NAV_ITEMS: readonly NavItem[] = [
  { to: '/admin',             label: 'Dashboard',  testId: 'admin-nav-dashboard' },
  { to: '/admin/funnel',      label: 'Funnel',     testId: 'admin-nav-funnel' },
  { to: '/admin/users',       label: 'Users',      testId: 'admin-nav-users' },
  { to: '/admin/ride-board',  label: 'Ride Board', testId: 'admin-nav-ride-board' },
  { to: '/admin/campaigns',   label: 'Campaigns',  testId: 'admin-nav-campaigns' },
  { to: '/admin/reports',     label: 'Reports',    testId: 'admin-nav-reports' },
  { to: '/admin/live',        label: 'Live',       testId: 'admin-nav-live' },
  { to: '/admin/alerts',      label: 'Alerts',     testId: 'admin-nav-alerts' },
  { to: '/admin/audit-log',   label: 'Audit Log',  testId: 'admin-nav-audit' },
  { to: '/admin/api-usage',   label: 'API Usage',  testId: 'admin-nav-api-usage' },
  { to: '/admin/settings',    label: 'Settings',   testId: 'admin-nav-settings' },
] as const

const MORE_TOOLS: readonly NavItem[] = [
  { to: '/admin/rides',           label: 'Rides',           testId: 'admin-nav-rides' },
  { to: '/admin/ghost-refunds',   label: 'Ghost refunds',   testId: 'admin-nav-ghost-refunds' },
  { to: '/admin/decline-reasons', label: 'Decline reasons', testId: 'admin-nav-decline-reasons' },
] as const

export default function AdminLayout() {
  const session = useAuthStore((s) => s.session)
  const signOut = useAuthStore((s) => s.signOut)
  const navigate = useNavigate()
  const location = useLocation()
  // "More tools" expand state. Default OPEN when the current route
  // is inside one of the More-Tools items (so the admin lands on
  // their page + sees the active highlight without expanding). Else
  // default closed to keep the sidebar compact.
  const isInsideMoreTools = MORE_TOOLS.some((it) =>
    location.pathname === it.to || location.pathname.startsWith(`${it.to}/`),
  )
  const [moreOpen, setMoreOpen] = useState(isInsideMoreTools)

  // Slice 1.9 — surface the live alert count as a sidebar badge so an
  // admin sees urgency at a glance without having to click into Alerts.
  // The hook itself polls every 30s while the tab is focused (defined
  // in src/hooks/useAdminAlerts.ts); calling it here also drives the
  // refetch when /admin/alerts isn't the current route.
  const alertsQuery = useAdminAlerts()
  const alertCount = alertsQuery.data?.total_count ?? 0

  // 2026-05-22 — Reports badge. Same 30s polling cadence as alerts.
  // Shows the sum of emergency + urgent (the loudest two severities)
  // so the sidebar surfaces "you have triage to do" at a glance.
  // We page with limit=1 since we only need the counts block, not
  // the actual rows.
  const reportsQuery = useAdminReportInbox({ limit: 1 })
  const reportsBadgeCount =
    (reportsQuery.data?.counts.emergency ?? 0) +
    (reportsQuery.data?.counts.urgent ?? 0)

  const navItems = NAV_ITEMS.map((item) => {
    if (item.to === '/admin/alerts') {
      return { ...item, badge: alertCount > 0 ? alertCount : undefined }
    }
    if (item.to === '/admin/reports') {
      return {
        ...item,
        badge: reportsBadgeCount > 0 ? reportsBadgeCount : undefined,
      }
    }
    return item
  })

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
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {navItems.map((item) => (
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

          {/* 2026-05-23 — collapsible "More tools" group for newer
              admin pages so the sidebar stays scannable. */}
          <button
            type="button"
            data-testid="admin-nav-more-tools-toggle"
            onClick={() => setMoreOpen((v) => !v)}
            className={[
              'mt-2 flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              isInsideMoreTools
                ? 'text-primary'
                : 'text-text-secondary hover:bg-surface hover:text-text-primary',
            ].join(' ')}
            aria-expanded={moreOpen}
          >
            <span className="flex items-center gap-2">
              <span>More tools</span>
              <span className="text-[10px] uppercase tracking-wide text-text-secondary/70">
                {MORE_TOOLS.length}
              </span>
            </span>
            <span
              aria-hidden="true"
              className={[
                'transition-transform text-text-secondary',
                moreOpen ? 'rotate-90' : '',
              ].join(' ')}
            >
              ›
            </span>
          </button>
          {moreOpen && (
            <div className="ml-2 border-l border-border pl-2 space-y-1">
              {MORE_TOOLS.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  data-testid={item.testId}
                  className={({ isActive }) => [
                    'block rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-primary-light text-primary'
                      : 'text-text-primary hover:bg-surface',
                  ].join(' ')}
                >
                  {item.label}
                </NavLink>
              ))}
            </div>
          )}
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

        {/* Phase 4 of docs/REPORTS_PLAN.md — emergency banner sits
            between the header and the page body so it's visible on
            every admin route. Renders nothing when no open
            emergencies exist. */}
        <EmergencyBanner />

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
