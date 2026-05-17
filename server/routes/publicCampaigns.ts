/**
 * `/api/campaigns/*` — public read of marketing campaigns.
 *
 * Mounted OUTSIDE the admin router (no JWT / no admin gate) because
 * the `/c/:slug` marketing page should be shareable. The endpoint
 * only exposes title / body / poster_url / sent_at — the audience
 * filter + counts + sender stay admin-only via the admin router.
 *
 * Public read is enforced both server-side (this file) and via the
 * RLS policy on `public.campaigns` (migration 077).
 */
import { Router, type Request, type Response, type NextFunction } from 'express'
import { supabaseAdmin } from '../lib/supabaseAdmin.ts'

export const publicCampaignsRouter = Router()

// Slug pattern matches the 10-char base36 generator in
// server/routes/admin/campaigns.ts. Reject anything else outright
// so the endpoint isn't a probe surface.
const SLUG_RE = /^[0-9a-z]{6,20}$/

publicCampaignsRouter.get(
  '/:slug',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const slug = typeof req.params['slug'] === 'string' ? req.params['slug'] : ''
      if (!slug || !SLUG_RE.test(slug)) {
        res.status(400).json({
          error: { code: 'INVALID_SLUG', message: 'Slug must be 6-20 lowercase alphanumeric chars.' },
        })
        return
      }

      const { data, error } = await supabaseAdmin
        .from('campaigns')
        .select('slug, title, body, poster_url, sent_at, recalled_at')
        .eq('slug', slug)
        .maybeSingle()
      if (error) throw error
      if (!data) {
        res.status(404).json({
          error: { code: 'CAMPAIGN_NOT_FOUND', message: 'No campaign with that slug.' },
        })
        return
      }
      // Slice 1.4d — recalled campaigns disappear from the public
      // surface too. Notifications-tab + push deep-links land on the
      // "expired or never sent" empty state.
      if (data.recalled_at !== null) {
        res.status(404).json({
          error: { code: 'CAMPAIGN_RECALLED', message: 'This message was recalled by an admin.' },
        })
        return
      }

      // Strip recalled_at from the response payload — the public
      // surface shouldn't leak whether a campaign was ever recalled.
      const { recalled_at: _recalled, ...publicFields } = data
      void _recalled
      res.status(200).json({ ok: true, campaign: publicFields })
    } catch (err) {
      next(err)
    }
  },
)
