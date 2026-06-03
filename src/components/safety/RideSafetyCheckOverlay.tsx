/**
 * v1.3 Sprint 11 Slice 4b — full interactive safety-check overlay.
 *
 * Mirrors iOS `RideSafetyCheckOverlay.swift` 1:1:
 *   - 90s countdown ring (green → yellow → red color stops)
 *   - Role-aware subtitle + 3 action buttons (rider / driver)
 *   - "Still here" / "Got out" / "Get help" each POST to
 *     `/api/rides/:id/safety-warning-response` with the role-
 *     prefixed action
 *   - Stale-tap silent dismiss on 409 NO_ACTIVE_WARNING / NOT_ACTIVE
 *     (counterparty responded first / ride already ended)
 *   - Help branch:
 *       * mobile (`sms:` handler available) → open
 *         `sms:phone1,phone2&body=helpComposedBody(url)` with the
 *         user's trusted contacts pre-filled
 *       * desktop fallback → Copy link + Web Share API + Close
 *       * zero trusted contacts → inline guidance + 2.5s pause
 *   - 3 distinct error copies with countdown re-anchor:
 *       "Couldn't confirm — {err}"
 *       "Couldn't end ride — {err}"
 *       "Couldn't notify — {err}"
 *
 * Replaces the Slice 4a passive banner — same parent (active-ride
 * pages) now mounts THIS overlay whenever
 * `useRideSafetyChannel().warningFiredAt` is non-null.
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import CountdownRing from '@/components/safety/CountdownRing'
import {
  helpComposedBody,
  isStaleResponseTap,
  postSafetyWarningResponse,
  type SafetyWarningResponseAction,
  type SafetyWarningResponseResult,
  type TrustedContactRef,
} from '@/lib/safetyWarningResponseApi'
import type { RideRole } from '@/hooks/useRideRole'

interface RideSafetyCheckOverlayProps {
  rideId: string
  role: RideRole
  /** Name of the OTHER party — drives the driver-side copy
   *  ("Sarah is still with me"). Pass null to fall back to "Rider". */
  counterpartyName: string | null
  /** Anchor for the countdown — `warning_fired_at` from the rides row
   *  or the realtime payload. Re-mounts during an active warning use
   *  the same anchor so the countdown resumes at the real time
   *  remaining. */
  firedAt: Date
  /** Called when the overlay should dismiss — either because the user
   *  resolved the prompt or because the OTHER party / server moved
   *  state on. The active-ride page's `useRideSafetyChannel` hook
   *  already nulls out `warningFiredAt` on `warning_responded` /
   *  `safety_ended`, so the typical dismiss path is just letting the
   *  parent re-render with a null `firedAt`. Callers may use this
   *  to navigate (e.g. on `got out` → ride summary). */
  onResolved: (outcome: ResolvedOutcome) => void
  'data-testid'?: string
}

export type ResolvedOutcome =
  | { kind: 'responded' }
  | { kind: 'ended_ride'; fareCents: number | null }
  | { kind: 'help_sent' }

type Submitting = 'still-here' | 'got-out' | 'help' | null

interface HelpFallbackState {
  url: string
  recipients: string[]
}

function buildTrackUrl(token: string): string {
  if (typeof window === 'undefined' || !window.location) return `/track/${token}`
  return `${window.location.origin}/track/${token}`
}

/**
 * Browser-side equivalent of iOS `MessageComposeView.canSendText`.
 * Mobile browsers handle `sms:` deep-links; desktop ones don't.
 * Heuristic: presence of touch + small viewport. Errs on the side
 * of "try sms: anyway" since failure is graceful (the browser just
 * opens nothing).
 */
function canSendSms(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  const ua = navigator.userAgent ?? ''
  if (/Android|iPhone|iPad|iPod/i.test(ua)) return true
  // Many desktop UAs lie about touch; gate additionally on viewport.
  const hasTouch = typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: coarse)').matches
  return hasTouch && window.innerWidth < 900
}

function buildSmsHref(recipients: string[], body: string): string {
  // iOS + Android accept comma-separated recipients in sms: URLs.
  // RFC 5724 says the `?body=` parameter is supported on iOS, with
  // `&body=` after the recipient list on Android. We send both
  // separators by using `?&` which both interpret correctly.
  const phones = recipients.join(',')
  return `sms:${phones}?&body=${encodeURIComponent(body)}`
}

export default function RideSafetyCheckOverlay({
  rideId,
  role,
  counterpartyName,
  firedAt,
  onResolved,
  'data-testid': testId = 'ride-safety-check-overlay',
}: RideSafetyCheckOverlayProps) {
  const [submitting, setSubmitting] = useState<Submitting>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [helpFallback, setHelpFallback] = useState<HelpFallbackState | null>(null)
  // Bumped each time we restart the countdown after an error so the
  // ring re-anchors visually.
  const [ringEpoch, setRingEpoch] = useState(0)

  // Re-anchor whenever firedAt changes (re-mount during an active
  // warning, or a fresh warning_fired event).
  useEffect(() => { setRingEpoch((n) => n + 1) }, [firedAt])

  const subtitle = role === 'rider'
    ? "You and your driver appear to be apart. Confirm you're safe — the ride auto-ends if you don't respond."
    : `${counterpartyName ?? 'Your rider'} is no longer near the vehicle. Confirm you're together — the ride auto-ends if you don't respond.`

  const stillHereLabel = role === 'rider'
    ? "I'm still in the car"
    : `${counterpartyName ?? 'Rider'} is still with me`
  const gotOutLabel = role === 'rider'
    ? 'I got out — end the ride'
    : `${counterpartyName ?? 'Rider'} got out — end the ride`
  const helpLabel = role === 'rider'
    ? "Something's wrong — get help"
    : 'Report a problem'

  async function submitAction(
    kind: Submitting,
    action: SafetyWarningResponseAction,
    onOk: (result: SafetyWarningResponseResult) => Promise<void> | void,
    errorPrefix: string,
  ) {
    if (submitting) return
    setSubmitting(kind)
    setErrorMessage(null)
    try {
      const result = await postSafetyWarningResponse(rideId, action)
      await onOk(result)
    } catch (err) {
      if (isStaleResponseTap(err)) {
        // Other party responded first / ride already ended. Treat as
        // silent dismiss — no error UI, no toast (matches iOS).
        onResolved({ kind: 'responded' })
        return
      }
      const message = err instanceof Error ? err.message : 'Try again.'
      setErrorMessage(`${errorPrefix} — ${message}`)
      setSubmitting(null)
      // Re-anchor the visual countdown so the user can retry.
      setRingEpoch((n) => n + 1)
    }
  }

  async function handleStillHere() {
    const action: SafetyWarningResponseAction = role === 'rider' ? 'rider_in_car' : 'driver_in_car'
    await submitAction('still-here', action, () => {
      onResolved({ kind: 'responded' })
    }, "Couldn't confirm")
  }

  async function handleGotOut() {
    const action: SafetyWarningResponseAction = role === 'rider' ? 'rider_left' : 'driver_left'
    await submitAction('got-out', action, (result) => {
      onResolved({ kind: 'ended_ride', fareCents: result.fare_cents ?? null })
    }, "Couldn't end ride")
  }

  async function handleHelp() {
    await submitAction('help', 'help_requested', async (result) => {
      const token = result.share_token
      const contacts: TrustedContactRef[] = result.trusted_contacts ?? []
      if (!token) {
        // Server returned without a token (unexpected — surface as
        // a soft success so the user knows the tap registered).
        onResolved({ kind: 'help_sent' })
        return
      }
      const url = buildTrackUrl(token)
      if (contacts.length === 0) {
        // Verbatim guidance against iOS RideSafetyCheckOverlay.swift L370.
        setErrorMessage('No trusted contacts saved. Add them in Profile → Safety so we can text them next time.')
        await new Promise<void>((resolve) => setTimeout(resolve, 2500))
        onResolved({ kind: 'help_sent' })
        return
      }
      if (canSendSms()) {
        const sms = buildSmsHref(contacts.map((c) => c.phone), helpComposedBody(url))
        if (typeof window !== 'undefined') {
          window.location.href = sms
        }
        onResolved({ kind: 'help_sent' })
        return
      }
      // Desktop fallback — show Copy / Share / Close.
      setHelpFallback({ url, recipients: contacts.map((c) => c.phone) })
      setSubmitting(null)
    }, "Couldn't notify")
  }

  function dismissHelpFallback() {
    setHelpFallback(null)
    onResolved({ kind: 'help_sent' })
  }

  async function copyLink(url: string) {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try { await navigator.clipboard.writeText(url) } catch { /* silent */ }
    }
  }

  async function nativeShare(url: string) {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ text: helpComposedBody(url), url })
      } catch { /* user cancelled — silent */ }
    }
  }

  const portalTarget =
    (typeof document !== 'undefined' && document.getElementById('portal-root'))
    || (typeof document !== 'undefined' ? document.body : null)

  if (!portalTarget) return null

  const card = (
    <div
      data-testid={testId}
      data-fired-at={firedAt.toISOString()}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="ride-safety-title"
      aria-describedby="ride-safety-subtitle"
      className="fixed inset-0 z-[2200] flex items-center justify-center bg-black/75 backdrop-blur-sm p-6"
    >
      <div
        data-testid="ride-safety-check-overlay-card"
        className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl"
      >
        <div className="flex flex-col items-center gap-3">
          <CountdownRing key={ringEpoch} firedAt={firedAt} data-testid="safety-countdown-ring" />
          <h2 id="ride-safety-title" className="text-xl font-extrabold text-text-primary">
            Safety check
          </h2>
          <p id="ride-safety-subtitle" className="text-center text-sm text-text-secondary">
            {subtitle}
          </p>
          {errorMessage && (
            <p
              data-testid="ride-safety-check-overlay-error"
              className="text-center text-xs font-semibold text-danger"
              role="alert"
            >
              {errorMessage}
            </p>
          )}
          <div className="mt-1 flex w-full flex-col gap-2">
            <button
              type="button"
              data-testid="ride-safety-check-overlay-still-here"
              onClick={() => { void handleStillHere() }}
              disabled={submitting !== null}
              className="w-full rounded-2xl bg-primary py-3 text-base font-semibold text-white transition-colors active:bg-primary/90 disabled:opacity-60"
            >
              {submitting === 'still-here' ? 'Confirming…' : stillHereLabel}
            </button>
            <button
              type="button"
              data-testid="ride-safety-check-overlay-got-out"
              onClick={() => { void handleGotOut() }}
              disabled={submitting !== null}
              className="w-full rounded-2xl border-[1.5px] border-danger/40 py-3 text-base font-bold text-danger transition-colors active:bg-danger/5 disabled:opacity-60"
            >
              {submitting === 'got-out' ? 'Ending…' : gotOutLabel}
            </button>
            <button
              type="button"
              data-testid="ride-safety-check-overlay-help"
              onClick={() => { void handleHelp() }}
              disabled={submitting !== null}
              className="w-full rounded-2xl py-2.5 text-sm font-semibold text-warning transition-colors active:bg-warning/5 disabled:opacity-60"
            >
              {submitting === 'help' ? 'Notifying…' : helpLabel}
            </button>
          </div>
        </div>
      </div>

      {helpFallback && (
        <div
          data-testid="ride-safety-check-overlay-help-fallback"
          role="dialog"
          aria-modal="true"
          aria-labelledby="help-fallback-title"
          className="absolute inset-0 z-[2300] flex items-end justify-center bg-black/60 p-4 sm:items-center"
        >
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
            <h3 id="help-fallback-title" className="text-base font-bold text-text-primary">
              Can&apos;t send SMS from this device
            </h3>
            <p className="mt-2 text-sm text-text-secondary">
              Your live location is now shared. Copy the link and send it however you like.
            </p>
            <p className="mt-3 break-all rounded-xl bg-surface px-3 py-2 font-mono text-xs text-text-primary">
              {helpFallback.url}
            </p>
            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                data-testid="ride-safety-check-overlay-help-copy"
                onClick={() => { void copyLink(helpFallback.url) }}
                className="flex-1 rounded-xl bg-primary py-2.5 text-sm font-semibold text-white active:bg-primary/90"
              >
                Copy link
              </button>
              {typeof navigator !== 'undefined' && typeof navigator.share === 'function' && (
                <button
                  type="button"
                  data-testid="ride-safety-check-overlay-help-share"
                  onClick={() => { void nativeShare(helpFallback.url) }}
                  className="flex-1 rounded-xl border border-border py-2.5 text-sm font-semibold text-text-primary active:bg-surface"
                >
                  Share…
                </button>
              )}
              <button
                type="button"
                data-testid="ride-safety-check-overlay-help-close"
                onClick={dismissHelpFallback}
                className="rounded-xl px-3 py-2.5 text-sm font-semibold text-text-secondary active:bg-surface"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )

  return createPortal(card, portalTarget)
}
