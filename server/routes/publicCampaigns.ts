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
 *
 * 2026-06-04 — when the request carries an `Authorization: Bearer …`
 * header (the in-app notifications inbox does; anonymous shared
 * links do not), we resolve {{first_name}} / {{name}} against that
 * user's profile before returning. The stored `campaigns.title` is
 * the raw template (shared across N recipients with different
 * names), so substitution has to happen on read. Without this fix
 * the iOS notification detail sheet showed `Hi {{first_name}}` raw
 * even though the push banner and the notifications-row title
 * already rendered correctly per recipient.
 */
import { Router, type Request, type Response, type NextFunction } from 'express'
import { supabaseAdmin } from '../lib/supabaseAdmin.ts'
import { substitute, RECIPIENT_TOKENS } from '../lib/personalize.ts'

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
        .select('slug, title, body, poster_url, poster_link_url, sent_at, recalled_at')
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

      // Resolve personalization tokens before returning, if the
      // template has any. The campaigns row stores the raw template
      // because campaigns are one-row-per-broadcast and substitution
      // is per-recipient — so the substitution has to happen at read
      // time. We try the request's authenticated user first; falling
      // back to the helper's anonymous default ("there") if the
      // request has no JWT or the lookup fails.
      const title = typeof data.title === 'string' ? data.title : ''
      const body = typeof data.body === 'string' ? data.body : ''
      const hasTokens = RECIPIENT_TOKENS.some(
        (t) => title.includes(t) || body.includes(t),
      )
      let renderedTitle = title
      let renderedBody = body
      if (hasTokens) {
        let recipient: { email: string | null; full_name: string | null } = {
          email: null,
          full_name: null,
        }
        const authHeader = req.headers['authorization']
        if (authHeader?.startsWith('Bearer ')) {
          const token = authHeader.slice(7)
          const { data: authResult, error: authErr } =
            await supabaseAdmin.auth.getUser(token)
          if (!authErr && authResult.user?.id) {
            const { data: userRow } = await supabaseAdmin
              .from('users')
              .select('full_name, email')
              .eq('id', authResult.user.id)
              .maybeSingle()
            if (userRow) {
              recipient = {
                email: (userRow.email ?? null) as string | null,
                full_name: (userRow.full_name ?? null) as string | null,
              }
            }
          }
        }
        renderedTitle = substitute(title, recipient)
        renderedBody = substitute(body, recipient)
      }

      // Strip recalled_at from the response payload — the public
      // surface shouldn't leak whether a campaign was ever recalled.
      const { recalled_at: _recalled, ...publicFields } = data
      void _recalled
      res.status(200).json({
        ok: true,
        campaign: {
          ...publicFields,
          title: renderedTitle,
          body: renderedBody,
        },
      })
    } catch (err) {
      next(err)
    }
  },
)
