/**
 * /api/admin/email-templates — admin CRUD + test-send for lifecycle
 * email templates. The cron uses these the same way the founder
 * preview does so admin edits flow to live sends without a deploy.
 */
import { Router, type Request, type Response, type NextFunction } from 'express'
import {
  listTemplates,
  loadTemplate,
  updateTemplate,
  renderTemplate,
  sendTemplated,
  listRecentSends,
} from '../../lib/email/templates.ts'
import { FROM_ADDRESS_ALLOWLIST } from '../../lib/resend.ts'
import { supabaseAdmin } from '../../lib/supabaseAdmin.ts'

export const adminEmailTemplatesRouter = Router()

/**
 * GET /api/admin/email-templates
 * Lists every template. Used by the marketing-panel landing page.
 */
adminEmailTemplatesRouter.get(
  '/',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const templates = await listTemplates()
      res.status(200).json({
        ok: true,
        templates,
        from_address_allowlist: FROM_ADDRESS_ALLOWLIST,
      })
    } catch (err) {
      next(err)
    }
  },
)

/**
 * GET /api/admin/email-templates/:key
 * Single template + a rendered preview using stub vars so the
 * admin can see how the email looks before saving.
 */
adminEmailTemplatesRouter.get(
  '/:key',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rawKey = req.params['key']
      const key = typeof rawKey === 'string' ? rawKey : ''
      if (!key) {
        res.status(400).json({ error: { code: 'INVALID_KEY', message: 'template key required' } })
        return
      }
      const template = await loadTemplate(key)
      if (!template) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: `no template with key "${key}"` } })
        return
      }
      // Stub preview vars so the admin gets a realistic render.
      const stub = {
        first_name: 'Sam',
        email: 'sam.example@ucdavis.edu',
      }
      const preview = renderTemplate(template, stub)
      const recentSends = await listRecentSends({ templateKey: key, limit: 20 })
      res.status(200).json({
        ok: true,
        template,
        preview,
        recent_sends: recentSends,
        from_address_allowlist: FROM_ADDRESS_ALLOWLIST,
      })
    } catch (err) {
      next(err)
    }
  },
)

/**
 * PATCH /api/admin/email-templates/:key
 * Updates name / subject / body / from / reply_to / is_active.
 * Variables list is intentionally NOT writable through this route
 * — it's the security allowlist; changing it requires a migration.
 */
adminEmailTemplatesRouter.patch(
  '/:key',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rawKey = req.params['key']
      const key = typeof rawKey === 'string' ? rawKey : ''
      if (!key) {
        res.status(400).json({ error: { code: 'INVALID_KEY', message: 'template key required' } })
        return
      }
      const rawUserId = res.locals['userId']
      const updatedBy = typeof rawUserId === 'string' && rawUserId.length > 0 ? rawUserId : null
      const body = (req.body ?? {}) as Record<string, unknown>
      const patch: Parameters<typeof updateTemplate>[1] = {}
      if (typeof body['name'] === 'string') patch.name = (body['name'] as string).slice(0, 200)
      if (typeof body['subject'] === 'string') patch.subject = (body['subject'] as string).slice(0, 500)
      if (typeof body['body_markdown'] === 'string') patch.body_markdown = (body['body_markdown'] as string).slice(0, 20000)
      if (typeof body['from_email'] === 'string') patch.from_email = (body['from_email'] as string).slice(0, 200)
      if (typeof body['from_name'] === 'string') patch.from_name = (body['from_name'] as string).slice(0, 200)
      if (typeof body['reply_to'] === 'string') patch.reply_to = (body['reply_to'] as string).slice(0, 200) || null
      if (typeof body['is_active'] === 'boolean') patch.is_active = body['is_active'] as boolean
      if (typeof body['trigger_event'] === 'string') {
        // Adding a new trigger is a code change (the sweep
        // dispatcher) not a free-form admin field — reject the
        // request explicitly so the admin sees they made a typo
        // instead of silently keeping the stale server-side value
        // while the form indicates success.
        const ALLOWED_TRIGGERS = ['manual', 'onboarding_completed']
        const v = body['trigger_event'] as string
        if (!ALLOWED_TRIGGERS.includes(v)) {
          res.status(400).json({
            error: {
              code: 'INVALID_TRIGGER',
              message: `trigger_event must be one of: ${ALLOWED_TRIGGERS.join(', ')}. Got "${v}".`,
            },
          })
          return
        }
        patch.trigger_event = v
      }
      if (typeof body['delay_hours'] === 'number' && Number.isFinite(body['delay_hours'] as number)) {
        const h = body['delay_hours'] as number
        patch.delay_hours = Math.max(0, Math.min(24 * 30, Math.floor(h)))  // 0..30 days
      }
      const r = await updateTemplate(key, patch, updatedBy)
      if (!r.ok) {
        res.status(400).json({ error: { code: 'UPDATE_FAILED', message: r.reason ?? 'update failed' } })
        return
      }
      res.status(200).json({ ok: true, template: r.template })
    } catch (err) {
      next(err)
    }
  },
)

/**
 * POST /api/admin/email-templates/:key/test-send
 * Sends the template to the admin's own email. Marked is_test=true
 * on the ledger so it bypasses the unique-send guard AND doesn't
 * pollute production send-history stats. Vars default to safe stubs
 * unless the admin provided overrides in the body.
 */
adminEmailTemplatesRouter.post(
  '/:key/test-send',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rawKey = req.params['key']
      const key = typeof rawKey === 'string' ? rawKey : ''
      if (!key) {
        res.status(400).json({ error: { code: 'INVALID_KEY', message: 'template key required' } })
        return
      }
      const rawUserId = res.locals['userId']
      const adminUserId = typeof rawUserId === 'string' && rawUserId.length > 0 ? rawUserId : null
      if (!adminUserId) {
        res.status(401).json({ error: { code: 'NO_USER', message: 'admin user id missing' } })
        return
      }
      // Resolve the admin's email from the users row — never trust
      // a client-supplied "to" field.
      const { data: adminRow } = await supabaseAdmin
        .from('users').select('email, full_name').eq('id', adminUserId).maybeSingle()
      const admin = adminRow as { email: string | null; full_name: string | null } | null
      if (!admin?.email) {
        res.status(400).json({ error: { code: 'NO_ADMIN_EMAIL', message: 'admin user has no email on file' } })
        return
      }
      const body = (req.body ?? {}) as Record<string, unknown>
      const firstNameOverride = typeof body['first_name'] === 'string' ? (body['first_name'] as string).slice(0, 80) : null
      const vars = {
        first_name: firstNameOverride
          ?? (admin.full_name?.split(/\s+/)[0] ?? 'Sam'),
        email: admin.email,
      }
      const result = await sendTemplated({
        userId: adminUserId,
        templateKey: key,
        recipientEmail: admin.email,
        vars,
        isTest: true,
      })
      if (!result.ok) {
        res.status(500).json({
          error: { code: 'TEST_SEND_FAILED', message: result.error ?? result.reason ?? 'send failed' },
        })
        return
      }
      res.status(200).json({ ok: true, send: result.send, recipient: admin.email })
    } catch (err) {
      next(err)
    }
  },
)

/**
 * GET /api/admin/email-templates/:key/sends
 * Recent send history for the template. Defaults to 50.
 */
adminEmailTemplatesRouter.get(
  '/:key/sends',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rawKey = req.params['key']
      const key = typeof rawKey === 'string' ? rawKey : ''
      if (!key) {
        res.status(400).json({ error: { code: 'INVALID_KEY', message: 'template key required' } })
        return
      }
      const limitRaw = typeof req.query['limit'] === 'string' ? parseInt(req.query['limit'], 10) : 50
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(200, limitRaw) : 50
      const rows = await listRecentSends({ templateKey: key, limit })
      res.status(200).json({ ok: true, sends: rows })
    } catch (err) {
      next(err)
    }
  },
)
