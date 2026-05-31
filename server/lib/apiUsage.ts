/**
 * 2026-05-19 — external-API call counter.
 *
 * Every external service Tago talks to gets an entry in `API_QUOTAS`
 * and a `recordApiCall('<service>')` call at the wrapper layer. The
 * `/admin/api-usage` page reads from `api_usage_daily` to show how
 * close we are to each provider's quota.
 *
 * Design notes:
 *   - We do NOT block the request path on the counter write. The
 *     `recordApiCall()` helper fires the upsert in the background;
 *     a missed counter is annoying (slightly inaccurate gauge), but
 *     never breaks the actual external call. Errors are logged via
 *     console.warn so dev sees them; production logs land in CloudWatch.
 *   - Counter is per UTC day. Aligns with most provider quota resets
 *     (Resend, Google Maps daily quotas). Per-minute / per-second
 *     limits are NOT tracked here — those are caller-side (e.g. the
 *     Resend throttle in `resend.ts` is rate-limited inline).
 *   - `getUsageSnapshot()` returns today + last 30 days for every
 *     service in `API_QUOTAS`. Used by the admin endpoint.
 */
import { supabaseAdmin } from './supabaseAdmin.ts'

/**
 * Service tokens used in `api_usage_daily.service`. Keep these stable
 * — any rename means the historical counter resets. Add new services
 * by appending; never reuse a token for a different meaning.
 */
export const SERVICES = [
  'resend',
  'fcm',
  'gmaps_routes',
  'gmaps_places',
  'gmaps_directions',
  'gmaps_geocoding',
  'stripe',
  // Gemini services — added 2026-05-30 for Phase 6 quota guardrails.
  // Each entry maps 1:1 to a Gemini model ID. The marketing-panel
  // helper recordGeminiCall() maps model → service token.
  'gemini_flash',
  'gemini_pro',
  'gemini_flash_image',
] as const

export type Service = (typeof SERVICES)[number]

/**
 * Quota config per service. Numbers are best-effort estimates from
 * each provider's pricing page as of 2026-05-19. Update when we
 * change plans.
 *   - daily: hard reset every UTC midnight
 *   - monthly: rolling 30 days (we compute it from daily counters)
 *
 * `null` means no published daily / monthly cap (provider uses a
 * per-second rate limit instead — see `notes` for the gist).
 */
export interface QuotaConfig {
  label: string
  daily: number | null
  monthly: number | null
  notes: string
}

export const API_QUOTAS: Record<Service, QuotaConfig> = {
  resend: {
    label: 'Resend (email)',
    daily: 100,
    monthly: 3000,
    notes: 'Free tier. 2 req/s sustained (we throttle in resend.ts).',
  },
  fcm: {
    label: 'Firebase Cloud Messaging',
    daily: null,
    monthly: null,
    notes: 'No daily quota on the Spark plan. 600/min per project.',
  },
  gmaps_routes: {
    label: 'Google Maps Routes API',
    daily: 2500,
    monthly: null,
    notes: 'Smart-search board polyline lookups. $5 / 1k after free tier.',
  },
  gmaps_places: {
    label: 'Google Places Autocomplete',
    daily: 17000,
    monthly: null,
    notes: 'Destination + origin search. $2.83 / 1k Autocomplete-per-session.',
  },
  gmaps_directions: {
    label: 'Google Maps Directions',
    daily: null,
    monthly: null,
    notes: 'Transit handoff. $5 / 1k after free tier.',
  },
  gmaps_geocoding: {
    label: 'Google Maps Geocoding',
    daily: null,
    monthly: null,
    notes: 'Reverse + forward geocoding. $5 / 1k after free tier.',
  },
  stripe: {
    label: 'Stripe',
    daily: null,
    monthly: null,
    notes: 'No quota; rate-limited at 100 read / 100 write per second.',
  },
  gemini_flash: {
    label: 'Gemini 2.5 Flash',
    daily: 1500,
    monthly: null,
    notes: 'Story batches + poster copy. Free-tier 1500 req/day. Quota resets at UTC midnight.',
  },
  gemini_pro: {
    label: 'Gemini 2.5 Pro',
    daily: 50,
    monthly: null,
    notes: 'Advisor chat + calendar refresh-AI. Free-tier 50 req/day (low). Advisor auto-falls back to Flash on 429.',
  },
  gemini_flash_image: {
    label: 'Gemini 2.5 Flash Image (Nano Banana)',
    daily: 100,
    monthly: null,
    notes: 'Poster image generation. Free-tier 100 req/day.',
  },
}

/**
 * Map a Gemini model ID to the service token used in api_usage_daily.
 * Used by the marketing-panel generators to instrument each call.
 * Returns null for unknown model IDs (caller skips recording).
 */
export type GeminiModel =
  | 'gemini-2.5-flash'
  | 'gemini-2.5-pro'
  | 'gemini-2.5-flash-image'

export function geminiModelToService(model: string): Service | null {
  switch (model) {
    case 'gemini-2.5-flash':       return 'gemini_flash'
    case 'gemini-2.5-pro':         return 'gemini_pro'
    case 'gemini-2.5-flash-image': return 'gemini_flash_image'
    default:                       return null
  }
}

/**
 * Convenience: record a single Gemini call by model ID. Wraps the
 * common pattern of mapping model→service then incrementing.
 * Non-blocking, fail-soft (delegates to recordApiCall).
 */
export async function recordGeminiCall(model: string, count: number = 1): Promise<void> {
  const service = geminiModelToService(model)
  if (!service) {
    console.warn(`[apiUsage] recordGeminiCall: unknown model "${model}" — skipping`)
    return
  }
  await recordApiCall(service, count)
}

/**
 * Increment today's counter for `service` by `count` (default 1).
 *
 * Non-blocking + fail-soft. Returns a promise the caller MAY await
 * if they want to confirm the write, but typical use is
 * fire-and-forget alongside the external call. Errors are swallowed
 * and logged — the actual external request is the priority.
 *
 * Implementation uses `.rpc()` with an inline SQL increment OR a
 * read-modify-upsert fallback. We pick upsert here because Supabase
 * doesn't expose a SQL increment via the JS client cleanly; the
 * upsert has a small race window but the counter is monotonic
 * (we only ever increment), and at our scale the worst-case is a
 * counter being off by 1-2 ticks per minute under heavy concurrent
 * load. Good enough for a usage gauge.
 */
export async function recordApiCall(
  service: Service,
  count: number = 1,
): Promise<void> {
  if (count <= 0) return
  const today = isoToday()
  try {
    // Read-modify-upsert. The race risk: two concurrent reads see N,
    // both write N+1. Effective count = N+1 instead of N+2. We accept
    // this for a gauge; if we ever need exact, switch to a Supabase
    // RPC that does `INSERT ... ON CONFLICT DO UPDATE SET count = count + EXCLUDED.count`.
    const { data: existing, error: readErr } = await supabaseAdmin
      .from('api_usage_daily')
      .select('count')
      .eq('service', service)
      .eq('date', today)
      .maybeSingle()
    if (readErr) throw readErr
    const next = (existing?.count ?? 0) + count
    const { error: writeErr } = await supabaseAdmin
      .from('api_usage_daily')
      .upsert(
        { service, date: today, count: next },
        { onConflict: 'service,date' },
      )
    if (writeErr) throw writeErr
  } catch (err) {
    console.warn(
      `[apiUsage] recordApiCall(${service}, +${count}) failed:`,
      err instanceof Error ? err.message : err,
    )
  }
}

/**
 * Read snapshot: today's count + monthly (rolling 30d) count for each
 * service. Returns a quota-aware shape the admin UI can render
 * directly.
 */
export interface ServiceUsage {
  service: Service
  label: string
  notes: string
  today: number
  monthly: number // rolling 30d sum
  daily_quota: number | null
  monthly_quota: number | null
  daily_pct: number | null   // null when no daily quota
  monthly_pct: number | null
}

export interface UsageSnapshot {
  ok: true
  as_of: string
  today: string // ISO date
  services: ServiceUsage[]
  /** 30-day daily counts per service, for sparkline rendering. */
  trend: { service: Service; days: { date: string; count: number }[] }[]
}

export async function getUsageSnapshot(): Promise<UsageSnapshot> {
  const today = isoToday()
  const thirtyDaysAgo = isoMinusDays(29) // inclusive 30-day window

  const { data, error } = await supabaseAdmin
    .from('api_usage_daily')
    .select('service, date, count')
    .gte('date', thirtyDaysAgo)
    .order('date', { ascending: true })
  if (error) throw error

  const rows = data ?? []
  const byService = new Map<string, { date: string; count: number }[]>()
  for (const r of rows) {
    if (!byService.has(r.service)) byService.set(r.service, [])
    byService.get(r.service)!.push({ date: r.date, count: r.count })
  }

  const services: ServiceUsage[] = SERVICES.map((svc) => {
    const days = byService.get(svc) ?? []
    const todayRow = days.find((d) => d.date === today)
    const todayCount = todayRow?.count ?? 0
    const monthly = days.reduce((acc, d) => acc + d.count, 0)
    const cfg = API_QUOTAS[svc]
    const dailyPct = cfg.daily != null ? todayCount / cfg.daily : null
    const monthlyPct = cfg.monthly != null ? monthly / cfg.monthly : null
    return {
      service: svc,
      label: cfg.label,
      notes: cfg.notes,
      today: todayCount,
      monthly,
      daily_quota: cfg.daily,
      monthly_quota: cfg.monthly,
      daily_pct: dailyPct,
      monthly_pct: monthlyPct,
    }
  })

  const trend = SERVICES.map((svc) => ({
    service: svc,
    days: fillMissingDays(byService.get(svc) ?? [], thirtyDaysAgo, today),
  }))

  return {
    ok: true,
    as_of: new Date().toISOString(),
    today,
    services,
    trend,
  }
}

// ── date helpers (UTC-aligned for quota-reset alignment) ───────────────────

function isoToday(): string {
  return new Date().toISOString().slice(0, 10)
}

function isoMinusDays(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

/**
 * Returns a 30-element array filled with `{ date, count: 0 }` for any
 * day not present in `rows`. Makes the sparkline render with zeros
 * instead of gaps.
 */
function fillMissingDays(
  rows: { date: string; count: number }[],
  fromIso: string,
  toIso: string,
): { date: string; count: number }[] {
  const map = new Map(rows.map((r) => [r.date, r.count]))
  const out: { date: string; count: number }[] = []
  const start = new Date(fromIso + 'T00:00:00Z')
  const end = new Date(toIso + 'T00:00:00Z')
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10)
    out.push({ date: iso, count: map.get(iso) ?? 0 })
  }
  return out
}
