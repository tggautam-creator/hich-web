/**
 * v1.3 Sprint 11 Slice 4a — `ride-safety:{rideID}` realtime channel
 * + 10s polling backstop + reseat-on-mount.
 *
 * Mirrors iOS `RiderActiveRidePage+Live.swift::subscribeRideSafety
 * Channel` + the 10s ride-row poll backstop at
 * `startRidePollBackstop` (which re-reads `divergence_state` +
 * `warning_fired_at` to self-heal missed realtime broadcasts).
 *
 * What this hook handles (Slice 4a):
 *   - Subscribes to `ride-safety:{rideID}` for `warning_fired` /
 *     `warning_responded` / `safety_ended` broadcasts.
 *   - Reseat-on-mount: reads `rides.divergence_state` +
 *     `warning_fired_at` immediately so the surface re-anchors a
 *     mid-flight warning if the user re-opened the app during one.
 *   - 10s polling backstop: re-reads the same fields every 10s to
 *     auto-recover from dropped broadcasts (the user backgrounded
 *     the app during a `warning_responded` / `safety_ended` event;
 *     Supabase Realtime does NOT replay broadcast history for late
 *     subscribers).
 *   - Auto-clears local warning state on `warning_responded` (the
 *     counterparty responded first) and on `safety_ended` (server
 *     auto-ended after the 90s timeout).
 *
 * What this hook does NOT handle (deferred to Slice 4b):
 *   - The interactive overlay UI (90s countdown ring, three
 *     role-aware action buttons, sms help branch, desktop fallback).
 *   - Posting to `POST /api/rides/:id/safety-warning-response`.
 *   - FCM Web background push handlers.
 *   - Driver-side `safety_ended` rideEndedSignal mirror.
 * Slice 4a ships a passive "Safety check detected — verifying"
 * banner backed by this hook; Slice 4b layers the full interactive
 * overlay on top of the same hook.
 */
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

const POLL_INTERVAL_MS = 10_000

interface SafetyBroadcastPayload {
  fired_at?: unknown
}

interface UseRideSafetyChannelResult {
  /** Non-null when a divergence warning is currently active for this
   *  ride. The value is the `warning_fired_at` timestamp so Slice 4b
   *  can anchor the 90s countdown to it (vs. a fresh 90s every
   *  remount). Null when no warning is active or after a response /
   *  auto-end. */
  warningFiredAt: Date | null
  /** Monotonic counter bumped on every `safety_ended` broadcast.
   *  Slice 4b's driver-active page will watch this to mirror the
   *  iOS `rideEndedSignal` belt-and-suspenders path. */
  safetyEndedSignal: number
}

export function useRideSafetyChannel(rideId: string | null | undefined): UseRideSafetyChannelResult {
  const [warningFiredAt, setWarningFiredAt] = useState<Date | null>(null)
  const [safetyEndedSignal, setSafetyEndedSignal] = useState(0)

  // ── Reseat-on-mount + 10s polling backstop ──────────────────────
  useEffect(() => {
    if (!rideId) {
      setWarningFiredAt(null)
      return
    }
    let cancelled = false

    async function tick() {
      // `as never` on the select string bypasses the generated
      // Supabase column-type narrowing for `divergence_state` /
      // `warning_fired_at` — those columns ship from migration 094 +
      // 095 but `src/types/database.ts` hasn't been regenerated to
      // include them, so without the cast tsc rejects the build.
      // Mirrors the same pattern used server-side in rides.ts:5116.
      const { data, error } = await supabase
        .from('rides')
        .select('divergence_state, warning_fired_at' as never)
        .eq('id', rideId as string)
        .single()
      if (cancelled || error || !data) return
      const row = data as unknown as { divergence_state: string | null; warning_fired_at: string | null }
      const state = row.divergence_state ?? null
      const firedAtRaw = row.warning_fired_at ?? null
      if (state === 'warning' && firedAtRaw) {
        // Only update if the timestamp actually changed — avoids
        // a re-render storm when the poll keeps reading the same
        // value during an active warning.
        setWarningFiredAt((prev) => {
          const next = new Date(firedAtRaw)
          if (prev && prev.getTime() === next.getTime()) return prev
          return next
        })
      } else if (state !== 'warning') {
        // Server moved on (responded / safety_ended / cleared). Drop
        // the local override so the banner unmounts.
        setWarningFiredAt((prev) => (prev === null ? prev : null))
      }
    }

    void tick()
    const interval = setInterval(() => { void tick() }, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [rideId])

  // ── Realtime channel ───────────────────────────────────────────
  useEffect(() => {
    if (!rideId) return
    const channel = supabase
      .channel(`ride-safety:${rideId.toLowerCase()}`)
      .on('broadcast', { event: 'warning_fired' }, (msg) => {
        const payload = (msg.payload ?? {}) as SafetyBroadcastPayload
        const raw = typeof payload.fired_at === 'string' ? payload.fired_at : null
        const firedAt = raw ? new Date(raw) : new Date()
        setWarningFiredAt(firedAt)
      })
      .on('broadcast', { event: 'warning_responded' }, () => {
        setWarningFiredAt(null)
      })
      .on('broadcast', { event: 'safety_ended' }, () => {
        setWarningFiredAt(null)
        setSafetyEndedSignal((n) => n + 1)
      })
      .subscribe()

    return () => { void supabase.removeChannel(channel) }
  }, [rideId])

  return { warningFiredAt, safetyEndedSignal }
}
