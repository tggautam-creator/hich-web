import type { Request, Response, NextFunction } from 'express'
import { supabaseAdmin } from '../lib/supabaseAdmin.ts'

/**
 * Idempotency middleware for retryable mutating endpoints.
 *
 * Clients include an `Idempotency-Key` header with a client-generated unique
 * value (UUID recommended). The middleware:
 *  - On a cache hit, returns the stored response and skips the handler.
 *  - On a miss, runs the handler and caches the response (status + JSON body)
 *    keyed by (user_id, idempotency_key, endpoint).
 *
 * No header → no enforcement (legacy clients still work). Caller must run
 * `validateJwt` first so `res.locals.userId` is set.
 *
 * Race window: two concurrent requests with the same key can both miss the
 * cache and run the handler. Route handlers must remain idempotent enough that
 * a duplicate side-effect (e.g. a second ride row) is prevented by their own
 * guards. The cache still deduplicates *subsequent* retries once the first
 * response has been recorded.
 */
export function idempotency(endpointLabel: string) {
  return async function idempotencyMw(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const userId = res.locals['userId'] as string | undefined
    const key = req.header('Idempotency-Key') ?? req.header('idempotency-key')

    if (!key || !userId) {
      next()
      return
    }

    // Basic header hygiene
    if (key.length > 255) {
      res.status(400).json({
        error: { code: 'INVALID_IDEMPOTENCY_KEY', message: 'Idempotency-Key must be ≤ 255 chars' },
      })
      return
    }

    // Look up cached response
    const lookup = await supabaseAdmin
      .from('request_idempotency')
      .select('response_status, response_body')
      .eq('user_id', userId)
      .eq('idempotency_key', key)
      .eq('endpoint', endpointLabel)
      .maybeSingle()

    const cached = lookup.data as { response_status: number; response_body: unknown } | null

    if (cached) {
      res.status(cached.response_status).json(cached.response_body)
      return
    }

    // Wrap res.json to record the first response we emit
    const originalJson = res.json.bind(res) as (body: unknown) => Response
    let recorded = false
    res.json = (body: unknown): Response => {
      if (!recorded) {
        recorded = true
        void supabaseAdmin
          .from('request_idempotency')
          .insert({
            user_id: userId,
            idempotency_key: key,
            endpoint: endpointLabel,
            response_status: res.statusCode,
            response_body: body as object,
          })
          .then(({ error }) => {
            // 23505 = another request for the same key raced us; ignore.
            if (error && (error as { code?: string }).code !== '23505') {
              console.error('[idempotency] Failed to persist cached response:', error.message)
            }
          })
      }
      return originalJson(body)
    }

    next()
  }
}
