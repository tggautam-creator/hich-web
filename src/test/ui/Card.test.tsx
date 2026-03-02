import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import Card from '@/components/ui/Card'

describe('Card', () => {
  it('renders children', () => {
    render(<Card>Hello card</Card>)
    expect(screen.getByText('Hello card')).toBeDefined()
  })

  it('accepts data-testid', () => {
    render(<Card data-testid="my-card">Content</Card>)
    expect(screen.getByTestId('my-card')).toBeDefined()
  })

  it('merges extra className', () => {
    render(<Card className="mt-4" data-testid="c">Content</Card>)
    expect(screen.getByTestId('c').className).toContain('mt-4')
  })

  it('removes padding when noPadding is true', () => {
    render(<Card noPadding data-testid="c">Content</Card>)
    expect(screen.getByTestId('c').className).not.toContain('p-4')
  })

  it('includes padding by default', () => {
    render(<Card data-testid="c">Content</Card>)
    expect(screen.getByTestId('c').className).toContain('p-4')
  })

  it('passes through arbitrary HTML attributes', () => {
    render(<Card data-testid="c" role="article">Content</Card>)
    expect(screen.getByRole('article')).toBeDefined()
  })
})
