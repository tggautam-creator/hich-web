/**
 * Central motion tokens — durations and easings used by every animation in
 * the app. Colocated so a future iOS port only has to re-read these numbers
 * instead of hunting through CSS.
 *
 * Porting map:
 *  - Capacitor (WebView wrap): Tailwind/CSS animations just work.
 *  - React Native (Reanimated): feed these same durations + easings into
 *    `withTiming(value, { duration: DURATION.sheet, easing: EASING.standardOut })`.
 *  - Native Swift (SwiftUI): `.animation(.timingCurve(0.22, 1, 0.36, 1,
 *    duration: 0.28))` — cubic-bezier tuples line up 1:1.
 *
 * Keep the numbers in sync with tailwind.config.cjs `animation` / `keyframes`
 * entries. They are the single source of truth for motion intent; the CSS
 * side just encodes them in Tailwind-friendly form.
 */

export const DURATION = {
  /** press feedback, small icon swaps */
  fast: 150,
  /** default UI transitions (modals, toasts, tabs) */
  base: 220,
  /** bottom sheet enter */
  sheet: 280,
  /** big content reveals (driver card match) */
  reveal: 320,
} as const

export const EASING = {
  /** enter — decelerates in (ease-out-quint); matches iOS sheet feel. */
  standardOut: [0.22, 1, 0.36, 1] as const,
  /** exit — accelerates out (ease-in). */
  standardIn: [0.4, 0, 1, 1] as const,
  /** symmetric state change. */
  standard: [0.4, 0, 0.2, 1] as const,
} as const

/** CSS `cubic-bezier(...)` string for an EASING tuple. */
export function cubicBezier(easing: readonly [number, number, number, number]): string {
  return `cubic-bezier(${easing.join(', ')})`
}

/**
 * True when the user has requested reduced motion. Animations should
 * short-circuit to no-op when this is true (skip transform tweens, keep
 * opacity swaps so state still updates visibly).
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
