import { ButtonHTMLAttributes } from 'react'

interface PrimaryButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  'data-testid'?: string
  isLoading?: boolean
  /**
   * Slice 13 — text shown next to the spinner while `isLoading` is true.
   * Keep it action-specific so users can tell which long-running op is
   * in flight ("Processing payment…", "Transferring to bank…", etc.) and
   * are reassured the app didn't freeze. Defaults to a generic
   * "Loading…" so callers that don't care need no change.
   */
  loadingLabel?: string
}

export default function PrimaryButton({
  children,
  className = '',
  disabled,
  isLoading = false,
  loadingLabel = 'Loading…',
  'data-testid': testId,
  ...rest
}: PrimaryButtonProps) {
  const isDisabled = disabled || isLoading

  return (
    <button
      data-testid={testId}
      disabled={isDisabled}
      aria-busy={isLoading || undefined}
      className={[
        'w-full rounded-2xl px-6 py-3 text-base font-semibold text-white',
        'bg-primary hover:bg-primary-dark active:bg-primary-dark active:scale-[0.98]',
        'shadow-sm hover:shadow-md transition-all duration-150',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
        className,
      ].join(' ')}
      {...rest}
    >
      {isLoading ? (
        <span className="flex items-center justify-center gap-2">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden="true" />
          {loadingLabel}
        </span>
      ) : (
        children
      )}
    </button>
  )
}
