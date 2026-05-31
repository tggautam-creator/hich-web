import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import MultiRiderSubtitle from '@/components/ride/MultiRiderSubtitle'

describe('MultiRiderSubtitle', () => {
  it('renders nothing when otherRidersCount is 0 (solo ride)', () => {
    const { container } = render(
      <MultiRiderSubtitle otherRidersCount={0} phase="active" />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when otherRidersCount is negative (defensive)', () => {
    const { container } = render(
      <MultiRiderSubtitle otherRidersCount={-1} phase="active" />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders "Shared trip · 1 other on this route" during enroute phase (singular)', () => {
    render(<MultiRiderSubtitle otherRidersCount={1} phase="enroute" />)
    // Verbatim against iOS MultiRiderSubtitle.swift:26
    expect(
      screen.getByText('Shared trip · 1 other on this route'),
    ).toBeInTheDocument()
  })

  it('renders "Shared trip · N others on this route" during enroute phase (plural)', () => {
    render(<MultiRiderSubtitle otherRidersCount={3} phase="enroute" />)
    expect(
      screen.getByText('Shared trip · 3 others on this route'),
    ).toBeInTheDocument()
  })

  it('renders "Shared ride · 1 other aboard" during active phase (singular)', () => {
    render(<MultiRiderSubtitle otherRidersCount={1} phase="active" />)
    // Verbatim against iOS MultiRiderSubtitle.swift:28
    expect(screen.getByText('Shared ride · 1 other aboard')).toBeInTheDocument()
  })

  it('renders "Shared ride · N others aboard" during active phase (plural)', () => {
    render(<MultiRiderSubtitle otherRidersCount={4} phase="active" />)
    expect(screen.getByText('Shared ride · 4 others aboard')).toBeInTheDocument()
  })

  it('exposes the default data-testid', () => {
    render(<MultiRiderSubtitle otherRidersCount={1} phase="active" />)
    expect(screen.getByTestId('multi-rider-subtitle')).toBeInTheDocument()
  })

  it('accepts a custom data-testid override', () => {
    render(
      <MultiRiderSubtitle
        otherRidersCount={1}
        phase="active"
        data-testid="custom-pill"
      />,
    )
    expect(screen.getByTestId('custom-pill')).toBeInTheDocument()
    expect(screen.queryByTestId('multi-rider-subtitle')).not.toBeInTheDocument()
  })
})
