/**
 * Branded card badge — renders the issuer's mark on its native color so the
 * Payment Methods list, Add-Card sheet, and ride-confirm screens all show a
 * card the way users actually recognize it (Visa wordmark on navy, Mastercard
 * interlocking circles, etc.) instead of a grey "Visa" / "MC" text chip.
 *
 * Inline SVGs — no third-party dependency, brand strings come from
 * Stripe (`paymentMethods.list().data[*].card.brand`), which uses
 * lower-case identifiers: visa, mastercard, amex, discover, jcb,
 * diners, unionpay, unknown.
 */

interface CardBrandBadgeProps {
  brand: string
  /** sm = ride-confirm row chip; md = payment-methods row chip (default). */
  size?: 'sm' | 'md'
  className?: string
  'data-testid'?: string
}

export default function CardBrandBadge({
  brand,
  size = 'md',
  className,
  'data-testid': testId,
}: CardBrandBadgeProps) {
  const dims = size === 'sm' ? 'h-8 w-11' : 'h-10 w-14'
  const wrapper = `flex shrink-0 ${dims} items-center justify-center rounded-lg overflow-hidden ${className ?? ''}`
  const normalized = brand.toLowerCase()

  // ── Visa ──────────────────────────────────────────────────────────────
  if (normalized === 'visa') {
    return (
      <div data-testid={testId ?? 'card-brand-badge'} className={`${wrapper} bg-[#1A1F71]`}>
        <svg viewBox="0 0 64 24" className={size === 'sm' ? 'h-3.5' : 'h-4'} aria-hidden="true">
          <text
            x="32"
            y="19"
            textAnchor="middle"
            fontFamily="Helvetica, Arial, sans-serif"
            fontWeight="900"
            fontStyle="italic"
            fontSize="22"
            fill="#fff"
            letterSpacing="-1"
          >
            VISA
          </text>
        </svg>
      </div>
    )
  }

  // ── Mastercard ────────────────────────────────────────────────────────
  if (normalized === 'mastercard') {
    return (
      <div data-testid={testId ?? 'card-brand-badge'} className={`${wrapper} bg-white border border-border`}>
        <svg viewBox="0 0 40 24" className={size === 'sm' ? 'h-5' : 'h-6'} aria-hidden="true">
          <circle cx="15" cy="12" r="9" fill="#EB001B" />
          <circle cx="25" cy="12" r="9" fill="#F79E1B" />
          {/* Overlap zone — orange (multiplied effect) */}
          <path
            d="M20 5.5a9 9 0 0 1 0 13 9 9 0 0 1 0-13z"
            fill="#FF5F00"
          />
        </svg>
      </div>
    )
  }

  // ── American Express ──────────────────────────────────────────────────
  if (normalized === 'amex' || normalized === 'american_express') {
    return (
      <div data-testid={testId ?? 'card-brand-badge'} className={`${wrapper} bg-[#006FCF]`}>
        <svg viewBox="0 0 64 24" className={size === 'sm' ? 'h-3' : 'h-3.5'} aria-hidden="true">
          <text
            x="32"
            y="17"
            textAnchor="middle"
            fontFamily="Helvetica, Arial, sans-serif"
            fontWeight="800"
            fontSize="14"
            fill="#fff"
            letterSpacing="0.5"
          >
            AMEX
          </text>
        </svg>
      </div>
    )
  }

  // ── Discover ──────────────────────────────────────────────────────────
  if (normalized === 'discover') {
    return (
      <div data-testid={testId ?? 'card-brand-badge'} className={`${wrapper} bg-white border border-border`}>
        <svg viewBox="0 0 56 16" className={size === 'sm' ? 'h-3' : 'h-3.5'} aria-hidden="true">
          <text
            x="0"
            y="13"
            fontFamily="Helvetica, Arial, sans-serif"
            fontWeight="800"
            fontSize="13"
            fill="#000"
          >
            DISC
          </text>
          <circle cx="48" cy="8" r="6" fill="#FF6000" />
        </svg>
      </div>
    )
  }

  // ── JCB ───────────────────────────────────────────────────────────────
  if (normalized === 'jcb') {
    return (
      <div data-testid={testId ?? 'card-brand-badge'} className={`${wrapper} bg-white border border-border`}>
        <svg viewBox="0 0 36 16" className={size === 'sm' ? 'h-4' : 'h-5'} aria-hidden="true">
          <rect x="0" y="0" width="12" height="16" rx="2" fill="#0E4C96" />
          <rect x="12" y="0" width="12" height="16" rx="2" fill="#BB1F2A" />
          <rect x="24" y="0" width="12" height="16" rx="2" fill="#22885A" />
          <text
            x="18"
            y="12"
            textAnchor="middle"
            fontFamily="Helvetica, Arial, sans-serif"
            fontWeight="900"
            fontSize="9"
            fill="#fff"
          >
            JCB
          </text>
        </svg>
      </div>
    )
  }

  // ── Diners Club / UnionPay / Unknown — generic card glyph ────────────
  const label = (() => {
    if (normalized === 'diners' || normalized === 'diners_club') return 'DC'
    if (normalized === 'unionpay') return 'UP'
    return brand.length > 0 ? brand.slice(0, 4).toUpperCase() : 'CARD'
  })()
  return (
    <div data-testid={testId ?? 'card-brand-badge'} className={`${wrapper} bg-gray-100 border border-border`}>
      <div className="flex flex-col items-center gap-0.5">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`${size === 'sm' ? 'h-3' : 'h-4'} text-text-secondary`}
          aria-hidden="true"
        >
          <rect x="2" y="6" width="20" height="13" rx="2" />
          <line x1="2" y1="11" x2="22" y2="11" />
        </svg>
        <span className={`${size === 'sm' ? 'text-[8px]' : 'text-[9px]'} font-bold text-text-secondary leading-none`}>
          {label}
        </span>
      </div>
    </div>
  )
}
