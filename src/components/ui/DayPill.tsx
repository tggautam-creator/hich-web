import { ButtonHTMLAttributes } from 'react'

export type DayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6

const DAY_LABELS: Record<DayIndex, string> = {
  0: 'Sun',
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
}

interface DayPillProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  day: DayIndex
  selected?: boolean
  'data-testid'?: string
}

export default function DayPill({
  day,
  selected = false,
  className = '',
  'data-testid': testId,
  ...rest
}: DayPillProps) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={selected}
      aria-label={DAY_LABELS[day]}
      className={[
        'flex h-10 w-10 items-center justify-center rounded-full',
        'text-sm font-semibold transition-colors duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
        selected
          ? 'bg-primary text-white'
          : 'bg-surface text-text-secondary hover:bg-primary-light hover:text-primary',
        className,
      ].join(' ')}
      {...rest}
    >
      {DAY_LABELS[day]}
    </button>
  )
}
