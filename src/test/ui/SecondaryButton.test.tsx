import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import SecondaryButton from '@/components/ui/SecondaryButton'

describe('SecondaryButton', () => {
  it('renders children', () => {
    render(<SecondaryButton>Cancel</SecondaryButton>)
    expect(screen.getByText('Cancel')).toBeDefined()
  })

  it('accepts data-testid', () => {
    render(<SecondaryButton data-testid="sec-btn">Cancel</SecondaryButton>)
    expect(screen.getByTestId('sec-btn')).toBeDefined()
  })

  it('calls onClick when clicked', () => {
    const onClick = vi.fn()
    render(<SecondaryButton onClick={onClick}>Cancel</SecondaryButton>)
    fireEvent.click(screen.getByText('Cancel'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('is disabled when disabled prop is passed', () => {
    render(<SecondaryButton disabled>Disabled</SecondaryButton>)
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('does not call onClick when disabled', () => {
    const onClick = vi.fn()
    render(<SecondaryButton disabled onClick={onClick}>No</SecondaryButton>)
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('is disabled and shows loading text when isLoading', () => {
    render(<SecondaryButton isLoading>Save</SecondaryButton>)
    expect(screen.getByRole('button')).toBeDisabled()
    expect(screen.getByText(/Loading/)).toBeDefined()
  })

  it('merges custom className', () => {
    render(<SecondaryButton className="extra" data-testid="sb">Go</SecondaryButton>)
    expect(screen.getByTestId('sb').className).toContain('extra')
  })
})
