import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { trackEvent } from '@/lib/analytics'
import {
  useForceCancelOffer,
  useNotifyUser,
  useRideBoardActivity,
  useRideBoardCities,
  useRideBoardFunnel,
  useRideBoardMetrics,
  useRideBoardOffers,
  useRideBoardPostOffers,
  useRideBoardPosts,
  useRideBoardPowerUsers,
  useRideBoardTimePatterns,
  type RideBoardOffer,
  type RideBoardPost,
} from '@/hooks/useAdminRideBoard'
import InfoTooltip from './InfoTooltip'

/**
 * 2026-05-18 v2 — `/admin/ride-board` analytics dashboard.
 *
 * Sub-tabs:
 *   - Overview  : metric cards + funnel + daily trend + hour×dow heatmap
 *   - Cities    : top routes table + unmatched-demand / unmatched-supply
 *   - Users     : top posters + top drivers leaderboards
 *   - Activity  : real-time event feed (15s auto-refresh)
 *   - Posts     : original paginated ride_schedules table (with filters)
 *   - Offers    : original paginated ride_offers table (with filters)
 *
 * The Posts + Offers tabs preserve the v1 behaviour (drill-down modal,
 * notify, force-cancel) since the new analytics tabs don't replace
 * row-level inspection — they complement it.
 */

type Tab = 'overview' | 'cities' | 'users' | 'activity' | 'posts' | 'offers'

const TAB_LABELS: Record<Tab, string> = {
  overview: 'Overview',
  cities: 'Cities',
  users: 'Users',
  activity: 'Activity',
  posts: 'Posts',
  offers: 'Offers',
}

export default function RideBoardPage() {
  const [tab, setTab] = useState<Tab>('overview')
  const [notifyTarget, setNotifyTarget] = useState<{
    userId: string
    name: string | null
    email: string | null
  } | null>(null)

  function changeTab(next: Tab) {
    setTab(next)
    trackEvent('admin_ride_board_tab', { tab: next })
  }

  return (
    <div data-testid="admin-ride-board" className="space-y-6">
      {/* ── Header ────────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold text-text-primary">Ride Board</h1>
          <InfoTooltip
            testid="ride-board-page-info"
            text="Analytics + monitoring for the rider/driver post + offer flow. Overview surfaces today's snapshot, the conversion funnel, and time patterns. Cities shows where supply and demand mismatch. Users shows top posters + drivers. Activity is a real-time event feed. Posts/Offers are the raw tables with per-row actions."
            align="left"
          />
        </div>
        <p className="mt-1 text-sm text-text-secondary">
          Who's posting, who's offering, and where the marketplace is healthy or stuck.
        </p>
      </div>

      {/* ── Tab nav ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-1 border-b border-border">
        {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
          <TabButton key={t} active={tab === t} onClick={() => changeTab(t)} testId={`ride-board-tab-${t}`}>
            {TAB_LABELS[t]}
          </TabButton>
        ))}
      </div>

      {/* ── Tab content ───────────────────────────────────────────────── */}
      {tab === 'overview' && <OverviewTab />}
      {tab === 'cities' && <CitiesTab />}
      {tab === 'users' && <UsersTab onNotify={setNotifyTarget} />}
      {tab === 'activity' && <ActivityTab onNotify={setNotifyTarget} />}
      {tab === 'posts' && <PostsTabWrapper onNotify={setNotifyTarget} />}
      {tab === 'offers' && <OffersTabWrapper onNotify={setNotifyTarget} />}

      {/* ── Shared modal ──────────────────────────────────────────────── */}
      {notifyTarget && (
        <NotifyModal target={notifyTarget} onClose={() => setNotifyTarget(null)} />
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// OVERVIEW TAB — metrics + funnel + daily trend + hour×day heatmap
// ════════════════════════════════════════════════════════════════════════════

function OverviewTab() {
  return (
    <div className="space-y-6">
      <MetricsCard />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <FunnelCard />
        <TrendCard />
      </div>
      <HeatmapCard />
    </div>
  )
}

function MetricsCard() {
  const { data, isLoading, error } = useRideBoardMetrics()
  if (isLoading) return <Skeleton h={120} testId="ride-board-metrics-loading" />
  if (error || !data) return <ErrorBox message="Couldn't load metrics." />
  const { today, warnings } = data
  return (
    <div data-testid="ride-board-metrics" className="space-y-2">
      <div className="rounded-2xl border border-border bg-white p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
          Today
        </div>
        <div className="mt-2 flex flex-wrap items-baseline gap-8">
          <Stat label="Posts" value={today.posts} />
          <Stat label="Offers" value={today.offers} />
          <Stat label="Accepts" value={today.accepts} />
          <Stat label="Pending (all-time)" value={warnings.pending_offers_total} />
        </div>
      </div>
      {(warnings.unanswered_posts_over_7d > 0 || warnings.pending_offers_over_2d > 0) && (
        <div className="rounded-2xl border border-warning/40 bg-warning/5 p-4 text-sm text-text-primary">
          <div className="font-medium">⚠️ Attention</div>
          <ul className="mt-1 space-y-1 text-text-secondary">
            {warnings.unanswered_posts_over_7d > 0 && (
              <li>
                <span className="font-semibold text-text-primary">
                  {warnings.unanswered_posts_over_7d}
                </span>{' '}
                post{warnings.unanswered_posts_over_7d === 1 ? '' : 's'} older than 7
                days with no offers
              </li>
            )}
            {warnings.pending_offers_over_2d > 0 && (
              <li>
                <span className="font-semibold text-text-primary">
                  {warnings.pending_offers_over_2d}
                </span>{' '}
                pending offer{warnings.pending_offers_over_2d === 1 ? '' : 's'} older
                than 2 days
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}

function FunnelCard() {
  const { data, isLoading, error } = useRideBoardFunnel(30)
  if (isLoading) return <Skeleton h={280} testId="funnel-loading" />
  if (error || !data) return <ErrorBox message="Couldn't load funnel." />
  const stages = data.overall
  const posted = stages.find((s) => s.stage === 'posted')?.count ?? 0
  return (
    <div className="rounded-2xl border border-border bg-white p-4">
      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
            Funnel (last 30 days)
          </div>
          <div className="mt-1 text-sm text-text-secondary">
            Posts → at-least-1-offer → at-least-1-selected → ride completed
          </div>
        </div>
      </div>
      <div className="mt-4 space-y-2">
        {stages.map((s, idx) => {
          const pct = posted > 0 ? (s.count / posted) * 100 : 0
          const prevPct = idx > 0 && stages[idx - 1]
            ? (stages[idx - 1]!.count / Math.max(1, posted)) * 100
            : null
          const dropPct = prevPct != null ? prevPct - pct : null
          return (
            <div key={s.stage} className="flex items-center gap-3">
              <div className="w-28 shrink-0 text-sm font-medium capitalize text-text-primary">
                {s.stage}
              </div>
              <div className="relative h-7 flex-1 overflow-hidden rounded-md bg-surface">
                <div
                  className="absolute left-0 top-0 h-full bg-primary/80"
                  style={{ width: `${pct}%` }}
                />
                <div className="absolute inset-0 flex items-center px-2 text-xs font-semibold text-white mix-blend-difference">
                  {s.count} ({pct.toFixed(0)}%)
                </div>
              </div>
              {dropPct != null && dropPct > 0 && (
                <div className="w-12 shrink-0 text-right text-xs text-danger">
                  ↓ {dropPct.toFixed(0)}%
                </div>
              )}
            </div>
          )
        })}
      </div>
      {data.by_week.length > 1 && (
        <div className="mt-4 text-xs text-text-secondary">
          <div className="mb-1 font-semibold uppercase tracking-wide">
            Weekly trend
          </div>
          <div className="h-24">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.by_week} margin={{ left: -20, right: 8, top: 4, bottom: 0 }}>
                <CartesianGrid stroke="#eef" strokeDasharray="3 3" />
                <XAxis dataKey="week_start" stroke="#9aa" fontSize={10} tickLine={false} />
                <YAxis stroke="#9aa" fontSize={10} tickLine={false} />
                <Tooltip />
                <Line type="monotone" dataKey="posted" stroke="#0066ff" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="offered" stroke="#22c55e" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="selected" stroke="#a855f7" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}

function TrendCard() {
  const { data, isLoading, error } = useRideBoardTimePatterns(14)
  if (isLoading) return <Skeleton h={280} testId="trend-loading" />
  if (error || !data) return <ErrorBox message="Couldn't load trend." />
  return (
    <div className="rounded-2xl border border-border bg-white p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
        Daily trend (last 14 days)
      </div>
      <div className="mt-2 text-sm text-text-secondary">
        Posts (blue), offers (green), accepts (purple) per day
      </div>
      <div className="mt-3 h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data.daily_trend} margin={{ left: -20, right: 8, top: 8, bottom: 0 }}>
            <CartesianGrid stroke="#eef" strokeDasharray="3 3" />
            <XAxis
              dataKey="day"
              stroke="#9aa"
              fontSize={10}
              tickFormatter={(v: string) => v.slice(5)}
              tickLine={false}
            />
            <YAxis stroke="#9aa" fontSize={10} tickLine={false} />
            <Tooltip />
            <Line type="monotone" dataKey="posts" stroke="#0066ff" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="offers" stroke="#22c55e" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="selected" stroke="#a855f7" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function HeatmapCard() {
  const { data, isLoading, error } = useRideBoardTimePatterns(30)
  if (isLoading) return <Skeleton h={260} testId="heatmap-loading" />
  if (error || !data) return <ErrorBox message="Couldn't load heatmap." />
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const hours = Array.from({ length: 24 }, (_, i) => i)
  const max = Math.max(1, ...data.hour_day_heatmap.flat())
  return (
    <div className="rounded-2xl border border-border bg-white p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
        Posts by hour × day-of-week (last 30 days, UTC)
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="text-[10px]">
          <thead>
            <tr>
              <th />
              {hours.map((h) => (
                <th key={h} className="px-1 text-center font-normal text-text-secondary">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map((label, dowIdx) => (
              <tr key={label}>
                <td className="pr-2 text-text-secondary">{label}</td>
                {hours.map((h) => {
                  const v = data.hour_day_heatmap[dowIdx]?.[h] ?? 0
                  const alpha = v === 0 ? 0 : 0.15 + (v / max) * 0.85
                  return (
                    <td
                      key={h}
                      title={`${label} ${h}:00 — ${v} posts`}
                      className="border border-white"
                      style={{
                        width: 18,
                        height: 18,
                        backgroundColor: `rgba(0, 102, 255, ${alpha})`,
                      }}
                    />
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 text-xs text-text-secondary">
        Darker = more posts that hour. Times shown in UTC.
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// CITIES TAB
// ════════════════════════════════════════════════════════════════════════════

function CitiesTab() {
  const { data, isLoading, error } = useRideBoardCities(30)
  if (isLoading) return <Skeleton h={400} testId="cities-loading" />
  if (error || !data) return <ErrorBox message="Couldn't load city analytics." />
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-white p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
          Top routes (last 30 days)
        </div>
        <p className="mt-1 text-xs text-text-secondary">
          Ranked by post count. Match rate = % of those posts that ended with a selected offer.
        </p>
        {data.top_routes.length === 0 ? (
          <EmptyBox text="No routes yet." />
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-surface text-xs uppercase tracking-wide text-text-secondary">
                <tr>
                  <Th>Origin</Th>
                  <Th>Destination</Th>
                  <Th>Mode</Th>
                  <Th>Posts</Th>
                  <Th>Matched</Th>
                  <Th>Match rate</Th>
                </tr>
              </thead>
              <tbody>
                {data.top_routes.map((r, idx) => (
                  <tr key={idx} className="border-t border-border hover:bg-surface/50">
                    <Td>{r.origin_city}</Td>
                    <Td>{r.dest_city}</Td>
                    <Td>
                      <ModeChip mode={r.mode} />
                    </Td>
                    <Td>{r.post_count}</Td>
                    <Td>{r.matched_count}</Td>
                    <Td>
                      <MatchRateBar rate={r.match_rate} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <UnmatchedTable
          title="Unmatched demand"
          desc="Rider posts with zero offers. Driver-acquisition targets."
          rows={data.unmatched_demand}
          accent="danger"
        />
        <UnmatchedTable
          title="Unmatched supply"
          desc="Driver posts with zero rider interest. Rider-acquisition targets."
          rows={data.unmatched_supply}
          accent="primary"
        />
      </div>
    </div>
  )
}

function UnmatchedTable({
  title,
  desc,
  rows,
  accent,
}: {
  title: string
  desc: string
  rows: { origin_city: string; dest_city: string; post_count: number }[]
  accent: 'danger' | 'primary'
}) {
  const accentClass = accent === 'danger' ? 'text-danger' : 'text-primary'
  return (
    <div className="rounded-2xl border border-border bg-white p-4">
      <div className={['text-xs font-semibold uppercase tracking-wide', accentClass].join(' ')}>
        {title}
      </div>
      <p className="mt-1 text-xs text-text-secondary">{desc}</p>
      {rows.length === 0 ? (
        <EmptyBox text="None." />
      ) : (
        <ul className="mt-3 divide-y divide-border text-sm">
          {rows.map((r, idx) => (
            <li key={idx} className="flex items-center justify-between py-2">
              <div>
                {r.origin_city} → {r.dest_city}
              </div>
              <div className="font-semibold text-text-primary">{r.post_count}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function MatchRateBar({ rate }: { rate: number }) {
  const pct = Math.round(rate * 100)
  const color = pct >= 50 ? 'bg-success' : pct >= 20 ? 'bg-warning' : 'bg-danger'
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-2 w-20 overflow-hidden rounded-full bg-surface">
        <div className={['absolute left-0 top-0 h-full', color].join(' ')} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-text-secondary">{pct}%</span>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// USERS TAB
// ════════════════════════════════════════════════════════════════════════════

function UsersTab({
  onNotify,
}: {
  onNotify: (target: { userId: string; name: string | null; email: string | null }) => void
}) {
  const { data, isLoading, error } = useRideBoardPowerUsers(30)
  if (isLoading) return <Skeleton h={400} testId="users-loading" />
  if (error || !data) return <ErrorBox message="Couldn't load power users." />

  const posterChart = data.top_posters.slice(0, 10).map((p) => ({
    name: p.full_name || p.email?.split('@')[0] || p.user_id.slice(0, 6),
    posts: p.posts,
    matched: p.matched,
  }))
  const driverChart = data.top_drivers.slice(0, 10).map((d) => ({
    name: d.full_name || d.email?.split('@')[0] || d.user_id.slice(0, 6),
    offers: d.offers,
    selected: d.selected,
  }))

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <LeaderboardCard
        title="Top posters (last 30 days)"
        desc="Power riders + drivers posting trips. Watch the match rate — a long-time poster trending toward 0% is a churn risk."
        chartData={posterChart}
        chartKey="posts"
        chartColor="#0066ff"
      >
        {data.top_posters.length === 0 ? (
          <EmptyBox text="No posters yet." />
        ) : (
          <table className="min-w-full text-sm">
            <thead className="bg-surface text-xs uppercase tracking-wide text-text-secondary">
              <tr>
                <Th>User</Th>
                <Th>Posts</Th>
                <Th>Matched</Th>
                <Th>Match rate</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {data.top_posters.map((p) => (
                <tr key={p.user_id} className="border-t border-border hover:bg-surface/50">
                  <Td>
                    <Link to={`/admin/users/${p.user_id}`} className="text-primary hover:underline">
                      {p.full_name || p.email || p.user_id.slice(0, 8)}
                    </Link>
                  </Td>
                  <Td>{p.posts}</Td>
                  <Td>{p.matched}</Td>
                  <Td>
                    <MatchRateBar rate={p.match_rate} />
                  </Td>
                  <Td>
                    <SmallButton
                      variant="ghost"
                      onClick={() =>
                        onNotify({ userId: p.user_id, name: p.full_name, email: p.email })
                      }
                      testId="poster-row-notify"
                    >
                      Notify
                    </SmallButton>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </LeaderboardCard>

      <LeaderboardCard
        title="Top drivers (last 30 days)"
        desc="Drivers making offers. Accept rate = % of offers that were selected. Low accept rate could mean their offer quality / pricing is off."
        chartData={driverChart}
        chartKey="offers"
        chartColor="#22c55e"
      >
        {data.top_drivers.length === 0 ? (
          <EmptyBox text="No drivers yet." />
        ) : (
          <table className="min-w-full text-sm">
            <thead className="bg-surface text-xs uppercase tracking-wide text-text-secondary">
              <tr>
                <Th>Driver</Th>
                <Th>Offers</Th>
                <Th>Selected</Th>
                <Th>Accept rate</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {data.top_drivers.map((d) => (
                <tr key={d.user_id} className="border-t border-border hover:bg-surface/50">
                  <Td>
                    <Link to={`/admin/users/${d.user_id}`} className="text-primary hover:underline">
                      {d.full_name || d.email || d.user_id.slice(0, 8)}
                    </Link>
                  </Td>
                  <Td>{d.offers}</Td>
                  <Td>{d.selected}</Td>
                  <Td>
                    <MatchRateBar rate={d.accept_rate} />
                  </Td>
                  <Td>
                    <SmallButton
                      variant="ghost"
                      onClick={() =>
                        onNotify({ userId: d.user_id, name: d.full_name, email: d.email })
                      }
                      testId="driver-row-notify"
                    >
                      Notify
                    </SmallButton>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </LeaderboardCard>
    </div>
  )
}

function LeaderboardCard({
  title,
  desc,
  chartData,
  chartKey,
  chartColor,
  children,
}: {
  title: string
  desc: string
  chartData: { name: string; [k: string]: number | string }[]
  chartKey: string
  chartColor: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-2xl border border-border bg-white p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
        {title}
      </div>
      <p className="mt-1 text-xs text-text-secondary">{desc}</p>
      {chartData.length > 0 && (
        <div className="mt-3 h-40">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ left: -20, right: 8, top: 4, bottom: 0 }}>
              <CartesianGrid stroke="#eef" strokeDasharray="3 3" />
              <XAxis dataKey="name" stroke="#9aa" fontSize={10} tickLine={false} interval={0} angle={-30} textAnchor="end" height={50} />
              <YAxis stroke="#9aa" fontSize={10} tickLine={false} />
              <Tooltip />
              <Bar dataKey={chartKey} radius={[4, 4, 0, 0]}>
                {chartData.map((_, idx) => (
                  <Cell key={idx} fill={chartColor} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="mt-3 overflow-x-auto">{children}</div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// ACTIVITY TAB
// ════════════════════════════════════════════════════════════════════════════

function ActivityTab({
  onNotify,
}: {
  onNotify: (target: { userId: string; name: string | null; email: string | null }) => void
}) {
  const { data, isLoading, isFetching, error } = useRideBoardActivity(50)
  if (isLoading) return <Skeleton h={400} testId="activity-loading" />
  if (error || !data) return <ErrorBox message="Couldn't load activity feed." />
  return (
    <div className="rounded-2xl border border-border bg-white p-4">
      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
            Activity feed
          </div>
          <p className="mt-1 text-xs text-text-secondary">
            Latest {data.events.length} ride-board events. Auto-refreshes every 15s.
            {isFetching && <span className="ml-2 italic">refreshing…</span>}
          </p>
        </div>
      </div>
      {data.events.length === 0 ? (
        <EmptyBox text="No events yet." />
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {data.events.map((ev) => (
            <li key={`${ev.kind}-${ev.id}`} className="py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <KindChip kind={ev.kind} />
                    <Link
                      to={`/admin/users/${ev.user_id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {ev.user_name || ev.user_email || ev.user_id.slice(0, 8)}
                    </Link>
                    <span className="text-xs text-text-secondary">
                      {timeAgo(ev.created_at)}
                    </span>
                    {ev.offer_status && (
                      <span className="text-xs text-text-secondary">· {ev.offer_status}</span>
                    )}
                  </div>
                  <div className="mt-1 truncate text-sm text-text-secondary">
                    {ev.kind === 'post' ? 'posted' : 'offered on'}:{' '}
                    {ev.origin_address || '—'} → {ev.dest_address || '—'}
                  </div>
                </div>
                <SmallButton
                  variant="ghost"
                  onClick={() =>
                    onNotify({
                      userId: ev.user_id,
                      name: ev.user_name,
                      email: ev.user_email,
                    })
                  }
                  testId="activity-row-notify"
                >
                  Notify
                </SmallButton>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function KindChip({ kind }: { kind: 'post' | 'offer' }) {
  const color = kind === 'post' ? 'bg-primary/10 text-primary' : 'bg-success/10 text-success'
  return (
    <span className={['rounded-full px-2 py-0.5 text-xs font-semibold', color].join(' ')}>
      {kind}
    </span>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// POSTS + OFFERS TABS (preserved from v1)
// ════════════════════════════════════════════════════════════════════════════

function PostsTabWrapper({
  onNotify,
}: {
  onNotify: (target: { userId: string; name: string | null; email: string | null }) => void
}) {
  const [page, setPage] = useState(0)
  const [modeFilter, setModeFilter] = useState<'rider' | 'driver' | ''>('')
  const [drillDownPostId, setDrillDownPostId] = useState<string | null>(null)
  const limit = 50
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <FilterSelect
          label="Mode"
          value={modeFilter}
          options={[
            { value: '', label: 'All' },
            { value: 'rider', label: 'Rider posts' },
            { value: 'driver', label: 'Driver posts' },
          ]}
          onChange={(v) => {
            setModeFilter(v as typeof modeFilter)
            setPage(0)
          }}
          testId="ride-board-filter-mode"
        />
      </div>
      <PostsTable
        mode={modeFilter || undefined}
        page={page}
        limit={limit}
        onPageChange={setPage}
        onOpenOffers={(postId) => setDrillDownPostId(postId)}
        onNotify={onNotify}
      />
      {drillDownPostId && (
        <DrillDownPostOffers
          postId={drillDownPostId}
          onClose={() => setDrillDownPostId(null)}
          onNotifyDriver={onNotify}
        />
      )}
    </div>
  )
}

interface PostsTableProps {
  mode?: 'rider' | 'driver'
  page: number
  limit: number
  onPageChange: (page: number) => void
  onOpenOffers: (postId: string) => void
  onNotify: (user: { userId: string; name: string | null; email: string | null }) => void
}

function PostsTable({ mode, page, limit, onPageChange, onOpenOffers, onNotify }: PostsTableProps) {
  const { data, isLoading, isFetching, error } = useRideBoardPosts({
    mode,
    limit,
    offset: page * limit,
  })
  if (isLoading) return <Skeleton h={300} testId="posts-table-loading" />
  if (error) return <ErrorBox message="Couldn't load posts." />
  if (!data || data.posts.length === 0) return <EmptyBox text="No posts." />
  return (
    <div className="space-y-3" data-testid="ride-board-posts-table">
      <div className="overflow-x-auto rounded-2xl border border-border bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-surface text-xs uppercase tracking-wide text-text-secondary">
            <tr>
              <Th>Posted</Th>
              <Th>Poster</Th>
              <Th>Mode</Th>
              <Th>Route</Th>
              <Th>Trip date</Th>
              <Th>Offers</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {data.posts.map((post) => (
              <PostRow
                key={post.id}
                post={post}
                onOpenOffers={onOpenOffers}
                onNotify={onNotify}
              />
            ))}
          </tbody>
        </table>
      </div>
      <Pagination
        page={page}
        total={data.total}
        limit={limit}
        isFetching={isFetching}
        onPageChange={onPageChange}
      />
    </div>
  )
}

function PostRow({
  post,
  onOpenOffers,
  onNotify,
}: {
  post: RideBoardPost
  onOpenOffers: (postId: string) => void
  onNotify: (user: { userId: string; name: string | null; email: string | null }) => void
}) {
  return (
    <tr className="border-t border-border hover:bg-surface/50">
      <Td>{formatDateTime(post.created_at)}</Td>
      <Td>
        <Link to={`/admin/users/${post.user_id}`} className="text-primary hover:underline">
          {post.poster_name || post.poster_email || post.user_id.slice(0, 8)}
        </Link>
      </Td>
      <Td>
        <ModeChip mode={post.mode} />
      </Td>
      <Td className="max-w-xs truncate">
        {(post.origin_address || '—')} → {(post.dest_address || '—')}
      </Td>
      <Td>{post.trip_date || '—'}{post.trip_time ? ` ${post.trip_time}` : ''}</Td>
      <Td>{post.offer_count}</Td>
      <Td>
        <div className="flex flex-wrap gap-2">
          <SmallButton onClick={() => onOpenOffers(post.id)} testId="post-row-view-offers">
            View offers
          </SmallButton>
          <SmallButton
            variant="ghost"
            onClick={() =>
              onNotify({
                userId: post.user_id,
                name: post.poster_name,
                email: post.poster_email,
              })
            }
            testId="post-row-notify"
          >
            Notify
          </SmallButton>
        </div>
      </Td>
    </tr>
  )
}

function OffersTabWrapper({
  onNotify,
}: {
  onNotify: (target: { userId: string; name: string | null; email: string | null }) => void
}) {
  const [page, setPage] = useState(0)
  const [statusFilter, setStatusFilter] = useState<
    'pending' | 'selected' | 'standby' | 'released' | ''
  >('')
  const limit = 50
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <FilterSelect
          label="Status"
          value={statusFilter}
          options={[
            { value: '', label: 'All' },
            { value: 'pending', label: 'Pending' },
            { value: 'selected', label: 'Selected (accepted)' },
            { value: 'standby', label: 'Standby' },
            { value: 'released', label: 'Released' },
          ]}
          onChange={(v) => {
            setStatusFilter(v as typeof statusFilter)
            setPage(0)
          }}
          testId="ride-board-filter-status"
        />
      </div>
      <OffersTable
        status={statusFilter || undefined}
        page={page}
        limit={limit}
        onPageChange={setPage}
        onNotifyDriver={onNotify}
        onNotifyPoster={onNotify}
      />
    </div>
  )
}

interface OffersTableProps {
  status?: 'pending' | 'selected' | 'standby' | 'released'
  page: number
  limit: number
  onPageChange: (page: number) => void
  onNotifyDriver: (user: { userId: string; name: string | null; email: string | null }) => void
  onNotifyPoster: (user: { userId: string; name: string | null; email: string | null }) => void
}

function OffersTable({
  status,
  page,
  limit,
  onPageChange,
  onNotifyDriver,
  onNotifyPoster,
}: OffersTableProps) {
  const { data, isLoading, isFetching, error } = useRideBoardOffers({
    status,
    limit,
    offset: page * limit,
  })
  if (isLoading) return <Skeleton h={300} testId="offers-table-loading" />
  if (error) return <ErrorBox message="Couldn't load offers." />
  if (!data || data.offers.length === 0) return <EmptyBox text="No offers." />
  return (
    <div className="space-y-3" data-testid="ride-board-offers-table">
      <div className="overflow-x-auto rounded-2xl border border-border bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-surface text-xs uppercase tracking-wide text-text-secondary">
            <tr>
              <Th>Offered</Th>
              <Th>Driver</Th>
              <Th>For (poster)</Th>
              <Th>Route</Th>
              <Th>Trip date</Th>
              <Th>Status</Th>
              <Th>Fare</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {data.offers.map((offer) => (
              <OfferRow
                key={offer.id}
                offer={offer}
                onNotifyDriver={onNotifyDriver}
                onNotifyPoster={onNotifyPoster}
              />
            ))}
          </tbody>
        </table>
      </div>
      <Pagination
        page={page}
        total={data.total}
        limit={limit}
        isFetching={isFetching}
        onPageChange={onPageChange}
      />
    </div>
  )
}

function OfferRow({
  offer,
  onNotifyDriver,
  onNotifyPoster,
}: {
  offer: RideBoardOffer
  onNotifyDriver: (user: { userId: string; name: string | null; email: string | null }) => void
  onNotifyPoster: (user: { userId: string; name: string | null; email: string | null }) => void
}) {
  const forceCancel = useForceCancelOffer()
  const fareCents = offer.proposed_fare_cents ?? offer.estimated_fare_cents
  return (
    <tr className="border-t border-border hover:bg-surface/50 align-top">
      <Td>{formatDateTime(offer.created_at)}</Td>
      <Td>
        <Link to={`/admin/users/${offer.driver_id}`} className="text-primary hover:underline">
          {offer.driver_name || offer.driver_email || offer.driver_id.slice(0, 8)}
        </Link>
      </Td>
      <Td>
        {offer.poster_id ? (
          <Link to={`/admin/users/${offer.poster_id}`} className="text-primary hover:underline">
            {offer.poster_name || offer.poster_email || offer.poster_id.slice(0, 8)}
          </Link>
        ) : (
          '—'
        )}
      </Td>
      <Td className="max-w-xs truncate">
        {(offer.origin_address || '—')} → {(offer.dest_address || '—')}
        {offer.proposed_transit_line_name && (
          <div className="text-xs text-text-secondary">
            via {offer.proposed_transit_line_name}
          </div>
        )}
      </Td>
      <Td>{offer.trip_date || '—'}{offer.trip_time ? ` ${offer.trip_time}` : ''}</Td>
      <Td>
        <StatusChip status={offer.status} />
      </Td>
      <Td>{fareCents != null ? `$${(fareCents / 100).toFixed(2)}` : '—'}</Td>
      <Td>
        <div className="flex flex-wrap gap-2">
          <SmallButton
            variant="ghost"
            onClick={() =>
              onNotifyDriver({
                userId: offer.driver_id,
                name: offer.driver_name,
                email: offer.driver_email,
              })
            }
            testId="offer-row-notify-driver"
          >
            Notify driver
          </SmallButton>
          {offer.poster_id && (
            <SmallButton
              variant="ghost"
              onClick={() =>
                onNotifyPoster({
                  userId: offer.poster_id!,
                  name: offer.poster_name ?? null,
                  email: offer.poster_email ?? null,
                })
              }
              testId="offer-row-notify-poster"
            >
              Notify rider
            </SmallButton>
          )}
          {offer.status === 'pending' && (
            <SmallButton
              variant="danger"
              onClick={() => {
                if (
                  !window.confirm(
                    'Force-cancel this pending offer? This flips its status to released and logs an admin audit row. The driver and poster are not notified by this action.',
                  )
                )
                  return
                const reason = window.prompt('Reason for the force-cancel (optional, ≤500 chars):') ?? ''
                forceCancel.mutate(
                  { offerId: offer.id, reason },
                  {
                    onError: (err) => window.alert(err.message || 'Force-cancel failed.'),
                  },
                )
              }}
              disabled={forceCancel.isPending}
              testId="offer-row-force-cancel"
            >
              {forceCancel.isPending ? 'Cancelling…' : 'Force cancel'}
            </SmallButton>
          )}
        </div>
      </Td>
    </tr>
  )
}

function DrillDownPostOffers({
  postId,
  onClose,
  onNotifyDriver,
}: {
  postId: string
  onClose: () => void
  onNotifyDriver: (user: { userId: string; name: string | null; email: string | null }) => void
}) {
  const { data, isLoading, error } = useRideBoardPostOffers(postId)
  return (
    <ModalShell onClose={onClose} testId="ride-board-drill-down">
      <div className="space-y-4">
        <div className="text-lg font-semibold text-text-primary">Offers on this post</div>
        {isLoading && <div className="text-sm text-text-secondary">Loading…</div>}
        {error && <ErrorBox message="Couldn't load offers." />}
        {data && data.offers.length === 0 && (
          <div className="text-sm text-text-secondary">No offers yet.</div>
        )}
        {data && data.offers.length > 0 && (
          <ul className="divide-y divide-border">
            {data.offers.map((offer) => (
              <li key={offer.id} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium text-text-primary">
                      {offer.driver_name || offer.driver_email}
                    </div>
                    <div className="text-xs text-text-secondary">
                      {formatDateTime(offer.created_at)} • <StatusChip status={offer.status} /> •{' '}
                      {offer.proposed_fare_cents != null
                        ? `$${(offer.proposed_fare_cents / 100).toFixed(2)}`
                        : offer.estimated_fare_cents != null
                          ? `~$${(offer.estimated_fare_cents / 100).toFixed(2)}`
                          : 'no fare'}
                      {offer.proposed_transit_line_name && ` • via ${offer.proposed_transit_line_name}`}
                    </div>
                  </div>
                  <SmallButton
                    variant="ghost"
                    onClick={() =>
                      onNotifyDriver({
                        userId: offer.driver_id,
                        name: offer.driver_name,
                        email: offer.driver_email,
                      })
                    }
                    testId="drill-down-notify-driver"
                  >
                    Notify
                  </SmallButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </ModalShell>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// NOTIFY MODAL (preserved from v1)
// ════════════════════════════════════════════════════════════════════════════

function NotifyModal({
  target,
  onClose,
}: {
  target: { userId: string; name: string | null; email: string | null }
  onClose: () => void
}) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [reason, setReason] = useState('')
  const mutate = useNotifyUser()

  function submit() {
    if (!title.trim() || !body.trim()) return
    mutate.mutate(
      {
        userId: target.userId,
        title: title.trim(),
        body: body.trim(),
        reason: reason.trim() || undefined,
      },
      {
        onSuccess: () => onClose(),
        onError: (err) => window.alert(err.message || 'Notify failed.'),
      },
    )
  }

  return (
    <ModalShell onClose={onClose} testId="ride-board-notify-modal">
      <div className="space-y-4">
        <div>
          <div className="text-lg font-semibold text-text-primary">
            Notify {target.name || target.email || target.userId.slice(0, 8)}
          </div>
          <div className="text-xs text-text-secondary">
            Creates an in-app `admin_broadcast` notification. The user sees it on next inbox open. No push (admin push uses the Send Push action on the user detail page).
          </div>
        </div>
        <label className="block text-sm">
          <span className="text-text-primary">Title</span>
          <input
            data-testid="notify-modal-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            placeholder="e.g. BunHieng offered to drive you"
            className="mt-1 w-full rounded-xl border border-border bg-white px-3 py-2 text-sm focus:border-primary focus:outline-none"
          />
        </label>
        <label className="block text-sm">
          <span className="text-text-primary">Body</span>
          <textarea
            data-testid="notify-modal-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={500}
            rows={4}
            placeholder="What should the user see in their inbox?"
            className="mt-1 w-full rounded-xl border border-border bg-white px-3 py-2 text-sm focus:border-primary focus:outline-none"
          />
          <div className="mt-1 text-right text-xs text-text-secondary">{body.length}/500</div>
        </label>
        <label className="block text-sm">
          <span className="text-text-primary">Reason (audit log, optional)</span>
          <input
            data-testid="notify-modal-reason"
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            placeholder="Why are you sending this?"
            className="mt-1 w-full rounded-xl border border-border bg-white px-3 py-2 text-sm focus:border-primary focus:outline-none"
          />
        </label>
        <div className="flex items-center justify-end gap-2">
          <SmallButton variant="ghost" onClick={onClose} testId="notify-modal-cancel">
            Cancel
          </SmallButton>
          <SmallButton
            onClick={submit}
            disabled={!title.trim() || !body.trim() || mutate.isPending}
            testId="notify-modal-send"
          >
            {mutate.isPending ? 'Sending…' : 'Send'}
          </SmallButton>
        </div>
      </div>
    </ModalShell>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// SHARED UI BITS
// ════════════════════════════════════════════════════════════════════════════

function TabButton({
  active,
  onClick,
  children,
  testId,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  testId?: string
}) {
  return (
    <button
      data-testid={testId}
      onClick={onClick}
      className={[
        'border-b-2 px-3 py-2 text-sm font-medium',
        active
          ? 'border-primary text-text-primary'
          : 'border-transparent text-text-secondary hover:text-text-primary',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
  testId,
}: {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
  testId: string
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-text-secondary">{label}</span>
      <select
        data-testid={testId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-xl border border-border bg-white px-3 py-1.5 text-sm focus:border-primary focus:outline-none"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-2xl font-bold text-text-primary">{value}</div>
      <div className="text-xs text-text-secondary">{label}</div>
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-2 text-left font-semibold">{children}</th>
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={['px-4 py-2 align-top', className].join(' ')}>{children}</td>
}

function ModeChip({ mode }: { mode: 'rider' | 'driver' }) {
  const color = mode === 'rider' ? 'bg-primary/10 text-primary' : 'bg-success/10 text-success'
  return (
    <span className={['rounded-full px-2 py-0.5 text-xs font-semibold', color].join(' ')}>
      {mode}
    </span>
  )
}

function StatusChip({ status }: { status: string }) {
  const color =
    {
      pending: 'bg-warning/10 text-warning',
      selected: 'bg-success/10 text-success',
      standby: 'bg-text-secondary/10 text-text-secondary',
      released: 'bg-danger/10 text-danger',
    }[status] ?? 'bg-text-secondary/10 text-text-secondary'
  return (
    <span className={['rounded-full px-2 py-0.5 text-xs font-semibold', color].join(' ')}>
      {status}
    </span>
  )
}

function SmallButton({
  children,
  onClick,
  variant = 'primary',
  disabled,
  testId,
}: {
  children: React.ReactNode
  onClick: () => void
  variant?: 'primary' | 'ghost' | 'danger'
  disabled?: boolean
  testId?: string
}) {
  const styles = {
    primary: 'bg-primary text-white hover:bg-primary/90',
    ghost: 'border border-border bg-white text-text-primary hover:bg-surface',
    danger: 'border border-danger/40 bg-danger/5 text-danger hover:bg-danger/10',
  }[variant]
  return (
    <button
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      className={[
        'rounded-lg px-3 py-1.5 text-xs font-semibold transition',
        styles,
        disabled ? 'cursor-not-allowed opacity-50' : '',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function Pagination({
  page,
  total,
  limit,
  isFetching,
  onPageChange,
}: {
  page: number
  total: number
  limit: number
  isFetching: boolean
  onPageChange: (page: number) => void
}) {
  const pageCount = useMemo(() => Math.max(1, Math.ceil(total / limit)), [total, limit])
  return (
    <div className="flex items-center justify-between text-xs text-text-secondary">
      <div>
        Page <span className="font-semibold text-text-primary">{page + 1}</span> of {pageCount} •{' '}
        {total.toLocaleString()} total
        {isFetching && <span className="ml-2 italic">refreshing…</span>}
      </div>
      <div className="flex gap-2">
        <SmallButton
          variant="ghost"
          onClick={() => onPageChange(Math.max(0, page - 1))}
          disabled={page === 0}
          testId="ride-board-prev-page"
        >
          ← Prev
        </SmallButton>
        <SmallButton
          variant="ghost"
          onClick={() => onPageChange(Math.min(pageCount - 1, page + 1))}
          disabled={page + 1 >= pageCount}
          testId="ride-board-next-page"
        >
          Next →
        </SmallButton>
      </div>
    </div>
  )
}

function ModalShell({
  children,
  onClose,
  testId,
}: {
  children: React.ReactNode
  onClose: () => void
  testId: string
}) {
  return (
    <div
      data-testid={testId}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}

function Skeleton({ h, testId }: { h: number; testId: string }) {
  return (
    <div
      data-testid={testId}
      className="animate-pulse rounded-2xl border border-border bg-white"
      style={{ height: h }}
    />
  )
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-danger/40 bg-danger/5 p-4 text-sm text-danger">
      {message}
    </div>
  )
}

function EmptyBox({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-border bg-white p-8 text-center text-sm text-text-secondary">
      {text}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
