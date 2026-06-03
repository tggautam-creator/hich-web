/**
 * v1.3 Sprint 11 Slice 6 — Toast component + useToast hook tests.
 *
 * Mirrors iOS EmergencySheet.flashToast: 2400ms visible window,
 * auto-dismiss, new flash before timer expires resets the countdown.
 * Keyed render so React unmounts + re-mounts for a fresh fade-in.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { renderHook } from '@testing-library/react'
import Toast, { useToast } from '@/components/ui/Toast'

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Toast', () => {
  it('renders with the message + default testid', () => {
    render(<Toast toastKey={1} message="Link copied" />)
    const toast = screen.getByTestId('toast')
    expect(toast).toHaveTextContent('Link copied')
    expect(toast).toHaveAttribute('role', 'status')
    expect(toast).toHaveAttribute('aria-live', 'polite')
  })

  it('honours a per-call data-testid', () => {
    render(<Toast toastKey={1} message="x" data-testid="emergency-toast" />)
    expect(screen.getByTestId('emergency-toast')).toBeInTheDocument()
  })
})

describe('useToast', () => {
  it('starts with toast=null', () => {
    const { result } = renderHook(() => useToast())
    expect(result.current.toast).toBeNull()
  })

  it('flash() sets the toast with the message + increments key on each call', () => {
    const { result } = renderHook(() => useToast())
    act(() => { result.current.flash('Link copied') })
    expect(result.current.toast?.message).toBe('Link copied')
    const firstKey = result.current.toast?.key
    act(() => { result.current.flash('Tracking link turned off') })
    expect(result.current.toast?.message).toBe('Tracking link turned off')
    expect(result.current.toast?.key).not.toBe(firstKey)
  })

  it('auto-dismisses after 2400ms (mirrors iOS flashToast cadence)', async () => {
    const { result } = renderHook(() => useToast())
    act(() => { result.current.flash('Link copied') })
    expect(result.current.toast).not.toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(2500) })
    expect(result.current.toast).toBeNull()
  })

  it('dismiss() clears the toast + cancels the timer', () => {
    const { result } = renderHook(() => useToast())
    act(() => { result.current.flash('Link copied') })
    act(() => { result.current.dismiss() })
    expect(result.current.toast).toBeNull()
  })

  it('flash() before the previous timer fires resets the countdown', async () => {
    const { result } = renderHook(() => useToast())
    act(() => { result.current.flash('Link copied') })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(result.current.toast?.message).toBe('Link copied')
    act(() => { result.current.flash('Tracking link turned off') })
    // 1500ms after the second flash — first flash would have
    // expired but the second flash reset the timer.
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(result.current.toast?.message).toBe('Tracking link turned off')
  })
})
