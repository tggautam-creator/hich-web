/**
 * Per-ride story idea generator — alternative path to the cron's
 * corridor-batch flow. Founder picks a specific ride_schedules row,
 * the AI proposes 3 distinct story angles for that specific ride
 * (route, name, date, status, etc.).
 *
 * Privacy: the AI receives first-name + last-initial only. The
 * rendered story output is instructed to refer to people as "a
 * rider", initials, or first-name (never full last name).
 */
import { supabaseAdmin } from '../supabaseAdmin.ts'
import {
  geminiGenerateWithFallback,
  humanizeGeminiError,
  isGeminiConfigured,
  TEXT_FAST_CHAIN,
} from './gemini.ts'
import { BRAND_SYSTEM_PROMPT } from './brandContext.ts'

const MS_PER_DAY = 24 * 60 * 60 * 1000

// ── Types ─────────────────────────────────────────────────────────

export type ScheduleAudience = 'rider' | 'driver'

export interface RideForStory {
  id: string
  audience: ScheduleAudience
  /** First name + last initial. Empty when no name on file. */
  poster_name: string
  /** Hash of name for stable React keys if poster_name is empty. */
  user_id_short: string
  route_name: string
  origin_address: string
  dest_address: string
  trip_date: string         // ISO YYYY-MM-DD
  trip_time: string         // HH:MM:SS (PT)
  time_type: 'departure' | 'arrival'
  direction_type: 'one_way' | 'roundtrip'
  available_seats: number | null
  note: string | null
  created_at: string
  days_until: number
}

export interface StoryIdea {
  angle: string             // e.g. "Urgency / scarcity", "Community FOMO"
  headline: string
  body: string
  visual_idea: string       // what to put on the IG story canvas
  hashtags: string | null
}

export interface GenerateFromRideResult {
  ok: boolean
  ideas: StoryIdea[]
  model_used?: string
  ride?: RideForStory
  reason?: string
}

// ── Helpers ───────────────────────────────────────────────────────

function ptToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

function shortenName(full: string | null | undefined): string {
  if (!full) return ''
  const trimmed = full.trim()
  if (trimmed.length === 0) return ''
  const parts = trimmed.split(/\s+/)
  if (parts.length === 1) return parts[0]!
  const first = parts[0]!
  const last = parts[parts.length - 1]!
  return `${first} ${last.charAt(0).toUpperCase()}.`
}

function safe(s: string | null | undefined, maxLen = 200): string {
  if (!s) return ''
  return s
    .replace(/```/g, '"""')
    .replace(/\r?\n/g, ' ')
    .replace(/\b(?:system prompt|ignore previous|new instructions?)\b/gi, '[redacted]')
    .trim()
    .slice(0, maxLen)
}

// ── List endpoint ─────────────────────────────────────────────────

/**
 * Fetches ride_schedules within the upcoming window for the
 * "Browse rides for story ideas" picker. Returns audience-segregated
 * + ascending-by-date lists.
 *
 * Window: today (PT) through `daysAhead`. Past rides are not
 * surfaced because there's nothing to drive demand for retroactively.
 */
export async function listRidesForStories(args: {
  daysAhead?: number
  audience?: ScheduleAudience | 'both'
}): Promise<{ riders: RideForStory[]; drivers: RideForStory[] }> {
  const daysAhead = Math.min(30, Math.max(1, args.daysAhead ?? 7))
  const audience = args.audience ?? 'both'
  const today = ptToday()
  const horizon = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(Date.now() + daysAhead * MS_PER_DAY))

  let q = supabaseAdmin
    .from('ride_schedules')
    .select(`
      id, user_id, mode, route_name,
      origin_address, dest_address,
      trip_date, trip_time, time_type, direction_type,
      available_seats, note, created_at
    `)
    .gte('trip_date', today).lte('trip_date', horizon)
    .order('trip_date', { ascending: true })
    .order('trip_time', { ascending: true })
    .limit(200)
  if (audience !== 'both') q = q.eq('mode', audience)

  const { data, error } = await q
  if (error) throw error
  const rows = (data ?? []) as Array<{
    id: string; user_id: string; mode: ScheduleAudience; route_name: string;
    origin_address: string; dest_address: string;
    trip_date: string; trip_time: string; time_type: 'departure' | 'arrival';
    direction_type: 'one_way' | 'roundtrip'; available_seats: number | null;
    note: string | null; created_at: string;
  }>

  // Fetch poster names in a separate query — RLS-safe via service role.
  const userIds = Array.from(new Set(rows.map((r) => r.user_id)))
  const names = new Map<string, string>()
  if (userIds.length > 0) {
    const { data: users } = await supabaseAdmin
      .from('users')
      .select('id, full_name, email')
      .in('id', userIds)
    for (const u of (users ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>) {
      const fromDisplay = shortenName(u.full_name)
      if (fromDisplay) {
        names.set(u.id, fromDisplay)
      } else if (u.email) {
        // Derive a first-name-style label from the email's local-part
        // when no full_name is set. e.g. "samuel.k@ucdavis.edu" → "Samuel"
        const local = u.email.split('@')[0] ?? ''
        const firstChunk = (local.split(/[._-]/)[0] ?? '').trim()
        if (firstChunk) {
          names.set(u.id, firstChunk.charAt(0).toUpperCase() + firstChunk.slice(1))
        }
      }
    }
  }

  function shape(r: typeof rows[number]): RideForStory {
    const today0 = new Date(`${ptToday()}T12:00:00`).getTime()
    const evT = new Date(`${r.trip_date}T12:00:00`).getTime()
    return {
      id: r.id,
      audience: r.mode,
      poster_name: names.get(r.user_id) ?? '',
      user_id_short: r.user_id.slice(0, 8),
      route_name: r.route_name,
      origin_address: r.origin_address,
      dest_address: r.dest_address,
      trip_date: r.trip_date,
      trip_time: r.trip_time,
      time_type: r.time_type,
      direction_type: r.direction_type,
      available_seats: r.available_seats,
      note: r.note,
      created_at: r.created_at,
      days_until: Math.round((evT - today0) / MS_PER_DAY),
    }
  }

  const all = rows.map(shape)
  return {
    riders: all.filter((r) => r.audience === 'rider'),
    drivers: all.filter((r) => r.audience === 'driver'),
  }
}

// ── Generator ─────────────────────────────────────────────────────

const ANGLE_HINTS = [
  'urgency / scarcity (this seat is filling up)',
  'community / FOMO (a Davis student is going your way)',
  'humor / unexpected (a light, shareable take on the route)',
  'practical / cost-saving (split gas, save money)',
  'campus moment (tie to a finals, weekend trip, picnic-day-style event)',
  'student life (Davis-specific framing — Aggies, downtown, Mondavi)',
]

function pickAngleHints(count: number): string[] {
  // Stable-but-varied selection: shuffle by current minute so two
  // back-to-back regens get different angles without needing a seed.
  // We avoid Math.random/Date.now per repository rules in some
  // contexts but here at the route-handler level both are fine.
  const arr = [...ANGLE_HINTS]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j]!, arr[i]!]
  }
  return arr.slice(0, count)
}

function buildPrompt(ride: RideForStory): string {
  const hints = pickAngleHints(3)
  const audienceLine = ride.audience === 'rider'
    ? `${ride.poster_name || 'A UC Davis student'} (RIDER) is looking for a ride.`
    : `${ride.poster_name || 'A UC Davis student'} (DRIVER) is offering seats.`

  return `
Generate THREE distinct Instagram-story ideas for the Tago carpool
brand based on this single open ride board post:

${audienceLine}
Route: ${safe(ride.route_name, 80)}
Origin: ${safe(ride.origin_address, 100)}
Destination: ${safe(ride.dest_address, 100)}
Date: ${ride.trip_date} (${ride.days_until === 0 ? 'TODAY' : ride.days_until === 1 ? 'TOMORROW' : `in ${ride.days_until} days`})
Time: ${ride.trip_time} ${ride.time_type}
${ride.audience === 'driver' && ride.available_seats != null ? `Seats available: ${ride.available_seats}` : ''}
${ride.direction_type === 'roundtrip' ? 'Roundtrip — coming back' : 'One way'}
${ride.note ? `Poster's note: "${safe(ride.note, 200)}"` : ''}

For the 3 ideas, use these DISTINCT angles (one per idea):
  1. ${hints[0]}
  2. ${hints[1]}
  3. ${hints[2]}

PRIVACY: refer to the poster as their first name only OR "a rider"
/ "a driver" / "a Davis student". NEVER use a last name. Initials
are OK (e.g. "S.").

OUTPUT FORMAT — return a JSON object (no markdown fences) with one field:
{
  "ideas": [
    {
      "angle": "<short label, ≤40 chars — echo the angle hint above>",
      "headline": "<6-10 words, hero line on the story canvas>",
      "body": "<2-3 sentences. The caption that would go under or beside the headline>",
      "visual_idea": "<1 sentence describing what to show on the story — graphic, photo, layout, color>",
      "hashtags": "<optional 4-8 space-separated hashtags. Include #ucdavis #aggielife when relevant. Empty string if none.>"
    },
    { ... }, { ... }
  ]
}

RULES:
- Each idea must FEEL different from the other two — varied tone, varied call-to-action.
- Cite the actual route, date, and seats where it fits naturally — concrete details land harder than generic carpool copy.
- For DRIVER posts: lean into "earn back gas / sharing the trip", never "make money" or "side hustle".
- For RIDER posts: lean into safety, .edu trust, cost split, and the convenience of finding a Davis student going your way.
- No emoji in the headline (renders weird in some fonts). Emoji in body is fine if it fits.
- The CTA should always nudge readers to open Tago (tagorides.com) or check the ride board.
`.trim()
}

function parseIdeasJson(text: string): { ideas: StoryIdea[]; reason: string | null } {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end < start) return { ideas: [], reason: 'no JSON braces' }
  let raw: unknown
  try { raw = JSON.parse(cleaned.slice(start, end + 1)) }
  catch (err) { return { ideas: [], reason: `JSON.parse: ${err instanceof Error ? err.message : String(err)}` } }
  const obj = raw as { ideas?: unknown }
  const list = Array.isArray(obj.ideas) ? obj.ideas : []
  const ideas: StoryIdea[] = []
  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue
    const r = item as Record<string, unknown>
    const angle = typeof r['angle'] === 'string' ? r['angle'].slice(0, 60) : ''
    const headline = typeof r['headline'] === 'string' ? r['headline'].trim() : ''
    const body = typeof r['body'] === 'string' ? r['body'].trim() : ''
    const visual = typeof r['visual_idea'] === 'string' ? r['visual_idea'].trim() : ''
    const hashtags = typeof r['hashtags'] === 'string' ? r['hashtags'].trim() : ''
    if (headline.length < 3 || body.length < 10) continue
    ideas.push({
      angle,
      headline,
      body,
      visual_idea: visual,
      hashtags: hashtags || null,
    })
    if (ideas.length >= 3) break
  }
  if (ideas.length === 0) return { ideas: [], reason: 'no valid ideas in response' }
  return { ideas, reason: null }
}

export async function generateStoriesFromRide(rideId: string): Promise<GenerateFromRideResult> {
  if (!isGeminiConfigured()) {
    return { ok: false, ideas: [], reason: 'GEMINI_API_KEY not configured' }
  }
  const { data: row, error: fetchErr } = await supabaseAdmin
    .from('ride_schedules')
    .select(`
      id, user_id, mode, route_name,
      origin_address, dest_address,
      trip_date, trip_time, time_type, direction_type,
      available_seats, note, created_at
    `)
    .eq('id', rideId).maybeSingle()
  if (fetchErr || !row) {
    return { ok: false, ideas: [], reason: fetchErr?.message ?? 'ride_schedule not found' }
  }
  const raw = row as {
    id: string; user_id: string; mode: ScheduleAudience; route_name: string;
    origin_address: string; dest_address: string;
    trip_date: string; trip_time: string; time_type: 'departure' | 'arrival';
    direction_type: 'one_way' | 'roundtrip'; available_seats: number | null;
    note: string | null; created_at: string;
  }

  // Resolve poster name (best-effort, RLS-safe).
  const { data: u } = await supabaseAdmin
    .from('users').select('full_name, email').eq('id', raw.user_id).maybeSingle()
  const user = (u ?? null) as { full_name: string | null; email: string | null } | null
  let posterName = shortenName(user?.full_name ?? null)
  if (!posterName && user?.email) {
    const local = user.email.split('@')[0] ?? ''
    const first = (local.split(/[._-]/)[0] ?? '').trim()
    if (first) posterName = first.charAt(0).toUpperCase() + first.slice(1)
  }

  const today0 = new Date(`${ptToday()}T12:00:00`).getTime()
  const evT = new Date(`${raw.trip_date}T12:00:00`).getTime()
  const ride: RideForStory = {
    id: raw.id,
    audience: raw.mode,
    poster_name: posterName,
    user_id_short: raw.user_id.slice(0, 8),
    route_name: raw.route_name,
    origin_address: raw.origin_address,
    dest_address: raw.dest_address,
    trip_date: raw.trip_date,
    trip_time: raw.trip_time,
    time_type: raw.time_type,
    direction_type: raw.direction_type,
    available_seats: raw.available_seats,
    note: raw.note,
    created_at: raw.created_at,
    days_until: Math.round((evT - today0) / MS_PER_DAY),
  }

  try {
    const r = await geminiGenerateWithFallback({
      systemPrompt: BRAND_SYSTEM_PROMPT,
      userPrompt: buildPrompt(ride),
      temperature: 0.95,  // a touch hotter than corridor batch — variety matters here
      maxOutputTokens: 2048,
      responseMimeType: 'application/json',
      thinkingBudget: 0,
    }, TEXT_FAST_CHAIN)
    const parsed = parseIdeasJson(r.text)
    if (parsed.ideas.length === 0) {
      return { ok: false, ideas: [], ride, reason: parsed.reason ?? 'no ideas parsed' }
    }
    return { ok: true, ideas: parsed.ideas, ride, model_used: r.modelUsed }
  } catch (err) {
    return { ok: false, ideas: [], ride, reason: humanizeGeminiError(err) }
  }
}
