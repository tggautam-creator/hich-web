import { HTMLAttributes } from 'react'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  'data-testid'?: string
  /** Removes default padding when you need full-bleed content inside */
  noPadding?: boolean
}

export default function Card({
  children,
  className = '',
  noPadding = false,
  'data-testid': testId,
  ...rest
}: CardProps) {
  return (
    <div
      data-testid={testId}
      className={[
        'rounded-2xl border border-border bg-white shadow-sm',
        noPadding ? '' : 'p-4',
        className,
      ].join(' ')}
      {...rest}
    >
      {children}
    </div>
  )
}
