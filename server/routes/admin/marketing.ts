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
      res.status(200).json({ ok: true, ...result })
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
      const { itemId } = req.params
      // Minimal UUID format check — server-side defense for typos.
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(itemId ?? '')) {
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
      const { threadId } = req.params
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(threadId ?? '')) {
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
      const { threadId } = req.params
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(threadId ?? '')) {
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
      res.status(200).json({ ok: true, assistant_message: result.assistant_message })
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
      const { threadId } = req.params
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
