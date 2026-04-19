interface TrustBadgesProps {
  email?: string | null
  ratingAvg?: number | null
  ratingCount?: number | null
  ridesCompleted?: number | null
  /** Compact sizing for inline use inside driver cards. */
  size?: 'sm' | 'md'
  className?: string
  'data-testid'?: string
}

/**
 * Compact trust-signal row. Renders up to three pills:
 *  - .edu verified (derived from email domain)
 *  - ★ avg rating with count
 *  - Rides completed
 *
 * Each badge renders only when its data is present, so callers can pass what
 * they have and the row stays tidy. Accessible labels are baked in so screen
 * readers get a full sentence instead of isolated numbers.
 */
export default function TrustBadges({
  email,
  ratingAvg,
  ratingCount,
  ridesCompleted,
  size = 'sm',
  className,
  'data-testid': testId = 'trust-badges',
}: TrustBadgesProps) {
  const isEdu = typeof email === 'string' && /\.edu(?:$|\.)/i.test(email.trim())
  const hasRating = typeof ratingAvg === 'number' && ratingAvg > 0
  const hasRides = typeof ridesCompleted === 'number' && ridesCompleted > 0

  if (!isEdu && !hasRating && !hasRides) return null

  const text = size === 'sm' ? 'text-[11px]' : 'text-xs'
  const pad = size === 'sm' ? 'px-2 py-0.5' : 'px-2.5 py-1'
  const pill = `inline-flex items-center gap-1 rounded-full font-medium ${text} ${pad}`

  return (
    <div
      data-testid={testId}
      className={`flex flex-wrap items-center gap-1.5 ${className ?? ''}`}
    >
      {isEdu && (
        <span
          data-testid="trust-badge-edu"
          aria-label="Verified university email"
          className={`${pill} bg-primary-light text-primary`}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3 w-3"
            aria-hidden="true"
          >
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <path d="M22 4 12 14.01l-3-3" />
          </svg>
          .edu verified
        </span>
      )}
      {hasRating && (
        <span
          data-testid="trust-badge-rating"
          aria-label={`Rated ${ratingAvg!.toFixed(1)} out of 5 from ${ratingCount ?? 0} ratings`}
          className={`${pill} bg-warning/10 text-warning`}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="h-3 w-3"
            aria-hidden="true"
          >
            <path d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
          </svg>
          {ratingAvg!.toFixed(1)}
          {typeof ratingCount === 'number' && ratingCount > 0 && (
            <span className="opacity-70">({ratingCount})</span>
          )}
        </span>
      )}
      {hasRides && (
        <span
          data-testid="trust-badge-rides"
          aria-label={`${ridesCompleted} rides completed`}
          className={`${pill} bg-success/10 text-success`}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3 w-3"
            aria-hidden="true"
          >
            <path d="M14 16H9m10 0h3v-3.15a1 1 0 0 0-.84-.99L16 11l-2.7-3.6a1 1 0 0 0-.8-.4H5.24a2 2 0 0 0-1.8 1.1l-.8 1.63A6 6 0 0 0 2 12.42V16h2" />
            <circle cx="6.5" cy="16.5" r="2.5" />
            <circle cx="16.5" cy="16.5" r="2.5" />
          </svg>
          {ridesCompleted} {ridesCompleted === 1 ? 'ride' : 'rides'}
        </span>
      )}
    </div>
  )
}
