/**
 * v1.3 Sprint 12 Slice 3 — tap-to-call pill for the chat header,
 * driver pickup drawer, and both active-ride drawers. Mirrors iOS
 * `CallButton.swift` (visual + accessibility) and `CallButtonForRide`
 * (lifecycle).
 *
 * Behaviour matrix:
 *   - Has phone + mobile-class device → `tel:` deep link, native
 *     dialer opens.
 *   - Has phone + desktop browser → copies the number to clipboard
 *     and flashes a toast ("tel:" links are unreliable on desktop —
 *     Chrome shows a "choose an app" picker most users dismiss).
 *   - No phone → disabled "Phone unavailable" capsule (kept visible
 *     so the user knows calling IS the intended action, just blocked
 *     by missing data; iOS does the same).
 *
 * Two sizes mirror iOS `Size.compact` (chat header) vs `.standard`
 * (drawer rows). The driving difference is icon/text size, padding,
 * and capsule height — colours stay constant for consistency.
 *
 * Status gating happens UPSTREAM: callers pass `enabled: status in
 * {accepted, coordinating, active}` to `useCounterpartyContact`. When
 * disabled, no fetch fires, no data resolves, and CallButton renders
 * nothing (parent collapses the slot).
 */
import { useCallback, useRef, useState } from 'react'

interface CallButtonProps {
  /** Counter-party's display name. Drives the button label
   *  ("Call Casey") and the accessibility label. */
  partnerName?: string | null
  /** Phone returned by the server. `null` means the user never set
   *  one — button renders disabled. */
  phone: string | null | undefined
  /** Visual size. `compact` fits the MessagingWindow header row;
   *  `standard` is the roomier drawer-row pill. */
  size?: 'compact' | 'standard'
  'data-testid'?: string
}

const PHONE_DIGITS_RE = /[^\d+]/g

function telUrl(phone: string): string {
  return `tel:${phone.replace(PHONE_DIGITS_RE, '')}`
}

function isMobileLikeDevice(): boolean {
  if (typeof window === 'undefined') return false
  // Touch + coarse pointer is the most reliable signal: phones +
  // tablets pass; trackpad-only laptops fail. UA sniffing isn't worth
  // the maintenance cost when this works for all real cases.
  return window.matchMedia('(any-pointer: coarse)').matches
}

export default function CallButton({
  partnerName,
  phone,
  size = 'standard',
  'data-testid': testId = 'call-button',
}: CallButtonProps) {
  const [toast, setToast] = useState<string | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const trimmedPhone = phone?.trim() ?? ''
  const isEnabled = trimmedPhone.length > 0

  const firstName = partnerName?.trim().split(/\s+/)[0] ?? ''
  const buttonText = isEnabled
    ? firstName
      ? `Call ${firstName}`
      : 'Call'
    : 'Phone unavailable'

  const ariaLabel = isEnabled
    ? partnerName?.trim()
      ? `Call ${partnerName.trim()}`
      : 'Call'
    : 'Phone number not available'

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      if (!isEnabled) {
        event.preventDefault()
        return
      }
      if (isMobileLikeDevice()) {
        // Let the <a href="tel:..."> default action open the dialer.
        return
      }
      // Desktop fallback — copy to clipboard + toast. Default-prevent
      // the tel: navigation because most desktop browsers either ignore
      // it or surface an ugly app picker.
      event.preventDefault()
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(trimmedPhone).then(
          () => showToast(`Number copied: ${trimmedPhone}`),
          () => showToast(`Phone: ${trimmedPhone}`),
        )
      } else {
        showToast(`Phone: ${trimmedPhone}`)
      }
    },
    [isEnabled, trimmedPhone],
  )

  function showToast(message: string) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToast(message)
    toastTimerRef.current = setTimeout(() => {
      setToast(null)
      toastTimerRef.current = null
    }, 2400)
  }

  const sizeClasses =
    size === 'compact'
      ? 'gap-1 px-2.5 py-1.5 text-xs'
      : 'gap-1.5 px-4 py-2 text-sm'
  const iconSize = size === 'compact' ? 'h-3 w-3' : 'h-3.5 w-3.5'

  const enabledClasses = 'bg-success text-white shadow-sm hover:bg-success/90 active:scale-[0.98]'
  const disabledClasses =
    'bg-surface text-text-secondary border border-border/70 cursor-not-allowed opacity-80'

  return (
    <>
      <a
        href={isEnabled ? telUrl(trimmedPhone) : undefined}
        onClick={handleClick}
        aria-label={ariaLabel}
        aria-disabled={!isEnabled || undefined}
        role="button"
        tabIndex={isEnabled ? 0 : -1}
        data-testid={testId}
        data-enabled={isEnabled ? 'true' : 'false'}
        className={[
          'inline-flex select-none items-center justify-center rounded-full font-semibold transition',
          sizeClasses,
          isEnabled ? enabledClasses : disabledClasses,
        ].join(' ')}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          fill="currentColor"
          className={iconSize}
        >
          {isEnabled ? (
            <path d="M2.5 4.75A2.25 2.25 0 0 1 4.75 2.5h1.4c.49 0 .92.32 1.06.79l.85 2.83c.13.43-.02.9-.37 1.17l-1.2.93c-.22.17-.3.46-.18.71a11.5 11.5 0 0 0 5.06 5.06c.25.12.54.04.71-.18l.93-1.2c.27-.35.74-.5 1.17-.37l2.83.85c.47.14.79.57.79 1.06v1.4a2.25 2.25 0 0 1-2.25 2.25h-.75A12.25 12.25 0 0 1 2.5 5.5v-.75Z" />
          ) : (
            <path d="M2.5 4.75A2.25 2.25 0 0 1 4.75 2.5h1.4c.49 0 .92.32 1.06.79l.85 2.83c.13.43-.02.9-.37 1.17l-1.2.93c-.22.17-.3.46-.18.71a11.5 11.5 0 0 0 5.06 5.06c.25.12.54.04.71-.18l.93-1.2c.27-.35.74-.5 1.17-.37l2.83.85c.47.14.79.57.79 1.06v1.4a2.25 2.25 0 0 1-2.25 2.25h-.75A12.25 12.25 0 0 1 2.5 5.5v-.75Z M3 3l14 14" />
          )}
        </svg>
        <span className="whitespace-nowrap">{buttonText}</span>
      </a>
      {toast && (
        <div
          role="status"
          aria-live="polite"
          data-testid={`${testId}-toast`}
          className="pointer-events-none fixed left-1/2 z-[2400] -translate-x-1/2 rounded-full bg-black/85 px-4 py-2 text-xs font-semibold text-white shadow-lg backdrop-blur-sm"
          style={{ top: 'calc(env(safe-area-inset-top, 0px) + 1rem)' }}
        >
          {toast}
        </div>
      )}
    </>
  )
}
