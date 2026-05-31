import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TodaysAnytimeBanner from '@/components/ride/TodaysAnytimeBanner'

describe('TodaysAnytimeBanner', () => {
  it('renders the single-ride headline + destination subhead verbatim (iOS parity)', () => {
    render(
      <TodaysAnytimeBanner
        rideCount={1}
        firstRideHeadline="Sacramento"
        onTap={() => {}}
      />,
    )
    // Verbatim against iOS TodaysAnytimeBanner.swift:62-63
    expect(screen.getByText(`Today's the day!`)).toBeInTheDocument()
    // Verbatim against iOS TodaysAnytimeBanner.swift:71
    expect(
      screen.getByText(`Your anytime ride to Sacramento is scheduled today.`),
    ).toBeInTheDocument()
  })

  it('renders the destination-missing fallback subhead verbatim', () => {
    render(
      <TodaysAnytimeBanner rideCount={1} firstRideHeadline={null} onTap={() => {}} />,
    )
    expect(screen.getByText(`Today's the day!`)).toBeInTheDocument()
    // Verbatim against iOS TodaysAnytimeBanner.swift:73
    expect(
      screen.getByText(
        `Your anytime ride is scheduled today. Open Tago when you're ready to head out.`,
      ),
    ).toBeInTheDocument()
  })

  it('renders the multi-ride copy verbatim with count substitution', () => {
    render(
      <TodaysAnytimeBanner
        rideCount={3}
        firstRideHeadline="Sacramento"
        onTap={() => {}}
      />,
    )
    // Verbatim against iOS TodaysAnytimeBanner.swift:62 (multi branch)
    expect(
      screen.getByText(`Today's the day — 3 anytime rides`),
    ).toBeInTheDocument()
    // Verbatim against iOS TodaysAnytimeBanner.swift:68
    expect(
      screen.getByText(`Open Tago when you're ready to head out.`),
    ).toBeInTheDocument()
    // Multi-ride branch ignores the firstRideHeadline so the
    // destination should NOT appear in the subhead.
    expect(
      screen.queryByText(/Your anytime ride to Sacramento/),
    ).not.toBeInTheDocument()
  })

  it('fires onTap when the user clicks the banner', async () => {
    const onTap = vi.fn()
    render(
      <TodaysAnytimeBanner rideCount={1} firstRideHeadline="Davis" onTap={onTap} />,
    )
    await userEvent.click(screen.getByTestId('rides-anytime-today-banner'))
    expect(onTap).toHaveBeenCalledTimes(1)
  })

  it('matches iOS accessibility identifier on default data-testid', () => {
    render(
      <TodaysAnytimeBanner rideCount={1} firstRideHeadline={null} onTap={() => {}} />,
    )
    // iOS sets .accessibilityIdentifier("rides-anytime-today-banner")
    expect(screen.getByTestId('rides-anytime-today-banner')).toBeInTheDocument()
  })

  it('accepts a custom data-testid override', () => {
    render(
      <TodaysAnytimeBanner
        rideCount={1}
        firstRideHeadline={null}
        onTap={() => {}}
        data-testid="custom-anytime-banner"
      />,
    )
    expect(screen.getByTestId('custom-anytime-banner')).toBeInTheDocument()
    expect(
      screen.queryByTestId('rides-anytime-today-banner'),
    ).not.toBeInTheDocument()
  })
})
