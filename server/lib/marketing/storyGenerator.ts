/**
 * Daily Instagram-story generator. Pulls top-ranked corridors from
 * ride_schedules, asks Gemini to write one story per corridor in
 * Tago's voice, and writes the results to marketing_story_batches +
 * marketing_story_items so the admin UI can render the queue.
 *
 * Two entry points:
 *  - generateStoryBatch({ source: 'manual' }) — used by the admin
 *    "Generate now" button. Always tries to insert; the UNIQUE
 *    constraint on (for_date, source='manual') would block a second
 *    manual run on the same day, so we re-use the existing batch in
 *    that case.
 *  - generateStoryBatch({ source: 'cron' })   — used by the daily
 *    7 AM PT sweep. Same logic; the UNIQUE constraint guarantees
 *    one cron batch per day.
 */
import { supabaseAdmin } from '../supabaseAdmin.ts'
import { geminiGenerate, MODEL_FAST, isGeminiConfigured } from './gemini.ts'
import { BRAND_SYSTEM_PROMPT } from './brandContext.ts'
import { fetchAndClusterCorridors, type Corridor } from './corridors.ts'

interface GenerateArgs {
  source: 'cron' | 'manual'
  /** UTC date string YYYY-MM-DD; defaults to today. */
  forDate?: string
}

export interface StoryGenerationResult {
  batch_id: string
  item_count: number
  skipped_existing: boolean
  reason?: string
}

interface StoryCopy {
  headline: string
  body: string
}

/**
 * Builds the per-corridor user prompt. Keeps the prompt deterministic
 * and tightly structured so the response is parseable JSON.
 */
function buildCorridorPrompt(c: Corridor): string {
  const askLine = c.asking_for === 'driver'
    ? `We need drivers. ${c.rider_count} rider(s) posted; only ${c.driver_count} driver(s) so far.`
    : `We need riders. ${c.driver_count} driver(s) posted; only ${c.rider_count} rider(s) so far.`

  // Up to 3 ride snippets — enough to ground the story in real
  // trips, not so many that the prompt balloons.
  const sampleRides = c.rides.slice(0, 3).map((r) =>
    `- ${r.origin_region} → ${r.dest_region} on ${r.trip_date}${r.trip_time ? ` at ${r.trip_time.slice(0, 5)}` : ''} (${r.mode})`,
  ).join('\n')

  return `
Generate ONE Instagram story for Tago in the founder's voice. Follow
the high-converting template from the brand prompt exactly: headline
line + 1-2 line body asking for the opposite role.

Corridor: ${c.primary_origin} ⇌ ${c.primary_dest}
Date label: ${c.date_label}
Audience to ask: ${c.asking_for === 'driver' ? 'DRIVERS' : 'RIDERS'}
${askLine}

Sample rides in this corridor:
${sampleRides}

Output ONLY a JSON object with no markdown fences:
{
  "headline": "...",
  "body": "..."
}

Constraints:
- Headline ≤ 8 words. Use the 🚗 + 🌴/⛰️/🌉 emoji pattern from past
  high-performers when fitting; skip emojis if forced.
- Body: 1-2 sentences max. Frame the "you're already making either
  trip" angle. Include "gas reimbursed" / "your gas is paid" if asking
  for drivers; "split the cost" / "skip the bus" if asking for riders.
- NO "join the movement" or "earn money" framings.
- NO link in the body — the link sticker is added by the admin after.
`.trim()
}

/**
 * Parses the model's JSON response, tolerating leading/trailing
 * markdown fences or trailing prose (Gemini occasionally adds them
 * even when told not to).
 */
function parseStoryCopy(text: string): StoryCopy | null {
  // Strip ```json ... ``` fences if present.
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
  // Find first { and last } and slice — handles stray prose.
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end < start) return null
  try {
    const obj = JSON.parse(cleaned.slice(start, end + 1)) as Partial<StoryCopy>
    if (typeof obj.headline !== 'string' || typeof obj.body !== 'string') return null
    return { headline: obj.headline.trim(), body: obj.body.trim() }
  } catch {
    return null
  }
}

export async function generateStoryBatch(args: GenerateArgs): Promise<StoryGenerationResult> {
  if (!isGeminiConfigured()) {
    return {
      batch_id: '',
      item_count: 0,
      skipped_existing: false,
      reason: 'GEMINI_API_KEY not configured',
    }
  }

  const forDate = args.forDate ?? new Date().toISOString().slice(0, 10)

  // Short-circuit: if a batch for (forDate, source) already exists,
  // return it. Cheaper than inserting and hitting the UNIQUE error.
  const { data: existing } = await supabaseAdmin
    .from('marketing_story_batches')
    .select('id, item_count')
    .eq('for_date', forDate)
    .eq('source', args.source)
    .maybeSingle()

  if (existing) {
    return {
      batch_id: (existing as { id: string }).id,
      item_count: (existing as { item_count: number }).item_count,
      skipped_existing: true,
    }
  }

  const { corridors, error: fetchErr } = await fetchAndClusterCorridors()
  if (fetchErr) {
    // Surface the DB error onto the batch row so the admin UI shows
    // the actual cause instead of "no eligible corridors today" —
    // which is misleading when the real problem is a query failure.
    const { data: errBatch } = await supabaseAdmin
      .from('marketing_story_batches')
      .insert({
        for_date: forDate,
        source: args.source,
        llm_model: MODEL_FAST,
        item_count: 0,
        status: 'failed',
        error: `ride_schedules query failed: ${fetchErr}`,
      } as never)
      .select('id')
      .single()
    return {
      batch_id: (errBatch as { id: string } | null)?.id ?? '',
      item_count: 0,
      skipped_existing: false,
      reason: `ride_schedules query failed: ${fetchErr}`,
    }
  }
  if (corridors.length === 0) {
    // Still insert a (zero-item) batch row so the admin UI can show
    // "we scanned today; nothing worth posting" rather than a blank
    // page that looks like the cron didn't run.
    const { data: emptyBatch, error: emptyErr } = await supabaseAdmin
      .from('marketing_story_batches')
      .insert({
        for_date: forDate,
        source: args.source,
        llm_model: MODEL_FAST,
        item_count: 0,
        status: 'pending',
      } as never)
      .select('id')
      .single()
    if (emptyErr) {
      console.error('[marketing/stories] empty-batch insert failed:', emptyErr.message)
      return { batch_id: '', item_count: 0, skipped_existing: false, reason: emptyErr.message }
    }
    return {
      batch_id: (emptyBatch as { id: string }).id,
      item_count: 0,
      skipped_existing: false,
      reason: 'no eligible corridors today',
    }
  }

  const { data: batch, error: batchErr } = await supabaseAdmin
    .from('marketing_story_batches')
    .insert({
      for_date: forDate,
      source: args.source,
      llm_model: MODEL_FAST,
      item_count: 0,
      status: 'pending',
    } as never)
    .select('id')
    .single()
  if (batchErr || !batch) {
    console.error('[marketing/stories] batch insert failed:', batchErr?.message)
    return { batch_id: '', item_count: 0, skipped_existing: false, reason: batchErr?.message ?? 'batch insert failed' }
  }
  const batchId = (batch as { id: string }).id

  let inserted = 0
  let errorCount = 0

  for (const corridor of corridors) {
    try {
      const result = await geminiGenerate({
        systemPrompt: BRAND_SYSTEM_PROMPT,
        userPrompt: buildCorridorPrompt(corridor),
        temperature: 0.9,
        maxOutputTokens: 512,
      })
      const copy = parseStoryCopy(result.text)
      if (!copy) {
        console.warn(`[marketing/stories] unparseable Gemini response for ${corridor.corridor}:`, result.text.slice(0, 200))
        errorCount += 1
        continue
      }
      const { error: itemErr } = await supabaseAdmin
        .from('marketing_story_items')
        .insert({
          batch_id: batchId,
          corridor: corridor.corridor,
          asking_for: corridor.asking_for!,
          headline: copy.headline,
          body: copy.body,
          date_label: corridor.date_label,
          matched_ride_count: corridor.rides.length,
          status: 'pending',
        } as never)
      if (itemErr) {
        console.error(`[marketing/stories] item insert failed for ${corridor.corridor}:`, itemErr.message)
        errorCount += 1
        continue
      }
      inserted += 1
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[marketing/stories] Gemini call failed for ${corridor.corridor}:`, msg)
      errorCount += 1
    }
  }

  // Persist the final count on the batch row.
  await supabaseAdmin
    .from('marketing_story_batches')
    .update({
      item_count: inserted,
      status: inserted > 0 ? 'pending' : 'failed',
      ...(errorCount > 0 ? { error: `${errorCount} item(s) failed during generation` } : {}),
    } as never)
    .eq('id', batchId)

  return {
    batch_id: batchId,
    item_count: inserted,
    skipped_existing: false,
    ...(errorCount > 0 ? { reason: `${inserted} ok, ${errorCount} failed` } : {}),
  }
}

/**
 * Cron entry point. Only runs when local PT time is >= 7 AM AND the
 * day's cron batch hasn't been created yet. Designed to be called
 * from runReminderSweep() — cheap (one SELECT + a hour check) on
 * every tick that isn't the morning run.
 */
export async function tryGenerateDailyStories(): Promise<{ generated: boolean; reason: string }> {
  if (!isGeminiConfigured()) return { generated: false, reason: 'no_key' }

  // Convert "now" to America/Los_Angeles to honour the 7 AM PT trigger.
  // Intl with hour12=false + timeZone gets us hour-of-day cheaply
  // without pulling in a tz library.
  const ptHourStr = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: '2-digit',
    hour12: false,
  }).format(new Date())
  const ptHour = parseInt(ptHourStr, 10)
  if (Number.isNaN(ptHour) || ptHour < 7) {
    return { generated: false, reason: `pt_hour=${ptHour}_before_7am` }
  }

  // forDate uses PT date so a 7-7:59 AM PT run on UTC tomorrow still
  // writes against today's PT date.
  const ptDateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())

  const result = await generateStoryBatch({ source: 'cron', forDate: ptDateStr })
  if (result.skipped_existing) {
    return { generated: false, reason: 'already_ran_today' }
  }
  return {
    generated: result.item_count > 0,
    reason: result.reason ?? `generated_${result.item_count}_items`,
  }
}
