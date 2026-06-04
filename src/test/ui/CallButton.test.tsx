/**
 * v1.3 Sprint 12 Slice 3 — CallButton unit tests.
 *
 * Pins the three-mode contract: enabled (`tel:` href + green capsule),
 * disabled ("Phone unavailable", no href, not focusable) and desktop
 * fallback (clipboard write + toast).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import CallButton from '@/components/ui/CallButton'

const mockMatchMedia = vi.fn()
const mockWriteText = vi.fn().mockResolvedValue(undefined)

beforeEach(() => {
  vi.useFakeTimers()
  Object.defineProperty(window, 'matchMedia', { writable: true, value: mockMatchMedia })
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: mockWriteText },
  })
  mockMatchMedia.mockReturnValue({ matches: false })
  mockWriteText.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('CallButton', () => {
  it('renders enabled state with tel: href and "Call <firstName>" label when phone is present', () => {
    render(<CallButton partnerName="Casey Lin" phone="+15551234567" />)
    const btn = screen.getByTestId('call-button')
    expect(btn).toHaveAttribute('href', 'tel:+15551234567')
    expect(btn).toHaveAttribute('data-enabled', 'true')
    expect(btn).toHaveTextContent('Call Casey')
    expect(btn).toHaveAttribute('aria-label', 'Call Casey Lin')
  })

  it('strips formatting chars from the tel: href (preserves digits + leading +)', () => {
    render(<CallButton partnerName="Casey" phone="+1 (555) 867-5309" />)
    expect(screen.getByTestId('call-button')).toHaveAttribute('href', 'tel:+15558675309')
  })

  it('renders disabled state with "Phone unavailable" + no href when phone is null', () => {
    render(<CallButton partnerName="Casey" phone={null} />)
    const btn = screen.getByTestId('call-button')
    expect(btn).not.toHaveAttribute('href')
    expect(btn).toHaveAttribute('data-enabled', 'false')
    expect(btn).toHaveTextContent('Phone unavailable')
    expect(btn).toHaveAttribute('aria-label', 'Phone number not available')
    expect(btn).toHaveAttribute('tabindex', '-1')
  })

  it('renders disabled state when phone is just whitespace', () => {
    render(<CallButton partnerName="Casey" phone="   " />)
    expect(screen.getByTestId('call-button')).toHaveAttribute('data-enabled', 'false')
  })

  it('falls back to "Call" label when no partner name supplied', () => {
    render(<CallButton phone="+15551234567" />)
    expect(screen.getByTestId('call-button')).toHaveTextContent('Call')
  })

  it('on desktop tap: prevents the tel: navigation, copies number to clipboard, flashes a toast', async () => {
    mockMatchMedia.mockReturnValue({ matches: false }) // (any-pointer: coarse) → false → desktop
    render(<CallButton partnerName="Casey" phone="+15551234567" />)
    const btn = screen.getByTestId('call-button')
    fireEvent.click(btn)
    await act(async () => { await Promise.resolve() })
    expect(mockWriteText).toHaveBeenCalledWith('+15551234567')
    expect(screen.getByTestId('call-button-toast')).toHaveTextContent('Number copied: +15551234567')
  })

  it('on mobile tap: lets the tel: link fire natively (does not preventDefault)', () => {
    mockMatchMedia.mockReturnValue({ matches: true }) // (any-pointer: coarse) → true → mobile
    render(<CallButton partnerName="Casey" phone="+15551234567" />)
    const btn = screen.getByTestId('call-button')
    const evt = new MouseEvent('click', { bubbles: true, cancelable: true })
    btn.dispatchEvent(evt)
    expect(evt.defaultPrevented).toBe(false)
    expect(mockWriteText).not.toHaveBeenCalled()
  })

  it('toast auto-dismisses after 2400ms', async () => {
    render(<CallButton partnerName="Casey" phone="+15551234567" />)
    fireEvent.click(screen.getByTestId('call-button'))
    await act(async () => { await Promise.resolve() })
    expect(screen.getByTestId('call-button-toast')).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(2400) })
    expect(screen.queryByTestId('call-button-toast')).not.toBeInTheDocument()
  })

  it('renders compact size with tighter padding when size="compact"', () => {
    render(<CallButton partnerName="Casey" phone="+15551234567" size="compact" />)
    const btn = screen.getByTestId('call-button')
    expect(btn.className).toContain('text-xs')
  })
})
