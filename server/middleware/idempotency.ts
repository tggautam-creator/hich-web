import type { Request, Response, NextFunction } from 'express'
import { supabaseAdmin } from '../lib/supabaseAdmin.ts'

/**
 * Idempotency middleware for retryable mutating endpoints.
 *
 * Clients include an `Idempotency-Key` header (UUID recommended) per
 * user-action. The middleware:
 *  - Inserts a RESERVATION row first (response_status=0 sentinel)
 *    so concurrent requests with the same key cannot both run the
 *    handler. The losing request polls the row + serves the winner's
 *    response when it lands.
 *  - On a cache hit (response_status > 0), returns the stored
 *    response and skips the handler.
 *  - On a cold miss (no row, no conflict), runs the handler and
 *    UPDATEs the reservation row with the actual status + body.
 *
 * **Why the reservation pattern (not just lookup-then-insert)** —
 * `/wallet/withdraw` had an exploitable race: a driver double-tapping
 * Withdraw could fire two concurrent requests with the same
 * Idempotency-Key, both miss the cache, both debit the wallet, but
 * Stripe-side dedupe means only one transfer goes out. Driver loses
 * the difference. The INSERT…ON CONFLICT DO NOTHING reservation
 * collapses that race to a single winner; loser polls. Promoted
 * 2026-04-28 as part of PAY.0.
 *
 * Stale rows from crashed handlers are reaped by
 * `purge_stale_idempotency()` (24h TTL, see migration 045).
 *
 * No header → no enforcement (legacy clients still work). Caller must
 * run `validateJwt` first so `res.locals.userId` is set.
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

    if (key.length > 255) {
      res.status(400).json({
        error: { code: 'INVALID_IDEMPOTENCY_KEY', message: 'Idempotency-Key must be ≤ 255 chars' },
      })
      return
    }

    // ── Step 1: try to claim the reservation slot ──────────────────────
    // INSERT…ON CONFLICT DO NOTHING via Supabase: an upsert with
    // `ignoreDuplicates: true` returns an empty array when the row
    // already existed, vs the inserted row when we won. We pick the
    // winner via a length check on the returned array.
    const reserveRes = await supabaseAdmin
      .from('request_idempotency')
      .upsert(
        {
          user_id: userId,
          idempotency_key: key,
          endpoint: endpointLabel,
          response_status: 0, // 0 = reservation in-progress sentinel
          response_body: {},
        },
        { onConflict: 'user_id,idempotency_key,endpoint', ignoreDuplicates: true },
      )
      .select('user_id')

    if (reserveRes.error) {
      console.error('[idempotency] reservation insert failed:', reserveRes.error.message)
      // Hard-fail open: if the cache table is broken, run the handler
      // anyway. Non-cached call sites already work this way; this
      // matches the previous behavior on lookup errors.
      next()
      return
    }

    const wonReservation = (reserveRes.data?.length ?? 0) > 0

    if (!wonReservation) {
      // ── Step 2: another request owns this slot ────────────────────────
      // Either it's already completed (status > 0, return cached) OR
      // it's still in-flight (status = 0, poll with backoff). 250ms
      // backoff × up to 8s gives most realistic handlers room to
      // finish before we 409. Hard upper bound prevents zombie waits.
      const deadline = Date.now() + 8000
      while (Date.now() < deadline) {
        const { data: existing } = await supabaseAdmin
          .from('request_idempotency')
          .select('response_status, response_body')
          .eq('user_id', userId)
          .eq('idempotency_key', key)
          .eq('endpoint', endpointLabel)
          .maybeSingle()

        const cached = existing as { response_status: number; response_body: unknown } | null
        if (cached && cached.response_status > 0) {
          res.status(cached.response_status).json(cached.response_body)
          return
        }
        // Still 0 = in-progress; sleep + re-check.
        await new Promise<void>((resolve) => setTimeout(resolve, 250))
      }

      // 8s is enough for any sane mutating handler; if we're still
      // here, something's wedged. 409 lets the client retry with a
      // fresh key (the safest action — the original may have crashed
      // or be processing very slowly).
      res.status(409).json({
        error: {
          code: 'IDEMPOTENCY_IN_PROGRESS',
          message: 'A request with this key is still processing. Try again.',
        },
      })
      return
    }

    // ── Step 3: we won the reservation, run the handler ────────────────
    // Wrap res.json so we UPDATE the reservation row with the real
    // status + body when the handler emits its response. The update
    // is fire-and-forget by design (the response goes out immediately;
    // the cache catches the next retry, not this request). The 250ms
    // poll loop above tolerates a brief gap between handler
    // completion and cache UPDATE landing.
    const originalJson = res.json.bind(res) as (body: unknown) => Response
    let recorded = false
    res.json = (body: unknown): Response => {
      if (!recorded) {
        recorded = true
        void supabaseAdmin
          .from('request_idempotency')
          .update({
            response_status: res.statusCode,
            response_body: body as object,
          })
          .eq('user_id', userId)
          .eq('idempotency_key', key)
          .eq('endpoint', endpointLabel)
          .then(({ error }) => {
            if (error) {
              console.error('[idempotency] failed to record response:', error.message)
            }
          })
      }
      return originalJson(body)
    }

    next()
  }
}
