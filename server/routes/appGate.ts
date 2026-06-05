/**
 * `GET /api/app/gate` — V4 F5 System A. Public (no JWT) so it works on
 * the auth screens + before login. The client sends its `platform` +
 * `version`; the server returns whether the app must update, is in
 * maintenance, or can proceed.
 *
 * FAILS OPEN: any error (missing config row, DB hiccup) returns
 * `{ status: 'ok' }` so a gate problem can never lock users out.
 *
 * Admin bypass is intentionally NOT implemented yet — to TEST a block
 * you flip the flag and verify it blocks. Production "admin can use the
 * app during maintenance" is a later add (would read an optional JWT).
 */
import { Router, type Request, type Response } from 'express'
import { supabaseAdmin } from '../lib/supabaseAdmin.ts'

export const appGateRouter = Router()

interface AppGateRow {
  min_required_version_ios: string | null
  recommended_version_ios: string | null
  maintenance_ios: boolean
  maintenance_web: boolean
  maintenance_title: string
  maintenance_message: string
  maintenance_eta: string | null
  update_title: string
  update_message: string
  recommended_update_message: string
  ios_store_url: string
}

/** Numeric dotted-version compare: -1 (a<b) / 0 / 1 (a>b). */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x < y) return -1
    if (x > y) return 1
  }
  return 0
}

appGateRouter.get('/gate', async (req: Request, res: Response) => {
  try {
    const platform = String(req.query['platform'] ?? '').toLowerCase()
    const version = String(req.query['version'] ?? '').trim()

    const { data } = await supabaseAdmin
      .from('app_gate_config')
      .select('*')
      .eq('id', 'global')
      .maybeSingle()

    // Fail open if the config row isn't there.
    if (!data) {
      res.status(200).json({ status: 'ok' })
      return
    }
    const cfg = data as unknown as AppGateRow

    // 1) Maintenance (per platform) — highest priority, blocking.
    const inMaintenance = platform === 'web' ? cfg.maintenance_web : cfg.maintenance_ios
    if (inMaintenance) {
      res.status(200).json({
        status: 'maintenance',
        title: cfg.maintenance_title,
        message: cfg.maintenance_message,
        eta: cfg.maintenance_eta,
      })
      return
    }

    // 2) Version gates (iOS only — web auto-updates via Vercel).
    if (platform === 'ios' && version !== '') {
      if (
        cfg.min_required_version_ios
        && compareVersions(version, cfg.min_required_version_ios) < 0
      ) {
        res.status(200).json({
          status: 'force_update',
          mode: 'required',
          title: cfg.update_title,
          message: cfg.update_message,
          store_url: cfg.ios_store_url,
        })
        return
      }
      if (
        cfg.recommended_version_ios
        && compareVersions(version, cfg.recommended_version_ios) < 0
      ) {
        // Soft, dismissible nudge — app still works.
        res.status(200).json({
          status: 'ok',
          soft_update: {
            message: cfg.recommended_update_message,
            store_url: cfg.ios_store_url,
          },
        })
        return
      }
    }

    res.status(200).json({ status: 'ok' })
  } catch (err) {
    // FAIL OPEN — never block the app on a gate error.
    console.warn('[app/gate] failing open after error:', err)
    res.status(200).json({ status: 'ok' })
  }
})
