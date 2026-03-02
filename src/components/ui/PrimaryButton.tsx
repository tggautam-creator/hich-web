import { ButtonHTMLAttributes } from 'react'

interface PrimaryButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  'data-testid'?: string
  isLoading?: boolean
}

export default function PrimaryButton({
  children,
  className = '',
  disabled,
  isLoading = false,
  'data-testid': testId,
  ...rest
}: PrimaryButtonProps) {
  const isDisabled = disabled || isLoading

  return (
    <button
      data-testid={testId}
      disabled={isDisabled}
      className={[
        'w-full rounded-xl px-6 py-3 text-base font-semibold text-white',
        'bg-primary hover:bg-primary-dark active:bg-primary-dark',
        'transition-colors duration-150',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
        className,
      ].join(' ')}
      {...rest}
    >
      {isLoading ? (
        <span className="flex items-center justify-center gap-2">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
          Loading…
        </span>
      ) : (
        children
      )}
    </button>
  )
}
