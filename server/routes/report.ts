import { Router } from 'express'
import type { Request, Response } from 'express'
import { validateJwt } from '../middleware/auth.ts'
import { supabaseAdmin } from '../lib/supabaseAdmin.ts'

export const reportRouter = Router()

reportRouter.post('/', validateJwt, async (req: Request, res: Response) => {
  const userId = (req as Request & { userId: string }).userId
  const { category, description, ride_id } = req.body as {
    category?: unknown
    description?: unknown
    ride_id?: unknown
  }

  if (typeof category !== 'string' || category.trim() === '') {
    res.status(400).json({ error: { code: 'MISSING_FIELD', message: 'category is required' } })
    return
  }
  if (typeof description !== 'string' || description.trim().length < 10) {
    res.status(400).json({ error: { code: 'MISSING_FIELD', message: 'description must be at least 10 characters' } })
    return
  }

  const { error } = await supabaseAdmin.from('reports').insert({
    user_id:     userId,
    ride_id:     typeof ride_id === 'string' ? ride_id : null,
    category:    category.trim(),
    description: description.trim(),
  })

  if (error) {
    console.error('[report] insert error:', error.message)
    res.status(500).json({ error: { code: 'DB_ERROR', message: 'Failed to save report' } })
    return
  }

  res.json({ ok: true })
})
