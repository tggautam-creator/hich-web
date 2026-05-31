/**
 * "Today's the day" banner for Anytime rides scheduled for today.
 *
 * Mirrors iOS `Features/Rides/TodaysAnytimeBanner.swift` 1:1 —
 * three copy variants (single / multi / destination-missing
 * fallback), sun icon in warning-tinted bubble, soft warning
 * border + tint overlay, trailing chevron. Renders above the
 * Rides-tab content as in-app reinforcement of the server's 9 AM
 * push fired from `lib/scheduledReminders.ts` for rides with
 * `time_flexible = true` AND `trip_date == today`.
 *
 * iOS opacities: stroke 0.32, fill 0.06. Tailwind maps closest to
 * `border-warning/30` + `bg-warning/5` over a base material (white
 * here — iOS uses `.regularMaterial`).
 */

interface TodaysAnytimeBannerProps {
  rideCount: number
  /**
   * First ride's destination/route summary (already trimmed via
   * `bannerDestinationHeadline`). Null falls back to generic copy.
   */
  firstRideHeadline: string | null
  onTap: () => void
  'data-testid'?: string
}

export default function TodaysAnytimeBanner({
  rideCount,
  firstRideHeadline,
  onTap,
  'data-testid': testId = 'rides-anytime-today-banner',
}: TodaysAnytimeBannerProps) {
  const headline =
    rideCount > 1
      ? `Today's the day — ${rideCount} anytime rides`
      : `Today's the day!`

  const subhead =
    rideCount > 1
      ? `Open Tago when you're ready to head out.`
      : firstRideHeadline != null
        ? `Your anytime ride to ${firstRideHeadline} is scheduled today.`
        : `Your anytime ride is scheduled today. Open Tago when you're ready to head out.`

  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onTap}
      className="relative flex w-full items-center gap-3 rounded-2xl border border-warning/30 bg-white px-4 py-3 text-left active:scale-[0.99] transition-transform"
    >
      {/* Inner warning tint overlay (iOS opacity 0.06) */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-2xl bg-warning/5"
      />

      {/* Sun icon in warning-tinted bubble (iOS opacity 0.18) */}
      <span
        aria-hidden="true"
        className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-warning/20"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="currentColor"
          className="h-4 w-4 text-warning"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="4" />
          <path
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
            fill="none"
          />
        </svg>
      </span>

      <div className="relative flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[13px] font-semibold text-text-primary">
          {headline}
        </span>
        <span className="line-clamp-2 text-[11px] font-normal text-text-secondary">
          {subhead}
        </span>
      </div>

      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="relative h-3 w-3 shrink-0 text-text-secondary"
        aria-hidden="true"
      >
        <path d="M9 18l6-6-6-6" />
      </svg>
    </button>
  )
}
