/**
 * V4 F1 — Companions CRUD endpoints. Mirrors `caregivers.ts`.
 *
 *   POST   /api/companions       — create
 *   GET    /api/companions       — list caller's companions (newest first)
 *   PATCH  /api/companions/:id   — update (ownership-checked)
 *   DELETE /api/companions/:id   — hard delete (ownership-checked)
 *
 * iOS uses `CompanionsRepository` (Supabase SDK direct) for the Add/Edit
 * sheets; these endpoints exist for parity + admin tooling. Hard-delete
 * model: removing a companion nulls `companion_a_id`/`companion_b_id` on
 * past rides + schedules via ON DELETE SET NULL (migration 119).
 */

import { Router } from 'express'
import type { Request, Response } from 'express'
import { supabaseAdmin } from '../lib/supabaseAdmin.ts'
import { validateJwt } from '../middleware/auth.ts'

export const companionsRouter = Router()

// ── POST /api/companions ────────────────────────────────────────────────────
companionsRouter.post('/', validateJwt, async (req: Request, res: Response) => {
  const userId = res.locals['userId'] as string
  if (!userId) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Not signed in' } })
    return
  }

  const body = (req.body ?? {}) as Record<string, unknown>
  const validation = validateCreatePayload(body)
  if ('error' in validation) {
    res.status(400).json({ error: validation.error })
    return
  }
  const row = { ...validation.payload, user_id: userId }

  try {
    const { data, error } = await supabaseAdmin
      .from('companions')
      .insert(row as never)
      .select()
      .single()

    if (error) {
      console.error(`[companions POST] ${error.message}`)
      res.status(500).json({ error: { code: 'DB_ERROR', message: 'Could not create companion' } })
      return
    }
    res.status(201).json(data)
  } catch (err) {
    console.error('[companions POST] unexpected error:', err)
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Companion create failed' } })
  }
})

// ── GET /api/companions ─────────────────────────────────────────────────────
companionsRouter.get('/', validateJwt, async (_req: Request, res: Response) => {
  const userId = res.locals['userId'] as string
  if (!userId) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Not signed in' } })
    return
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('companions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error(`[companions GET] ${error.message}`)
      res.status(500).json({ error: { code: 'DB_ERROR', message: 'Could not load companions' } })
      return
    }
    res.status(200).json({ companions: data ?? [] })
  } catch (err) {
    console.error('[companions GET] unexpected error:', err)
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Companion list failed' } })
  }
})

// ── PATCH /api/companions/:id ───────────────────────────────────────────────
companionsRouter.patch('/:id', validateJwt, async (req: Request, res: Response) => {
  const userId = res.locals['userId'] as string
  const companionIdRaw = req.params['id']
  const companionId = typeof companionIdRaw === 'string' ? companionIdRaw : ''
  if (!userId) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Not signed in' } })
    return
  }
  if (!companionId) {
    res.status(400).json({ error: { code: 'MISSING_ID', message: 'companion id required' } })
    return
  }

  const ownsIt = await assertOwnership(companionId, userId, res)
  if (!ownsIt) return

  const body = (req.body ?? {}) as Record<string, unknown>
  const validation = validateUpdatePayload(body)
  if ('error' in validation) {
    res.status(400).json({ error: validation.error })
    return
  }
  if (Object.keys(validation.payload).length === 0) {
    res.status(400).json({
      error: { code: 'INVALID_BODY', message: 'No valid fields in body' },
    })
    return
  }

  const patch = { ...validation.payload, updated_at: new Date().toISOString() }

  try {
    const { data, error } = await supabaseAdmin
      .from('companions')
      .update(patch as never)
      .eq('id', companionId)
      .select()
      .single()

    if (error) {
      console.error(`[companions PATCH] ${error.message}`)
      res.status(500).json({ error: { code: 'DB_ERROR', message: 'Could not save companion' } })
      return
    }
    res.status(200).json(data)
  } catch (err) {
    console.error('[companions PATCH] unexpected error:', err)
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Companion update failed' } })
  }
})

// ── DELETE /api/companions/:id ──────────────────────────────────────────────
// Hard delete. Rides + ride_schedules referencing this companion get NULL
// via ON DELETE SET NULL — historical records remain queryable.
companionsRouter.delete('/:id', validateJwt, async (req: Request, res: Response) => {
  const userId = res.locals['userId'] as string
  const companionIdRaw = req.params['id']
  const companionId = typeof companionIdRaw === 'string' ? companionIdRaw : ''
  if (!userId) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Not signed in' } })
    return
  }
  if (!companionId) {
    res.status(400).json({ error: { code: 'MISSING_ID', message: 'companion id required' } })
    return
  }

  const ownsIt = await assertOwnership(companionId, userId, res)
  if (!ownsIt) return

  try {
    const { error } = await supabaseAdmin
      .from('companions')
      .delete()
      .eq('id', companionId)

    if (error) {
      console.error(`[companions DELETE] ${error.message}`)
      res.status(500).json({ error: { code: 'DB_ERROR', message: 'Could not delete companion' } })
      return
    }
    res.status(204).end()
  } catch (err) {
    console.error('[companions DELETE] unexpected error:', err)
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Companion delete failed' } })
  }
})

// ── Helpers ─────────────────────────────────────────────────────────────────

interface InvalidBody { error: { code: string; message: string } }
interface ValidPayload { payload: Record<string, string | null> }

function validateCreatePayload(body: Record<string, unknown>): ValidPayload | InvalidBody {
  const nameRaw = body['name']
  if (typeof nameRaw !== 'string' || nameRaw.trim().length === 0 || nameRaw.length > 100) {
    return {
      error: { code: 'INVALID_BODY', message: 'name is required and must be 1-100 chars' },
    }
  }
  const out: Record<string, string | null> = { name: nameRaw.trim() }
  applyOptionalFields(body, out)
  const err = optionalFieldsError(body)
  return err ?? { payload: out }
}

function validateUpdatePayload(body: Record<string, unknown>): ValidPayload | InvalidBody {
  const out: Record<string, string | null> = {}
  if ('name' in body) {
    const v = body['name']
    if (typeof v !== 'string' || v.trim().length === 0 || v.length > 100) {
      return { error: { code: 'INVALID_BODY', message: 'name must be 1-100 chars' } }
    }
    out['name'] = v.trim()
  }
  applyOptionalFields(body, out)
  const err = optionalFieldsError(body)
  return err ?? { payload: out }
}

/// Optional string fields shared by create + update. Each is nullable; a
/// present-but-invalid value is reported by `optionalFieldsError`.
const OPTIONAL_LIMITS: Record<string, number> = {
  relationship: 50,
  phone: 32,
  notes: 500,
  avatar_url: 1024,
}

function applyOptionalFields(body: Record<string, unknown>, out: Record<string, string | null>): void {
  for (const key of Object.keys(OPTIONAL_LIMITS)) {
    if (!(key in body)) continue
    const v = body[key]
    if (v === null || v === '') {
      out[key] = null
    } else if (typeof v === 'string' && v.length <= (OPTIONAL_LIMITS[key] ?? 0)) {
      out[key] = v.trim()
    }
  }
}

function optionalFieldsError(body: Record<string, unknown>): InvalidBody | null {
  for (const [key, limit] of Object.entries(OPTIONAL_LIMITS)) {
    if (!(key in body)) continue
    const v = body[key]
    if (v === null || v === '') continue
    if (typeof v !== 'string' || v.length > limit) {
      return { error: { code: 'INVALID_BODY', message: `${key} must be a string ≤ ${limit} chars or null` } }
    }
  }
  return null
}

/// 404 on miss + on other-user ownership to avoid enumerating ids.
async function assertOwnership(
  companionId: string,
  userId: string,
  res: Response,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('companions')
    .select('user_id')
    .eq('id', companionId)
    .maybeSingle()

  if (error) {
    console.error(`[companions ownership] ${error.message}`)
    res.status(500).json({ error: { code: 'DB_ERROR', message: 'Could not verify ownership' } })
    return false
  }
  if (!data || (data as { user_id: string }).user_id !== userId) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Companion not found' } })
    return false
  }
  return true
}
