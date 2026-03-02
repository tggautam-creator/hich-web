import { HTMLAttributes, ReactNode, useEffect } from 'react'
import { createPortal } from 'react-dom'

interface BottomSheetProps extends HTMLAttributes<HTMLDivElement> {
  isOpen: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  'data-testid'?: string
}

export default function BottomSheet({
  isOpen,
  onClose,
  title,
  children,
  className = '',
  'data-testid': testId,
  ...rest
}: BottomSheetProps) {
  // Lock body scroll while sheet is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  if (!isOpen) return null

  const portalTarget =
    (typeof document !== 'undefined' && document.getElementById('portal-root')) ||
    (typeof document !== 'undefined' ? document.body : null)

  if (!portalTarget) return null

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title ?? 'Bottom sheet'}
      data-testid={testId}
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40"
        aria-hidden="true"
        onClick={onClose}
      />

      {/* Sheet */}
      <div
        className={[
          'fixed bottom-0 left-0 right-0 z-50',
          'rounded-t-3xl border-t border-border bg-white',
          'max-h-[90dvh] overflow-y-auto',
          'px-4 pb-8 pt-3',
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
