/**
 * v1.3 Sprint 11 Slice 4a — passive "Safety check detected" banner.
 *
 * Renders when `useRideSafetyChannel` reports a non-null
 * `warningFiredAt`. This is the Slice 4a placeholder for the full
 * interactive overlay that lands in Slice 4b — the banner gets the
 * realtime + reseat plumbing live end-to-end so we can ship the
 * channel + polling backstop independently, then layer the
 * countdown + three action buttons + sms branch on top in 4b.
 *
 * The banner does NOT post any action — server's safety-net cron
 * will still auto-end the ride at 90s if neither party responds via
 * iOS during the Slice 4a window. Slice 4b adds the response
 * endpoint calls. Until then, on web this banner is a "we see the
 * warning, the iOS app is responding" indicator.
 */
interface SafetyWarningBannerProps {
  firedAt: Date
  /** Per-surface identifier — e.g. `safety-warning-banner-rider`
   *  on RiderActiveRidePage, `-driver` on DriverActiveRidePage. */
  'data-testid'?: string
}

export default function SafetyWarningBanner({
  firedAt,
  'data-testid': testId = 'safety-warning-banner',
}: SafetyWarningBannerProps) {
  return (
    <div
      data-testid={testId}
      data-fired-at={firedAt.toISOString()}
      role="alert"
      aria-live="polite"
      className="fixed left-1/2 z-[1800] -translate-x-1/2 rounded-2xl border border-warning bg-warning/15 px-4 py-3 text-text-primary shadow-lg backdrop-blur-sm"
      style={{
        top: 'calc(env(safe-area-inset-top, 0px) + 3.5rem)',
        maxWidth: 'min(calc(100% - 1.5rem), 24rem)',
      }}
    >
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="text-lg leading-none">⚠️</span>
        <div className="min-w-0">
          <p className="text-sm font-semibold">Safety check detected — verifying</p>
          <p className="mt-0.5 text-xs text-text-secondary">
            Tago is monitoring this ride. Watch for an action prompt.
          </p>
        </div>
      </div>
    </div>
  )
}
