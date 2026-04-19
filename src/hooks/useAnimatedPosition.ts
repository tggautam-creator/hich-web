import { useEffect, useRef, useState } from 'react'
import { EASING, prefersReducedMotion } from '@/lib/motion'

/**
 * Tween lat/lng between GPS ticks via requestAnimationFrame. Prevents the
 * "teleport" feel when a new driver ping arrives every 5–15 seconds.
 *
 * Returns a smoothed {lat, lng} that the caller can feed straight into an
 * `AdvancedMarker` position. When the target updates mid-tween, the RAF
 * loop retargets from the current tweened value — no snap.
 *
 * Honours `prefers-reduced-motion`: skips the tween and tracks the target
 * directly, keeping map position correct without the transform animation.
 *
 * Port note:
 *  - Capacitor (WebView wrap): RAF is native DOM, works unchanged.
 *  - React Native: swap for `useSharedValue` + `withTiming` (Reanimated);
 *    same duration/easing tokens from src/lib/motion.ts carry over.
 */

export interface LatLng {
  lat: number
  lng: number
}

/** Matches the 600ms car rotation transition in CarMarker so move + turn
 *  stay visually in sync. */
const TWEEN_MS = 600

function bezierSample(t: number, e: readonly [number, number, number, number]): number {
  // Approximate cubic-bezier (e[0], e[1], e[2], e[3]) evaluated on y for a
  // given x = t. Cheap two-step newton refine — plenty accurate for a
  // position tween sampled at 60 Hz.
  const x1 = e[0], y1 = e[1], x2 = e[2], y2 = e[3]
  let u = t
  for (let i = 0; i < 5; i++) {
    const x = 3 * (1 - u) ** 2 * u * x1 + 3 * (1 - u) * u ** 2 * x2 + u ** 3
    const dx = 3 * (1 - u) ** 2 * (x1) + 6 * (1 - u) * u * (x2 - x1) + 3 * u ** 2 * (1 - x2)
    if (Math.abs(dx) < 1e-6) break
    u -= (x - t) / dx
    u = Math.min(1, Math.max(0, u))
  }
  return 3 * (1 - u) ** 2 * u * y1 + 3 * (1 - u) * u ** 2 * y2 + u ** 3
}

/**
 * @param target Destination lat/lng. Null disables the hook.
 * @returns Current animated position, or null until the first target.
 */
export function useAnimatedPosition(target: LatLng | null): LatLng | null {
  const [value, setValue] = useState<LatLng | null>(target)

  const fromRef = useRef<LatLng | null>(target)
  const toRef = useRef<LatLng | null>(target)
  const startRef = useRef<number>(0)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (!target) return
    // First target: snap to avoid animating from (0,0).
    if (!value) {
      setValue(target)
      fromRef.current = target
      toRef.current = target
      return
    }

    // Reduced motion: track directly.
    if (prefersReducedMotion()) {
      setValue(target)
      fromRef.current = target
      toRef.current = target
      return
    }

    // No-op if target is identical.
    if (
      toRef.current &&
      toRef.current.lat === target.lat &&
      toRef.current.lng === target.lng
    ) {
      return
    }

    // Start a new tween from the current animated value.
    fromRef.current = value
    toRef.current = target
    startRef.current = performance.now()

    const easing = EASING.standardOut

    const step = (now: number) => {
      const from = fromRef.current
      const to = toRef.current
      if (!from || !to) return

      const t = Math.min(1, (now - startRef.current) / TWEEN_MS)
      const eased = bezierSample(t, easing)
      const next = {
        lat: from.lat + (to.lat - from.lat) * eased,
        lng: from.lng + (to.lng - from.lng) * eased,
      }
      setValue(next)

      if (t < 1) {
        rafRef.current = requestAnimationFrame(step)
      } else {
        rafRef.current = null
      }
    }

    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(step)

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
    // Target identity drives the effect; the `value` capture at tween-start
    // is intentional so mid-tween re-targets don't reset from the old target.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.lat, target?.lng])

  return value
}
