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
        .select('id, batch_id, audience, canva_template, headline, subheadline, body, hashtags, status, acted_at, created_at')
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
 * Manual "Generate now" for posters. Optional body
 * `{ audience: 'rider' | 'driver' | 'both' }` narrows the target;
 * defaults 'both' (cron default).
 */
adminMarketingRouter.post(
  '/posters/generate',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const raw = (req.body ?? {}) as { audience?: unknown }
      const ALLOWED = ['rider', 'driver', 'both'] as const
      const audience = (ALLOWED as readonly string[]).includes(raw.audience as string)
        ? (raw.audience as 'rider' | 'driver' | 'both')
        : 'both'
      const result = await generatePosterBatch({ source: 'manual', audience })
      res.status(200).json({ ok: true, ...result })
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
