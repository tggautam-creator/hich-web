import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import PrimaryButton from '@/components/ui/PrimaryButton'

interface DriverCancelledOverlayProps {
  rideId: string
  /**
   * Standby drivers still on `pending` offers when the cancel landed.
   * Drives the subtitle copy — "3 other drivers are ready..." reads much
   * better than the bare "we can find another driver" fallback when we
   * already know there are takers waiting.
   */
  standbyCount: number
  /**
   * Fired after a successful `/find-new-driver` call. Caller should
   * dismiss the overlay and keep the rider in their current screen so
   * they continue waiting on the same surface (WaitingRoom toast,
   * MessagingWindow chat, RiderPickupPage staging, etc.).
   */
  onFindNewDriverSucceeded: () => void
  /**
   * Fired on a successful cancel (manual tap OR the 2-min idle timeout).
   * Caller should navigate the rider out of all active-ride surfaces
   * back to their home — equivalent of dismissing the active ride.
   */
  onCancelled: () => void
  'data-testid'?: string
}

/**
 * Full-screen takeover the rider sees when their selected driver
 * cancels mid-flow on an instant ride. Web mirror of iOS
 * `DriverCancelledChoiceOverlay.swift` (W-T1-R3, 2026-05-16).
 *
 * Behaviour the user gets:
 *   - **Find another driver** (primary) → `POST /api/rides/:id/find-new-driver`.
 *     Standbys ping first; if none, server fans out to all online drivers.
 *   - **Cancel ride** (destructive) → `PATCH /api/rides/:id/cancel`.
 *   - **2-minute auto-cancel** countdown so a stranded rider doesn't sit
 *     forever on a re-queued `requested` row. Pill turns red at <30s.
 *   - Warning vibration on mount (Android-only, Safari ignores).
 *
 * Replaces the previous auto-dismiss-3s flow on RiderPickupPage and the
 * bare modal on MessagingWindow. WaitingRoom keeps its toast-style
 * handler because the rider is still in the matching loop there.
 */
export default function DriverCancelledOverlay({
  rideId,
  standbyCount,
  onFindNewDriverSucceeded,
  onCancelled,
  'data-testid': testId,
}: DriverCancelledOverlayProps) {
  const [submittingFind, setSubmittingFind] = useState(false)
  const [submittingCancel, setSubmittingCancel] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [secondsRemaining, setSecondsRemaining] = useState(120)

  // Latest cancel handler in a ref so the countdown effect can call it
  // without re-running every render (which would reset the timer).
  const idleCancelRef = useRef<() => Promise<void>>(() => Promise.resolve())

  // ── Warning vibration on appearance ─────────────────────────────────
  useEffect(() => {
    // Android Chrome respects `vibrate`; iOS Safari silently ignores —
    // matches iOS warning haptic where supported, no-op where not.
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate([60, 40, 60])
    }
  }, [])

  // ── Countdown ───────────────────────────────────────────────────────
  // Single setInterval for the overlay's whole life — simpler to
  // reason about than a chain of setTimeouts (and composes correctly
  // with React batching under fake timers). The interval pauses
  // itself while a network call is in flight and fires the idle
  // cancel via the ref the moment the count crosses zero.
  useEffect(() => {
    const id = window.setInterval(() => {
      setSecondsRemaining((s) => {
        if (s <= 1) {
          window.clearInterval(id)
          void idleCancelRef.current()
          return 0
        }
        return s - 1
      })
    }, 1000)
    return () => window.clearInterval(id)
  }, [])

  // ── Actions ─────────────────────────────────────────────────────────

  const cancelRide = async (reason: 'user' | 'idle') => {
    // Guard on BOTH in-flight flags. The user-tap path is already
    // blocked by the disabled attribute when find is in flight, but
    // the idle-timeout path (fired from the countdown effect) has no
    // UI gate — without checking submittingFind it would race a
    // hanging /find-new-driver call and send /cancel to the server
    // for the same ride.
    if (submittingCancel || submittingFind) return
    setSubmittingCancel(true)
    setErrorMessage(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        setErrorMessage('Please sign in to cancel.')
        setSubmittingCancel(false)
        return
      }
      const resp = await fetch(`/api/rides/${rideId}/cancel`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!resp.ok) {
        const body = (await resp.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        setErrorMessage(body.error?.message ?? "Couldn't cancel — try again.")
        setSubmittingCancel(false)
        // Restart the countdown only when the user can still see + retry
        // (a user tap). Idle-timeout failure leaves the error visible.
        if (reason === 'user') setSecondsRemaining(120)
        return
      }
      onCancelled()
    } catch {
      setErrorMessage('Network error — try again.')
      setSubmittingCancel(false)
      if (reason === 'user') setSecondsRemaining(120)
    }
  }

  // Keep the ref pointed at the latest cancel closure so the countdown
  // effect always fires the current version (and doesn't capture stale
  // state via a hook dependency).
  idleCancelRef.current = () => cancelRide('idle')

  const findAnotherDriver = async () => {
    // Symmetric guard — block if either button is mid-request.
    if (submittingFind || submittingCancel) return
    setSubmittingFind(true)
    setErrorMessage(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        setErrorMessage('Please sign in to retry.')
        setSubmittingFind(false)
        return
      }
      const resp = await fetch(`/api/rides/${rideId}/find-new-driver`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!resp.ok) {
        const body = (await resp.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        setErrorMessage(
          body.error?.message ?? "Couldn't reach drivers — try again.",
        )
        setSubmittingFind(false)
        return
      }
      onFindNewDriverSucceeded()
    } catch {
      setErrorMessage('Network error — try again.')
      setSubmittingFind(false)
    }
  }

  // ── Derived ─────────────────────────────────────────────────────────

  const subtitleCopy =
    standbyCount > 0
      ? `${standbyCount} other ${standbyCount > 1 ? 'drivers are' : 'driver is'} ready to take this ride right now.`
      : 'We can find you another driver, or cancel the ride.'

  const isUrgent = secondsRemaining < 30
  const mins = Math.floor(Math.max(0, secondsRemaining) / 60)
  const secs = Math.max(0, secondsRemaining) % 60
  const countdownLabel = `${mins}:${secs.toString().padStart(2, '0')}`

  const buttonsDisabled = submittingFind || submittingCancel

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 px-6"
      data-testid={testId ?? 'driver-cancelled-overlay'}
      role="dialog"
      aria-modal="true"
      aria-labelledby="driver-cancelled-title"
    >
      <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl space-y-4">
        {/* Icon */}
        <div className="flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-warning/20">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="h-8 w-8 text-warning"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003zM12 8.25a.75.75 0 01.75.75v3.75a.75.75 0 01-1.5 0V9a.75.75 0 01.75-.75zm0 8.25a.75.75 0 100-1.5.75.75 0 000 1.5z"
                clipRule="evenodd"
              />
            </svg>
          </div>
        </div>

        <h3
          id="driver-cancelled-title"
          className="text-center text-xl font-bold text-text-primary"
        >
          Driver cancelled
        </h3>
        <p
          className="text-center text-sm text-text-secondary"
          data-testid="driver-cancelled-subtitle"
        >
          {subtitleCopy}
        </p>

        {/* Countdown pill */}
        <div className="flex justify-center">
          <span
            data-testid="auto-cancel-countdown"
            className={[
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold tabular-nums',
              isUrgent
                ? 'bg-danger/15 text-danger'
                : 'bg-warning/15 text-warning',
            ].join(' ')}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="h-3.5 w-3.5"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25zM12.75 6a.75.75 0 00-1.5 0v6c0 .414.336.75.75.75h4.5a.75.75 0 000-1.5h-3.75V6z"
                clipRule="evenodd"
              />
            </svg>
            Auto-cancels in {countdownLabel}
          </span>
        </div>

        {errorMessage && (
          <p
            className="text-center text-xs text-danger"
            data-testid="driver-cancelled-error"
          >
            {errorMessage}
          </p>
        )}

        {/* CTAs */}
        <div className="space-y-2 pt-2">
          <PrimaryButton
            onClick={() => { void findAnotherDriver() }}
            disabled={buttonsDisabled}
            isLoading={submittingFind}
            loadingLabel="Finding…"
            data-testid="find-another-driver"
          >
            Find another driver
          </PrimaryButton>

          <button
            type="button"
            onClick={() => { void cancelRide('user') }}
            disabled={buttonsDisabled}
            data-testid="cancel-ride"
            className="w-full rounded-2xl border-2 border-danger/40 py-3 text-sm font-bold text-danger transition-colors active:bg-danger/5 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submittingCancel ? 'Cancelling…' : 'Cancel ride'}
          </button>
        </div>
      </div>
    </div>
  )
}
