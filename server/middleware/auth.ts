import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { supabaseAdmin } from '../lib/supabaseAdmin.ts'

/**
 * Validates the Supabase JWT in the Authorization header.
 * Uses local jsonwebtoken.verify() for speed (<1ms vs ~200ms network call).
 * Falls back to supabaseAdmin.auth.getUser() if local verification fails.
 * On success sets res.locals.userId; on failure returns 401.
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
  const jwtSecret = process.env['SUPABASE_JWT_SECRET'] ?? ''

  // Try local JWT verification first (fast path)
  if (jwtSecret) {
    try {
      const decoded = jwt.verify(token, jwtSecret) as { sub?: string }
      if (decoded.sub) {
        res.locals['userId'] = decoded.sub
        next()
        return
      }
    } catch {
      // Token invalid or expired locally — fall through to Supabase
    }
  }

  // Fallback: verify via Supabase Auth API
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
