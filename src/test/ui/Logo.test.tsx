import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import Logo from '@/components/ui/Logo'

describe('Logo', () => {
  it('renders with default medium size', () => {
    render(<Logo />)
    const logo = screen.getByTestId('logo')
    expect(logo).toBeDefined()
    const img = logo.querySelector('img')
    expect(img?.getAttribute('width')).toBe('48')
    expect(img?.getAttribute('height')).toBe('48')
  })

  it('renders small size', () => {
    render(<Logo size="sm" />)
    const img = screen.getByTestId('logo').querySelector('img')
    expect(img?.getAttribute('width')).toBe('32')
  })

  it('renders large size with text', () => {
    render(<Logo size="lg" />)
    const logo = screen.getByTestId('logo')
    const img = logo.querySelector('img')
    expect(img?.getAttribute('width')).toBe('80')
    expect(logo.textContent).toContain('TAGO')
  })

  it('does not show text at medium size', () => {
    render(<Logo />)
    const logo = screen.getByTestId('logo')
    expect(logo.textContent).not.toContain('TAGO')
  })

  it('accepts custom data-testid', () => {
    render(<Logo data-testid="custom-logo" />)
    expect(screen.getByTestId('custom-logo')).toBeDefined()
  })

  it('uses /logo-transparent.png as image source', () => {
    render(<Logo />)
    const img = screen.getByTestId('logo').querySelector('img')
    expect(img?.getAttribute('src')).toBe('/logo-transparent.png')
  })
})
