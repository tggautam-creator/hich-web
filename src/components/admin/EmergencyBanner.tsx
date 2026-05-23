import { Link } from 'react-router-dom'
import {
  useOpenEmergencyReports,
  useAdminChangeReportStatus,
  type AdminReportInboxRow,
} from '@/hooks/useAdminReports'

/**
 * 2026-05-22 — Phase 4 of docs/REPORTS_PLAN.md. Sticky red banner
 * mounted at the top of every `/admin/*` page that surfaces any
 * `severity=emergency AND status=open` report the second it lands.
 *
 * Why this exists: before this banner, an emergency report only
 * pinged Slack/email + bumped the Reports nav badge. An admin who
 * was actively on `/admin/users` (or any other page) might not
 * notice for several minutes. Per the plan doc, an emergency =
 * "drop everything," so it needs a top-level visual interrupt.
 *
 * Behavior:
 *   - Polls `GET /admin/reports?severity=emergency&status=open` every
 *     10s via `useOpenEmergencyReports` (vs the inbox's 30s — emergency
 *     freshness budget is tighter).
 *   - One stacked card per open emergency. Card shows reporter name,
 *     title, time-ago, an "Open report" link to the detail page, and
 *     a 🚨 Acknowledge button.
 *   - Acknowledge POSTs `/reports/:id/actions/status { status:
 *     'in_progress' }` via the existing mutation. The same hook
 *     invalidates the banner query so the card drops off
 *     immediately (no waiting for the next 10s tick).
 *   - Renders nothing when the list is empty — does not show during
 *     the loading state to avoid layout flicker on every page nav.
 *
 * Where it's mounted: `AdminLayout` renders it ABOVE the `<Outlet />`
 * so it sits between the page header and the page body, visible on
 * every admin route. It does NOT cover the sidebar (intentional —
 * sidebar nav is the primary escape hatch).
 *
 * Tradeoffs:
 *   - 10s poll cadence (vs server-broadcast realtime): polling stays
 *     simple and avoids enabling postgres-changes on the `reports`
 *     table. The 10s upper-bound latency is acceptable for human
 *     triage (the Slack + email pageouts fire instantly anyway).
 *   - Multiple emergencies stack vertically (no "show 3 of 7"
 *     collapse). Practical reality: more than 2-3 unack'd
 *     emergencies = pager outage = banner crowding is not the
 *     biggest problem.
 */
export default function EmergencyBanner() {
  const query = useOpenEmergencyReports()
  const rows = query.data?.reports ?? []

  if (rows.length === 0) return null

  return (
    <div
      data-testid="emergency-banner"
      role="alert"
      aria-live="assertive"
      className="border-b border-danger bg-danger/95"
    >
      <div className="px-6 py-3 space-y-2">
        {rows.map((row) => (
          <EmergencyRow key={row.id} row={row} />
        ))}
      </div>
    </div>
  )
}

function EmergencyRow({ row }: { row: AdminReportInboxRow }) {
  const ackMutation = useAdminChangeReportStatus(row.id)

  return (
    <div
      data-testid={`emergency-banner-row-${row.id}`}
      className="flex items-center gap-4"
    >
      <span
        aria-hidden="true"
        className="text-2xl leading-none"
      >
        🚨
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-sm font-bold text-white">
          <span className="uppercase tracking-wide text-[10px] rounded bg-white/20 px-1.5 py-0.5">
            EMERGENCY
          </span>
          <span className="truncate">
            {row.reporter_name ?? row.reporter_email ?? 'Anonymous reporter'}
          </span>
          <span className="text-white/70 text-xs font-normal">
            · {formatAgo(row.created_at)}
          </span>
        </div>
        <div className="text-xs text-white/90 truncate">{row.title}</div>
      </div>
      <Link
        to={`/admin/reports/${row.id}`}
        data-testid={`emergency-banner-open-${row.id}`}
        className="rounded-md bg-white/15 hover:bg-white/25 px-3 py-1.5 text-xs font-semibold text-white transition-colors whitespace-nowrap"
      >
        Open report
      </Link>
      <button
        type="button"
        data-testid={`emergency-banner-ack-${row.id}`}
        disabled={ackMutation.isPending}
        onClick={() => {
          // `in_progress` is the canonical "an admin is on it"
          // state. Server writes the audit row + flips updated_at.
          ackMutation.mutate({ status: 'in_progress' })
        }}
        className="rounded-md bg-white text-danger hover:bg-white/90 disabled:opacity-60 px-3 py-1.5 text-xs font-bold transition-colors whitespace-nowrap"
      >
        {ackMutation.isPending ? 'Acknowledging…' : '🚨 Acknowledge'}
      </button>
    </div>
  )
}

function formatAgo(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
