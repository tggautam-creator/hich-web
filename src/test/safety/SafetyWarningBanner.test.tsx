/**
 * v1.3 Sprint 11 Slice 4a — SafetyWarningBanner render tests.
 *
 * Banner is intentionally minimal in Slice 4a — Slice 4b replaces
 * it with the full RideSafetyCheckOverlay. These tests pin the
 * accessibility shape + per-surface testid + that the warning
 * timestamp survives the round-trip into the DOM (Slice 4b's
 * countdown ring will anchor to it).
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import SafetyWarningBanner from '@/components/safety/SafetyWarningBanner'

describe('SafetyWarningBanner', () => {
  it('renders with the default test id', () => {
    render(<SafetyWarningBanner firedAt={new Date('2026-06-03T11:00:00.000Z')} />)
    expect(screen.getByTestId('safety-warning-banner')).toBeInTheDocument()
  })

  it('honours a per-surface data-testid', () => {
    render(
      <SafetyWarningBanner
        firedAt={new Date('2026-06-03T11:00:00.000Z')}
        data-testid="safety-warning-banner-rider"
      />,
    )
    expect(screen.getByTestId('safety-warning-banner-rider')).toBeInTheDocument()
  })

  it('exposes role="alert" and aria-live="polite" so SR users are notified', () => {
    render(<SafetyWarningBanner firedAt={new Date()} />)
    const banner = screen.getByTestId('safety-warning-banner')
    expect(banner).toHaveAttribute('role', 'alert')
    expect(banner).toHaveAttribute('aria-live', 'polite')
  })

  it('renders the verbatim title + sub-line copy', () => {
    render(<SafetyWarningBanner firedAt={new Date()} />)
    expect(screen.getByText('Safety check detected — verifying')).toBeInTheDocument()
    expect(
      screen.getByText('Tago is monitoring this ride. Watch for an action prompt.'),
    ).toBeInTheDocument()
  })

  it('round-trips firedAt as data-fired-at so Slice 4b can anchor the countdown', () => {
    const iso = '2026-06-03T11:00:00.000Z'
    render(<SafetyWarningBanner firedAt={new Date(iso)} data-testid="banner-with-fired-at" />)
    expect(screen.getByTestId('banner-with-fired-at')).toHaveAttribute('data-fired-at', iso)
  })
})
