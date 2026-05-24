/**
 * v1.2 F3.1 — Caregivers CRUD endpoints.
 *
 *   POST   /api/caregivers       — create
 *   GET    /api/caregivers       — list caller's caregivers (newest first)
 *   PATCH  /api/caregivers/:id   — update (ownership-checked)
 *   DELETE /api/caregivers/:id   — hard delete (ownership-checked)
 *
 * iOS will use `CaregiversRepository` (Supabase SDK direct) for the
 * Add / Edit sheets that ship with F3.2 — these endpoints exist for
 * web parity + the upcoming admin tooling. Same pattern as
 * `vehicles.ts` (F13.1).
 *
 * Hard-delete model per Tarun's direction (2026-05-20): when a
 * caregiver row is destroyed, historical rides + schedules that
 * referenced it null out their `caregiver_id` via `ON DELETE SET NULL`
 * (added in the F6 / F7 migration). The row itself is gone.
 */

import { Router } from 'express'
import type { Request, Response } from 'express'
import { supabaseAdmin } from '../lib/supabaseAdmin.ts'
import { validateJwt } from '../middleware/auth.ts'

export const caregiversRouter = Router()

// ── POST /api/caregivers ───────────────────────────────────────────────────
caregiversRouter.post('/', validateJwt, async (req: Request, res: Response) => {
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
      .from('caregivers')
      .insert(row as never)
      .select()
      .single()

    if (error) {
      console.error(`[caregivers POST] ${error.message}`)
      res.status(500).json({ error: { code: 'DB_ERROR', message: 'Could not create caregiver' } })
      return
    }
    res.status(201).json(data)
  } catch (err) {
    console.error('[caregivers POST] unexpected error:', err)
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Caregiver create failed' } })
  }
})

// ── GET /api/caregivers ────────────────────────────────────────────────────
caregiversRouter.get('/', validateJwt, async (_req: Request, res: Response) => {
  const userId = res.locals['userId'] as string
  if (!userId) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Not signed in' } })
    return
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('caregivers')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error(`[caregivers GET] ${error.message}`)
      res.status(500).json({ error: { code: 'DB_ERROR', message: 'Could not load caregivers' } })
      return
    }
    res.status(200).json({ caregivers: data ?? [] })
  } catch (err) {
    console.error('[caregivers GET] unexpected error:', err)
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Caregiver list failed' } })
  }
})

// ── PATCH /api/caregivers/:id ──────────────────────────────────────────────
caregiversRouter.patch('/:id', validateJwt, async (req: Request, res: Response) => {
  const userId = res.locals['userId'] as string
  const caregiverIdRaw = req.params['id']
  const caregiverId = typeof caregiverIdRaw === 'string' ? caregiverIdRaw : ''
  if (!userId) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Not signed in' } })
    return
  }
  if (!caregiverId) {
    res.status(400).json({ error: { code: 'MISSING_ID', message: 'caregiver id required' } })
    return
  }

  const ownsIt = await assertOwnership(caregiverId, userId, res)
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

  // Always bump updated_at on a real edit so the GET ordering reflects
  // recency of change too (currently ordered by created_at desc, but
  // surfacing freshly-edited rows is useful for the F3.2 Profile list).
  const patch = { ...validation.payload, updated_at: new Date().toISOString() }

  try {
    const { data, error } = await supabaseAdmin
      .from('caregivers')
      .update(patch as never)
      .eq('id', caregiverId)
      .select()
      .single()

    if (error) {
      console.error(`[caregivers PATCH] ${error.message}`)
      res.status(500).json({ error: { code: 'DB_ERROR', message: 'Could not save caregiver' } })
      return
    }
    res.status(200).json(data)
  } catch (err) {
    console.error('[caregivers PATCH] unexpected error:', err)
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Caregiver update failed' } })
  }
})

// ── DELETE /api/caregivers/:id ─────────────────────────────────────────────
//
// Hard delete (Tarun's direction). Rides + ride_schedules with
// `caregiver_id = <this row>` get NULL via `ON DELETE SET NULL` —
// historical records remain queryable, they just lose the caregiver
// pointer.
caregiversRouter.delete('/:id', validateJwt, async (req: Request, res: Response) => {
  const userId = res.locals['userId'] as string
  const caregiverIdRaw = req.params['id']
  const caregiverId = typeof caregiverIdRaw === 'string' ? caregiverIdRaw : ''
  if (!userId) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Not signed in' } })
    return
  }
  if (!caregiverId) {
    res.status(400).json({ error: { code: 'MISSING_ID', message: 'caregiver id required' } })
    return
  }

  const ownsIt = await assertOwnership(caregiverId, userId, res)
  if (!ownsIt) return

  try {
    const { error } = await supabaseAdmin
      .from('caregivers')
      .delete()
      .eq('id', caregiverId)

    if (error) {
      console.error(`[caregivers DELETE] ${error.message}`)
      res.status(500).json({ error: { code: 'DB_ERROR', message: 'Could not delete caregiver' } })
      return
    }
    res.status(204).end()
  } catch (err) {
    console.error('[caregivers DELETE] unexpected error:', err)
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Caregiver delete failed' } })
  }
})

// ── Helpers ────────────────────────────────────────────────────────────────

interface InvalidBody { error: { code: string; message: string } }
interface ValidPayload { payload: Record<string, string | null> }

function validateCreatePayload(body: Record<string, unknown>): ValidPayload | InvalidBody {
  const nameRaw = body['name']
  if (typeof nameRaw !== 'string' || nameRaw.trim().length === 0 || nameRaw.length > 100) {
    return {
      error: {
        code: 'INVALID_BODY',
        message: 'name is required and must be 1-100 chars',
      },
    }
  }
  const out: Record<string, string | null> = { name: nameRaw.trim() }

  if ('relationship' in body) {
    const v = body['relationship']
    if (v === null || v === '') {
      out['relationship'] = null
    } else if (typeof v === 'string' && v.length <= 50) {
      out['relationship'] = v.trim()
    } else {
      return { error: { code: 'INVALID_BODY', message: 'relationship must be a string ≤ 50 chars or null' } }
    }
  }
  if ('phone' in body) {
    const v = body['phone']
    if (v === null || v === '') {
      out['phone'] = null
    } else if (typeof v === 'string' && v.length <= 32) {
      out['phone'] = v.trim()
    } else {
      return { error: { code: 'INVALID_BODY', message: 'phone must be a string ≤ 32 chars or null' } }
    }
  }
  if ('notes' in body) {
    const v = body['notes']
    if (v === null || v === '') {
      out['notes'] = null
    } else if (typeof v === 'string' && v.length <= 500) {
      out['notes'] = v.trim()
    } else {
      return { error: { code: 'INVALID_BODY', message: 'notes must be a string ≤ 500 chars or null' } }
    }
  }
  if ('avatar_url' in body) {
    const v = body['avatar_url']
    if (v === null || v === '') {
      out['avatar_url'] = null
    } else if (typeof v === 'string' && v.length <= 1024) {
      out['avatar_url'] = v.trim()
    } else {
      return { error: { code: 'INVALID_BODY', message: 'avatar_url must be a string ≤ 1024 chars or null' } }
    }
  }
  return { payload: out }
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
  if ('relationship' in body) {
    const v = body['relationship']
    if (v === null || v === '') {
      out['relationship'] = null
    } else if (typeof v === 'string' && v.length <= 50) {
      out['relationship'] = v.trim()
    } else {
      return { error: { code: 'INVALID_BODY', message: 'relationship must be a string ≤ 50 chars or null' } }
    }
  }
  if ('phone' in body) {
    const v = body['phone']
    if (v === null || v === '') {
      out['phone'] = null
    } else if (typeof v === 'string' && v.length <= 32) {
      out['phone'] = v.trim()
    } else {
      return { error: { code: 'INVALID_BODY', message: 'phone must be a string ≤ 32 chars or null' } }
    }
  }
  if ('notes' in body) {
    const v = body['notes']
    if (v === null || v === '') {
      out['notes'] = null
    } else if (typeof v === 'string' && v.length <= 500) {
      out['notes'] = v.trim()
    } else {
      return { error: { code: 'INVALID_BODY', message: 'notes must be a string ≤ 500 chars or null' } }
    }
  }
  if ('avatar_url' in body) {
    const v = body['avatar_url']
    if (v === null || v === '') {
      out['avatar_url'] = null
    } else if (typeof v === 'string' && v.length <= 1024) {
      out['avatar_url'] = v.trim()
    } else {
      return { error: { code: 'INVALID_BODY', message: 'avatar_url must be a string ≤ 1024 chars or null' } }
    }
  }
  return { payload: out }
}

/// 404 on miss + on other-user ownership to avoid enumerating ids
/// (same convention as the vehicles router).
async function assertOwnership(
  caregiverId: string,
  userId: string,
  res: Response,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('caregivers')
    .select('user_id')
    .eq('id', caregiverId)
    .maybeSingle()

  if (error) {
    console.error(`[caregivers ownership] ${error.message}`)
    res.status(500).json({ error: { code: 'DB_ERROR', message: 'Could not verify ownership' } })
    return false
  }
  if (!data || (data as { user_id: string }).user_id !== userId) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Caregiver not found' } })
    return false
  }
  return true
}
