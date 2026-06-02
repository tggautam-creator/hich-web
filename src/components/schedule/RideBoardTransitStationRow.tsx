/**
 * v1.3 Sprint 10 Slice 4 — single transit-station row in the
 * `RideBoardConfirmSheet` transit-stop picker.
 *
 * Mirrors iOS `RideBoardConfirmDestinationSection.swift::transitRow`
 * (lines 252-335). Tap-to-peek (does NOT commit); commit is a
 * separate "Use this stop" button that only renders on the peeked
 * card. This split was an explicit iOS UX call so tap-to-inspect
 * doesn't accidentally lock in a destination.
 *
 * Subtitle copy mirrors iOS line 341 character-for-character:
 *   "{walk} min walk · {transit} min transit · {total} min total"
 */

interface RideBoardTransitStationRowProps {
  stationName: string
  walkToStationMinutes: number
  transitToDestMinutes: number
  totalRiderMinutes: number
  /** 1-based number rendered inside the leading badge — matches the
   *  numbered pin on the mini-map (iOS overview state, line 89). */
  index: number
  isPeeked: boolean
  onTapPeek: () => void
  /** Fires when the rider taps "Use this stop" on the peeked card.
   *  Only relevant when `isPeeked === true`; the button itself is
   *  hidden when not peeked. */
  onCommit: () => void
  'data-testid'?: string
}

export default function RideBoardTransitStationRow({
  stationName,
  walkToStationMinutes,
  transitToDestMinutes,
  totalRiderMinutes,
  index,
  isPeeked,
  onTapPeek,
  onCommit,
  'data-testid': testId = 'ride-board-transit-station-row',
}: RideBoardTransitStationRowProps) {
  const subtitle =
    `${walkToStationMinutes} min walk · ${transitToDestMinutes} min transit · ${totalRiderMinutes} min total`
  return (
    <div
      data-testid={testId}
      data-peeked={isPeeked ? 'true' : 'false'}
      className={[
        'rounded-2xl overflow-hidden transition-all bg-surface',
        isPeeked
          ? 'border-2 border-primary'
          : 'border border-border',
      ].join(' ')}
    >
      <button
        type="button"
        onClick={onTapPeek}
        data-testid={
          isPeeked
            ? 'ride-board-transit-station-row-peeked'
            : 'ride-board-transit-station-row-tap'
        }
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left active:bg-border/30"
      >
        {/* Numbered tram badge — mirrors iOS lines 260-267. iOS uses
            tram.fill SF Symbol; web uses an inline numbered badge in a
            primary-tinted circle. The number lines up with the
            corresponding pin on the mini-map. */}
        <span
          aria-hidden="true"
          className={[
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-primary',
            isPeeked ? 'bg-primary/20' : 'bg-primary/12',
          ].join(' ')}
        >
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-text-primary">
            {stationName}
          </p>
          <p className="text-[11px] text-text-secondary">{subtitle}</p>
        </div>
        {!isPeeked && (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3 w-3 shrink-0 text-text-secondary"
            aria-hidden="true"
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
        )}
      </button>

      {/* "Use this stop" button — only on the peeked card, mirrors iOS
          lines 299-321. Explicit commit affordance so tap-to-peek
          doesn't lock in a destination. */}
      {isPeeked && (
        <div className="px-3 pb-2.5">
          <button
            type="button"
            onClick={onCommit}
            data-testid="ride-board-transit-station-row-use-this-stop"
            className="w-full rounded-xl bg-primary py-2 text-sm font-bold text-white active:opacity-90"
          >
            Use this stop
          </button>
        </div>
      )}
    </div>
  )
}
