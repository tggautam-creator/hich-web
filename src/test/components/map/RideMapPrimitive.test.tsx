/**
 * v1.3 Sprint 10 Slice 3 — unit tests for the shared `RideMapPrimitive`
 * extracted from TransitSuggestionCard. Pure refactor — verifies the
 * primitive's contract without asserting on user-visible behavior
 * (there is none; iOS-parity surface is N/A for this slice per
 * CLAUDE.md mandatory-exception clause).
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import RideMapPrimitive from '@/components/map/RideMapPrimitive'

// Stub @vis.gl/react-google-maps so we don't need a real map API key.
vi.mock('@vis.gl/react-google-maps', () => ({
  Map: ({ children, ...props }: Record<string, unknown>) => (
    <div data-testid="google-map" {...(props as Record<string, string>)}>
      {children as React.ReactNode}
    </div>
  ),
  useMap: () => null,
}))

vi.mock('@/components/map/RoutePreview', () => ({
  MapBoundsFitter: ({ points }: { points: Array<{ lat: number; lng: number }> }) => (
    <div data-testid="bounds-fitter" data-points={points.length} />
  ),
}))

describe('RideMapPrimitive', () => {
  it('renders the wrapper div with the supplied data-testid', () => {
    render(<RideMapPrimitive data-testid="my-map" />)
    expect(screen.getByTestId('my-map')).toBeInTheDocument()
  })

  it('renders a <Map> shell inside the wrapper', () => {
    render(<RideMapPrimitive data-testid="m" />)
    const wrapper = screen.getByTestId('m')
    expect(wrapper.querySelector('[data-testid="google-map"]')).not.toBeNull()
  })

  it('forwards `children` into the Map (markers/polylines stay caller-owned)', () => {
    render(
      <RideMapPrimitive data-testid="m">
        <div data-testid="caller-pin" />
      </RideMapPrimitive>,
    )
    expect(screen.getByTestId('caller-pin')).toBeInTheDocument()
  })

  it('mounts <MapBoundsFitter> when boundsPoints has entries', () => {
    render(
      <RideMapPrimitive
        data-testid="m"
        boundsPoints={[{ lat: 37.7, lng: -122.4 }, { lat: 38.5, lng: -121.7 }]}
      />,
    )
    const fitter = screen.getByTestId('bounds-fitter')
    expect(fitter.getAttribute('data-points')).toBe('2')
  })

  it('does NOT mount <MapBoundsFitter> when boundsPoints is empty or omitted', () => {
    const { rerender } = render(<RideMapPrimitive data-testid="m" />)
    expect(screen.queryByTestId('bounds-fitter')).toBeNull()

    rerender(<RideMapPrimitive data-testid="m" boundsPoints={[]} />)
    expect(screen.queryByTestId('bounds-fitter')).toBeNull()
  })

  it('applies the supplied className + height style to the wrapper', () => {
    render(
      <RideMapPrimitive
        data-testid="m"
        className="rounded-2xl border border-border"
        height="180px"
      />,
    )
    const wrapper = screen.getByTestId('m')
    expect(wrapper.className).toContain('rounded-2xl')
    expect(wrapper.className).toContain('border')
    expect(wrapper.getAttribute('style')).toContain('height')
    expect(wrapper.getAttribute('style')).toContain('180px')
  })

  it('defaults height to 180px when omitted (matches iOS RideBoardTransitMiniMap.swift)', () => {
    render(<RideMapPrimitive data-testid="m" />)
    expect(screen.getByTestId('m').getAttribute('style')).toContain('180px')
  })

  it('renders without throwing when panTo is null (peek mode disabled)', () => {
    render(<RideMapPrimitive data-testid="m" panTo={null} />)
    expect(screen.getByTestId('m')).toBeInTheDocument()
  })

  it('renders without throwing when panTo is a coord (peek mode enabled — pan happens via useMap effect, no DOM assertion)', () => {
    render(<RideMapPrimitive data-testid="m" panTo={{ lat: 37.83, lng: -122.27 }} />)
    expect(screen.getByTestId('m')).toBeInTheDocument()
  })

  it('forwards defaultZoom + gestureHandling to the Map element', () => {
    render(<RideMapPrimitive data-testid="m" defaultZoom={15} />)
    const map = screen.getByTestId('google-map')
    // Our Map mock spreads props onto the dom element, so we can read
    // them as attrs. React only spreads known attribute conventions —
    // disableDefaultUI is a boolean prop and may or may not appear as
    // an attribute depending on the React-DOM version; that's not load-
    // bearing for the primitive's contract (the real Map component
    // honors them). We assert the props that DO reliably serialize.
    expect(map.getAttribute('gestureHandling')).toBe('greedy')
    expect(map.getAttribute('defaultZoom')).toBe('15')
  })
})
