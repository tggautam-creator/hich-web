import type { Request, Response, NextFunction } from 'express'
import { supabaseAdmin } from '../lib/supabaseAdmin.ts'

/**
 * Validates the Supabase JWT in the Authorization header.
 * On success sets res.locals.userId; on failure returns 401.
 * Must be applied to every route before any business logic.
 */
export async function validateJwt(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers['authorization']
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({
      error: { code: 'MISSING_TOKEN', message: 'Authorization: Bearer <token> header required' },
    })
    return
  }

  const token = authHeader.slice(7)
  const { data, error } = await supabaseAdmin.auth.getUser(token)

  if (error ?? !data.user) {
    res.status(401).json({
      error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' },
    })
    return
  }

  res.locals['userId'] = data.user.id
  next()
}
