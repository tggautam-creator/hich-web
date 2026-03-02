import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import InputField from '@/components/ui/InputField'

describe('InputField', () => {
  it('renders without label', () => {
    render(<InputField data-testid="inp" placeholder="Type here" />)
    expect(screen.getByTestId('inp')).toBeDefined()
  })

  it('renders label and associates it with the input', () => {
    render(<InputField label="Full name" data-testid="inp" />)
    const input = screen.getByTestId('inp')
    const label = screen.getByText('Full name')
    expect(label).toBeDefined()
    // label htmlFor should match input id
    expect(label.getAttribute('for')).toBe(input.getAttribute('id'))
  })

  it('shows placeholder text', () => {
    render(<InputField placeholder="Enter your email" />)
    expect(screen.getByPlaceholderText('Enter your email')).toBeDefined()
  })

  it('renders error message with role=alert', () => {
    render(<InputField error="Email is required" data-testid="inp" />)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toBe('Email is required')
  })

  it('marks input as aria-invalid when error is present', () => {
    render(<InputField error="Required" data-testid="inp" />)
    expect(screen.getByTestId('inp').getAttribute('aria-invalid')).toBe('true')
  })

  it('does not show error when no error prop', () => {
    render(<InputField data-testid="inp" />)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByTestId('inp').getAttribute('aria-invalid')).toBeNull()
  })

  it('renders hint text when provided and no error', () => {
    render(<InputField hint="Use your .edu address" data-testid="inp" />)
    expect(screen.getByText('Use your .edu address')).toBeDefined()
  })

  it('hides hint when error is also set', () => {
    render(<InputField hint="Hint" error="Error" data-testid="inp" />)
    expect(screen.queryByText('Hint')).toBeNull()
    expect(screen.getByText('Error')).toBeDefined()
  })

  it('calls onChange when user types', () => {
    const onChange = vi.fn()
    render(<InputField onChange={onChange} data-testid="inp" />)
    fireEvent.change(screen.getByTestId('inp'), { target: { value: 'hello' } })
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('is disabled when disabled prop is passed', () => {
    render(<InputField disabled data-testid="inp" />)
    expect(screen.getByTestId('inp')).toBeDisabled()
  })
})
