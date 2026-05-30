/**
 * Phase 3 themed-poster generator. Produces a full Gemini/ChatGPT
 * image-gen PROMPT + a CAPTION + the legacy text fields per item.
 * Variety via deterministic angle rotation + "avoid these recent
 * headlines" injection. Steering via optional founder note +
 * structured event/feature inputs. Format-aware (story/post/A4/custom).
 */
import { supabaseAdmin } from '../supabaseAdmin.ts'
import { geminiGenerate, MODEL_FAST, isGeminiConfigured } from './gemini.ts'
import { BRAND_SYSTEM_PROMPT } from './brandContext.ts'
import {
  FORMAT_SPECS,
  pickAngle,
  fetchRecentPosterHeadlines,
  type PosterAngle,
} from './posterAngles.ts'

export type PosterAudience = 'rider' | 'driver' | 'both'
export type PosterFormat = 'ig_story' | 'ig_post' | 'a4_sheet' | 'custom'

interface GenerateArgs {
  source: 'cron' | 'manual'
  forDate?: string
  audience?: PosterAudience
  format?: PosterFormat
  founderNote?: string
  eventTag?: string
  featureSpotlight?: string
}

export interface PosterGenerationResult {
  ok: boolean
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
  caption: string
  image_prompt: string
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

const MODEL_FOR_POSTERS = MODEL_FAST

function todayPT(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

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

  const { data, error } = await supabaseAdmin
    .from('marketing_themes')
    .select('id, effective_month, theme_name, theme_summary, week_1_feature, week_2_feature, week_3_feature, week_4_feature')
    .eq('effective_month', monthStart)
    .maybeSingle()

  if (error) {
    console.error('[marketing/posters] theme fetch failed:', error.message)
  }

  const theme = (data as MarketingThemeRow | null) ?? null
  const weekIndex = Math.min(4, Math.ceil(d.getUTCDate() / 7)) as 1 | 2 | 3 | 4
  const weekFocus = theme
    ? [theme.week_1_feature, theme.week_2_feature, theme.week_3_feature, theme.week_4_feature][weekIndex - 1]!
    : ''

  return { theme, weekFocus, weekIndex, fetchError: error?.message ?? null }
}

/**
 * The Phase 3 prompt. Critical: image_prompt is described as
 * natural-language scene description (NOT section headers like
 * "Role:/Task:") because Nano Banana tends to render literal
 * label text onto the poster. Recent-headlines injection is scoped
 * to the COPY rather than the image to avoid the model echoing
 * them into rendered text.
 */
function buildPosterPrompt(args: {
  theme: MarketingThemeRow | null
  weekFocus: string
  weekIndex: 1 | 2 | 3 | 4
  audience: PosterAudience
  format: PosterFormat
  angle: PosterAngle
  recentHeadlines: string[]
  founderNote: string
  eventTag: string
  featureSpotlight: string
}): string {
  const fmt = FORMAT_SPECS[args.format] ?? FORMAT_SPECS.ig_story!

  const audLine =
    args.audience === 'rider'
      ? 'Speak TO RIDERS specifically (trust + cost split + .edu framing).'
      : args.audience === 'driver'
        ? 'Speak TO DRIVERS specifically (gas reimbursement on a trip they were already making — NEVER "earn", "make", "pocket"; if mentioning the 100%, phrase as "right now, drivers keep 100% of the fare").'
        : 'Write copy that lands for BOTH riders AND drivers in the same post. Headline and body MUST each contain language that works for either role reading it.'

  const themeBlock = args.theme
    ? `Current monthly theme: "${args.theme.theme_name}"\n  ${args.theme.theme_summary}\n\nThis week (week ${args.weekIndex}) focuses on: ${args.weekFocus}`
    : 'No monthly theme set; use the angle below as your only anchor.'

  const founderBlock = [
    args.founderNote.trim() ? `Note: ${args.founderNote.trim()}` : '',
    args.eventTag.trim() ? `Event/occasion: ${args.eventTag.trim()}` : '',
    args.featureSpotlight.trim() ? `Feature to spotlight: ${args.featureSpotlight.trim()}` : '',
  ].filter(Boolean).join('\n')

  // Recent-headlines injection is scoped to a single instruction so
  // the LLM avoids them WITHOUT echoing them into the rendered
  // image_prompt (where they could leak onto the poster as text).
  const recentBlock = args.recentHeadlines.length > 0
    ? `IMPORTANT — variety guard: the last ${args.recentHeadlines.length} posters used these headlines. Pick a fundamentally different phrasing AND angle. Do NOT echo them anywhere in your output (especially not inside image_prompt):\n${args.recentHeadlines.map((h, i) => `  ${i + 1}. "${h}"`).join('\n')}`
    : ''

  // Image-prompt instructions — natural-language scene description,
  // not section-header scaffolding. Nano Banana renders headers as
  // literal text on the image; flowing prose works far better.
  const imagePromptInstructions = `
The "image_prompt" field is what we (or the founder, copy-pasted
into Gemini/ChatGPT/Midjourney) will use to actually GENERATE the
poster image. Write it as ONE flowing natural-language scene
description — NO section headers, NO bullet lists, NO "Role:" /
"Task:" / "Visual Style:" labels (those render as literal text on
the poster, which we never want).

What the image must depict:
- A ${fmt.human_label}-shaped poster (${fmt.aspect_ratio},
  ${fmt.pixel_dims}) for the TAGO carpool brand.
- Minimalist, premium, sparse — never crowded or scammy-looking.
- Brand colors: primary blue #00A8F3 and accent green #10B981 on a
  light surface (#F8FAFC or pure white).
- A clean, abstract geometric background OR a single illustrated
  graphic element evoking the angle (e.g. a stylized highway, two
  speech bubbles, a campus silhouette). NEVER attempt to render an
  actual map of Davis CA — image models render maps as illegible
  squiggles. Subtle dot-grid, light gradient, or single iconic
  graphic only.
- The transparent "T" TAGO logo prominently placed
  (top center for stories/posts, top left for A4).
- The actual headline you wrote in clean modern sans-serif, large.
- The CTA "REGISTER AT: tagorides.com" near the bottom.
- The tagline "Tag Along. Go Smarter." in small text at the
  very bottom.
- ${fmt.composition_rules}

Constraints to bake into the image_prompt itself (since the founder
or downstream model needs them):
- Do NOT include the word "Driver" — use "share a ride" or "split
  the trip" or "trip you were already making" instead.
- Do NOT mention "earn money", "make money", "side hustle", or
  "time costs". Focus is purely on covering gas.
- Do NOT generate stock-photo carpool imagery or Uber-style mockups.
- Keep on-image text to: headline, optional subheadline, CTA, tagline.
  No other text.

Write the image_prompt as 150-300 words of clean prose.`.trim()

  return `
Generate ONE Instagram poster spec for Tago in the founder's voice.

${themeBlock}

ANGLE for THIS generation:
  ${args.angle.title}
  ${args.angle.prompt_seed}

${audLine}

Output FORMAT: ${fmt.human_label} (${fmt.aspect_ratio}, ${fmt.pixel_dims})

${founderBlock ? `Founder context (overrides the angle's default lean if conflicting):\n${founderBlock}\n` : ''}

${recentBlock}

Output a JSON object (no markdown fences) with EXACTLY these 7 fields:
{
  "headline":       "...", // 6-10 words. Hero text on the image.
  "subheadline":    "...", // 5-12 words. Supporting line.
  "body":           "...", // 2-3 sentences. Actual post body copy.
  "hashtags":       "...", // 8-12 space-separated. #ucdavis #aggielife #carpool #davisca #studentlife etc.
  "caption":        "...", // Instagram FEED CAPTION (separate from on-image text). 2-4 sentences + line break + 8-12 hashtags. Empty string "" for ig_story.
  "image_prompt":   "...", // 150-300 words natural-language scene description (see instructions below).
  "canva_template": "..."  // One of: safety, driver-upside, smart-matching, frictionless.
}

${imagePromptInstructions}

ALL 7 fields REQUIRED. Empty string ONLY acceptable for "caption"
when format is ig_story. Every other field must be non-empty.
`.trim()
}

function parsePosterCopy(text: string, isStory: boolean): { copy: PosterCopy | null; reason: string | null } {
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
  const caption = (typeof obj.caption === 'string' ? obj.caption : '').trim()
  const image_prompt = (typeof obj.image_prompt === 'string' ? obj.image_prompt : '').trim()
  const canva_template = ((typeof obj.canva_template === 'string' ? obj.canva_template : '').trim()) || 'safety'

  const missing: string[] = []
  if (headline.length < 3) missing.push('headline')
  if (body.length < 10) missing.push('body')
  if (subheadline.length < 3) missing.push('subheadline')
  if (hashtags.length < 3) missing.push('hashtags')
  if (image_prompt.length < 100) missing.push('image_prompt (too short, expected 150-300 words)')
  if (!isStory && caption.length < 10) missing.push('caption')
  if (missing.length > 0) {
    return { copy: null, reason: `missing/empty fields: ${missing.join(', ')}` }
  }

  return {
    copy: { headline, subheadline, body, hashtags, caption, image_prompt, canva_template },
    reason: null,
  }
}

export async function generatePosterBatch(args: GenerateArgs): Promise<PosterGenerationResult> {
  if (!isGeminiConfigured()) {
    return { ok: false, batch_id: '', item_count: 0, skipped_existing: false, reason: 'GEMINI_API_KEY not configured' }
  }

  const forDate = args.forDate ?? todayPT()
  const audience: PosterAudience = args.audience ?? 'both'
  const format: PosterFormat = args.format ?? 'ig_story'
  const founderNote = (args.founderNote ?? '').trim()
  const eventTag = (args.eventTag ?? '').trim()
  const featureSpotlight = (args.featureSpotlight ?? '').trim()

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
        ok: true,
        batch_id: (existing as { id: string }).id,
        item_count: (existing as { item_count: number }).item_count,
        skipped_existing: true,
      }
    }
  }

  const { theme, weekFocus, weekIndex, fetchError: themeErr } = await fetchCurrentThemeAndFocus(forDate)
  const angle = pickAngle({ forDate, audience, format })
  const recentHeadlines = await fetchRecentPosterHeadlines(5)

  const { data: batch, error: batchErr } = await supabaseAdmin
    .from('marketing_poster_batches')
    .insert({
      for_date: forDate,
      source: args.source,
      theme_id: theme?.id ?? null,
      theme_snapshot: theme?.theme_name ?? null,
      weekly_focus_snapshot: weekFocus || null,
      llm_model: MODEL_FOR_POSTERS,
      item_count: 0,
      status: 'pending',
    } as never)
    .select('id')
    .single()
  if (batchErr || !batch) {
    console.error('[marketing/posters] batch insert failed:', batchErr?.message)
    return { ok: false, batch_id: '', item_count: 0, skipped_existing: false, reason: batchErr?.message ?? 'batch insert failed' }
  }
  const batchId = (batch as { id: string }).id

  let inserted = 0
  const errors: string[] = []
  if (themeErr) errors.push(`theme lookup failed: ${themeErr}`)

  try {
    const result = await geminiGenerate({
      systemPrompt: BRAND_SYSTEM_PROMPT,
      userPrompt: buildPosterPrompt({
        theme, weekFocus, weekIndex, audience, format, angle,
        recentHeadlines, founderNote, eventTag, featureSpotlight,
      }),
      temperature: 0.9,
      maxOutputTokens: 4096,
      responseMimeType: 'application/json',
      thinkingBudget: 0,
    })
    const { copy, reason: parseReason } = parsePosterCopy(result.text, format === 'ig_story')
    if (!copy) {
      const preview = result.text ? result.text.slice(0, 200) : '(empty response)'
      const msg = `audience=${audience} format=${format}: ${parseReason ?? 'unparseable'} → ${preview}`
      console.warn(`[marketing/posters] ${msg}`)
      errors.push(msg)
    } else {
      const { error: itemErr } = await supabaseAdmin
        .from('marketing_poster_items')
        .insert({
          batch_id: batchId,
          audience,
          format,
          canva_template: copy.canva_template,
          headline: copy.headline,
          subheadline: copy.subheadline,
          body: copy.body,
          hashtags: copy.hashtags,
          caption: copy.caption,
          image_prompt: copy.image_prompt,
          theme_angle: angle.key,
          founder_note: founderNote || null,
          event_tag: eventTag || null,
          feature_spotlight: featureSpotlight || null,
          status: 'pending',
        } as never)
      if (itemErr) {
        const msg = `audience=${audience} format=${format}: item insert failed → ${itemErr.message}`
        console.error(`[marketing/posters] ${msg}`)
        errors.push(msg)
      } else {
        inserted += 1
      }
    }
  } catch (err) {
    const msg = `audience=${audience} format=${format}: Gemini call threw → ${err instanceof Error ? err.message : String(err)}`
    console.error(`[marketing/posters] ${msg}`)
    errors.push(msg)
  }

  const aggregatedError = errors.length > 0
    ? (errors.join(' | ').length > 800 ? `${errors.join(' | ').slice(0, 797)}...` : errors.join(' | '))
    : null

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
    ok: inserted > 0,
    batch_id: batchId,
    item_count: inserted,
    skipped_existing: false,
    ...(errors.length > 0 ? { reason: `${inserted} ok, ${errors.length} failed` } : {}),
  }
}

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

  const result = await generatePosterBatch({
    source: 'cron',
    forDate: todayPT(),
    audience: 'both',
    format: 'ig_story',
  })
  if (result.skipped_existing) return { generated: false, reason: 'already_ran_today' }
  return {
    generated: result.item_count > 0,
    reason: result.reason ?? `generated_${result.item_count}_items`,
  }
}
