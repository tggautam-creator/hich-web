/**
 * v1.3 Sprint 11 Slice 6 — transient capsule toast for the
 * EmergencySheet (mirrors iOS `EmergencySheet.flashToast`).
 *
 * Default cadence: 2400ms visible window matching iOS. Caller
 * triggers via the `useToast()` hook (lives in
 * `@/hooks/useToast` so this file exports only the component —
 * Fast Refresh requires component-only modules per
 * `react-refresh/only-export-components`).
 *
 * Intentionally not a global / app-wide toast system — those usually
 * outgrow their scope. This is the focused subset the EmergencySheet
 * needs for copy/sent/revoke/mint-fail/revoke-fail confirmations.
 */

interface ToastProps {
  message: string
  /** Per-call key so React re-mounts (resets the fade-in) when the
   *  parent flashes a new message before the old one expired. */
  toastKey: number
  'data-testid'?: string
}

export default function Toast({ message, toastKey, 'data-testid': testId = 'toast' }: ToastProps) {
  return (
    <div
      key={toastKey}
      data-testid={testId}
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed left-1/2 z-[2400] -translate-x-1/2 rounded-full bg-black/85 px-4 py-2 text-xs font-semibold text-white shadow-lg backdrop-blur-sm"
      style={{ top: 'calc(env(safe-area-inset-top, 0px) + 1rem)' }}
    >
      {message}
    </div>
  )
}
