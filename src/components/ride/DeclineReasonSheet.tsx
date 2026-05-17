import { useState } from 'react'

interface DeclineReasonSheetProps {
  /**
   * Called when the driver hits Submit. Parent owns the network side —
   * snooze goes through POST /api/rides/snooze (durable, ride-independent
   * intent) and reason goes through PATCH /api/rides/:id/cancel as an
   * analytics tag. Either or both may be null per the user's choices.
   */
  onSubmit: (reason: string | null, snoozeMinutes: number | null) => void
  /**
   * Called when the driver dismisses the sheet via the X button or
   * backdrop tap. Sheet should re-open if the parent re-triggers it.
   */
  onCancel: () => void
  'data-testid'?: string
}

// ── Choices ─────────────────────────────────────────────────────────────
// 7-pill reason set + 6-pill snooze set chosen 2026-05-16 (see
// WEB_PARITY_PROGRESS.md "Decisions" table). Web is intentionally a
// superset of the iOS sheet; the strings are stored verbatim in
// `driver_decline_reasons.reason` so analytics need them stable.

const REASONS: readonly string[] = [
  'Too far',
  'Wrong direction',
  'Busy right now',
  'Taking a break',
  'Detour too long',
  'Pickup too far from me',
  'Other',
]

interface SnoozeOption {
  label: string
  minutes: number
}

const SNOOZE_OPTIONS: readonly SnoozeOption[] = [
  { label: '15 min', minutes: 15 },
  { label: '1 hour', minutes: 60 },
  { label: '2 hours', minutes: 120 },
  { label: '4 hours', minutes: 240 },
  { label: '8 hours', minutes: 480 },
  { label: 'Until tomorrow', minutes: 1440 },
]

/**
 * Bottom-sheet shown after a driver taps Decline on an inbound ride
 * request. Web mirror of iOS `DeclineReasonSheet.swift` (Sprint 2
 * W-T1-D1, 2026-05-16). Asks WHY (analytics) and offers a snooze
 * ("Don't show me ride requests for the next…") so the driver can step
 * away without going fully Offline.
 *
 * Submit calls back to the parent with `(reason, snoozeMinutes)`. The
 * parent then POSTs `/api/rides/snooze` (durable, decoupled from the
 * specific ride) and PATCHes the ride's `/cancel` with reason only —
 * server logs both into `driver_decline_reasons` for analytics.
 *
 * "Just decline" in the header is a first-class skip — single declines
 * shouldn't be punished with a forced reason.
 */
export default function DeclineReasonSheet({
  onSubmit,
  onCancel,
  'data-testid': testId,
}: DeclineReasonSheetProps) {
  const [selectedReason, setSelectedReason] = useState<string | null>(null)
  const [selectedSnoozeMinutes, setSelectedSnoozeMinutes] = useState<number | null>(null)

  const submitLabel = selectedSnoozeMinutes
    ? `Decline & pause for ${
      SNOOZE_OPTIONS.find((o) => o.minutes === selectedSnoozeMinutes)?.label
        ?? `${selectedSnoozeMinutes} min`
    }`
    : 'Decline'

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50"
      data-testid={testId ?? 'decline-reason-sheet'}
      role="dialog"
      aria-modal="true"
      aria-labelledby="decline-reason-title"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-t-3xl bg-white shadow-2xl"
        // Stop propagation so taps inside the sheet don't trigger the
        // backdrop's onCancel.
        onClick={(e) => e.stopPropagation()}
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 1rem)' }}
      >
        {/* Drag indicator */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="h-1.5 w-10 rounded-full bg-border" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pb-2">
          <h3
            id="decline-reason-title"
            className="text-base font-bold text-text-primary"
          >
            Why decline?
          </h3>
          <button
            type="button"
            onClick={() => onSubmit(null, null)}
            data-testid="decline-skip"
            className="text-sm font-semibold text-primary"
          >
            Just decline
          </button>
        </div>

        <div className="max-h-[70dvh] overflow-y-auto px-5 pt-2 pb-4">
          <p className="text-xs text-text-secondary">
            Help us match you with rides you&apos;ll want — and we&apos;ll quiet
            down if you&apos;re busy.
          </p>

          {/* Reason pills */}
          <div className="mt-5">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-text-secondary">
              Reason
            </p>
            <div className="flex flex-wrap gap-2" data-testid="reason-pills">
              {REASONS.map((reason) => {
                const active = selectedReason === reason
                return (
                  <button
                    key={reason}
                    type="button"
                    onClick={() =>
                      setSelectedReason((prev) => (prev === reason ? null : reason))
                    }
                    aria-pressed={active}
                    data-testid={`decline-reason-${reason}`}
                    className={[
                      'rounded-full border px-3.5 py-1.5 text-xs font-bold transition-colors',
                      active
                        ? 'border-primary bg-primary text-white'
                        : 'border-border bg-surface text-text-primary',
                    ].join(' ')}
                  >
                    {reason}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Snooze pills */}
          <div className="mt-5">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-text-secondary">
              Pause new ride requests
            </p>
            <p className="mb-2 text-[11px] text-text-secondary">
              We&apos;ll stop pinging you and quietly resume when the timer
              ends. You can still go online manually anytime.
            </p>
            <div className="flex flex-wrap gap-2" data-testid="snooze-pills">
              {SNOOZE_OPTIONS.map((opt) => {
                const active = selectedSnoozeMinutes === opt.minutes
                return (
                  <button
                    key={opt.minutes}
                    type="button"
                    onClick={() =>
                      setSelectedSnoozeMinutes((prev) =>
                        prev === opt.minutes ? null : opt.minutes,
                      )
                    }
                    aria-pressed={active}
                    data-testid={`decline-snooze-${opt.minutes}`}
                    className={[
                      'rounded-full border px-3.5 py-1.5 text-xs font-bold transition-colors',
                      active
                        ? 'border-success bg-success text-white'
                        : 'border-border bg-surface text-text-primary',
                    ].join(' ')}
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Submit */}
          <button
            type="button"
            onClick={() => onSubmit(selectedReason, selectedSnoozeMinutes)}
            data-testid="decline-submit"
            className="mt-6 w-full rounded-2xl bg-primary py-3.5 text-sm font-bold text-white active:bg-primary-dark"
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
