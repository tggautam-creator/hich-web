/**
 * v1.3 Sprint 11 Slice 6 — useToast hook for the EmergencySheet
 * transient capsule toast. Mirrors iOS `EmergencySheet.flashToast`.
 *
 * Split out from `src/components/ui/Toast.tsx` so the Toast file
 * exports only the component (Fast Refresh requires
 * component-only modules — react-refresh/only-export-components).
 */
import { useCallback, useEffect, useRef, useState } from 'react'

const TOAST_VISIBLE_MS = 2400

export interface ToastState {
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
