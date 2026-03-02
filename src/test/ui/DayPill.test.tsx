import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import DayPill from '@/components/ui/DayPill'
import type { DayIndex } from '@/components/ui/DayPill'

const DAYS: { index: DayIndex; label: string }[] = [
  { index: 0, label: 'Sun' },
  { index: 1, label: 'Mon' },
  { index: 2, label: 'Tue' },
  { index: 3, label: 'Wed' },
  { index: 4, label: 'Thu' },
  { index: 5, label: 'Fri' },
  { index: 6, label: 'Sat' },
]

describe('DayPill — labels', () => {
  it.each(DAYS)('renders correct label for day $index ($label)', ({ index, label }) => {
    render(<DayPill day={index} />)
    expect(screen.getByText(label)).toBeDefined()
  })
})

describe('DayPill — interaction', () => {
  it('accepts data-testid', () => {
    render(<DayPill day={1} data-testid="mon-pill" />)
    expect(screen.getByTestId('mon-pill')).toBeDefined()
  })

  it('calls onClick when clicked', () => {
    const onClick = vi.fn()
    render(<DayPill day={3} onClick={onClick} />)
    fireEvent.click(screen.getByText('Wed'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('sets aria-pressed=true when selected', () => {
    render(<DayPill day={0} selected data-testid="pill" />)
    expect(screen.getByTestId('pill').getAttribute('aria-pressed')).toBe('true')
  })

  it('sets aria-pressed=false when not selected', () => {
    render(<DayPill day={0} data-testid="pill" />)
    expect(screen.getByTestId('pill').getAttribute('aria-pressed')).toBe('false')
  })

  it('applies selected styles when selected', () => {
    render(<DayPill day={1} selected data-testid="pill" />)
    expect(screen.getByTestId('pill').className).toContain('bg-primary')
  })

  it('does not apply selected styles when not selected', () => {
    render(<DayPill day={1} data-testid="pill" />)
    expect(screen.getByTestId('pill').className).not.toContain('bg-primary text-white')
  })
})
