/**
 * In-app foreground toast for FCM events that aren't already handled by
 * `RideRequestNotification.tsx`.
 *
 * Why this exists (per WEB_PARITY_REPORT W-T0-10): when a browser tab is
 * focused, the OS / browser suppresses the native push banner — the
 * server's FCM delivery succeeds but the user sees nothing. The existing
 * `RideRequestNotification` component handles `ride_request` / `board_*`
 * etc., but payment-related and `schedule_match` events fall through.
 * iOS surfaces these via `PaymentEventStore` + `ScheduleMatchEventStore`.
 * This component is the web analog.
 *
 * Mounted once at the authenticated root (`AuthGuard`).
 *
 * Behaviour:
 *  - Subscribes to `onForegroundMessage` from `@/lib/fcm`.
 *  - Skips types already owned by `RideRequestNotification` (see
 *    `HANDLED_ELSEWHERE`).
 *  - Renders a tinted toast at top-center for 6 s. Tap routes to the
 *    most relevant context (RideSummary, Wallet, RideBoard).
 *  - Auto-dismisses; tapping the body also dismisses.
 */

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { onForegroundMessage } from '@/lib/fcm'

interface ToastState {
  /** Re-keyed on every show so timeouts reset cleanly. */
  id: string
  title: string
  body: string
  tint: 'success' | 'warning' | 'danger' | 'primary'
  onTap?: () => void
}

const HANDLED_ELSEWHERE = new Set([
  // RideRequestNotification owns these:
  'ride_request',
  'board_request',
  'board_accepted',
  'board_declined',
  'ride_cancelled',
  'driver_cancelled',
  'ride_request_renewed',
  'ride_reminder',
  'driver_selected',
  // No UX intent for these foreground events (silent service triggers):
  'wake_up',
])

const TOAST_DURATION_MS = 6000

const TINT_CLASSES: Record<ToastState['tint'], string> = {
  success: 'bg-success/10 border-success/30 text-success',
  warning: 'bg-warning/10 border-warning/30 text-warning',
  danger: 'bg-danger/10 border-danger/30 text-danger',
  primary: 'bg-primary/10 border-primary/30 text-primary',
}

export default function ForegroundPushToast() {
  const navigate = useNavigate()
  const [toast, setToast] = useState<ToastState | null>(null)

  // Keep the latest navigate in a ref so the FCM callback closure doesn't
  // capture a stale reference (the callback only runs once on mount).
  const navigateRef = useRef(navigate)
  useEffect(() => { navigateRef.current = navigate }, [navigate])

  useEffect(() => {
    const unsub = onForegroundMessage((payload) => {
      const data = payload.data ?? {}
      const type = data.type
      if (!type || HANDLED_ELSEWHERE.has(type)) return

      const fallbackTitle = payload.title ?? data.title
      const fallbackBody = payload.body ?? data.body
      const rideId = data.ride_id

      let next: ToastState | null = null

      switch (type) {
        case 'payment_received':
          next = {
            id: `${type}-${Date.now()}`,
            title: fallbackTitle ?? 'Payment received',
            body: fallbackBody ?? 'Your ride payment cleared.',
            tint: 'success',
            onTap: rideId
              ? () => navigateRef.current(`/ride/summary/${rideId}`)
              : () => navigateRef.current('/wallet'),
          }
          break

        case 'payment_failed':
          next = {
            id: `${type}-${Date.now()}`,
            title: fallbackTitle ?? 'Payment failed',
            body: fallbackBody ?? 'Update your card and we\'ll retry.',
            tint: 'danger',
            onTap: rideId
              ? () => navigateRef.current(`/ride/summary/${rideId}`)
              : () => navigateRef.current('/payment/methods'),
          }
          break

        case 'payment_needed':
          next = {
            id: `${type}-${Date.now()}`,
            title: fallbackTitle ?? 'Payment needed',
            body: fallbackBody ?? 'Add a payment method to finish this ride.',
            tint: 'warning',
            onTap: rideId
              ? () => navigateRef.current(`/ride/summary/${rideId}`)
              : () => navigateRef.current('/payment/methods'),
          }
          break

        case 'topup_succeeded':
          next = {
            id: `${type}-${Date.now()}`,
            title: fallbackTitle ?? 'Wallet topped up',
            body: fallbackBody ?? 'Funds added to your Tago credit.',
            tint: 'success',
            onTap: () => navigateRef.current('/wallet'),
          }
          break

        case 'withdrawal_landed':
          next = {
            id: `${type}-${Date.now()}`,
            title: fallbackTitle ?? 'Withdrawal landed',
            body: fallbackBody ?? 'Your transfer arrived in your bank.',
            tint: 'success',
            onTap: () => navigateRef.current('/wallet'),
          }
          break

        case 'withdrawal_failed':
          next = {
            id: `${type}-${Date.now()}`,
            title: fallbackTitle ?? 'Withdrawal failed',
            body: fallbackBody ?? 'Your bank declined the transfer.',
            tint: 'danger',
            onTap: () => navigateRef.current('/wallet'),
          }
          break

        case 'schedule_match':
          next = {
            id: `${type}-${Date.now()}`,
            title: fallbackTitle ?? 'New match on the Ride Board',
            body: fallbackBody ?? 'A rider posted a trip that matches your route.',
            tint: 'primary',
            onTap: () => navigateRef.current('/rides/board'),
          }
          break

        default:
          // Unknown type with title/body present — surface as a neutral
          // toast rather than dropping silently. Anything truly noisy
          // should be added to HANDLED_ELSEWHERE.
          if (fallbackTitle || fallbackBody) {
            next = {
              id: `${type}-${Date.now()}`,
              title: fallbackTitle ?? 'Update',
              body: fallbackBody ?? '',
              tint: 'primary',
            }
          }
          break
      }

      if (next) setToast(next)
    })

    return () => {
      if (unsub) unsub()
    }
  }, [])

  // Auto-dismiss. We intentionally key the effect on `toast?.id` only
  // (not the whole `toast`) so a re-render that doesn't change the
  // toast identity doesn't reset the timer. ESLint can't see through
  // optional chaining, so the eslint-disable explicitly opts out.
  useEffect(() => {
    if (!toast) return
    const timeoutId = window.setTimeout(() => setToast(null), TOAST_DURATION_MS)
    return () => window.clearTimeout(timeoutId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast?.id])

  if (!toast) return null

  const tint = TINT_CLASSES[toast.tint]

  return (
    <div
      role="alert"
      data-testid="foreground-toast"
      className="fixed top-3 left-1/2 -translate-x-1/2 z-[60] w-[92vw] max-w-md"
    >
      <button
        type="button"
        onClick={() => {
          toast.onTap?.()
          setToast(null)
        }}
        className={`w-full rounded-2xl border ${tint} bg-white shadow-lg px-4 py-3 text-left active:opacity-80 transition-opacity`}
      >
        <p className="text-sm font-semibold text-text-primary">{toast.title}</p>
        {toast.body && (
          <p className="text-xs text-text-secondary mt-0.5">{toast.body}</p>
        )}
      </button>
    </div>
  )
}
