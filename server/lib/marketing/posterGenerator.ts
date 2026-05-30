/**
 * Daily Instagram feed-post copy generator (Phase 2).
 *
 * Where stories (Phase 1) are reactive to the current ride board,
 * posters are PROACTIVE: one feed post per day, driven by the
 * current month's marketing theme + the rotating weekly feature
 * focus from marketing_themes. The output is text-only — headline,
 * subheadline, body, hashtags — designed to be pasted into one of
 * the admin's Canva templates.
 *
 * Two entry points:
 *  - generatePosterBatch({ source: 'manual', audience? }) — Generate-now
 *    button. Audience optional (defaults 'both' = rider+driver).
 *  - tryGenerateDailyPoster() — cron, gated to >= 7 AM PT, idempotent
 *    via the partial unique index source='cron' on poster_batches.
 *
 * The generator produces ONE poster_item per batch (not 6 like
 * stories) — feed posts have a much lower healthy cadence than
 * stories. Audience='both' generates a single poster that frames
 * the feature for both sides; 'rider' or 'driver' generates a
 * targeted variant.
 */
import { supabaseAdmin } from '../supabaseAdmin.ts'
import { geminiGenerate, MODEL_FAST, isGeminiConfigured } from './gemini.ts'
import { BRAND_SYSTEM_PROMPT } from './brandContext.ts'

export type PosterAudience = 'rider' | 'driver' | 'both'

interface GenerateArgs {
  source: 'cron' | 'manual'
  /**
   * Date string YYYY-MM-DD. Defaults to TODAY in America/Los_Angeles
   * (NOT UTC) so manual generations match the cron's PT-anchored
   * batch grouping. Late-PT-evening clicks no longer jump into
   * tomorrow's row.
   */
  forDate?: string
  /**
   * Which audience the poster speaks to. 'both' is the safe daily
   * default; 'rider' or 'driver' lets the admin do targeted drops
   * when they're trying to grow one side of the marketplace.
   */
  audience?: PosterAudience
}

/**
 * Today's date in America/Los_Angeles as YYYY-MM-DD. Used as the
 * `for_date` anchor for everything in the marketing panel so the
 * admin's "today" mental model (PT, matching the cron clock)
 * lines up with both manual and cron batches.
 */
function todayPT(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export interface PosterGenerationResult {
  batch_id: string
  item_count: number
  skipped_existing: boolean
  reason?: string
}

interface PosterCopy {
  headline: string
  subheadline: string
  body: string
  hashtags: string
  canva_template: string
}

interface MarketingThemeRow {
  id: string
  effective_month: string
  theme_name: string
  theme_summary: string
  week_1_feature: string
  week_2_feature: string
  week_3_feature: string
  week_4_feature: string
}

/**
 * Returns the marketing_themes row whose effective_month is the
 * first of the current month (or null if no theme is seeded).
 * Also picks the week-of-month feature focus to pass to Gemini.
 */
async function fetchCurrentThemeAndFocus(forDate: string): Promise<{
  theme: MarketingThemeRow | null
  weekFocus: string
  weekIndex: 1 | 2 | 3 | 4
  fetchError: string | null
}> {
  const d = new Date(forDate + 'T00:00:00Z')
  const monthStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10)

  // Destructure error too — previously this swallowed RLS/network/
  // schema-drift failures and silently routed into the "no theme"
  // prompt branch with no batch.error signal.
  const { data, error } = await supabaseAdmin
    .from('marketing_themes')
    .select('id, effective_month, theme_name, theme_summary, week_1_feature, week_2_feature, week_3_feature, week_4_feature')
    .eq('effective_month', monthStart)
    .maybeSingle()

  if (error) {
    console.error('[marketing/posters] theme fetch failed:', error.message)
  }

  const theme = (data as MarketingThemeRow | null) ?? null

  // Week index: roughly week-of-month bucketed into 1..4 by the
  // ceil(day/7) heuristic. Day 1-7 → week 1, 8-14 → 2, 15-21 → 3,
  // 22-end → 4. Good enough — themes are monthly artifacts, not
  // calendar-week precise.
  const weekIndex = Math.min(4, Math.ceil(d.getUTCDate() / 7)) as 1 | 2 | 3 | 4
  const weekFocus = theme
    ? [theme.week_1_feature, theme.week_2_feature, theme.week_3_feature, theme.week_4_feature][weekIndex - 1]!
    : ''

  return { theme, weekFocus, weekIndex, fetchError: error?.message ?? null }
}

/**
 * Per-poster prompt. Same brand prompt as stories, different
 * instructions for the output shape (5 fields vs 2) + the theme
 * grounding so the post lands in a coherent month-long arc.
 */
function buildPosterPrompt(args: {
  theme: MarketingThemeRow | null
  weekFocus: string
  weekIndex: 1 | 2 | 3 | 4
  audience: PosterAudience
}): string {
  const audLine =
    args.audience === 'rider'
      ? 'Speak TO RIDERS specifically (frame the value as a rider).'
      : args.audience === 'driver'
        ? 'Speak TO DRIVERS specifically (frame the value as gas reimbursement on trips they were already making).'
        // Balanced-marketplace rule (CLAUDE.md): the copy must land
        // for BOTH roles. Pick a frame that names both sides
        // explicitly OR a verb that works for either ("split the gas
        // or get yours covered"). Don't pick one side and assume it
        // works — it doesn't.
        : 'Write copy that lands for BOTH riders AND drivers in the same post. The headline and body MUST each contain language that works for either side reading it (e.g. "split the gas or get yours covered", "ride together — drivers paid, riders save").'

  const themeBlock = args.theme
    ? `
Current monthly theme: "${args.theme.theme_name}"
  ${args.theme.theme_summary}

This week (week ${args.weekIndex} of the month) focuses on:
  ${args.weekFocus}
    `.trim()
    : `No monthly theme set. Pick any high-converting Tago feature naturally.`

  return `
Generate ONE Instagram FEED POST (not a story) for Tago in the
founder's voice. Feed posts are higher-stakes than stories — they
sit on the profile grid and represent the brand. Goal: ground the
post in the current monthly theme + this week's feature focus so
the feed has a coherent arc.

${themeBlock}

${audLine}

Output a JSON object (no markdown fences):
{
  "headline":     "...",  // 6-10 words. Used as the hero text in Canva.
  "subheadline":  "...",  // 5-12 words. One supporting line.
  "body":         "...",  // 2-3 sentences. The actual post copy.
  "hashtags":     "...",  // 8-12 space-separated hashtags. Mix:
                          //   #ucdavis #aggielife (school)
                          //   #carpool #rideshare (category)
                          //   #davisca #sacramento #bayarea #socal (geo)
                          //   #studentlife #collegelife (lifestyle)
                          //   #gasreimbursement (positioning)
  "canva_template": "..." // ONE OF: 'safety', 'driver-upside',
                          //   'smart-matching', 'frictionless'.
                          //   Pick the template that best fits the
                          //   week's focus.
}

Constraints:
- Strong verbs. Short sentences. Specific over abstract.
- Reference the weekly focus directly in the headline OR body.
- NEVER use "earn money", "side hustle", "join the movement",
  "community", or any "Uber for students" framing.
- The link in the bio is tagorides.com — don't restate it in body.
- If the audience is 'rider', emphasize trust + cost split + .edu.
- If 'driver', emphasize gas reimbursement + the
  trip-you-were-already-making framing. Brand-safe phrasing for the
  driver-keeps-everything point is: "right now, drivers keep 100% of
  the fare" — NEVER "earn", "make", "pocket", or "take home" 100%.
  Drop the "right now" hedge only when space forces it.
- If 'both', follow the audience block above — balanced two-sided
  copy (see audLine). Do NOT pick a single audience for the 'both'
  case; that violates the balanced-marketplace rule.
`.trim()
}

/**
 * Strict parser — requires ALL 5 fields with sensible minimum
 * lengths. A degraded poster (empty hashtags, no subheadline) is
 * worse than a missing one in a once-per-day cadence: the admin
 * wouldn't know to regenerate. Hard-fail with a descriptive reason
 * so the batch.error column surfaces what's missing.
 */
function parsePosterCopy(text: string): { copy: PosterCopy | null; reason: string | null } {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end < start) {
    return { copy: null, reason: 'no JSON object braces found in response' }
  }
  let obj: Partial<PosterCopy>
  try {
    obj = JSON.parse(cleaned.slice(start, end + 1)) as Partial<PosterCopy>
  } catch (err) {
    return { copy: null, reason: `JSON.parse threw: ${err instanceof Error ? err.message : String(err)}` }
  }

  const headline = (typeof obj.headline === 'string' ? obj.headline : '').trim()
  const body = (typeof obj.body === 'string' ? obj.body : '').trim()
  const subheadline = (typeof obj.subheadline === 'string' ? obj.subheadline : '').trim()
  const hashtags = (typeof obj.hashtags === 'string' ? obj.hashtags : '').trim()
  // Use `||` not `??` so empty strings ALSO fall back to 'safety'
  // (the `??` short-circuit only caught null/undefined).
  const canva_template = ((typeof obj.canva_template === 'string' ? obj.canva_template : '').trim()) || 'safety'

  const missing: string[] = []
  if (headline.length < 3) missing.push('headline')
  if (body.length < 10) missing.push('body')
  if (subheadline.length < 3) missing.push('subheadline')
  if (hashtags.length < 3) missing.push('hashtags')
  if (missing.length > 0) {
    return {
      copy: null,
      reason: `missing/empty fields: ${missing.join(', ')}`,
    }
  }

  return {
    copy: { headline, subheadline, body, hashtags, canva_template },
    reason: null,
  }
}

export async function generatePosterBatch(args: GenerateArgs): Promise<PosterGenerationResult> {
  if (!isGeminiConfigured()) {
    return {
      batch_id: '',
      item_count: 0,
      skipped_existing: false,
      reason: 'GEMINI_API_KEY not configured',
    }
  }

  // Default to PT-anchored date (not UTC) so manual batches group
  // with the cron's batches on the admin's "today" mental model.
  const forDate = args.forDate ?? todayPT()
  const audience: PosterAudience = args.audience ?? 'both'

  // Cron is idempotent (one batch/day), manual stacks (multiple
  // audience runs welcome). The short-circuit reuses an existing
  // PENDING/REVIEWED cron batch only — if today's cron batch is in
  // 'failed' status, fall through and try again. Without this gate
  // a transient Gemini failure wedges the entire day's auto-cron.
  if (args.source === 'cron') {
    const { data: existing } = await supabaseAdmin
      .from('marketing_poster_batches')
      .select('id, item_count')
      .eq('for_date', forDate)
      .eq('source', 'cron')
      .neq('status', 'failed')
      .maybeSingle()
    if (existing) {
      return {
        batch_id: (existing as { id: string }).id,
        item_count: (existing as { item_count: number }).item_count,
        skipped_existing: true,
      }
    }
  }

  const { theme, weekFocus, weekIndex, fetchError: themeErr } = await fetchCurrentThemeAndFocus(forDate)

  const { data: batch, error: batchErr } = await supabaseAdmin
    .from('marketing_poster_batches')
    .insert({
      for_date: forDate,
      source: args.source,
      theme_id: theme?.id ?? null,
      theme_snapshot: theme?.theme_name ?? null,
      weekly_focus_snapshot: weekFocus || null,
      llm_model: MODEL_FAST,
      item_count: 0,
      status: 'pending',
    } as never)
    .select('id')
    .single()
  if (batchErr || !batch) {
    console.error('[marketing/posters] batch insert failed:', batchErr?.message)
    return {
      batch_id: '',
      item_count: 0,
      skipped_existing: false,
      reason: batchErr?.message ?? 'batch insert failed',
    }
  }
  const batchId = (batch as { id: string }).id

  let inserted = 0
  const errors: string[] = []
  // Surface the theme-fetch error (if any) into the batch so admins
  // see "theme fetch failed: ..." in the UI instead of getting a
  // silent default-prompt batch.
  if (themeErr) errors.push(`theme lookup failed: ${themeErr}`)

  try {
    const result = await geminiGenerate({
      systemPrompt: BRAND_SYSTEM_PROMPT,
      userPrompt: buildPosterPrompt({ theme, weekFocus, weekIndex, audience }),
      temperature: 0.85,
      maxOutputTokens: 1024,
      responseMimeType: 'application/json',
      thinkingBudget: 0,
    })
    const { copy, reason: parseReason } = parsePosterCopy(result.text)
    if (!copy) {
      const preview = result.text ? result.text.slice(0, 200) : '(empty response)'
      const msg = `audience=${audience}: ${parseReason ?? 'unparseable'} → ${preview}`
      console.warn(`[marketing/posters] ${msg}`)
      errors.push(msg)
    } else {
      const { error: itemErr } = await supabaseAdmin
        .from('marketing_poster_items')
        .insert({
          batch_id: batchId,
          audience,
          canva_template: copy.canva_template,
          headline: copy.headline,
          subheadline: copy.subheadline,
          body: copy.body,
          hashtags: copy.hashtags,
          status: 'pending',
        } as never)
      if (itemErr) {
        const msg = `audience=${audience}: item insert failed → ${itemErr.message}`
        console.error(`[marketing/posters] ${msg}`)
        errors.push(msg)
      } else {
        inserted += 1
      }
    }
  } catch (err) {
    const msg = `audience=${audience}: Gemini call threw → ${err instanceof Error ? err.message : String(err)}`
    console.error(`[marketing/posters] ${msg}`)
    errors.push(msg)
  }

  const aggregatedError = errors.length > 0
    ? (errors.join(' | ').length > 800
      ? `${errors.join(' | ').slice(0, 797)}...`
      : errors.join(' | '))
    : null

  // Surface the update error too — silently failing here leaves the
  // batch stuck at status='pending' with item_count=0 forever.
  const { error: updateErr } = await supabaseAdmin
    .from('marketing_poster_batches')
    .update({
      item_count: inserted,
      status: inserted > 0 ? 'pending' : 'failed',
      ...(aggregatedError ? { error: aggregatedError } : {}),
    } as never)
    .eq('id', batchId)
  if (updateErr) {
    console.error('[marketing/posters] batch finalize update failed:', updateErr.message)
    errors.push(`batch update failed: ${updateErr.message}`)
  }

  return {
    batch_id: batchId,
    item_count: inserted,
    skipped_existing: false,
    ...(errors.length > 0 ? { reason: `${inserted} ok, ${errors.length} failed` } : {}),
  }
}

/**
 * Cron entry point. Same PT-7-AM gate + once-per-day guarantee as
 * the story generator. Always runs with audience='both' for the
 * cron path — the admin can still trigger targeted manual runs.
 */
export async function tryGenerateDailyPoster(): Promise<{ generated: boolean; reason: string }> {
  if (!isGeminiConfigured()) return { generated: false, reason: 'no_key' }

  const ptHourStr = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: '2-digit',
    hour12: false,
  }).format(new Date())
  const ptHour = parseInt(ptHourStr, 10)
  if (Number.isNaN(ptHour) || ptHour < 7) {
    return { generated: false, reason: `pt_hour=${ptHour}_before_7am` }
  }

  const result = await generatePosterBatch({ source: 'cron', forDate: todayPT(), audience: 'both' })
  if (result.skipped_existing) return { generated: false, reason: 'already_ran_today' }
  return {
    generated: result.item_count > 0,
    reason: result.reason ?? `generated_${result.item_count}_items`,
  }
}
