/**
 * Smart marketing calendar — Phase 5.
 *
 * Maintains the marketing_events table: seeded defaults (academic
 * calendar + federal holidays + UC Davis campus events) + AI-
 * suggested additions + admin manual entries.
 *
 * The reminder system surfaces a "you have N events in the next
 * week" banner on the marketing dashboard. Dismissals are
 * persisted per-event so the same reminder doesn't keep nagging.
 */
import { supabaseAdmin } from '../supabaseAdmin.ts'
import { geminiGenerate, humanizeGeminiError, MODEL_SMART, isGeminiConfigured } from './gemini.ts'
import { BRAND_SYSTEM_PROMPT } from './brandContext.ts'

export type EventCategory = 'holiday' | 'academic' | 'campus' | 'travel-trigger' | 'custom'
export type EventSource = 'seeded' | 'ai_suggested' | 'manual'
export type EventAudience = 'rider' | 'driver' | 'both'

export interface MarketingEvent {
  id: string
  title: string
  event_date: string
  end_date: string | null
  category: EventCategory
  location_hint: string | null
  description: string | null
  target_audience: EventAudience
  source: EventSource
  target_lead_time_days: number
  reminder_dismissed_at: string | null
  notes: string | null
  linked_story_batch_ids: string[]
  linked_poster_item_ids: string[]
  created_at: string
  updated_at: string
}

interface SeedEvent {
  title: string
  event_date: string
  end_date?: string
  category: EventCategory
  location_hint?: string
  description: string
  target_audience: EventAudience
  target_lead_time_days?: number
}

/**
 * Initial seed of events. Covers the next ~12 months of:
 *  - Federal holidays / long weekends (peak travel demand)
 *  - UC Davis academic calendar moments
 *  - Davis-specific campus events
 *  - Big travel-trigger events for SoCal/Bay corridors
 *
 * Re-running the seed is idempotent (unique index on
 * (event_date, lower(title))). Refresh this list manually each
 * year or use the AI suggestor.
 */
export const SEED_EVENTS: SeedEvent[] = [
  // ── Federal holidays / long weekends — 2026 + early 2027 ──
  {
    title: 'Memorial Day weekend',
    event_date: '2026-05-23', end_date: '2026-05-25',
    category: 'holiday',
    description: 'Long weekend; students head home, to Tahoe, or to the coast. High ride demand Friday + Monday.',
    target_audience: 'both',
  },
  {
    title: 'Independence Day weekend',
    event_date: '2026-07-03', end_date: '2026-07-05',
    category: 'holiday',
    description: '4th of July long weekend. Bay Area + SoCal beach trips.',
    target_audience: 'both',
  },
  {
    title: 'Labor Day weekend',
    event_date: '2026-09-05', end_date: '2026-09-07',
    category: 'holiday',
    description: 'Last long weekend before school. Tahoe + coast peak.',
    target_audience: 'both',
  },
  {
    title: 'Veterans Day',
    event_date: '2026-11-11',
    category: 'holiday',
    description: 'Mid-week holiday; short trips home.',
    target_audience: 'both',
  },
  {
    title: 'Thanksgiving break',
    event_date: '2026-11-25', end_date: '2026-11-29',
    category: 'holiday',
    description: 'Biggest single-week ride demand of the year. Going-home traffic Wed; return Sun. PUSH HEAVILY.',
    target_audience: 'both', target_lead_time_days: 14,
  },
  {
    title: 'Winter break begins',
    event_date: '2026-12-12',
    category: 'academic',
    description: 'Last day of finals (Fall 2026). Mass exodus from campus.',
    target_audience: 'both', target_lead_time_days: 14,
  },
  {
    title: 'New Year weekend',
    event_date: '2026-12-31', end_date: '2027-01-03',
    category: 'holiday',
    description: 'Travel back to campus + ring-in-NYE trips.',
    target_audience: 'both',
  },
  {
    title: 'MLK Day',
    event_date: '2027-01-18',
    category: 'holiday',
    description: 'Long weekend in winter quarter; short trips.',
    target_audience: 'both',
  },
  {
    title: 'Presidents Day weekend',
    event_date: '2027-02-13', end_date: '2027-02-15',
    category: 'holiday',
    description: 'Long weekend; weekend trips.',
    target_audience: 'both',
  },

  // ── UC Davis academic calendar (2026-2027) ──
  {
    title: 'Fall quarter begins',
    event_date: '2026-09-24',
    category: 'academic',
    description: 'First day of Fall 2026 instruction. Move-in week leading up.',
    target_audience: 'both', target_lead_time_days: 14,
  },
  {
    title: 'Fall quarter move-in week',
    event_date: '2026-09-19', end_date: '2026-09-23',
    category: 'campus',
    description: 'Students arriving at campus. Parents driving from Bay/SoCal — also riders flying into SFO/SMF needing rides to Davis.',
    target_audience: 'both', target_lead_time_days: 14,
  },
  {
    title: 'Fall quarter finals week',
    event_date: '2026-12-07', end_date: '2026-12-12',
    category: 'academic',
    description: 'Finals stress + everyone planning to leave campus.',
    target_audience: 'both', target_lead_time_days: 7,
  },
  {
    title: 'Winter quarter begins',
    event_date: '2027-01-04',
    category: 'academic',
    description: 'First day of Winter 2027 instruction. Return-to-campus trips.',
    target_audience: 'both', target_lead_time_days: 7,
  },
  {
    title: 'Winter quarter finals week',
    event_date: '2027-03-15', end_date: '2027-03-20',
    category: 'academic',
    description: 'Finals + spring break planning starts.',
    target_audience: 'both',
  },
  {
    title: 'Spring break',
    event_date: '2027-03-22', end_date: '2027-03-28',
    category: 'academic',
    description: 'Week-long break between Winter + Spring quarters. Vegas, Tahoe, beach trips peak.',
    target_audience: 'both', target_lead_time_days: 14,
  },
  {
    title: 'Spring quarter begins',
    event_date: '2027-03-29',
    category: 'academic',
    description: 'First day of Spring 2027 instruction.',
    target_audience: 'both',
  },
  {
    title: 'Picnic Day (UC Davis)',
    event_date: '2027-04-17',
    category: 'campus',
    location_hint: 'Davis',
    description: 'UC Davis\'s signature student-run open-house event. Alumni + parents flood Davis. Reverse traffic from SoCal/Bay heading IN.',
    target_audience: 'both', target_lead_time_days: 14,
  },
  {
    title: 'Spring quarter finals week',
    event_date: '2027-06-07', end_date: '2027-06-12',
    category: 'academic',
    description: 'Finals + planning summer move-out.',
    target_audience: 'both',
  },
  {
    title: 'Commencement (UC Davis)',
    event_date: '2027-06-12',
    category: 'campus',
    location_hint: 'Davis',
    description: 'UC Davis graduation. Families driving in; graduates moving out. Peak emotional moment + maxed ride demand.',
    target_audience: 'both', target_lead_time_days: 21,
  },

  // ── Travel-trigger events (big draws from Davis) ──
  {
    title: 'Coachella Weekend 1',
    event_date: '2027-04-09', end_date: '2027-04-11',
    category: 'travel-trigger',
    location_hint: 'SoCal',
    description: 'Music festival in Indio CA. Heavy Davis → SoCal traffic Thu/Fri.',
    target_audience: 'both', target_lead_time_days: 14,
  },
  {
    title: 'Coachella Weekend 2',
    event_date: '2027-04-16', end_date: '2027-04-18',
    category: 'travel-trigger',
    location_hint: 'SoCal',
    description: 'Second Coachella weekend. Same corridor surge.',
    target_audience: 'both',
  },
  {
    title: 'Stagecoach Festival',
    event_date: '2027-04-23', end_date: '2027-04-25',
    category: 'travel-trigger',
    location_hint: 'SoCal',
    description: 'Country music festival in Indio. Same SoCal corridor as Coachella.',
    target_audience: 'both',
  },
  {
    title: 'Tahoe ski season opening',
    event_date: '2026-11-15',
    category: 'travel-trigger',
    location_hint: 'Tahoe',
    description: 'First weekend resorts typically open. Davis → Tahoe traffic ramps.',
    target_audience: 'both',
  },
]

// ── List / get ─────────────────────────────────────────────────────

export async function listUpcomingEvents(args?: {
  daysAhead?: number
  includeRecentlyPast?: number
  limit?: number
}): Promise<MarketingEvent[]> {
  const daysAhead = args?.daysAhead ?? 90
  const daysBack = args?.includeRecentlyPast ?? 7
  const limit = Math.min(200, args?.limit ?? 100)
  const today = new Date()
  const from = new Date(today.getTime() - daysBack * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const to = new Date(today.getTime() + daysAhead * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const { data, error } = await supabaseAdmin
    .from('marketing_events')
    .select('*')
    .gte('event_date', from)
    .lte('event_date', to)
    .order('event_date', { ascending: true })
    .limit(limit)

  if (error) {
    console.error('[marketing/events] listUpcomingEvents failed:', error.message)
    return []
  }
  return (data ?? []) as MarketingEvent[]
}

export async function getEventsNeedingReminder(): Promise<MarketingEvent[]> {
  // Active reminders: event_date within target_lead_time_days from
  // today AND not dismissed. Done in two passes since we need to
  // compare per-row lead time to per-row date.
  const today = new Date().toISOString().slice(0, 10)
  const horizon = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const { data, error } = await supabaseAdmin
    .from('marketing_events')
    .select('*')
    .gte('event_date', today)
    .lte('event_date', horizon)
    .is('reminder_dismissed_at', null)
    .order('event_date', { ascending: true })
  if (error) {
    console.error('[marketing/events] getEventsNeedingReminder failed:', error.message)
    return []
  }
  // Filter to events where date - today is <= lead_time_days.
  const todayMs = new Date(today + 'T00:00:00Z').getTime()
  return ((data ?? []) as MarketingEvent[]).filter((e) => {
    const eventMs = new Date(e.event_date + 'T00:00:00Z').getTime()
    const daysOut = Math.floor((eventMs - todayMs) / (24 * 60 * 60 * 1000))
    return daysOut <= (e.target_lead_time_days ?? 7)
  })
}

// ── Mutations ──────────────────────────────────────────────────────

export async function seedEvents(): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0
  let skipped = 0
  for (const seed of SEED_EVENTS) {
    const { error } = await supabaseAdmin
      .from('marketing_events')
      .insert({
        title: seed.title,
        event_date: seed.event_date,
        end_date: seed.end_date ?? null,
        category: seed.category,
        location_hint: seed.location_hint ?? null,
        description: seed.description,
        target_audience: seed.target_audience,
        source: 'seeded' as EventSource,
        target_lead_time_days: seed.target_lead_time_days ?? 7,
      } as never)
    if (error) {
      // unique-violation = already seeded; expected on re-run.
      if (/duplicate|23505/i.test(error.message)) {
        skipped += 1
      } else {
        console.error('[marketing/events] seed insert failed:', error.message, seed.title)
      }
    } else {
      inserted += 1
    }
  }
  return { inserted, skipped }
}

export async function addManualEvent(payload: {
  title: string
  event_date: string
  end_date?: string
  category?: EventCategory
  location_hint?: string
  description?: string
  target_audience?: EventAudience
  target_lead_time_days?: number
  notes?: string
}): Promise<{ ok: boolean; event?: MarketingEvent; error?: string }> {
  const { data, error } = await supabaseAdmin
    .from('marketing_events')
    .insert({
      title: payload.title.trim().slice(0, 200),
      event_date: payload.event_date,
      end_date: payload.end_date ?? null,
      category: payload.category ?? 'custom',
      location_hint: payload.location_hint?.slice(0, 200) ?? null,
      description: payload.description?.slice(0, 1000) ?? null,
      target_audience: payload.target_audience ?? 'both',
      source: 'manual' as EventSource,
      target_lead_time_days: payload.target_lead_time_days ?? 7,
      notes: payload.notes?.slice(0, 2000) ?? null,
    } as never)
    .select('*')
    .single()
  if (error || !data) {
    return { ok: false, error: error?.message ?? 'insert failed' }
  }
  return { ok: true, event: data as MarketingEvent }
}

export async function dismissReminder(eventId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabaseAdmin
    .from('marketing_events')
    .update({ reminder_dismissed_at: new Date().toISOString() } as never)
    .eq('id', eventId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function deleteEvent(eventId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabaseAdmin
    .from('marketing_events')
    .delete()
    .eq('id', eventId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function updateEvent(
  eventId: string,
  patch: Partial<Pick<MarketingEvent,
    'title' | 'event_date' | 'end_date' | 'category' | 'location_hint'
    | 'description' | 'target_audience' | 'target_lead_time_days' | 'notes'
  >>,
): Promise<{ ok: boolean; error?: string }> {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) update[k] = v
  }
  const { error } = await supabaseAdmin
    .from('marketing_events')
    .update(update as never)
    .eq('id', eventId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

// ── AI refresh ─────────────────────────────────────────────────────

interface AiEventSuggestion {
  title: string
  event_date: string
  end_date?: string
  category: EventCategory
  location_hint?: string
  description: string
  target_audience: EventAudience
}

/**
 * Ask Gemini to suggest 5-10 upcoming events worth targeting that
 * AREN'T already in the events table. The current events list is
 * sent in as context so Gemini doesn't suggest duplicates.
 */
export async function refreshAiEventSuggestions(): Promise<{
  ok: boolean
  inserted: number
  skipped: number
  reason?: string
  /** Number of Google Search source URLs the model consulted. */
  sources_count?: number
}> {
  if (!isGeminiConfigured()) {
    return { ok: false, inserted: 0, skipped: 0, reason: 'GEMINI_API_KEY not configured' }
  }

  // Pull existing events so Gemini doesn't duplicate them.
  const existing = await listUpcomingEvents({ daysAhead: 365, limit: 200 })
  const existingTitlesByDate = existing.map((e) =>
    `${e.event_date} — ${e.title} (${e.category})`,
  ).join('\n')

  const today = new Date().toISOString().slice(0, 10)
  const sixMonthsAhead = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const userPrompt = `
Today's date: ${today}.

You have GOOGLE SEARCH available — USE IT to find real, current
events. Don't rely on training-data dates that may be stale.

I run TAGO, a UC Davis student carpool app. I push marketing 1-3
weeks before any event that drives ride demand on Davis-anchored
corridors (Davis ⇌ SoCal / Bay Area / Sacramento / Tahoe).

I already have these events on my calendar between now and ${sixMonthsAhead}:
${existingTitlesByDate || '  (none yet)'}

Search Google for 8-12 ADDITIONAL events between ${today} and
${sixMonthsAhead} that are NOT in my list above. Prioritize:
  - **Concerts in Sacramento, Bay Area, SoCal** that UC Davis
    students would drive to (search "concerts Sacramento [month]
    2026/2027", "BottleRock Napa lineup 2026", etc.)
  - **UC Davis Aggie home games** (search "UC Davis football
    schedule 2026", "UC Davis basketball home games 2027")
  - **Mondavi Center / campus events** at UC Davis
  - **Festivals** in CA that draw students (Coachella, Stagecoach,
    Outside Lands, Sunrise Festival, EDC Vegas, etc. — verify
    THIS year's exact dates)
  - **Sacramento Kings / Golden 1 Center concerts** (heavy Davis
    traffic; 20 min drive)
  - **Lesser-known holidays** I might have missed (Indigenous
    Peoples Day, Cesar Chavez Day, Juneteenth, Lunar New Year)

Skip generic non-travel-triggering events. Skip anything already
in my list. All event_dates MUST be verified real dates between
${today} and ${sixMonthsAhead} — if Google Search doesn't confirm
a date, skip the event rather than guess.

Output a JSON object only (no markdown fences, no prose around
it) with this shape:
{
  "events": [
    {
      "title": "...",                          // ≤80 chars; include venue if a concert
      "event_date": "YYYY-MM-DD",
      "end_date": "YYYY-MM-DD" or null,
      "category": "holiday" | "academic" | "campus" | "travel-trigger",
      "location_hint": "Davis | Bay Area | SoCal | Tahoe | Sacramento | Reno | ...",
      "description": "1-2 sentences. Why this event drives ride demand. Include venue + headliner if applicable.",
      "target_audience": "rider" | "driver" | "both"
    }
  ]
}

If you can't fill 8-12 with confidence, return fewer — quality
over quantity.
`.trim()

  let raw: string
  let groundingUrls: string[] = []
  try {
    const result = await geminiGenerate({
      systemPrompt: BRAND_SYSTEM_PROMPT,
      userPrompt,
      model: MODEL_SMART,
      temperature: 0.6,
      maxOutputTokens: 4096,
      // Enable Google Search grounding so suggestions are based on
      // real current event listings (concert dates, festival lineups,
      // UC Davis schedules) rather than potentially-stale training
      // data. Note: googleSearch is incompatible with
      // responseMimeType:'application/json' — we parse JSON out of
      // free-form text below.
      useGoogleSearch: true,
      thinkingBudget: 1024,
    })
    raw = result.text
    if (result.groundingUrls) {
      groundingUrls = result.groundingUrls
      console.log(`[marketing/events] AI refresh grounded on ${groundingUrls.length} source(s)`)
    }
  } catch (err) {
    return {
      ok: false,
      inserted: 0,
      skipped: 0,
      reason: humanizeGeminiError(err),
    }
  }

  // Without responseMimeType=JSON the model may emit prose around
  // the JSON object (e.g. "Based on my search, here are the events:
  // {...} Let me know if you need more."). Robust extract: find the
  // first '{' and last '}' that bracket a valid parseable region.
  let parsed: { events?: AiEventSuggestion[] }
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start < 0 || end < start) {
      return {
        ok: false, inserted: 0, skipped: 0,
        reason: `Gemini response has no JSON object braces (grounding may have produced prose-only output). First 200 chars: ${raw.slice(0, 200)}`,
      }
    }
    parsed = JSON.parse(cleaned.slice(start, end + 1)) as { events?: AiEventSuggestion[] }
  } catch (err) {
    return {
      ok: false,
      inserted: 0,
      skipped: 0,
      reason: `unparseable Gemini response: ${err instanceof Error ? err.message : String(err)}. First 200 chars: ${raw.slice(0, 200)}`,
    }
  }

  const events = parsed.events ?? []
  let inserted = 0
  let skipped = 0
  for (const e of events) {
    if (!e.title || !e.event_date || !/^\d{4}-\d{2}-\d{2}$/.test(e.event_date)) {
      skipped += 1
      continue
    }
    const { error } = await supabaseAdmin
      .from('marketing_events')
      .insert({
        title: e.title.slice(0, 200),
        event_date: e.event_date,
        end_date: e.end_date && /^\d{4}-\d{2}-\d{2}$/.test(e.end_date) ? e.end_date : null,
        category: e.category ?? 'custom',
        location_hint: e.location_hint?.slice(0, 200) ?? null,
        description: e.description?.slice(0, 1000) ?? null,
        target_audience: e.target_audience ?? 'both',
        source: 'ai_suggested' as EventSource,
        target_lead_time_days: 7,
      } as never)
    if (error) {
      if (/duplicate|23505/i.test(error.message)) {
        skipped += 1
      } else {
        console.error('[marketing/events] AI suggest insert failed:', error.message, e.title)
        skipped += 1
      }
    } else {
      inserted += 1
    }
  }
  return {
    ok: true,
    inserted,
    skipped,
    ...(groundingUrls.length > 0 ? { sources_count: groundingUrls.length } : {}),
  }
}
