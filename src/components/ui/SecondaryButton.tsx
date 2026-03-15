import { ButtonHTMLAttributes } from 'react'

interface SecondaryButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  'data-testid'?: string
  isLoading?: boolean
}

export default function SecondaryButton({
  children,
  className = '',
  disabled,
  isLoading = false,
  'data-testid': testId,
  ...rest
}: SecondaryButtonProps) {
  const isDisabled = disabled || isLoading

  return (
    <button
      data-testid={testId}
      disabled={isDisabled}
      className={[
        'w-full rounded-2xl border border-primary px-6 py-3 text-base font-semibold text-primary',
        'bg-transparent hover:bg-primary-light active:bg-primary-light active:scale-[0.98]',
        'transition-all duration-150',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
        className,
      ].join(' ')}
      {...rest}
    >
      {isLoading ? (
        <span className="flex items-center justify-center gap-2">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          Loading…
        </span>
      ) : (
        children
      )}
    </button>
  )
}
