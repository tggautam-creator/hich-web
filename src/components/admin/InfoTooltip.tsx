import { useEffect, useRef, useState } from 'react'

/**
 * Small "i" trigger button that toggles a tooltip with a plain-English
 * explanation of the adjacent metric. Used throughout the admin panel
 * so a new admin can land on the dashboard / funnel and immediately
 * understand what every number means without reading the source.
 *
 * Behaviour:
 *   - Tap toggles open; tap-outside or Escape closes.
 *   - Tooltip floats below the trigger, right-aligned so it doesn't
 *     overflow the right edge of a card.
 *   - Stays accessible: role=button, aria-expanded, aria-label.
 *
 * Why not pure CSS hover: needs to work on touch + needs to dismiss
 * deterministically when the admin clicks somewhere else.
 */
interface InfoTooltipProps {
  /** The explanation text shown inside the popup. */
  text: string
  /** test id for the trigger button; tooltip pops up as `${testid}-popup`. */
  testid?: string
  /** Optional label override for the aria-label on the trigger. */
  ariaLabel?: string
  /**
   * Which edge of the trigger the popup anchors to.
   * - 'right' (default): popup's right edge aligns with the trigger; it
   *    extends LEFT. Use when the trigger sits near the right edge of
   *    the page (e.g. dashboard KPI cards where the "i" is in the
   *    top-right corner of the card).
   * - 'left': popup's left edge aligns with the trigger; it extends
   *    RIGHT. Use when the trigger sits near the left edge of the
   *    page (e.g. funnel step titles where the "i" is right after a
   *    short title with empty card space to the right).
   */
  align?: 'left' | 'right'
}

export default function InfoTooltip({
  text,
  testid,
  ariaLabel,
  align = 'right',
}: InfoTooltipProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  return (
    <span ref={ref} className="relative inline-flex items-center align-middle">
      <button
        type="button"
        data-testid={testid}
        aria-label={ariaLabel ?? 'What does this mean?'}
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        className={[
          'ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full',
          'border border-border bg-white text-[10px] font-semibold leading-none',
          'text-text-secondary hover:text-primary hover:border-primary',
          'transition-colors',
        ].join(' ')}
      >
        i
      </button>
      {open && (
        <span
          data-testid={testid ? `${testid}-popup` : undefined}
          role="tooltip"
          className={[
            'absolute top-full z-30 mt-1 w-64',
            align === 'right' ? 'right-0' : 'left-0',
            'rounded-lg border border-border bg-white p-3',
            'text-xs leading-relaxed text-text-primary shadow-lg',
            'normal-case font-normal tracking-normal',
          ].join(' ')}
        >
          {text}
        </span>
      )}
    </span>
  )
}
