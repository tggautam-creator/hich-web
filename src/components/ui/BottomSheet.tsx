import { HTMLAttributes, ReactNode, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { DURATION, prefersReducedMotion } from '@/lib/motion'

interface BottomSheetProps extends HTMLAttributes<HTMLDivElement> {
  isOpen: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  'data-testid'?: string
}

// Long enough to cover the slowest exit keyframe (sheet-out 220ms). Keep in
// sync with tailwind.config.cjs. We use the sheet-in duration as the floor
// because entering is the longer phase.
const EXIT_MS = DURATION.base

export default function BottomSheet({
  isOpen,
  onClose,
  title,
  children,
  className = '',
  'data-testid': testId,
  ...rest
}: BottomSheetProps) {
  // `mounted` drives whether the node is in the DOM; `visible` drives which
  // enter/exit animation class is applied. Decoupling them lets the exit
  // animation play before unmount.
  const [mounted, setMounted] = useState(isOpen)
  const [visible, setVisible] = useState(isOpen)

  useEffect(() => {
    if (isOpen) {
      setMounted(true)
      // Next frame: flip visible so enter animation runs from mounted state.
      requestAnimationFrame(() => setVisible(true))
    } else if (mounted) {
      setVisible(false)
      const reduced = prefersReducedMotion()
      const timeout = setTimeout(() => setMounted(false), reduced ? 0 : EXIT_MS)
      return () => clearTimeout(timeout)
    }
    return undefined
  }, [isOpen, mounted])

  // Lock body scroll while mounted (covers enter + exit phases).
  useEffect(() => {
    if (mounted) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [mounted])

  if (!mounted) return null

  const portalTarget =
    (typeof document !== 'undefined' && document.getElementById('portal-root')) ||
    (typeof document !== 'undefined' ? document.body : null)

  if (!portalTarget) return null

  // `motion-reduce:animate-none` ensures reduced-motion users see a plain
  // mount/unmount rather than the slide tween.
  const backdropAnim = visible ? 'animate-fade-in' : 'animate-fade-out'
  const sheetAnim = visible ? 'animate-sheet-in' : 'animate-sheet-out'

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title ?? 'Bottom sheet'}
      data-testid={testId}
    >
      {/* Backdrop */}
      <div
        className={[
          'fixed inset-0 z-[1100] bg-black/50 backdrop-blur-sm',
          backdropAnim,
          'motion-reduce:animate-none',
        ].join(' ')}
        aria-hidden="true"
        onClick={onClose}
      />

      {/* Sheet */}
      <div
        className={[
          'fixed bottom-0 left-0 right-0 z-[1200]',
          'rounded-t-3xl border-t border-border bg-white',
          'max-h-[90dvh] overflow-y-auto',
          'px-4 pb-8 pt-3',
          sheetAnim,
          'motion-reduce:animate-none',
          className,
        ].join(' ')}
        {...rest}
      >
        {/* Drag handle */}
        <div className="mx-auto mb-4 h-1 w-12 rounded-full bg-border" />

        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          {title && (
            <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-auto rounded-lg p-1 text-text-secondary hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            ✕
          </button>
        </div>

        {children}
      </div>
    </div>,
    portalTarget,
  )
}
