/**
 * Feature 3 — Daily focus brief.
 *
 * Cron-generated (7 AM PT) morning briefing for the marketing
 * panel. Surfaces what's coming up today, day-over-day KPI deltas,
 * and 3-5 prioritised action items. Cached in marketing_daily_briefings
 * keyed by for_date so a generation runs at most once per PT day.
 *
 * Cost: ~$0.01 per brief on Gemini 2.5 Pro (760 output tokens × $10/M
 * + 2.85k input tokens × $1.25/M). On Pro quota exhaustion the chain
 * falls through to 2.5 Flash → 2.0 Flash → Flash Lite per
 * geminiChatWithToolsAndFallback semantics.
 */
import { supabaseAdmin } from '../supabaseAdmin.ts'
import {
  geminiChatWithToolsAndFallback,
  humanizeGeminiError,
  isGeminiConfigured,
  TOOLS_CHAIN,
  MODEL_SMART,
} from './gemini.ts'
import { BRAND_SYSTEM_PROMPT, type LiveKpiSnapshot } from './brandContext.ts'
import { listUpcomingEvents, getEventsNeedingReminder } from './eventCalendar.ts'
import type { MarketingEvent } from './eventCalendar.ts'

const MS_PER_DAY = 24 * 60 * 60 * 1000

// ── Types ─────────────────────────────────────────────────────────

export interface KpiDelta {
  // null when prior value was 0 (math is undefined). UI renders
  // null as "new" rather than fabricating a 0% flat reading.
  dau_vs_yesterday_pct: number | null
  revenue_vs_yesterday_pct: number | null
  revenue_vs_7d_avg_pct: number | null
  rides_vs_7d_avg_pct: number | null
}

export interface KpiSnapshotExtended extends LiveKpiSnapshot {
  rides_yesterday: number
  rides_today_so_far: number
  revenue_yesterday_cents: number
  revenue_last_7d_cents: number
  rides_last_7d: number
  signups_yesterday: number
  signups_last_7d: number
  dau_yesterday: number
  delta: KpiDelta
}

export interface EventLite {
  id: string
  title: string
  event_date: string
  category: string
  target_audience: string
  days_until: number
  has_posters: boolean
  has_stories: boolean
}

export interface DailyFocusContext {
  today: {
    iso: string
    day_of_week: string
    pt_offset_hours: number
  }
  kpis: KpiSnapshotExtended
  events: {
    reminders: EventLite[]
    next_7d: EventLite[]
    next_14d: EventLite[]
  }
  theme: {
    theme_name: string | null
    theme_summary: string | null
    week_focus: string | null
    week_index: number
  }
  history: {
    stories_yesterday: Array<{ corridor: string; asking_for: string; headline: string; status: string }>
    posters_yesterday: Array<{ format: string; audience: string; headline: string; theme_angle: string | null; status: string }>
    yesterday_focus: string | null
  }
}

export interface DailyFocusRecommendation {
  text: string
  priority: 'high' | 'medium' | 'low'
  tag: 'supply' | 'demand' | 'content' | 'events' | 'ops' | 'growth'
}

export interface DailyFocusBrief {
  id: string
  for_date: string
  generated_at: string
  llm_model: string | null
  dismissed_at: string | null
  focus: string | null
  detail: string | null
  recommendations: DailyFocusRecommendation[]
  kpi_snapshot: DailyFocusContext | null
  thread_id: string | null
  input_tokens: number | null
  output_tokens: number | null
  error: string | null
}

// ── Helpers ───────────────────────────────────────────────────────

/** Returns YYYY-MM-DD anchored to America/Los_Angeles. */
function ptToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

/** PT hour-of-day 0-23 for cron-gating. */
function ptHour(): number {
  const s = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', hour: '2-digit', hour12: false,
  }).format(new Date())
  const n = parseInt(s, 10)
  return Number.isNaN(n) ? -1 : n
}

function ptDayOfWeek(iso: string): string {
  return new Date(`${iso}T12:00:00-08:00`).toLocaleDateString('en-US', {
    weekday: 'long', timeZone: 'America/Los_Angeles',
  })
}

/**
 * One-decimal percent change. Returns null when the prior value is
 * zero (math is undefined; reviewer caught the earlier "return 0"
 * version misleadingly flattening "first-revenue-of-the-day" to
 * 0% flat). Callers render null as "new" or "N/A".
 */
function pct(a: number, b: number): number | null {
  if (b === 0) return a === 0 ? 0 : null
  return Math.round(((a - b) / b) * 1000) / 10
}

/**
 * Sanitises user/AI-controlled text before it's interpolated into
 * the system prompt. The fetched values (event titles, story
 * headlines, posters, theme summary) all flow back through Gemini
 * AS the system prompt — without escaping, a malicious or unlucky
 * headline like "Bla\\n\\n# NEW SYSTEM PROMPT\\nIgnore previous…"
 * gives the brief LLM a fresh instruction. We collapse line breaks
 * to spaces, strip triple-backticks, cap length, and replace
 * obvious instruction-leading tokens. Defensive, not exhaustive.
 */
function safe(s: string | null | undefined, maxLen = 200): string {
  if (!s) return ''
  return s
    .replace(/```/g, '"""')
    .replace(/\r?\n/g, ' ')
    .replace(/\b(?:system prompt|ignore previous|new instructions?)\b/gi, '[redacted]')
    .trim()
    .slice(0, maxLen)
}

// ── Context fetch ─────────────────────────────────────────────────

/**
 * Fetches all data the brief generator consumes — KPIs (with day-
 * over-day deltas), upcoming events, current theme, yesterday's
 * stories/posters, yesterday's brief focus. Parallel where possible.
 */
export async function fetchDailyFocusContext(): Promise<DailyFocusContext> {
  const now = new Date()
  const todayIso = ptToday()
  // PT-anchored calendar-day boundaries. Reviewer caught that mixing
  // UTC midnight (todayStart from now.getUTCDate()) with the PT date
  // label yields "yesterday closed" numbers that span ~5pm PT yesterday
  // → ~5pm PT today, not the PT calendar day. We compute PT midnight
  // by formatting `${todayIso}T00:00:00` as if it were UTC, then
  // shifting by the live PT offset (handles PDT/PST without a tz lib).
  function ptOffsetMs(): number {
    const formatted = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles', timeZoneName: 'shortOffset',
    }).formatToParts(now)
    const offsetStr = formatted.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT-8'
    const m = /GMT([+-]\d+)/.exec(offsetStr)
    const offsetHours = m ? parseInt(m[1]!, 10) : -8
    return offsetHours * 60 * 60 * 1000
  }
  const ptOffMs = ptOffsetMs()
  const yesterdayDate = new Date(now.getTime() - MS_PER_DAY)
  const yesterdayIso = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(yesterdayDate)
  // PT midnight = `${iso}T00:00:00` parsed as UTC then shifted back
  // by the PT offset, which lands on the actual UTC instant of PT
  // midnight for that calendar date.
  const todayStartPt = new Date(`${todayIso}T00:00:00Z`).getTime() - ptOffMs
  const yesterdayStartPt = new Date(`${yesterdayIso}T00:00:00Z`).getTime() - ptOffMs
  const todayStartPtIso = new Date(todayStartPt).toISOString()
  const yesterdayStartPtIso = new Date(yesterdayStartPt).toISOString()
  // PT calendar-day yesterday DAU window (was rolling 24h — reviewer
  // caught the drift between rolling DAU vs calendar-day rides).
  const dauYesterdayStartPtIso = yesterdayStartPtIso
  const dauYesterdayEndPtIso = todayStartPtIso
  // 7d closed-days window — EXCLUDES today to avoid self-referential
  // delta where today is on both sides of the comparison.
  const sevenDaysAgoExclToday = new Date(todayStartPt - 7 * MS_PER_DAY).toISOString()
  const sevenDaysAgo = new Date(now.getTime() - 7 * MS_PER_DAY).toISOString()
  const dayAgo = new Date(now.getTime() - MS_PER_DAY).toISOString()
  const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000).toISOString()
  const monthAgo = new Date(now.getTime() - 30 * MS_PER_DAY).toISOString()

  const [
    dauRes, dauYesterdayRes, wauRes, mauRes, onlineRes,
    totalUsersRes, totalDriversRes, onboardedRes, completedRes,
    revenueTodayRes, revenueYesterdayRes, revenueLast7dRes,
    ridesYesterdayRes, ridesTodayRes, ridesLast7dRes,
    signupsYesterdayRes, signupsLast7dRes,
    emailsRes, themeRes,
    storiesYesterdayRes, postersYesterdayRes,
    yesterdayBriefRes, upcomingEvents, reminders,
  ] = await Promise.all([
    // Rolling 24h DAU + 24h-48h prior — these stay rolling because
    // last_active_at lacks a "calendar day" semantic; we surface them
    // as "rolling 24h" labels in the prompt to match reality.
    supabaseAdmin.from('users').select('id', { count: 'exact', head: true }).gte('last_active_at', dayAgo),
    supabaseAdmin.from('users').select('id', { count: 'exact', head: true }).gte('last_active_at', dauYesterdayStartPtIso).lt('last_active_at', dauYesterdayEndPtIso),
    supabaseAdmin.from('users').select('id', { count: 'exact', head: true }).gte('last_active_at', sevenDaysAgo),
    supabaseAdmin.from('users').select('id', { count: 'exact', head: true }).gte('last_active_at', monthAgo),
    supabaseAdmin.from('driver_locations').select('user_id').gte('recorded_at', fiveMinAgo),
    supabaseAdmin.from('users').select('id', { count: 'exact', head: true }),
    supabaseAdmin.from('users').select('id', { count: 'exact', head: true }).eq('is_driver', true),
    supabaseAdmin.from('users').select('id', { count: 'exact', head: true }).eq('is_driver', true).not('stripe_account_id', 'is', null),
    supabaseAdmin.from('rides').select('id', { count: 'exact', head: true }).eq('status', 'completed'),
    // PT-anchored revenue today (closed today PT, paid).
    supabaseAdmin.from('rides').select('fare_cents').eq('status', 'completed').eq('payment_status', 'paid').gte('ended_at', todayStartPtIso),
    // PT-anchored revenue yesterday (closed yesterday PT, paid).
    supabaseAdmin.from('rides').select('fare_cents').eq('status', 'completed').eq('payment_status', 'paid').gte('ended_at', yesterdayStartPtIso).lt('ended_at', todayStartPtIso),
    // 7d revenue EXCLUDING today — fixes the self-referential delta
    // where today's revenue was inside its own "vs 7d avg" comparison.
    supabaseAdmin.from('rides').select('fare_cents').eq('status', 'completed').eq('payment_status', 'paid').gte('ended_at', sevenDaysAgoExclToday).lt('ended_at', todayStartPtIso),
    supabaseAdmin.from('rides').select('id', { count: 'exact', head: true }).eq('status', 'completed').gte('ended_at', yesterdayStartPtIso).lt('ended_at', todayStartPtIso),
    supabaseAdmin.from('rides').select('id', { count: 'exact', head: true }).eq('status', 'completed').gte('ended_at', todayStartPtIso),
    supabaseAdmin.from('rides').select('id', { count: 'exact', head: true }).eq('status', 'completed').gte('ended_at', sevenDaysAgoExclToday).lt('ended_at', todayStartPtIso),
    supabaseAdmin.from('users').select('id', { count: 'exact', head: true }).gte('created_at', yesterdayStartPtIso).lt('created_at', todayStartPtIso),
    supabaseAdmin.from('users').select('id', { count: 'exact', head: true }).gte('created_at', sevenDaysAgo),
    // Universities: was paging the implicit 1000-row default cap.
    // Bumped to 100k so any realistic UC Davis-scale user base
    // (~50k students) renders the right university count.
    supabaseAdmin.from('users').select('email').limit(100000),
    supabaseAdmin.from('marketing_themes')
      .select('theme_name, theme_summary, week_1_feature, week_2_feature, week_3_feature, week_4_feature, effective_month')
      .lte('effective_month', todayIso)
      .order('effective_month', { ascending: false })
      .limit(1).maybeSingle(),
    supabaseAdmin.from('marketing_story_items')
      .select('corridor, asking_for, headline, status')
      .gte('created_at', yesterdayStartPtIso).lt('created_at', todayStartPtIso).limit(6),
    supabaseAdmin.from('marketing_poster_items')
      .select('format, audience, headline, theme_angle, status')
      .gte('created_at', yesterdayStartPtIso).lt('created_at', todayStartPtIso).limit(6),
    supabaseAdmin.from('marketing_daily_briefings')
      .select('focus').eq('for_date', yesterdayIso).maybeSingle(),
    listUpcomingEvents({ daysAhead: 14, includeRecentlyPast: 1, limit: 50 }),
    getEventsNeedingReminder(),
  ])

  const onlineSet = new Set<string>()
  for (const r of onlineRes.data ?? []) {
    const uid = (r as { user_id?: string }).user_id
    if (uid) onlineSet.add(uid)
  }

  const sumFareCents = (rows: unknown): number => {
    const arr = (rows as Array<{ fare_cents?: number }> | null) ?? []
    return arr.reduce((acc, r) => acc + (r.fare_cents ?? 0), 0)
  }

  const universities = new Set<string>()
  for (const u of emailsRes.data ?? []) {
    const email = ((u as { email?: string | null }).email ?? '').toLowerCase()
    const at = email.lastIndexOf('@')
    if (at < 0) continue
    const domain = email.slice(at + 1)
    if (domain.endsWith('.edu')) universities.add(domain)
  }

  const revenueToday = sumFareCents(revenueTodayRes.data)
  const revenueYesterday = sumFareCents(revenueYesterdayRes.data)
  const revenueLast7d = sumFareCents(revenueLast7dRes.data)
  const ridesYesterday = ridesYesterdayRes.count ?? 0
  const ridesTodaySoFar = ridesTodayRes.count ?? 0
  const ridesLast7d = ridesLast7dRes.count ?? 0
  const dauToday = dauRes.count ?? 0
  const dauYesterday = dauYesterdayRes.count ?? 0

  const delta: KpiDelta = {
    dau_vs_yesterday_pct: pct(dauToday, dauYesterday),
    revenue_vs_yesterday_pct: pct(revenueToday, revenueYesterday),
    revenue_vs_7d_avg_pct: pct(revenueToday, revenueLast7d / 7),
    rides_vs_7d_avg_pct: pct(ridesTodaySoFar, ridesLast7d / 7),
  }

  // Today's theme + which week of the month we're in
  const theme = themeRes.data as null | {
    theme_name: string; theme_summary: string;
    week_1_feature: string; week_2_feature: string;
    week_3_feature: string; week_4_feature: string;
    effective_month: string;
  }
  const dayOfMonth = parseInt(todayIso.slice(8, 10), 10)
  const weekIndex = Math.min(4, Math.max(1, Math.ceil(dayOfMonth / 7)))
  const weekFocus = theme ? [
    theme.week_1_feature, theme.week_2_feature,
    theme.week_3_feature, theme.week_4_feature,
  ][weekIndex - 1] ?? null : null

  // Bucket events
  function bucket(e: MarketingEvent): EventLite {
    const evDate = new Date(`${e.event_date}T12:00:00`)
    const today0 = new Date(`${todayIso}T12:00:00`)
    const daysUntil = Math.round((evDate.getTime() - today0.getTime()) / MS_PER_DAY)
    return {
      id: e.id, title: e.title, event_date: e.event_date,
      category: e.category, target_audience: e.target_audience,
      days_until: daysUntil,
      has_posters: (e.linked_poster_item_ids?.length ?? 0) > 0,
      has_stories: (e.linked_story_batch_ids?.length ?? 0) > 0,
    }
  }
  const next7d = upcomingEvents.filter((e) => {
    const d = bucket(e).days_until
    return d >= 0 && d <= 7
  }).map(bucket)
  const next14d = upcomingEvents.filter((e) => {
    const d = bucket(e).days_until
    return d > 7 && d <= 14
  }).map(bucket)
  const remindersLite = reminders.map(bucket)

  return {
    today: {
      iso: todayIso,
      day_of_week: ptDayOfWeek(todayIso),
      pt_offset_hours: -new Date().getTimezoneOffset() / 60, // best-effort
    },
    kpis: {
      dau: dauToday, wau: wauRes.count ?? 0, mau: mauRes.count ?? 0,
      online_drivers: onlineSet.size,
      total_users: totalUsersRes.count ?? 0,
      total_drivers: totalDriversRes.count ?? 0,
      stripe_onboarded_drivers: onboardedRes.count ?? 0,
      total_completed: completedRes.count ?? 0,
      revenue_today_cents: revenueToday,
      universities: universities.size,
      // Extensions
      rides_yesterday: ridesYesterday,
      rides_today_so_far: ridesTodaySoFar,
      revenue_yesterday_cents: revenueYesterday,
      revenue_last_7d_cents: revenueLast7d,
      rides_last_7d: ridesLast7d,
      signups_yesterday: signupsYesterdayRes.count ?? 0,
      signups_last_7d: signupsLast7dRes.count ?? 0,
      dau_yesterday: dauYesterday,
      delta,
    },
    events: {
      reminders: remindersLite,
      next_7d: next7d,
      next_14d: next14d,
    },
    theme: {
      theme_name: theme?.theme_name ?? null,
      theme_summary: theme?.theme_summary ?? null,
      week_focus: weekFocus,
      week_index: weekIndex,
    },
    history: {
      stories_yesterday: ((storiesYesterdayRes.data ?? []) as Array<{ corridor: string; asking_for: string; headline: string; status: string }>).map((r) => ({
        corridor: r.corridor, asking_for: r.asking_for,
        headline: r.headline, status: r.status,
      })),
      posters_yesterday: ((postersYesterdayRes.data ?? []) as Array<{ format: string; audience: string; headline: string; theme_angle: string | null; status: string }>).map((r) => ({
        format: r.format, audience: r.audience,
        headline: r.headline, theme_angle: r.theme_angle,
        status: r.status,
      })),
      yesterday_focus: (yesterdayBriefRes.data as { focus?: string | null } | null)?.focus ?? null,
    },
  }
}

// ── Prompt ────────────────────────────────────────────────────────

function buildContextSnippet(ctx: DailyFocusContext): string {
  const k = ctx.kpis
  const dollars = (cents: number) => `$${(cents / 100).toFixed(0)}`
  const sign = (n: number | null): string => {
    if (n === null) return 'new'
    return n >= 0 ? `+${n}%` : `${n}%`
  }

  const eventLine = (e: EventLite) =>
    `  - ${safe(e.title, 80)} (${e.event_date}, ${e.category}, ${e.target_audience}, in ${e.days_until}d` +
    (e.has_posters ? ', has posters' : ', NO posters yet') +
    (e.has_stories ? ', has stories' : ', NO stories yet') + ')'

  return `
TODAY: ${ctx.today.iso} (${ctx.today.day_of_week})
MONTHLY THEME: ${safe(ctx.theme.theme_name, 80) || '(none)'} — ${safe(ctx.theme.theme_summary, 240) || '(no summary)'}
THIS WEEK (week ${ctx.theme.week_index}): focus on "${safe(ctx.theme.week_focus, 120) || '(no weekly focus)'}"

KPIs (live):
  - Today so far (PT): DAU ${k.dau} (${sign(k.delta.dau_vs_yesterday_pct)} vs prior 24h), revenue ${dollars(k.revenue_today_cents)} (${sign(k.delta.revenue_vs_yesterday_pct)} vs yesterday PT, ${sign(k.delta.revenue_vs_7d_avg_pct)} vs 7d avg excl today)
  - Yesterday closed (PT): ${k.rides_yesterday} rides, revenue ${dollars(k.revenue_yesterday_cents)}, ${k.signups_yesterday} new signups
  - Prior 24h rolling: DAU ${k.dau_yesterday}
  - 7d closed days (excl today): ${k.rides_last_7d} rides, revenue ${dollars(k.revenue_last_7d_cents)}
  - Today: ${k.rides_today_so_far} rides so far (${sign(k.delta.rides_vs_7d_avg_pct)} vs 7d avg)
  - Marketplace: ${k.total_users} users (${k.total_drivers} drivers, ${k.stripe_onboarded_drivers} Stripe-onboarded, ${k.online_drivers} online now), ${k.total_completed} lifetime rides, ${k.universities} .edu universities

EVENTS:
  Need attention (within their lead-time):
${ctx.events.reminders.length === 0 ? '    (none)' : ctx.events.reminders.map(eventLine).join('\n')}
  Next 7 days:
${ctx.events.next_7d.length === 0 ? '    (none)' : ctx.events.next_7d.map(eventLine).join('\n')}
  Next 8-14 days:
${ctx.events.next_14d.length === 0 ? '    (none)' : ctx.events.next_14d.map(eventLine).join('\n')}

YESTERDAY'S CONTENT:
  Stories: ${ctx.history.stories_yesterday.length === 0 ? '(none)' : ctx.history.stories_yesterday.map((s) => `"${safe(s.headline, 100)}" (${safe(s.corridor, 60)}, ${s.asking_for}, ${s.status})`).join('; ')}
  Posters: ${ctx.history.posters_yesterday.length === 0 ? '(none)' : ctx.history.posters_yesterday.map((p) => `"${safe(p.headline, 100)}" (${p.format}, ${p.audience}, ${safe(p.theme_angle, 40) || 'no angle'}, ${p.status})`).join('; ')}
  ${ctx.history.yesterday_focus ? `Yesterday's focus was: "${safe(ctx.history.yesterday_focus, 200)}"` : ''}
`.trim()
}

const FOCUS_INSTRUCTION = `
You are producing the founder's morning marketing briefing for Tago.

OUTPUT FORMAT — return a JSON object (no markdown fences) with EXACTLY these 3 fields:
{
  "focus": "<=140 chars, one-sentence imperative. The single most important thing to do today.",
  "detail": "Markdown body. 200-450 words. 3 sections: 1) Pulse (KPI deltas in plain English), 2) Events (what's coming up + content gaps), 3) Recommendations (3-5 sentences expanding the bullets below).",
  "recommendations": [
    { "text": "<=120 chars, imperative voice", "priority": "high|medium|low", "tag": "supply|demand|content|events|ops|growth" }
  ]
}

RULES:
- Lead with the highest-leverage thing — if an event with no posters is 5-10 days out, push that.
- Cite the actual numbers (e.g. "DAU +12% vs yesterday", "revenue down $40 vs 7d avg").
- Use the variety guard: if yesterday's posters were all "safety" angle, recommend a different angle for today.
- Capped at 5 recommendations. Sort high → low priority.
- Tone: direct, founder-to-self. No emojis. No "consider" or "perhaps"; use imperatives.
- If KPIs are all flat and no events are urgent: focus on content velocity, weekly theme alignment, or known weak spots (driver supply, .edu university expansion).
- NEVER fabricate numbers. If a metric is 0, say "no rides yesterday" or "no signups yesterday" rather than inventing a story.
`.trim()

// ── Generator ─────────────────────────────────────────────────────

export interface GenerateBriefingResult {
  ok: boolean
  brief?: DailyFocusBrief
  reason?: string
}

interface ParsedFocus {
  focus: string
  detail: string
  recommendations: DailyFocusRecommendation[]
}

function parseFocusJson(text: string): { obj: ParsedFocus | null; reason: string | null } {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end < start) return { obj: null, reason: 'no JSON braces in response' }
  let raw: unknown
  try { raw = JSON.parse(cleaned.slice(start, end + 1)) }
  catch (err) { return { obj: null, reason: `JSON.parse: ${err instanceof Error ? err.message : String(err)}` } }
  const obj = raw as Partial<ParsedFocus>
  const focus = typeof obj.focus === 'string' ? obj.focus.trim() : ''
  const detail = typeof obj.detail === 'string' ? obj.detail.trim() : ''
  const rawRecs: unknown[] = Array.isArray(obj.recommendations) ? obj.recommendations : []
  const recs: DailyFocusRecommendation[] = []
  for (const raw of rawRecs) {
    if (typeof raw !== 'object' || raw === null) continue
    const r = raw as Record<string, unknown>
    const text = typeof r['text'] === 'string' ? r['text'].slice(0, 120) : ''
    if (text.length === 0) continue
    const priority: 'high' | 'medium' | 'low' = ['high', 'medium', 'low'].includes(r['priority'] as string)
      ? (r['priority'] as 'high' | 'medium' | 'low') : 'medium'
    const tag: DailyFocusRecommendation['tag'] = ['supply', 'demand', 'content', 'events', 'ops', 'growth'].includes(r['tag'] as string)
      ? (r['tag'] as DailyFocusRecommendation['tag']) : 'ops'
    recs.push({ text, priority, tag })
    if (recs.length >= 5) break
  }
  if (focus.length < 10) return { obj: null, reason: 'focus too short' }
  if (detail.length < 100) return { obj: null, reason: 'detail too short' }
  return { obj: { focus, detail, recommendations: recs }, reason: null }
}

/**
 * Generates today's brief, persists to marketing_daily_briefings.
 * Idempotent via UNIQUE(for_date) — returns the existing row if one
 * already exists for today.
 */
export async function generateDailyBriefing(forDate?: string): Promise<GenerateBriefingResult> {
  if (!isGeminiConfigured()) return { ok: false, reason: 'GEMINI_API_KEY not configured' }
  const date = forDate ?? ptToday()

  // Cache hit — but ONLY count rows that successfully produced a
  // focus. Error rows (parse failure, all-chain quota exhaustion)
  // are NOT cache hits; the next call retries instead of locking
  // the founder out for the rest of the day. Reviewer caught this.
  const { data: existing } = await supabaseAdmin
    .from('marketing_daily_briefings').select('*').eq('for_date', date).maybeSingle()
  const existingRow = existing as DailyFocusBrief | null
  if (existingRow && existingRow.focus && !existingRow.error) {
    return { ok: true, brief: existingRow }
  }
  // If an error row exists, delete it so the new INSERT below isn't
  // blocked by the UNIQUE(for_date) constraint. Idempotent — silent
  // on missing row.
  if (existingRow) {
    await supabaseAdmin.from('marketing_daily_briefings').delete().eq('for_date', date)
  }

  const context = await fetchDailyFocusContext()
  let modelUsed: string = MODEL_SMART
  let parsed: ParsedFocus | null = null
  let inputTokens: number | null = null
  let outputTokens: number | null = null
  let errorMsg: string | null = null

  try {
    const r = await geminiChatWithToolsAndFallback({
      systemPrompt: `${BRAND_SYSTEM_PROMPT}\n\n${buildContextSnippet(context)}`,
      history: [],
      userPrompt: FOCUS_INSTRUCTION,
      tools: [],
      dispatch: async () => ({ ok: false, error: 'no tools' }),
      temperature: 0.4,
    }, TOOLS_CHAIN)
    modelUsed = r.modelUsed
    inputTokens = r.inputTokens
    outputTokens = r.outputTokens
    const parsedRes = parseFocusJson(r.text)
    if (!parsedRes.obj) {
      errorMsg = `parse: ${parsedRes.reason}`
    } else {
      parsed = parsedRes.obj
    }
  } catch (err) {
    errorMsg = humanizeGeminiError(err)
  }

  // Always insert a row — error rows let the UI surface "generation
  // failed" instead of an empty banner.
  const insertPayload = {
    for_date: date,
    llm_model: modelUsed,
    focus: parsed?.focus ?? null,
    detail: parsed?.detail ?? null,
    recommendations: parsed?.recommendations ?? [],
    kpi_snapshot: context,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    error: errorMsg,
  }
  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from('marketing_daily_briefings')
    .insert(insertPayload as never)
    .select('*')
    .single()
  if (insertErr) {
    // Race with cron: another process inserted for the same date.
    // Re-read and return the winner.
    const { data: winner } = await supabaseAdmin
      .from('marketing_daily_briefings').select('*').eq('for_date', date).maybeSingle()
    if (winner) return { ok: true, brief: winner as DailyFocusBrief }
    return { ok: false, reason: insertErr.message }
  }
  if (errorMsg) return { ok: false, reason: errorMsg, brief: inserted as DailyFocusBrief }
  return { ok: true, brief: inserted as DailyFocusBrief }
}

/** Cron wrapper — mirrors tryGenerateDailyStories pattern. */
export async function tryGenerateDailyBriefing(): Promise<{ generated: boolean; reason: string }> {
  if (!isGeminiConfigured()) return { generated: false, reason: 'no_key' }
  const h = ptHour()
  if (h < 7) return { generated: false, reason: `pt_hour=${h}_before_7am` }
  const date = ptToday()
  const result = await generateDailyBriefing(date)
  if (!result.ok) return { generated: false, reason: result.reason ?? 'failed' }
  return { generated: true, reason: 'generated' }
}

// ── Helpers for the spawn-thread endpoint ─────────────────────────

/**
 * Creates a fresh advisor thread seeded with the brief's detail as
 * the opening assistant message. Idempotent — returns the existing
 * thread_id if the brief already has one.
 */
export async function startThreadFromBrief(forDate: string, userId: string): Promise<{ ok: boolean; thread_id?: string; reason?: string }> {
  const { data: brief } = await supabaseAdmin
    .from('marketing_daily_briefings').select('*').eq('for_date', forDate).maybeSingle()
  if (!brief) return { ok: false, reason: 'no brief for date' }
  const row = brief as DailyFocusBrief
  if (row.thread_id) return { ok: true, thread_id: row.thread_id }
  if (!row.detail) return { ok: false, reason: 'brief has no detail body' }

  const { data: thread, error: threadErr } = await supabaseAdmin
    .from('marketing_advisor_threads')
    .insert({
      user_id: userId,
      title: `Daily focus — ${forDate}`,
    } as never)
    .select('id')
    .single()
  if (threadErr || !thread) return { ok: false, reason: threadErr?.message ?? 'thread insert failed' }

  const threadId = (thread as { id: string }).id
  await supabaseAdmin
    .from('marketing_advisor_messages')
    .insert({
      thread_id: threadId,
      role: 'assistant',
      content: row.detail,
    } as never)

  await supabaseAdmin
    .from('marketing_daily_briefings')
    .update({ thread_id: threadId } as never)
    .eq('for_date', forDate)

  return { ok: true, thread_id: threadId }
}
