/**
 * `/api/admin/marketing/*` — Phase 0 scaffold.
 *
 * In Phase 0 this owns:
 *   - GET  /config      → returns { gemini_configured: boolean } so the
 *                         admin UI can show a "set GEMINI_API_KEY"
 *                         banner without leaking the actual key value.
 *   - GET  /themes/current → returns the marketing_theme effective for
 *                         today (or null if none seeded for this month).
 *
 * Story / poster / advisor endpoints land in Phase 1+ via the same
 * router, keeping all marketing endpoints under one mount.
 *
 * Auth gate inherited from the parent adminRouter (validateJwt +
 * adminAuth).
 */
import { Router, type Request, type Response, type NextFunction } from 'express'
import { supabaseAdmin } from '../../lib/supabaseAdmin.ts'
import { isGeminiConfigured } from '../../lib/marketing/gemini.ts'
import { generateStoryBatch } from '../../lib/marketing/storyGenerator.ts'
import { generatePosterBatch } from '../../lib/marketing/posterGenerator.ts'
import { generatePosterImage } from '../../lib/marketing/posterImageGenerator.ts'

export const adminMarketingRouter = Router()

adminMarketingRouter.get(
  '/config',
  (_req: Request, res: Response) => {
    res.status(200).json({
      ok: true,
      gemini_configured: isGeminiConfigured(),
    })
  },
)

adminMarketingRouter.get(
  '/themes/current',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      // First-of-this-month in UTC. Themes are stored against the
      // first day of the month they apply to.
      const now = new Date()
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
        .toISOString()
        .slice(0, 10)

      const { data, error } = await supabaseAdmin
        .from('marketing_themes')
        .select('id, effective_month, theme_name, theme_summary, week_1_feature, week_2_feature, week_3_feature, week_4_feature')
        .eq('effective_month', monthStart)
        .maybeSingle()

      if (error) throw error
      res.status(200).json({ ok: true, theme: data ?? null })
    } catch (err) {
      next(err)
    }
  },
)

// ── Stories (Phase 1) ──────────────────────────────────────────────

/**
 * GET /api/admin/marketing/stories
 * List recent batches (last 14 days) with embedded items so the
 * Stories page can render the queue in a single round-trip.
 */
adminMarketingRouter.get(
  '/stories',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const since = new Date()
      since.setUTCDate(since.getUTCDate() - 14)
      const sinceStr = since.toISOString().slice(0, 10)

      const { data: batches, error: batchErr } = await supabaseAdmin
        .from('marketing_story_batches')
        .select('id, for_date, source, llm_model, item_count, status, error, generated_at')
        .gte('for_date', sinceStr)
        .order('for_date', { ascending: false })
        .order('generated_at', { ascending: false })
        .limit(30)
      if (batchErr) throw batchErr

      const ids = (batches ?? []).map((b) => (b as { id: string }).id)
      if (ids.length === 0) {
        res.status(200).json({ ok: true, batches: [] })
        return
      }

      const { data: items, error: itemsErr } = await supabaseAdmin
        .from('marketing_story_items')
        .select('id, batch_id, corridor, asking_for, headline, body, date_label, matched_ride_count, status, acted_at, created_at, source_rides')
        .in('batch_id', ids)
        .order('created_at', { ascending: true })
      if (itemsErr) throw itemsErr

      // Bucket items back under their batch.
      const itemsByBatch = new Map<string, unknown[]>()
      for (const i of items ?? []) {
        const bid = (i as { batch_id: string }).batch_id
        const arr = itemsByBatch.get(bid) ?? []
        arr.push(i)
        itemsByBatch.set(bid, arr)
      }
      const enriched = (batches ?? []).map((b) => ({
        ...(b as Record<string, unknown>),
        items: itemsByBatch.get((b as { id: string }).id) ?? [],
      }))
      res.status(200).json({ ok: true, batches: enriched })
    } catch (err) {
      next(err)
    }
  },
)

/**
 * POST /api/admin/marketing/stories/generate
 * Manual "Generate now" button. Always source='manual'. Optional
 * body `{ asking_for: 'driver' | 'rider' | 'both' }` narrows the
 * generation to one audience; defaults to 'both' (cron behavior).
 * Manual batches can stack within a day — different askingFor
 * values produce different stories the admin may want side-by-side.
 */
adminMarketingRouter.post(
  '/stories/generate',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const raw = (req.body ?? {}) as { asking_for?: unknown }
      const ALLOWED = ['driver', 'rider', 'both'] as const
      const askingFor = (ALLOWED as readonly string[]).includes(raw.asking_for as string)
        ? (raw.asking_for as 'driver' | 'rider' | 'both')
        : 'both'
      const result = await generateStoryBatch({ source: 'manual', askingFor })
      res.status(200).json({ ok: true, ...result })
    } catch (err) {
      next(err)
    }
  },
)

/**
 * GET /api/admin/marketing/stories/rides
 * Per-ride story picker — returns upcoming ride_schedules in the
 * next `days` window (default 7), segregated rider vs driver and
 * sorted ascending by trip_date. Used by the "Browse rides for
 * story ideas" section on StoriesPage.
 */
adminMarketingRouter.get(
  '/stories/rides',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { listRidesForStories } = await import('../../lib/marketing/storyFromRide.ts')
      const daysRaw = typeof req.query['days'] === 'string' ? parseInt(req.query['days'], 10) : 7
      const days = Number.isFinite(daysRaw) && daysRaw >= 1 ? Math.min(30, daysRaw) : 7
      const audRaw = typeof req.query['audience'] === 'string' ? req.query['audience'] : 'both'
      const audience: 'rider' | 'driver' | 'both' =
        audRaw === 'rider' || audRaw === 'driver' ? audRaw : 'both'
      const result = await listRidesForStories({ daysAhead: days, audience })
      res.status(200).json({ ok: true, ...result })
    } catch (err) {
      next(err)
    }
  },
)

/**
 * POST /api/admin/marketing/stories/from-ride/:rideId
 * Per-ride story-idea generator — calls Gemini Flash with the
 * specific ride's context (route, name, date, seats, note) and
 * returns 3 distinct story angles. Ephemeral — does NOT persist
 * to marketing_story_items; the founder copies what they want.
 */
adminMarketingRouter.post(
  '/stories/from-ride/:rideId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rawRideId = req.params['rideId']
      const rideId = typeof rawRideId === 'string' ? rawRideId : ''
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rideId)) {
        res.status(400).json({ error: { code: 'INVALID_RIDE_ID', message: 'rideId must be a UUID' } })
        return
      }
      const { generateStoriesFromRide } = await import('../../lib/marketing/storyFromRide.ts')
      const result = await generateStoriesFromRide(rideId)
      if (!result.ok) {
        res.status(500).json({
          error: { code: 'STORY_GEN_FAILED', message: result.reason ?? 'generation failed' },
          ride: result.ride,
        })
        return
      }
      res.status(200).json({
        ok: true,
        ideas: result.ideas,
        ride: result.ride,
        model_used: result.model_used,
      })
    } catch (err) {
      next(err)
    }
  },
)

/**
 * PATCH /api/admin/marketing/stories/items/:itemId
 * Update an item's lifecycle status. Body: { status: 'pending' |
 * 'copied' | 'posted' | 'skipped' }. Stamps acted_at on first non-
 * pending transition.
 */
adminMarketingRouter.patch(
  '/stories/items/:itemId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { itemId } = req.params
      const { status } = (req.body ?? {}) as { status?: string }
      const VALID = ['pending', 'copied', 'posted', 'skipped'] as const
      if (!status || !(VALID as readonly string[]).includes(status)) {
        res.status(400).json({
          error: { code: 'INVALID_STATUS', message: `status must be one of: ${VALID.join(', ')}` },
        })
        return
      }
      const update: Record<string, unknown> = { status }
      if (status !== 'pending') update['acted_at'] = new Date().toISOString()
      const { error } = await supabaseAdmin
        .from('marketing_story_items')
        .update(update as never)
        .eq('id', itemId)
      if (error) throw error
      res.status(200).json({ ok: true })
    } catch (err) {
      next(err)
    }
  },
)

// ── Posters (Phase 2) ──────────────────────────────────────────────

/**
 * GET /api/admin/marketing/posters
 * List recent poster batches (last 30 days) with embedded items in
 * one round-trip. Same shape as the stories endpoint.
 */
adminMarketingRouter.get(
  '/posters',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const since = new Date()
      since.setUTCDate(since.getUTCDate() - 30)
      const sinceStr = since.toISOString().slice(0, 10)

      const { data: batches, error: batchErr } = await supabaseAdmin
        .from('marketing_poster_batches')
        .select('id, for_date, source, llm_model, item_count, status, error, generated_at, theme_snapshot, weekly_focus_snapshot')
        .gte('for_date', sinceStr)
        .order('for_date', { ascending: false })
        .order('generated_at', { ascending: false })
        .limit(60)
      if (batchErr) throw batchErr

      const ids = (batches ?? []).map((b) => (b as { id: string }).id)
      if (ids.length === 0) {
        res.status(200).json({ ok: true, batches: [] })
        return
      }

      const { data: items, error: itemsErr } = await supabaseAdmin
        .from('marketing_poster_items')
        .select('id, batch_id, audience, format, canva_template, headline, subheadline, body, hashtags, caption, image_prompt, image_url, image_generated_at, image_model, founder_note, event_tag, feature_spotlight, theme_angle, status, acted_at, created_at')
        .in('batch_id', ids)
        .order('created_at', { ascending: true })
      if (itemsErr) throw itemsErr

      const itemsByBatch = new Map<string, unknown[]>()
      for (const i of items ?? []) {
        const bid = (i as { batch_id: string }).batch_id
        const arr = itemsByBatch.get(bid) ?? []
        arr.push(i)
        itemsByBatch.set(bid, arr)
      }
      const enriched = (batches ?? []).map((b) => ({
        ...(b as Record<string, unknown>),
        items: itemsByBatch.get((b as { id: string }).id) ?? [],
      }))
      res.status(200).json({ ok: true, batches: enriched })
    } catch (err) {
      next(err)
    }
  },
)

/**
 * POST /api/admin/marketing/posters/generate
 * Phase 3 — accepts { audience, format, founder_note, event_tag,
 * feature_spotlight } (all optional). Returns 500 + ok:false when
 * the batch produced 0 items so the UI can distinguish failure
 * from success.
 */
adminMarketingRouter.post(
  '/posters/generate',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const raw = (req.body ?? {}) as {
        audience?: unknown
        format?: unknown
        founder_note?: unknown
        event_tag?: unknown
        feature_spotlight?: unknown
      }
      const AUD = ['rider', 'driver', 'both'] as const
      const FMT = ['ig_story', 'ig_post', 'a4_sheet', 'custom'] as const
      const audience = (AUD as readonly string[]).includes(raw.audience as string)
        ? (raw.audience as 'rider' | 'driver' | 'both')
        : 'both'
      const format = (FMT as readonly string[]).includes(raw.format as string)
        ? (raw.format as 'ig_story' | 'ig_post' | 'a4_sheet' | 'custom')
        : 'ig_story'
      const clip = (v: unknown): string =>
        typeof v === 'string' ? v.slice(0, 500) : ''
      const result = await generatePosterBatch({
        source: 'manual',
        audience,
        format,
        founderNote: clip(raw.founder_note),
        eventTag: clip(raw.event_tag),
        featureSpotlight: clip(raw.feature_spotlight),
      })
      // Surface failure via HTTP status so the UI can distinguish a
      // failed batch (0 items) from a successful one.
      if (!result.ok) {
        res.status(500).json({
          error: {
            code: 'POSTER_GEN_FAILED',
            message: result.reason ?? 'poster generation failed',
          },
          batch_id: result.batch_id,
          skipped_existing: result.skipped_existing,
        })
        return
      }
      // `result` already contains an `ok` field from generatePosterBatch;
      // spreading it after `ok: true` would trigger TS2783 (duplicate
      // key). Just spread — `ok: true` is what `result.ok` resolves to
      // on this success branch anyway.
      res.status(200).json(result)
    } catch (err) {
      next(err)
    }
  },
)

/**
 * POST /api/admin/marketing/posters/items/:itemId/generate-image
 * Phase 3 — calls gemini-2.5-flash-image with the item's stored
 * image_prompt + uploads to Supabase Storage. Returns the public
 * URL. Re-callable to regenerate.
 */
adminMarketingRouter.post(
  '/posters/items/:itemId/generate-image',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // req.params[k] is typed as string | string[] because Express
      // supports catch-all params; narrow to string per the
      // codebase pattern (see server/routes/admin/rides.ts).
      const rawItemId = req.params['itemId']
      const itemId = typeof rawItemId === 'string' ? rawItemId : ''
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(itemId)) {
        res.status(400).json({
          error: { code: 'INVALID_ITEM_ID', message: 'itemId must be a UUID' },
        })
        return
      }
      const result = await generatePosterImage(itemId)
      if (!result.ok) {
        res.status(500).json({
          error: { code: 'IMAGE_GEN_FAILED', message: result.error ?? 'image generation failed' },
        })
        return
      }
      res.status(200).json({ ok: true, image_url: result.image_url })
    } catch (err) {
      next(err)
    }
  },
)

/**
 * PATCH /api/admin/marketing/posters/items/:itemId
 * Update lifecycle status. Same status set as stories.
 */
adminMarketingRouter.patch(
  '/posters/items/:itemId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { itemId } = req.params
      const { status } = (req.body ?? {}) as { status?: string }
      const VALID = ['pending', 'copied', 'posted', 'skipped'] as const
      if (!status || !(VALID as readonly string[]).includes(status)) {
        res.status(400).json({
          error: { code: 'INVALID_STATUS', message: `status must be one of: ${VALID.join(', ')}` },
        })
        return
      }
      const update: Record<string, unknown> = { status }
      if (status !== 'pending') update['acted_at'] = new Date().toISOString()
      const { error } = await supabaseAdmin
        .from('marketing_poster_items')
        .update(update as never)
        .eq('id', itemId)
      if (error) throw error
      res.status(200).json({ ok: true })
    } catch (err) {
      next(err)
    }
  },
)

// ── Advisor (Phase 4) ──────────────────────────────────────────────

/**
 * Chat-based marketing advisor agent. Per-admin threads with
 * persisted history, brand context auto-loaded, KPIs injected on
 * the first message of each thread. RLS scopes threads + messages
 * to the calling admin.
 */
adminMarketingRouter.get(
  '/advisor/threads',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = res.locals['userId'] as string
      const { listThreads } = await import('../../lib/marketing/advisor.ts')
      const threads = await listThreads(userId)
      res.status(200).json({ ok: true, threads })
    } catch (err) {
      next(err)
    }
  },
)

adminMarketingRouter.post(
  '/advisor/threads',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = res.locals['userId'] as string
      const raw = (req.body ?? {}) as { title?: unknown }
      const title = typeof raw.title === 'string' ? raw.title.slice(0, 100) : undefined
      const { createThread } = await import('../../lib/marketing/advisor.ts')
      const thread = await createThread(userId, title)
      if (!thread) {
        res.status(500).json({ error: { code: 'CREATE_FAILED', message: 'thread create failed' } })
        return
      }
      res.status(200).json({ ok: true, thread })
    } catch (err) {
      next(err)
    }
  },
)

adminMarketingRouter.get(
  '/advisor/threads/:threadId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = res.locals['userId'] as string
      const rawThreadId = req.params['threadId']
      const threadId = typeof rawThreadId === 'string' ? rawThreadId : ''
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(threadId)) {
        res.status(400).json({ error: { code: 'INVALID_THREAD_ID', message: 'threadId must be a UUID' } })
        return
      }
      const { getThreadWithMessages } = await import('../../lib/marketing/advisor.ts')
      const result = await getThreadWithMessages(threadId, userId)
      if (!result) {
        res.status(404).json({ error: { code: 'THREAD_NOT_FOUND', message: 'thread not found' } })
        return
      }
      res.status(200).json({ ok: true, ...result })
    } catch (err) {
      next(err)
    }
  },
)

adminMarketingRouter.post(
  '/advisor/threads/:threadId/messages',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = res.locals['userId'] as string
      const rawThreadId = req.params['threadId']
      const threadId = typeof rawThreadId === 'string' ? rawThreadId : ''
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(threadId)) {
        res.status(400).json({ error: { code: 'INVALID_THREAD_ID', message: 'threadId must be a UUID' } })
        return
      }
      const raw = (req.body ?? {}) as { content?: unknown }
      const content = typeof raw.content === 'string' ? raw.content.slice(0, 4000) : ''
      if (content.trim().length < 1) {
        res.status(400).json({ error: { code: 'EMPTY_MESSAGE', message: 'content required' } })
        return
      }
      const { sendMessage } = await import('../../lib/marketing/advisor.ts')
      const result = await sendMessage({ threadId, userId, userContent: content })
      if (!result.ok) {
        res.status(500).json({ error: { code: 'SEND_FAILED', message: result.error ?? 'send failed' } })
        return
      }
      res.status(200).json({
        ok: true,
        assistant_message: result.assistant_message,
        model_used: result.model_used,
      })
    } catch (err) {
      next(err)
    }
  },
)

adminMarketingRouter.delete(
  '/advisor/threads/:threadId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = res.locals['userId'] as string
      const rawThreadId = req.params['threadId']
      const threadId = typeof rawThreadId === 'string' ? rawThreadId : ''
      // UUID validation (parity with the other advisor routes —
      // missing here was a low-severity finding from the Phase 4
      // review).
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(threadId)) {
        res.status(400).json({ error: { code: 'INVALID_THREAD_ID', message: 'threadId must be a UUID' } })
        return
      }
      const { deleteThread } = await import('../../lib/marketing/advisor.ts')
      const ok = await deleteThread(threadId, userId)
      if (!ok) {
        res.status(500).json({ error: { code: 'DELETE_FAILED', message: 'thread delete failed' } })
        return
      }
      res.status(200).json({ ok: true })
    } catch (err) {
      next(err)
    }
  },
)

// ── Daily focus brief (Feature 3) ─────────────────────────────────
//
// Process-local rate-limit for /regenerate. Founder is a single user
// + each regen costs ~$0.01, so a hard 60s cooldown is plenty to
// stop accidental rapid-clicks without being annoying. Keyed by
// userId so multiple admins in the future each get their own cap.
const lastRegenAt = new Map<string, number>()
const REGEN_COOLDOWN_MS = 60_000

/**
 * GET /api/admin/marketing/advisor/daily-focus
 * Returns today's brief (PT-anchored). If no row exists AND we're
 * after 7 AM PT, lazy-generates one — the founder shouldn't have to
 * wait until tomorrow if the cron sweep missed. Returns 204 if no
 * row exists AND it's before 7 AM PT (UI hides the banner).
 */
adminMarketingRouter.get(
  '/advisor/daily-focus',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        generateDailyBriefing,
      } = await import('../../lib/marketing/dailyFocusGenerator.ts')
      // PT-anchored "today"
      const today = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(new Date())
      const { data: existing } = await supabaseAdmin
        .from('marketing_daily_briefings').select('*')
        .eq('for_date', today).maybeSingle()
      const existingRow = existing as {
        focus?: string | null
        error?: string | null
        dismissed_at?: string | null
      } | null
      // Return cached only when the brief actually has a focus + no
      // error. Error rows fall through to regeneration so the founder
      // isn't locked out of the brief for the rest of the day.
      // Dismissed-but-successful rows still return cached so dismiss
      // remains sticky for the day.
      if (existingRow && existingRow.focus && !existingRow.error) {
        res.status(200).json({ ok: true, brief: existing })
        return
      }
      const ptHour = parseInt(new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles', hour: '2-digit', hour12: false,
      }).format(new Date()), 10)
      if (Number.isNaN(ptHour) || ptHour < 7) {
        res.status(204).end()
        return
      }
      // Lazy-generate. May take 5-15s on first request of the day.
      // Note: this blocks the GET — acceptable trade-off for v1
      // (founder is a single user, single request). When user volume
      // grows, switch to 202 + poll pattern (the brief table is the
      // shared queue).
      const r = await generateDailyBriefing(today)
      if (r.brief) {
        res.status(200).json({ ok: true, brief: r.brief })
        return
      }
      res.status(500).json({
        error: { code: 'BRIEF_GEN_FAILED', message: r.reason ?? 'generation failed' },
      })
    } catch (err) {
      next(err)
    }
  },
)

/**
 * POST /api/admin/marketing/advisor/daily-focus/start-thread
 * Spawns an advisor thread seeded with the brief's detail as the
 * opening assistant message. Idempotent — if a thread was already
 * spawned for today's brief, returns the existing thread_id.
 */
adminMarketingRouter.post(
  '/advisor/daily-focus/start-thread',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const rawUserId = res.locals['userId']
      const userId = typeof rawUserId === 'string' && rawUserId.length > 0 ? rawUserId : null
      if (!userId) {
        res.status(401).json({
          error: { code: 'NO_USER', message: 'No authenticated user on request.' },
        })
        return
      }
      const { startThreadFromBrief } = await import('../../lib/marketing/dailyFocusGenerator.ts')
      const today = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(new Date())
      const r = await startThreadFromBrief(today, userId)
      if (!r.ok) {
        res.status(500).json({
          error: { code: 'SPAWN_FAILED', message: r.reason ?? 'spawn failed' },
        })
        return
      }
      res.status(200).json({ ok: true, thread_id: r.thread_id })
    } catch (err) {
      next(err)
    }
  },
)

/**
 * POST /api/admin/marketing/advisor/daily-focus/dismiss
 * Sets today's brief.dismissed_at = now() so the banner hides for
 * the rest of the day.
 */
adminMarketingRouter.post(
  '/advisor/daily-focus/dismiss',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const today = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(new Date())
      const { count, error } = await supabaseAdmin
        .from('marketing_daily_briefings')
        .update({ dismissed_at: new Date().toISOString() } as never, { count: 'exact' })
        .eq('for_date', today)
      if (error) {
        res.status(500).json({ error: { code: 'DISMISS_FAILED', message: error.message } })
        return
      }
      // count===0 means no brief yet today — dismiss is still
      // semantically OK (nothing to hide); UI re-fetches + sees null.
      res.status(200).json({ ok: true, rows_updated: count ?? 0 })
    } catch (err) {
      next(err)
    }
  },
)

/**
 * POST /api/admin/marketing/advisor/daily-focus/regenerate
 * Deletes today's row + re-runs generateDailyBriefing. No rate-
 * limit yet (founder is a single user; cost is ~$0.01/regen).
 */
adminMarketingRouter.post(
  '/advisor/daily-focus/regenerate',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const rawUserId = res.locals['userId']
      const userId = typeof rawUserId === 'string' && rawUserId.length > 0 ? rawUserId : 'unknown'
      // 60s cooldown to prevent accidental rapid-clicks racking up
      // Gemini token cost (~$0.01/regen). Founder is a single user
      // so this is friction, not access control.
      const last = lastRegenAt.get(userId) ?? 0
      const elapsed = Date.now() - last
      if (elapsed < REGEN_COOLDOWN_MS) {
        const wait = Math.ceil((REGEN_COOLDOWN_MS - elapsed) / 1000)
        res.status(429).json({
          error: {
            code: 'REGEN_COOLDOWN',
            message: `Regenerate is rate-limited to once per minute. Try again in ${wait}s.`,
          },
        })
        return
      }
      lastRegenAt.set(userId, Date.now())
      const { generateDailyBriefing } = await import('../../lib/marketing/dailyFocusGenerator.ts')
      const today = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(new Date())
      await supabaseAdmin
        .from('marketing_daily_briefings').delete().eq('for_date', today)
      const r = await generateDailyBriefing(today)
      if (r.brief) {
        res.status(200).json({ ok: true, brief: r.brief })
        return
      }
      res.status(500).json({
        error: { code: 'BRIEF_GEN_FAILED', message: r.reason ?? 'regeneration failed' },
      })
    } catch (err) {
      next(err)
    }
  },
)

// ── Weekly Slack review (Feature 4) ───────────────────────────────

const lastReviewActionAt = new Map<string, number>()
const REVIEW_COOLDOWN_MS = 60_000

/**
 * GET /api/admin/marketing/weekly-review
 * Returns the most recent weekly review row + the last 4 weeks for
 * history sparkline. `current` is the row for last week (Monday →
 * Sunday). Returns ok with null current when no review has been
 * generated yet.
 */
adminMarketingRouter.get(
  '/weekly-review',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const { lastWeekMondayPt } = await import('../../lib/marketing/weeklyReviewGenerator.ts')
      const weekStart = lastWeekMondayPt()
      const { data: current } = await supabaseAdmin
        .from('marketing_weekly_reviews').select('*')
        .eq('for_week_starting', weekStart).maybeSingle()
      const { data: history } = await supabaseAdmin
        .from('marketing_weekly_reviews')
        .select('id, for_week_starting, generated_at, summary, slack_sent_at, slack_response_status, error')
        .order('for_week_starting', { ascending: false }).limit(8)
      res.status(200).json({
        ok: true,
        current: current ?? null,
        history: history ?? [],
        week_starting: weekStart,
      })
    } catch (err) {
      next(err)
    }
  },
)

/**
 * POST /api/admin/marketing/weekly-review/generate
 * Manual trigger — generates last week's review now (or returns the
 * cached row if it already exists with no error). 60s cooldown.
 */
adminMarketingRouter.post(
  '/weekly-review/generate',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const rawUserId = res.locals['userId']
      const userId = typeof rawUserId === 'string' && rawUserId.length > 0 ? rawUserId : 'unknown'
      const last = lastReviewActionAt.get(`gen:${userId}`) ?? 0
      const elapsed = Date.now() - last
      if (elapsed < REVIEW_COOLDOWN_MS) {
        const wait = Math.ceil((REVIEW_COOLDOWN_MS - elapsed) / 1000)
        res.status(429).json({
          error: {
            code: 'REVIEW_COOLDOWN',
            message: `Generate is rate-limited to once per minute. Try again in ${wait}s.`,
          },
        })
        return
      }
      lastReviewActionAt.set(`gen:${userId}`, Date.now())
      const { generateWeeklyReview, lastWeekMondayPt } = await import('../../lib/marketing/weeklyReviewGenerator.ts')
      const weekStart = lastWeekMondayPt()
      // Force regen by deleting first.
      await supabaseAdmin
        .from('marketing_weekly_reviews').delete().eq('for_week_starting', weekStart)
      const r = await generateWeeklyReview(weekStart)
      if (r.review) {
        res.status(200).json({ ok: true, review: r.review })
        return
      }
      res.status(500).json({
        error: { code: 'REVIEW_GEN_FAILED', message: r.reason ?? 'generation failed' },
      })
    } catch (err) {
      next(err)
    }
  },
)

/**
 * POST /api/admin/marketing/weekly-review/send
 * Manual Slack send for last week's review. Idempotent — re-send
 * is a no-op if already sent successfully. 60s cooldown.
 */
adminMarketingRouter.post(
  '/weekly-review/send',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const rawUserId = res.locals['userId']
      const userId = typeof rawUserId === 'string' && rawUserId.length > 0 ? rawUserId : 'unknown'
      const last = lastReviewActionAt.get(`send:${userId}`) ?? 0
      const elapsed = Date.now() - last
      if (elapsed < REVIEW_COOLDOWN_MS) {
        const wait = Math.ceil((REVIEW_COOLDOWN_MS - elapsed) / 1000)
        res.status(429).json({
          error: { code: 'SEND_COOLDOWN', message: `Try again in ${wait}s.` },
        })
        return
      }
      lastReviewActionAt.set(`send:${userId}`, Date.now())
      const { sendWeeklyReviewToSlack, lastWeekMondayPt } = await import('../../lib/marketing/weeklyReviewGenerator.ts')
      const r = await sendWeeklyReviewToSlack(lastWeekMondayPt())
      if (r.ok || r.review) {
        res.status(r.ok ? 200 : 500).json({
          ok: r.ok,
          status: r.status,
          body: r.body,
          review: r.review,
        })
        return
      }
      res.status(500).json({
        error: { code: 'SEND_FAILED', message: r.body || 'send failed' },
        status: r.status,
      })
    } catch (err) {
      next(err)
    }
  },
)

/**
 * POST /api/admin/marketing/weekly-review/test-webhook
 * Posts a tiny ping message to SLACK_MARKETING_WEBHOOK_URL so the
 * founder can verify the URL is wired without waiting until Monday.
 */
adminMarketingRouter.post(
  '/weekly-review/test-webhook',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const { getServerEnv } = await import('../../env.ts')
      const { postToSlackUrl } = await import('../../lib/slackWebhook.ts')
      const { SLACK_MARKETING_WEBHOOK_URL } = getServerEnv()
      if (!SLACK_MARKETING_WEBHOOK_URL) {
        res.status(400).json({
          error: {
            code: 'NO_WEBHOOK_URL',
            message: 'SLACK_MARKETING_WEBHOOK_URL is not set in the server env.',
          },
        })
        return
      }
      const r = await postToSlackUrl(SLACK_MARKETING_WEBHOOK_URL, {
        text: 'Tago marketing webhook test — ' + new Date().toISOString(),
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*Marketing webhook test* — if you can read this, the weekly recap will land here every Monday morning.',
            },
          },
        ],
      })
      res.status(r.status === 200 ? 200 : 500).json({
        ok: r.status === 200,
        status: r.status,
        body: r.body,
      })
    } catch (err) {
      next(err)
    }
  },
)

// ── Events / Smart Calendar (Phase 5) ──────────────────────────────

adminMarketingRouter.get(
  '/events',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const { listUpcomingEvents, getEventsNeedingReminder } = await import('../../lib/marketing/eventCalendar.ts')
      // daysAhead: 400 covers a full academic year + summer
      // commencement (longest seeded event chain ends 2027-06-12,
      // ~13 months out). Earlier value of 180 silently hid 15 of the
      // 23 seeded events because the window stopped at 2026-11-26.
      // includeRecentlyPast: 14 keeps recently-finished multi-day
      // events visible (e.g. Memorial Day weekend) so the founder can
      // still post a retrospective if they missed the lead-time.
      const [events, reminders] = await Promise.all([
        listUpcomingEvents({ daysAhead: 400, includeRecentlyPast: 14, limit: 200 }),
        getEventsNeedingReminder(),
      ])
      res.status(200).json({ ok: true, events, reminders })
    } catch (err) {
      next(err)
    }
  },
)

adminMarketingRouter.post(
  '/events/seed',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const { seedEvents } = await import('../../lib/marketing/eventCalendar.ts')
      const result = await seedEvents()
      res.status(200).json({ ok: true, ...result })
    } catch (err) {
      next(err)
    }
  },
)

adminMarketingRouter.post(
  '/events/refresh-ai',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const { refreshAiEventSuggestions } = await import('../../lib/marketing/eventCalendar.ts')
      const result = await refreshAiEventSuggestions()
      if (!result.ok) {
        res.status(500).json({
          error: { code: 'AI_REFRESH_FAILED', message: result.reason ?? 'AI refresh failed' },
        })
        return
      }
      // result already has ok: true on this branch.
      res.status(200).json(result)
    } catch (err) {
      next(err)
    }
  },
)

adminMarketingRouter.post(
  '/events',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const raw = (req.body ?? {}) as Record<string, unknown>
      const title = typeof raw['title'] === 'string' ? raw['title'].slice(0, 200) : ''
      const eventDate = typeof raw['event_date'] === 'string' ? raw['event_date'] : ''
      if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
        res.status(400).json({
          error: { code: 'INVALID_PAYLOAD', message: 'title + event_date (YYYY-MM-DD) required' },
        })
        return
      }
      const { addManualEvent } = await import('../../lib/marketing/eventCalendar.ts')
      const result = await addManualEvent({
        title,
        event_date: eventDate,
        end_date: typeof raw['end_date'] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw['end_date']) ? raw['end_date'] : undefined,
        category: typeof raw['category'] === 'string' ? (raw['category'] as never) : undefined,
        location_hint: typeof raw['location_hint'] === 'string' ? raw['location_hint'] : undefined,
        description: typeof raw['description'] === 'string' ? raw['description'] : undefined,
        target_audience: typeof raw['target_audience'] === 'string' ? (raw['target_audience'] as never) : undefined,
        target_lead_time_days: typeof raw['target_lead_time_days'] === 'number' ? raw['target_lead_time_days'] : undefined,
        notes: typeof raw['notes'] === 'string' ? raw['notes'] : undefined,
      })
      if (!result.ok) {
        res.status(500).json({ error: { code: 'CREATE_FAILED', message: result.error ?? 'create failed' } })
        return
      }
      res.status(200).json({ ok: true, event: result.event })
    } catch (err) {
      next(err)
    }
  },
)

adminMarketingRouter.patch(
  '/events/:eventId/dismiss',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rawEventId = req.params['eventId']
      const eventId = typeof rawEventId === 'string' ? rawEventId : ''
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId)) {
        res.status(400).json({ error: { code: 'INVALID_EVENT_ID', message: 'eventId must be a UUID' } })
        return
      }
      const { dismissReminder } = await import('../../lib/marketing/eventCalendar.ts')
      const result = await dismissReminder(eventId)
      if (!result.ok) {
        res.status(500).json({ error: { code: 'DISMISS_FAILED', message: result.error ?? 'dismiss failed' } })
        return
      }
      res.status(200).json({ ok: true })
    } catch (err) {
      next(err)
    }
  },
)

adminMarketingRouter.delete(
  '/events/:eventId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rawEventId = req.params['eventId']
      const eventId = typeof rawEventId === 'string' ? rawEventId : ''
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId)) {
        res.status(400).json({ error: { code: 'INVALID_EVENT_ID', message: 'eventId must be a UUID' } })
        return
      }
      const { deleteEvent } = await import('../../lib/marketing/eventCalendar.ts')
      const result = await deleteEvent(eventId)
      if (!result.ok) {
        res.status(500).json({ error: { code: 'DELETE_FAILED', message: result.error ?? 'delete failed' } })
        return
      }
      res.status(200).json({ ok: true })
    } catch (err) {
      next(err)
    }
  },
)
