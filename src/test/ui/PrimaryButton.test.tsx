import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import PrimaryButton from '@/components/ui/PrimaryButton'

describe('PrimaryButton', () => {
  it('renders children', () => {
    render(<PrimaryButton>Get a ride</PrimaryButton>)
    expect(screen.getByText('Get a ride')).toBeDefined()
  })

  it('accepts data-testid', () => {
    render(<PrimaryButton data-testid="cta-btn">Go</PrimaryButton>)
    expect(screen.getByTestId('cta-btn')).toBeDefined()
  })

  it('calls onClick when clicked', () => {
    const onClick = vi.fn()
    render(<PrimaryButton onClick={onClick}>Click me</PrimaryButton>)
    fireEvent.click(screen.getByText('Click me'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('is disabled when disabled prop is passed', () => {
    render(<PrimaryButton disabled>Disabled</PrimaryButton>)
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('does not call onClick when disabled', () => {
    const onClick = vi.fn()
    render(<PrimaryButton disabled onClick={onClick}>No click</PrimaryButton>)
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('is disabled and shows loading text when isLoading', () => {
    render(<PrimaryButton isLoading>Submit</PrimaryButton>)
    expect(screen.getByRole('button')).toBeDisabled()
    expect(screen.getByText(/Loading/)).toBeDefined()
  })

  it('merges custom className', () => {
    render(<PrimaryButton className="custom-class" data-testid="btn">Go</PrimaryButton>)
    expect(screen.getByTestId('btn').className).toContain('custom-class')
  })
})
