/**
 * v1.3 Sprint 11 Slice 4b — 90s safety-check countdown ring.
 *
 * Mirrors iOS `RideSafetyCheckOverlay.countdownRing` 1:1:
 *   - Total 90s window, anchored to `warning_fired_at` (so a remount
 *     resumes the real remaining seconds, not a fresh 90s).
 *   - Color grades green → yellow → red as the timer drains:
 *       remaining < 20s → danger
 *       remaining < 45s → warning
 *       otherwise       → success
 *   - 8pt stroke, lineCap=round, 92×92 frame
 *   - Tracks under-ring at 18% opacity for the empty portion
 *
 * Display loop ticks every 500ms via setInterval — matches iOS
 * `Task.sleep(.milliseconds(500))`. Server's cron fires the actual
 * auto-end at 90s; this ring is purely cosmetic.
 */
import { useEffect, useState } from 'react'

interface CountdownRingProps {
  firedAt: Date
  /** Optional test override — exposes the current remaining seconds
   *  for the regression test without having to read the DOM. */
  'data-testid'?: string
}

const TOTAL_SECONDS = 90
const TICK_INTERVAL_MS = 500

function ringTint(remaining: number): string {
  if (remaining < 20) return 'text-danger'
  if (remaining < 45) return 'text-warning'
  return 'text-success'
}

function computeRemaining(firedAt: Date, now: number): number {
  const deadline = firedAt.getTime() + TOTAL_SECONDS * 1000
  return Math.max(0, (deadline - now) / 1000)
}

export default function CountdownRing({
  firedAt,
  'data-testid': testId = 'safety-countdown-ring',
}: CountdownRingProps) {
  const [remaining, setRemaining] = useState<number>(() => computeRemaining(firedAt, Date.now()))

  useEffect(() => {
    // Immediately re-anchor on `firedAt` change so a re-mount during
    // an active warning shows the real remaining seconds.
    setRemaining(computeRemaining(firedAt, Date.now()))
    if (computeRemaining(firedAt, Date.now()) <= 0) return undefined
    const id = setInterval(() => {
      const next = computeRemaining(firedAt, Date.now())
      setRemaining(next)
      if (next <= 0) clearInterval(id)
    }, TICK_INTERVAL_MS)
    return () => clearInterval(id)
  }, [firedAt])

  // SVG ring math — circumference of an r=44 circle = 2πr ≈ 276.46.
  // strokeDashoffset = (1 - progress) * circumference reveals the
  // arc from the top (rotated -90°).
  const RADIUS = 44
  const CIRC = 2 * Math.PI * RADIUS
  const progress = Math.max(0, Math.min(1, remaining / TOTAL_SECONDS))
  const dashOffset = (1 - progress) * CIRC
  const tint = ringTint(remaining)
  const displaySeconds = Math.ceil(remaining)

  return (
    <div
      data-testid={testId}
      data-remaining={displaySeconds}
      className="relative h-[92px] w-[92px]"
    >
      <svg
        viewBox="0 0 100 100"
        className={`absolute inset-0 -rotate-90 ${tint}`}
        aria-hidden="true"
      >
        <circle
          cx="50"
          cy="50"
          r={RADIUS}
          className="text-text-secondary/20"
          stroke="currentColor"
          strokeWidth={8}
          fill="none"
        />
        <circle
          cx="50"
          cy="50"
          r={RADIUS}
          stroke="currentColor"
          strokeWidth={8}
          strokeLinecap="round"
          strokeDasharray={CIRC}
          strokeDashoffset={dashOffset}
          fill="none"
          style={{ transition: 'stroke-dashoffset 0.5s linear, color 0.5s linear' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-2xl font-extrabold leading-none ${tint}`}>
          {displaySeconds}
        </span>
        <span className="mt-0.5 text-[11px] font-semibold text-text-secondary">
          seconds
        </span>
      </div>
    </div>
  )
}
