/**
 * Sprint 9 Slice 5 SURFACE B — rider-drawer "Shared trip/ride" pill.
 *
 * Mirrors iOS `MultiRiderSubtitle.swift` 1:1. Sits under the existing
 * driver-name + destination hero copy on RiderActiveRidePage as a
 * single-line accent letting the rider know they're not alone in the
 * car. Solo trips render nothing — the parent passes
 * `otherRidersCount=0` and the component short-circuits.
 *
 * Phase distinction (iOS lines 22-30):
 *   coordinating → "Shared trip · {N} other(s) on this route"
 *   active       → "Shared ride · {N} other(s) aboard"
 *
 * Visual: `person.2.fill`-equivalent inline SVG + label, both
 * `tokens.primary`. Capsule background at primary/10 opacity.
 */

interface MultiRiderSubtitleProps {
  /** Other riders on the trip, NOT including the viewer. Solo = 0 → hidden. */
  otherRidersCount: number
  /** Coordinating (pickup phase) renders "on this route"; active renders "aboard". */
  phase: 'enroute' | 'active'
  'data-testid'?: string
}

export default function MultiRiderSubtitle({
  otherRidersCount,
  phase,
  'data-testid': testId = 'multi-rider-subtitle',
}: MultiRiderSubtitleProps) {
  if (otherRidersCount < 1) return null

  const noun = otherRidersCount === 1 ? 'other' : 'others'
  const label =
    phase === 'enroute'
      ? `Shared trip · ${otherRidersCount} ${noun} on this route`
      : `Shared ride · ${otherRidersCount} ${noun} aboard`

  return (
    <div
      data-testid={testId}
      className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2 py-1"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        className="h-3 w-3 text-primary"
        aria-hidden="true"
      >
        {/* SF Symbol "person.2.fill" equivalent — two overlapping figures */}
        <path d="M8 12a3.5 3.5 0 100-7 3.5 3.5 0 000 7zm0 1.5c-3 0-7 1.5-7 4.5v1.5h14V18c0-3-4-4.5-7-4.5z" />
        <path d="M16 12a3.5 3.5 0 100-7 3.5 3.5 0 000 7zm0 1.5c-.7 0-1.5.1-2.3.3 1.3.9 2 2.3 2 4.2v1.5h7V18c0-3-3.7-4.5-6.7-4.5z" />
      </svg>
      <span className="text-xs font-semibold text-primary">{label}</span>
    </div>
  )
}
