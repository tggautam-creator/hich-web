/**
 * Phase 4.1 — schema-aware database tools for the Marketing Advisor.
 *
 * Gives Gemini two tools (query_table + count_table) that hit the
 * Tago database via PostgREST/supabase-js. Bounded by:
 *   - Whitelisted tables (no PII tables like messages, no secret-
 *     bearing tables like payment_intents/push_tokens)
 *   - PII-column scrub on every result row (emails, phones,
 *     stripe_account_ids never leave the server)
 *   - Per-call row cap (100 max) + result-size cap
 *   - SELECT-only by construction — we use supabaseAdmin.from().select()
 *     which can't mutate
 *
 * The schema description is compact text (~2-3k tokens) injected
 * ONCE per advisor session into the system prompt, so Gemini knows
 * what tables/columns exist without us listing them as separate
 * tool params or burning tokens per call.
 */
import { supabaseAdmin } from '../supabaseAdmin.ts'

// ── Whitelist ──────────────────────────────────────────────────────

/**
 * Tables Gemini is allowed to query. EXCLUDES:
 *   - messages (PII: chat content between riders/drivers)
 *   - notification_preferences (PII)
 *   - push_tokens (security: FCM tokens are credentials)
 *   - reports + report_messages (sensitive: harassment/safety
 *     reports between users)
 *   - payment_intents (Stripe secrets in raw responses)
 *   - auth.* (raw auth tables, password hashes)
 *
 * Marketing tables are included so the advisor can introspect its
 * own output (e.g. "what stories did I generate this week?").
 */
export const ALLOWED_TABLES = [
  // Core marketplace
  'users',
  'vehicles',
  'rides',
  'ride_schedules',
  'driver_routines',
  'ride_offers',
  'ride_suggestions',
  'driver_locations',
  // Marketing self-introspection
  'marketing_themes',
  'marketing_story_batches',
  'marketing_story_items',
  'marketing_poster_batches',
  'marketing_poster_items',
  'marketing_advisor_threads',
  'marketing_daily_briefings',
  // Admin observability (no PII)
  'audit_log',
] as const

export type AllowedTable = typeof ALLOWED_TABLES[number]

/**
 * Columns scrubbed from EVERY result row regardless of what the
 * model asked for. The .select() doesn't filter these out because
 * the model might ask for `*` — so we post-process the rows.
 */
const SCRUB_COLUMNS = new Set<string>([
  'email',
  'phone',
  'phone_number',
  'stripe_account_id',
  'stripe_customer_id',
  'stripe_payment_method_id',
  'firebase_token',
  'fcm_token',
  'push_token',
  'auth_token',
  'refresh_token',
  'password_hash',
  'license_url',
  'license_photo_url',
  'avatar_url', // can leak storage paths
  'qr_token',
])

/**
 * Compact schema description embedded in the advisor's system
 * prompt. Lists the whitelisted tables + the columns the advisor
 * most often wants. Keep this tight — every token here is paid
 * for on every advisor message.
 *
 * If a parallel-session migration adds columns to existing
 * tables, the model can still query them (the .select() string is
 * arbitrary text), but it won't know they exist until this is
 * updated. Acceptable trade-off for token economy.
 */
export const SCHEMA_DESCRIPTION = `
## TAGO DATABASE SCHEMA (read-only access via query_table tool)

You can read these tables. Common columns listed; not exhaustive
(some tables have more columns; ask for specific ones in select).

**users** — every signup. is_driver=true means they can drive.
  Columns: id, full_name, university, is_driver, has_completed_onboarding,
  created_at, last_active_at, last_known_lat, last_known_lng,
  has_accessibility_needs, is_admin
  (email + phone + stripe_account_id are SCRUBBED from results.)

**vehicles** — cars owned by drivers.
  Columns: id, user_id, make, model, year, color, license_plate,
  seats, has_wheelchair, trunk_size, created_at

**rides** — actual rides taken (matched + executed).
  Columns: id, rider_id, driver_id, vehicle_id, status,
  fare_cents, gas_cost_cents, time_cost_cents, payment_status,
  gps_distance_metres, duration_min, rider_rating, driver_rating,
  tip_cents, end_reason, cancel_reason, created_at, started_at,
  ended_at, pickup_address, dropoff_address
  status: 'requested' | 'accepted' | 'active' | 'completed' | 'cancelled'

**ride_schedules** — posted ride requests/offers on the Ride Board.
  Columns: id, user_id, mode, route_name, origin_address,
  dest_address, trip_date, time_type, trip_time, time_flexible,
  available_seats, end_date, seats_locked, created_at
  mode: 'rider' (looking for a ride) | 'driver' (offering one)

**driver_routines** — recurring routes (M/W/F commutes etc).
  Columns: id, user_id, mode, route_name, origin_address,
  dest_address, day_of_week (int[]), departure_time, arrival_time,
  available_seats, end_date, is_active, created_at
  mode: 'rider' | 'driver'

**ride_offers** — driver-to-rider offers on board posts.
  Columns: id, ride_schedule_id, driver_id, status, created_at,
  responded_at
  status: 'pending' | 'accepted' | 'declined' | 'expired'

**ride_suggestions** — engine-generated rider↔driver matches.
  Columns: id, rider_user_id, driver_user_id, trip_date,
  match_type, relevance_score, rider_status, driver_status,
  notified_via_instant, rider_notified_at, driver_notified_at,
  expires_at, created_at

**driver_locations** — last known GPS per driver (online status).
  Columns: user_id, recorded_at, is_online, lat, lng
  Use recorded_at >= now()-5min to count "online right now".

**marketing_themes** — monthly marketing theme + weekly feature focus.
  Columns: effective_month, theme_name, theme_summary,
  week_1_feature .. week_4_feature

**marketing_story_items** — generated Instagram-story copy.
  Columns: id, batch_id, corridor, asking_for, headline, body,
  matched_ride_count, status, created_at
  status: 'pending' | 'copied' | 'posted' | 'skipped'

**marketing_poster_items** — generated poster copy + images.
  Columns: id, batch_id, audience, format, headline, subheadline,
  body, hashtags, caption, image_url, theme_angle, founder_note,
  event_tag, feature_spotlight, status, created_at
  audience: 'rider' | 'driver' | 'both'
  format: 'ig_story' | 'ig_post' | 'a4_sheet' | 'custom'

**marketing_advisor_threads** — your own chat threads (for self-ref).
  Columns: id, title, user_id, created_at, updated_at

**marketing_daily_briefings** — pre-generated daily focus banners.
  Columns: id, for_date, focus, detail, dismissed_at

**audit_log** — admin actions (campaigns sent, refunds, etc).
  Columns: id, admin_user_id, action_type, target_user_id,
  payload (jsonb), created_at

## Tools available

- query_table(table, select?, filter?, order?, limit?) — returns rows
- count_table(table, filter?) — returns just the count, no rows

Use count_table when you only need a number — it's much cheaper.
Use query_table with specific column lists; avoid select="*" on
big tables. Always set limit to something reasonable (10-50 for
inspection, up to 100 max).

PostgREST filter syntax for the filter param:
  "column.operator.value"
  Operators: eq, neq, gt, gte, lt, lte, like, ilike, in, is, not.is
  Multiple filters: comma-separated, all AND'd.
  Examples:
    "mode.eq.driver"
    "is_driver.eq.true,is_admin.eq.false"
    "created_at.gte.2026-05-01"
    "status.in.(completed,active)"
    "stripe_account_id.not.is.null"

Order syntax: "column.asc" or "column.desc"

Call tools FIRST when the user's question needs data. Don't make
up numbers — query for them.
`.trim()

// ── Tool execution ─────────────────────────────────────────────────

const MAX_ROWS = 100
const MAX_RESULT_BYTES = 25_000  // ~6k tokens

export interface QueryTableArgs {
  table: string
  select?: string
  filter?: string
  order?: string
  limit?: number
}

export interface QueryTableResult {
  ok: boolean
  rows?: unknown[]
  row_count?: number
  truncated?: boolean
  scrubbed_columns?: string[]
  error?: string
}

function isAllowed(table: string): table is AllowedTable {
  return (ALLOWED_TABLES as readonly string[]).includes(table)
}

function applyFilters(
  query: ReturnType<ReturnType<typeof supabaseAdmin.from>['select']>,
  filterStr: string,
): { query: typeof query; error: string | null } {
  // Parse "col.op.val,col2.op.val2" — supabase-js doesn't accept a
  // raw PostgREST filter string, so we build the chain.
  const parts = filterStr.split(',').map((s) => s.trim()).filter(Boolean)
  let q = query
  for (const part of parts) {
    const m = part.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\.(eq|neq|gt|gte|lt|lte|like|ilike|is|in)\.(.+)$/)
    if (!m) return { query: q, error: `unparseable filter clause: "${part}"` }
    const [, col, op, valRaw] = m
    switch (op) {
      case 'eq':  q = q.eq(col!, coerce(valRaw!));  break
      case 'neq': q = q.neq(col!, coerce(valRaw!)); break
      case 'gt':  q = q.gt(col!, coerce(valRaw!));  break
      case 'gte': q = q.gte(col!, coerce(valRaw!)); break
      case 'lt':  q = q.lt(col!, coerce(valRaw!));  break
      case 'lte': q = q.lte(col!, coerce(valRaw!)); break
      case 'like':  q = q.like(col!, valRaw!);  break
      case 'ilike': q = q.ilike(col!, valRaw!); break
      case 'is':  q = q.is(col!, valRaw === 'null' ? null : valRaw === 'true' ? true : valRaw === 'false' ? false : valRaw!); break
      case 'in':  {
        // "in.(a,b,c)" → ['a','b','c']
        const arrMatch = valRaw!.match(/^\((.+)\)$/)
        const arr = (arrMatch ? arrMatch[1]! : valRaw!).split(',').map((s) => coerce(s.trim()))
        q = q.in(col!, arr)
        break
      }
      default: return { query: q, error: `unsupported operator: ${op}` }
    }
  }
  return { query: q, error: null }
}

function coerce(v: string): string | number | boolean | null {
  if (v === 'null') return null
  if (v === 'true') return true
  if (v === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v)
  return v
}

function scrubRow(row: unknown): { scrubbed: Record<string, unknown>; scrubbedKeys: string[] } {
  if (!row || typeof row !== 'object') {
    return { scrubbed: row as Record<string, unknown>, scrubbedKeys: [] }
  }
  const out: Record<string, unknown> = {}
  const scrubbedKeys: string[] = []
  for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
    if (SCRUB_COLUMNS.has(k)) {
      scrubbedKeys.push(k)
      continue
    }
    out[k] = v
  }
  return { scrubbed: out, scrubbedKeys }
}

export async function executeQueryTable(args: QueryTableArgs): Promise<QueryTableResult> {
  if (!isAllowed(args.table)) {
    return {
      ok: false,
      error: `table "${args.table}" is not allowed. Allowed: ${ALLOWED_TABLES.join(', ')}`,
    }
  }
  const limit = Math.min(MAX_ROWS, Math.max(1, Math.floor(args.limit ?? 25)))
  const select = (args.select ?? '*').trim() || '*'

  let q = supabaseAdmin.from(args.table).select(select).limit(limit)

  if (args.filter && args.filter.trim().length > 0) {
    const { query, error } = applyFilters(q, args.filter)
    if (error) return { ok: false, error }
    q = query
  }

  if (args.order && args.order.trim().length > 0) {
    const m = args.order.trim().match(/^([a-zA-Z_][a-zA-Z0-9_]*)(?:\.(asc|desc))?$/)
    if (m) {
      q = q.order(m[1]!, { ascending: m[2] !== 'desc' })
    }
  }

  const { data, error } = await q
  if (error) {
    return { ok: false, error: error.message }
  }
  const scrubbedKeysAll = new Set<string>()
  const scrubbedRows = (data ?? []).map((r) => {
    const { scrubbed, scrubbedKeys } = scrubRow(r)
    for (const k of scrubbedKeys) scrubbedKeysAll.add(k)
    return scrubbed
  })

  // Size cap — truncate if the JSON would blow the budget.
  let truncated = false
  let serialized = JSON.stringify(scrubbedRows)
  while (serialized.length > MAX_RESULT_BYTES && scrubbedRows.length > 1) {
    scrubbedRows.pop()
    truncated = true
    serialized = JSON.stringify(scrubbedRows)
  }

  return {
    ok: true,
    rows: scrubbedRows,
    row_count: scrubbedRows.length,
    truncated,
    scrubbed_columns: scrubbedKeysAll.size > 0 ? Array.from(scrubbedKeysAll) : undefined,
  }
}

export interface CountTableArgs {
  table: string
  filter?: string
}

export interface CountTableResult {
  ok: boolean
  count?: number
  error?: string
}

export async function executeCountTable(args: CountTableArgs): Promise<CountTableResult> {
  if (!isAllowed(args.table)) {
    return {
      ok: false,
      error: `table "${args.table}" is not allowed. Allowed: ${ALLOWED_TABLES.join(', ')}`,
    }
  }
  let q = supabaseAdmin.from(args.table).select('id', { count: 'exact', head: true })
  if (args.filter && args.filter.trim().length > 0) {
    const { query, error } = applyFilters(q, args.filter)
    if (error) return { ok: false, error }
    q = query as typeof q
  }
  const { count, error } = await q
  if (error) return { ok: false, error: error.message }
  return { ok: true, count: count ?? 0 }
}

// ── Gemini tool declarations ──────────────────────────────────────

// Not `as const` — the ToolDeclaration interface in gemini.ts uses
// mutable arrays/strings; readonly tuples here wouldn't assign.
export const ADVISOR_TOOLS: Array<{
  name: string
  description: string
  parameters: {
    type: 'object'
    required?: string[]
    properties: Record<string, unknown>
  }
}> = [
  {
    name: 'query_table',
    description:
      'Read rows from a Tago database table. Returns up to 100 rows '
      + '(capped). PII columns (email, phone, Stripe IDs, etc.) are '
      + 'scrubbed automatically. SELECT-only. Use this when you need '
      + 'actual row data; use count_table when you only need a number.',
    parameters: {
      type: 'object',
      required: ['table'],
      properties: {
        table: {
          type: 'string',
          description: `Which table to query. Must be one of: ${ALLOWED_TABLES.join(', ')}`,
          enum: ALLOWED_TABLES as unknown as string[],
        },
        select: {
          type: 'string',
          description: 'Comma-separated columns. Default "*". Prefer specific columns to save tokens.',
        },
        filter: {
          type: 'string',
          description:
            'PostgREST filter, comma-separated AND clauses. '
            + 'Format: "col.op.value". Operators: eq, neq, gt, gte, '
            + 'lt, lte, like, ilike, in, is. Examples: "mode.eq.driver", '
            + '"created_at.gte.2026-05-01", "status.in.(completed,active)".',
        },
        order: {
          type: 'string',
          description: 'Column + direction, e.g. "created_at.desc" or "fare_cents.asc". Optional.',
        },
        limit: {
          type: 'number',
          description: 'Max rows to return (1-100). Default 25.',
        },
      },
    },
  },
  {
    name: 'count_table',
    description:
      'Count rows in a Tago database table matching a filter. Cheap — '
      + 'returns just the count, no row data. Use this when answering '
      + 'questions like "how many drivers are Stripe-onboarded?".',
    parameters: {
      type: 'object',
      required: ['table'],
      properties: {
        table: {
          type: 'string',
          description: `Which table to count. One of: ${ALLOWED_TABLES.join(', ')}`,
          enum: ALLOWED_TABLES as unknown as string[],
        },
        filter: {
          type: 'string',
          description: 'PostgREST filter (same syntax as query_table.filter). Empty = count everything.',
        },
      },
    },
  },
]

/**
 * Dispatch a tool call by name. Returns the structured result the
 * tool produced. Unknown tools return an error object.
 */
export async function dispatchToolCall(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (name === 'query_table') {
    return executeQueryTable({
      table: String(args['table'] ?? ''),
      select: typeof args['select'] === 'string' ? args['select'] : undefined,
      filter: typeof args['filter'] === 'string' ? args['filter'] : undefined,
      order: typeof args['order'] === 'string' ? args['order'] : undefined,
      limit: typeof args['limit'] === 'number' ? args['limit'] : undefined,
    })
  }
  if (name === 'count_table') {
    return executeCountTable({
      table: String(args['table'] ?? ''),
      filter: typeof args['filter'] === 'string' ? args['filter'] : undefined,
    })
  }
  return { ok: false, error: `unknown tool: ${name}` }
}
