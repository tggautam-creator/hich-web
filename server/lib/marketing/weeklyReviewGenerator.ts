/**
 * Feature 4 — Weekly Slack review.
 *
 * Every Monday at 9 AM PT, summarizes the prior week (last Mon-Sun)
 * and POSTs to SLACK_MARKETING_WEBHOOK_URL. The cron is idempotent
 * via UNIQUE(for_week_starting) on marketing_weekly_reviews — a
 * retry within the same Monday no-ops.
 *
 * Cost: ~$0.01-0.02 per review on Gemini 2.5 Pro. One per week.
 */
import { supabaseAdmin } from '../supabaseAdmin.ts'
import { getServerEnv } from '../../env.ts'
import {
  geminiChatWithToolsAndFallback,
  humanizeGeminiError,
  isGeminiConfigured,
  TOOLS_CHAIN,
  MODEL_SMART,
} from './gemini.ts'
import { BRAND_SYSTEM_PROMPT } from './brandContext.ts'
import { listUpcomingEvents } from './eventCalendar.ts'
import { postToSlackUrl, type SlackBlock, type SlackMessage } from '../slackWebhook.ts'

const MS_PER_DAY = 24 * 60 * 60 * 1000

// ── Types ─────────────────────────────────────────────────────────

export interface WeeklyHighlight {
  /** Short text marker (NOT an emoji shortcode — Slack renders
   *  Unicode directly. We deliberately pass through; no expansion. */
  icon: string
  text: string
}

export interface WeeklyContext {
  for_week_starting: string  // Monday ISO
  for_week_ending: string    // Sunday ISO
  metrics: {
    rides_this_week: number
    revenue_this_week_cents: number
    rides_prev_week: number
    revenue_prev_week_cents: number
    signups_this_week: number
    signups_prev_week: number
    dau_this_week: number
    new_drivers_this_week: number
  }
  content: {
    stories_shipped: number
    stories_posted: number
    stories_skipped: number
    posters_shipped: number
    posters_posted: number
    posters_skipped: number
    top_corridors: string[]
    top_poster_angles: string[]
  }
  theme: {
    theme_name: string | null
    theme_summary: string | null
  }
  events: {
    next_7d: Array<{ title: string; event_date: string; category: string; days_until: number }>
  }
}

export interface WeeklyReview {
  id: string
  for_week_starting: string
  generated_at: string
  llm_model: string | null
  summary: string | null
  highlights: WeeklyHighlight[]
  next_week_focus: string | null
  context_snapshot: WeeklyContext | null
  slack_payload: SlackMessage | null
  slack_sent_at: string | null
  slack_response_status: number | null
  slack_response_body: string | null
  input_tokens: number | null
  output_tokens: number | null
  error: string | null
}

// ── PT helpers ────────────────────────────────────────────────────

function ptHour(): number {
  const s = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', hour: '2-digit', hour12: false,
  }).format(new Date())
  const n = parseInt(s, 10)
  return Number.isNaN(n) ? -1 : n
}

function ptDayOfWeek(): number {
  // 0=Sunday, 1=Monday, …, 6=Saturday — same convention as Date.getDay
  const s = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', weekday: 'short',
  }).format(new Date())
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return map[s] ?? -1
}

function ptToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

function ptOffsetMs(): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', timeZoneName: 'shortOffset',
  }).formatToParts(new Date())
  const offsetStr = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT-8'
  const m = /GMT([+-]\d+)/.exec(offsetStr)
  const hours = m ? parseInt(m[1]!, 10) : -8
  return hours * 60 * 60 * 1000
}

/** Returns the Monday ISO for the week before the current week (PT). */
function lastWeekMondayPt(): string {
  // PT today's day-of-week → step back to last Monday
  const today = new Date(`${ptToday()}T12:00:00`)
  const dow = ptDayOfWeek()  // 0=Sun..6=Sat
  // distance back to the Monday OF THIS WEEK
  const distanceToThisWeekMon = (dow + 6) % 7  // 0 for Mon, 1 for Tue, …
  // last week's Monday is this-week-Monday minus 7 days
  const lastMon = new Date(today.getTime() - (distanceToThisWeekMon + 7) * MS_PER_DAY)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(lastMon)
}

function addDaysIso(iso: string, days: number): string {
  const t = new Date(`${iso}T12:00:00`).getTime() + days * MS_PER_DAY
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(t))
}

function ptMidnightUtc(iso: string): string {
  return new Date(new Date(`${iso}T00:00:00Z`).getTime() - ptOffsetMs()).toISOString()
}

// ── Context fetch ─────────────────────────────────────────────────

function safeStr(s: string | null | undefined, max = 200): string {
  if (!s) return ''
  return s
    .replace(/```/g, '"""')
    .replace(/\r?\n/g, ' ')
    .replace(/\b(?:system prompt|ignore previous|new instructions?)\b/gi, '[redacted]')
    .trim()
    .slice(0, max)
}

export async function fetchWeeklyContext(forWeekStarting: string): Promise<WeeklyContext> {
  const weekEnd = addDaysIso(forWeekStarting, 6)
  const weekStartIso = ptMidnightUtc(forWeekStarting)
  const weekEndIso = ptMidnightUtc(addDaysIso(forWeekStarting, 7)) // exclusive
  const prevWeekStart = addDaysIso(forWeekStarting, -7)
  const prevWeekStartIso = ptMidnightUtc(prevWeekStart)
  const prevWeekEndIso = weekStartIso  // prev week ends where this week begins

  const [
    ridesThis, revenueThis, ridesPrev, revenuePrev,
    signupsThis, signupsPrev, dauThis, newDriversThis,
    storyItems, posterItems, themeRow, upcomingEvents,
  ] = await Promise.all([
    supabaseAdmin.from('rides').select('id', { count: 'exact', head: true })
      .eq('status', 'completed').gte('ended_at', weekStartIso).lt('ended_at', weekEndIso),
    supabaseAdmin.from('rides').select('fare_cents')
      .eq('status', 'completed').eq('payment_status', 'paid')
      .gte('ended_at', weekStartIso).lt('ended_at', weekEndIso),
    supabaseAdmin.from('rides').select('id', { count: 'exact', head: true })
      .eq('status', 'completed').gte('ended_at', prevWeekStartIso).lt('ended_at', prevWeekEndIso),
    supabaseAdmin.from('rides').select('fare_cents')
      .eq('status', 'completed').eq('payment_status', 'paid')
      .gte('ended_at', prevWeekStartIso).lt('ended_at', prevWeekEndIso),
    supabaseAdmin.from('users').select('id', { count: 'exact', head: true })
      .gte('created_at', weekStartIso).lt('created_at', weekEndIso),
    supabaseAdmin.from('users').select('id', { count: 'exact', head: true })
      .gte('created_at', prevWeekStartIso).lt('created_at', prevWeekEndIso),
    supabaseAdmin.from('users').select('id', { count: 'exact', head: true })
      .gte('last_active_at', weekStartIso).lt('last_active_at', weekEndIso),
    supabaseAdmin.from('users').select('id', { count: 'exact', head: true })
      .eq('is_driver', true).gte('created_at', weekStartIso).lt('created_at', weekEndIso),
    supabaseAdmin.from('marketing_story_items')
      .select('corridor, status')
      .gte('created_at', weekStartIso).lt('created_at', weekEndIso).limit(200),
    supabaseAdmin.from('marketing_poster_items')
      .select('theme_angle, status')
      .gte('created_at', weekStartIso).lt('created_at', weekEndIso).limit(200),
    supabaseAdmin.from('marketing_themes')
      .select('theme_name, theme_summary, effective_month')
      .lte('effective_month', forWeekStarting)
      .order('effective_month', { ascending: false })
      .limit(1).maybeSingle(),
    listUpcomingEvents({ daysAhead: 7, includeRecentlyPast: 0, limit: 20 }),
  ])

  const sumFare = (rows: unknown): number => {
    const arr = (rows as Array<{ fare_cents?: number }> | null) ?? []
    return arr.reduce((acc, r) => acc + (r.fare_cents ?? 0), 0)
  }

  const stories = (storyItems.data ?? []) as Array<{ corridor: string; status: string }>
  const posters = (posterItems.data ?? []) as Array<{ theme_angle: string | null; status: string }>

  // Top-3 corridors by count
  const corridorCount = new Map<string, number>()
  for (const s of stories) {
    corridorCount.set(s.corridor, (corridorCount.get(s.corridor) ?? 0) + 1)
  }
  const topCorridors = Array.from(corridorCount.entries())
    .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c]) => c)

  const angleCount = new Map<string, number>()
  for (const p of posters) {
    const a = p.theme_angle ?? 'unspecified'
    angleCount.set(a, (angleCount.get(a) ?? 0) + 1)
  }
  const topAngles = Array.from(angleCount.entries())
    .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([a]) => a)

  const theme = themeRow.data as null | { theme_name: string; theme_summary: string }

  return {
    for_week_starting: forWeekStarting,
    for_week_ending: weekEnd,
    metrics: {
      rides_this_week: ridesThis.count ?? 0,
      revenue_this_week_cents: sumFare(revenueThis.data),
      rides_prev_week: ridesPrev.count ?? 0,
      revenue_prev_week_cents: sumFare(revenuePrev.data),
      signups_this_week: signupsThis.count ?? 0,
      signups_prev_week: signupsPrev.count ?? 0,
      dau_this_week: dauThis.count ?? 0,
      new_drivers_this_week: newDriversThis.count ?? 0,
    },
    content: {
      stories_shipped: stories.length,
      stories_posted: stories.filter((s) => s.status === 'posted').length,
      stories_skipped: stories.filter((s) => s.status === 'skipped').length,
      posters_shipped: posters.length,
      posters_posted: posters.filter((p) => p.status === 'posted').length,
      posters_skipped: posters.filter((p) => p.status === 'skipped').length,
      top_corridors: topCorridors,
      top_poster_angles: topAngles,
    },
    theme: {
      theme_name: theme?.theme_name ?? null,
      theme_summary: theme?.theme_summary ?? null,
    },
    events: {
      next_7d: upcomingEvents.slice(0, 10).map((e) => {
        const today0 = new Date(`${ptToday()}T12:00:00`).getTime()
        const evT = new Date(`${e.event_date}T12:00:00`).getTime()
        return {
          title: safeStr(e.title, 80),
          event_date: e.event_date,
          category: e.category,
          days_until: Math.round((evT - today0) / MS_PER_DAY),
        }
      }),
    },
  }
}

// ── Prompt ────────────────────────────────────────────────────────

function buildContextSnippet(ctx: WeeklyContext): string {
  const m = ctx.metrics
  const c = ctx.content
  const dollars = (cents: number) => `$${(cents / 100).toFixed(0)}`
  const pctChange = (now: number, prev: number): string => {
    if (prev === 0) return now === 0 ? 'flat' : 'new'
    const v = Math.round(((now - prev) / prev) * 1000) / 10
    return v >= 0 ? `+${v}%` : `${v}%`
  }

  return `
WEEK REVIEWED: ${ctx.for_week_starting} → ${ctx.for_week_ending} (Mon–Sun, PT)
MONTHLY THEME: ${safeStr(ctx.theme.theme_name, 80) || '(none)'} — ${safeStr(ctx.theme.theme_summary, 240) || '(none)'}

ACTIVITY:
  - Rides: ${m.rides_this_week} (${pctChange(m.rides_this_week, m.rides_prev_week)} vs prev week)
  - Revenue: ${dollars(m.revenue_this_week_cents)} (${pctChange(m.revenue_this_week_cents, m.revenue_prev_week_cents)} vs prev week)
  - Signups: ${m.signups_this_week} (${pctChange(m.signups_this_week, m.signups_prev_week)} vs prev week)
  - DAU (rolling 7d): ${m.dau_this_week}
  - New drivers: ${m.new_drivers_this_week}

CONTENT SHIPPED:
  - Stories: ${c.stories_shipped} generated, ${c.stories_posted} posted, ${c.stories_skipped} skipped
  - Posters: ${c.posters_shipped} generated, ${c.posters_posted} posted, ${c.posters_skipped} skipped
  - Top corridors: ${c.top_corridors.length === 0 ? '(none)' : c.top_corridors.join(', ')}
  - Top poster angles: ${c.top_poster_angles.length === 0 ? '(none)' : c.top_poster_angles.join(', ')}

NEXT 7 DAYS:
${ctx.events.next_7d.length === 0 ? '  (no calendar events)' :
  ctx.events.next_7d.map((e) =>
    `  - ${e.title} on ${e.event_date} (${e.category}, in ${e.days_until}d)`,
  ).join('\n')}
`.trim()
}

const REVIEW_INSTRUCTION = `
You are producing the founder's weekly marketing recap for Tago,
posted to a Slack channel every Monday morning.

OUTPUT FORMAT — return a JSON object (no markdown fences) with EXACTLY these 3 fields:
{
  "summary": "1-3 sentences. The headline read of the week — what happened, what moved, what didn't. <=400 chars.",
  "highlights": [
    { "icon": "[positive Unicode marker, e.g. \\u2714, \\u2191, \\u2605]", "text": "<=140 chars, one fact + its meaning" }
  ],
  "next_week_focus": "1-2 sentences. The recommended pivot for next week, grounded in the metrics + content + events above. <=400 chars."
}

RULES:
- 3-6 highlights. Mix wins ([wins]) and gaps ([gaps]) — Slack readers see this skimmed.
- Cite actual numbers (e.g. "revenue +18% to $620", "Davis→SF posted 4 of 6 stories, skipped 2"). Never fabricate.
- Tone: direct, founder-to-team. No emoji shortcodes (Slack renders raw Unicode; use \\u2191 not :arrow_up:).
- next_week_focus must reference at least one specific event from the next-7-days list OR one specific number from the activity block.
- If metrics are flat / no content shipped: focus next_week_focus on content velocity + onboarding wins.
- Do NOT generate marketing copy — this is a recap, not a campaign.
`.trim()

// ── LLM call ──────────────────────────────────────────────────────

interface ParsedReview {
  summary: string
  highlights: WeeklyHighlight[]
  next_week_focus: string
}

function parseReviewJson(text: string): { obj: ParsedReview | null; reason: string | null } {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end < start) return { obj: null, reason: 'no JSON braces' }
  let raw: unknown
  try { raw = JSON.parse(cleaned.slice(start, end + 1)) }
  catch (err) { return { obj: null, reason: `JSON.parse: ${err instanceof Error ? err.message : String(err)}` } }
  const obj = raw as Partial<ParsedReview>
  const summary = typeof obj.summary === 'string' ? obj.summary.trim().slice(0, 400) : ''
  const next_week_focus = typeof obj.next_week_focus === 'string' ? obj.next_week_focus.trim().slice(0, 400) : ''
  const rawHighlights: unknown[] = Array.isArray(obj.highlights) ? obj.highlights : []
  const highlights: WeeklyHighlight[] = []
  for (const raw of rawHighlights) {
    if (typeof raw !== 'object' || raw === null) continue
    const r = raw as Record<string, unknown>
    const icon = typeof r['icon'] === 'string' ? r['icon'].slice(0, 8) : '•'
    const text = typeof r['text'] === 'string' ? r['text'].slice(0, 140) : ''
    if (text.length === 0) continue
    highlights.push({ icon, text })
    if (highlights.length >= 6) break
  }
  if (summary.length < 10) return { obj: null, reason: 'summary too short' }
  if (highlights.length === 0) return { obj: null, reason: 'no highlights' }
  return { obj: { summary, highlights, next_week_focus }, reason: null }
}

// ── Block Kit ─────────────────────────────────────────────────────

export function buildSlackMessage(review: WeeklyReview, context: WeeklyContext): SlackMessage {
  const m = context.metrics
  const c = context.content
  const dollars = (cents: number) => `$${(cents / 100).toFixed(0)}`
  const pctChange = (now: number, prev: number): string => {
    if (prev === 0) return now === 0 ? 'flat' : 'new'
    const v = Math.round(((now - prev) / prev) * 1000) / 10
    return v >= 0 ? `+${v}%` : `${v}%`
  }

  const headerText = `Weekly recap · ${context.for_week_starting} → ${context.for_week_ending}`

  const blocks: SlackBlock[] = [
    { type: 'header', text: { type: 'plain_text', text: headerText } },
    { type: 'section', text: { type: 'mrkdwn', text: review.summary ?? '_no summary_' } },
    { type: 'divider' },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: '*Activity*' },
      fields: [
        { type: 'mrkdwn', text: `*Rides:* ${m.rides_this_week} (${pctChange(m.rides_this_week, m.rides_prev_week)})` },
        { type: 'mrkdwn', text: `*Revenue:* ${dollars(m.revenue_this_week_cents)} (${pctChange(m.revenue_this_week_cents, m.revenue_prev_week_cents)})` },
        { type: 'mrkdwn', text: `*Signups:* ${m.signups_this_week} (${pctChange(m.signups_this_week, m.signups_prev_week)})` },
        { type: 'mrkdwn', text: `*New drivers:* ${m.new_drivers_this_week}` },
      ],
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: '*Content shipped*' },
      fields: [
        { type: 'mrkdwn', text: `*Stories:* ${c.stories_shipped} generated · ${c.stories_posted} posted · ${c.stories_skipped} skipped` },
        { type: 'mrkdwn', text: `*Posters:* ${c.posters_shipped} generated · ${c.posters_posted} posted · ${c.posters_skipped} skipped` },
      ],
    },
  ]

  if (review.highlights.length > 0) {
    blocks.push({ type: 'divider' })
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Highlights*\n${review.highlights.map((h) => `${h.icon} ${h.text}`).join('\n')}`,
      },
    })
  }

  if (context.events.next_7d.length > 0) {
    blocks.push({ type: 'divider' })
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Next 7 days*\n${context.events.next_7d.slice(0, 5).map((e) =>
          `• ${e.event_date} — ${e.title} (${e.category}, in ${e.days_until}d)`,
        ).join('\n')}`,
      },
    })
  }

  if (review.next_week_focus) {
    blocks.push({ type: 'divider' })
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Focus for next week*\n${review.next_week_focus}` },
    })
  }

  return {
    text: `Weekly marketing recap for ${context.for_week_starting} → ${context.for_week_ending}: ${(review.summary ?? '').slice(0, 200)}`,
    blocks,
  }
}

// ── Generator ─────────────────────────────────────────────────────

export interface GenerateReviewResult {
  ok: boolean
  review?: WeeklyReview
  reason?: string
}

export async function generateWeeklyReview(forWeekStarting?: string): Promise<GenerateReviewResult> {
  if (!isGeminiConfigured()) return { ok: false, reason: 'GEMINI_API_KEY not configured' }
  const weekStart = forWeekStarting ?? lastWeekMondayPt()

  const { data: existing } = await supabaseAdmin
    .from('marketing_weekly_reviews').select('*').eq('for_week_starting', weekStart).maybeSingle()
  const existingRow = existing as WeeklyReview | null
  if (existingRow && existingRow.summary && !existingRow.error) {
    return { ok: true, review: existingRow }
  }
  if (existingRow) {
    await supabaseAdmin.from('marketing_weekly_reviews').delete().eq('for_week_starting', weekStart)
  }

  const context = await fetchWeeklyContext(weekStart)
  let modelUsed: string = MODEL_SMART
  let parsed: ParsedReview | null = null
  let inputTokens: number | null = null
  let outputTokens: number | null = null
  let errorMsg: string | null = null

  try {
    const r = await geminiChatWithToolsAndFallback({
      systemPrompt: `${BRAND_SYSTEM_PROMPT}\n\n${buildContextSnippet(context)}`,
      history: [],
      userPrompt: REVIEW_INSTRUCTION,
      tools: [],
      dispatch: async () => ({ ok: false, error: 'no tools' }),
      temperature: 0.4,
    }, TOOLS_CHAIN)
    modelUsed = r.modelUsed
    inputTokens = r.inputTokens
    outputTokens = r.outputTokens
    const p = parseReviewJson(r.text)
    if (!p.obj) errorMsg = `parse: ${p.reason}`
    else parsed = p.obj
  } catch (err) {
    errorMsg = humanizeGeminiError(err)
  }

  const review: Omit<WeeklyReview, 'id' | 'generated_at' | 'slack_sent_at' | 'slack_response_status' | 'slack_response_body'> = {
    for_week_starting: weekStart,
    llm_model: modelUsed,
    summary: parsed?.summary ?? null,
    highlights: parsed?.highlights ?? [],
    next_week_focus: parsed?.next_week_focus ?? null,
    context_snapshot: context,
    slack_payload: null,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    error: errorMsg,
  }

  // Build the Slack payload if we have a summary — store it so the
  // admin UI can preview before send.
  let payload: SlackMessage | null = null
  if (parsed) {
    payload = buildSlackMessage({
      ...(review as WeeklyReview), id: '', generated_at: '',
      slack_sent_at: null, slack_response_status: null, slack_response_body: null,
    }, context)
  }

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from('marketing_weekly_reviews')
    .insert({ ...review, slack_payload: payload } as never)
    .select('*').single()
  if (insertErr) {
    const { data: winner } = await supabaseAdmin
      .from('marketing_weekly_reviews').select('*').eq('for_week_starting', weekStart).maybeSingle()
    if (winner) return { ok: true, review: winner as WeeklyReview }
    return { ok: false, reason: insertErr.message }
  }
  if (errorMsg) return { ok: false, reason: errorMsg, review: inserted as WeeklyReview }
  return { ok: true, review: inserted as WeeklyReview }
}

// ── Send to Slack ─────────────────────────────────────────────────

export interface SendResult {
  ok: boolean
  status: number
  body: string
  review?: WeeklyReview
}

export async function sendWeeklyReviewToSlack(weekStart: string): Promise<SendResult> {
  const { data: row, error } = await supabaseAdmin
    .from('marketing_weekly_reviews').select('*')
    .eq('for_week_starting', weekStart).maybeSingle()
  if (error || !row) return { ok: false, status: 0, body: error?.message ?? 'no review row' }
  const review = row as WeeklyReview
  if (!review.slack_payload) {
    return { ok: false, status: 0, body: 'review has no Slack payload (generation failed)' }
  }
  if (review.slack_sent_at) {
    return { ok: true, status: review.slack_response_status ?? 200, body: 'already sent', review }
  }

  const { SLACK_MARKETING_WEBHOOK_URL } = getServerEnv()
  const result = await postToSlackUrl(SLACK_MARKETING_WEBHOOK_URL, review.slack_payload)

  // Update the row with the send outcome regardless of success so we
  // can show "tried at HH:MM, got 500" in the UI.
  const updates: Record<string, unknown> = {
    slack_response_status: result.status,
    slack_response_body: result.body.slice(0, 500),
  }
  if (result.status === 200) updates['slack_sent_at'] = new Date().toISOString()
  await supabaseAdmin
    .from('marketing_weekly_reviews')
    .update(updates as never)
    .eq('for_week_starting', weekStart)

  const { data: updated } = await supabaseAdmin
    .from('marketing_weekly_reviews').select('*').eq('for_week_starting', weekStart).maybeSingle()
  return {
    ok: result.status === 200,
    status: result.status,
    body: result.body,
    ...(updated ? { review: updated as WeeklyReview } : {}),
  }
}

/**
 * Cron entry — gated to Mondays after 9 AM PT. Generates last
 * week's review (if missing) AND sends it to Slack. Idempotent on
 * both steps.
 */
export async function tryGenerateAndSendWeeklyReview(): Promise<{
  generated: boolean
  sent: boolean
  reason: string
}> {
  if (!isGeminiConfigured()) return { generated: false, sent: false, reason: 'no_key' }
  if (ptDayOfWeek() !== 1) return { generated: false, sent: false, reason: `pt_dow=${ptDayOfWeek()}_not_monday` }
  if (ptHour() < 9) return { generated: false, sent: false, reason: `pt_hour=${ptHour()}_before_9am` }

  const weekStart = lastWeekMondayPt()
  const gen = await generateWeeklyReview(weekStart)
  if (!gen.ok || !gen.review) {
    return { generated: false, sent: false, reason: gen.reason ?? 'generate failed' }
  }
  // Only send on the first successful cron of the day. If the row's
  // slack_sent_at is already set the send is a no-op (returns early).
  const send = await sendWeeklyReviewToSlack(weekStart)
  return {
    generated: true,
    sent: send.ok,
    reason: send.ok ? 'generated_and_sent' : `generated_send_failed_${send.status}`,
  }
}

// Re-export for the routes layer.
export { lastWeekMondayPt }
