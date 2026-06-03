/**
 * v1.3 Sprint 11 Slice 6 — transient capsule toast for the
 * EmergencySheet (mirrors iOS `EmergencySheet.flashToast`).
 *
 * Default cadence: 2400ms visible window matching iOS. Caller
 * triggers via `useToast()` hook returned `flash(message)` — the
 * hook owns the timer + the message state so the EmergencySheet's
 * own component state stays focused on share-state semantics.
 *
 * Intentionally not a global / app-wide toast system — those usually
 * outgrow their scope. This is the focused subset the EmergencySheet
 * needs for copy/sent/revoke/mint-fail/revoke-fail confirmations.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

const TOAST_VISIBLE_MS = 2400

interface ToastState {
  /** Auto-incrementing key — pinned by tests to assert a fresh
   *  toast (vs. the same message lingering from a prior flash). */
  key: number
  message: string
}

export interface UseToastResult {
  toast: ToastState | null
  flash: (message: string) => void
  dismiss: () => void
}

export function useToast(): UseToastResult {
  const [toast, setToast] = useState<ToastState | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const keyRef = useRef(0)

  const dismiss = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    setToast(null)
  }, [])

  const flash = useCallback((message: string) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    keyRef.current += 1
    setToast({ key: keyRef.current, message })
    timerRef.current = setTimeout(() => {
      setToast(null)
      timerRef.current = null
    }, TOAST_VISIBLE_MS)
  }, [])

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  return { toast, flash, dismiss }
}

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
