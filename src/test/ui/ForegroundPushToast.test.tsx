import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

type Payload = { title?: string; body?: string; data?: Record<string, string> }
let triggers: Array<(p: Payload) => void> = []

vi.mock('@/lib/fcm', () => ({
  onForegroundMessage: (cb: (p: Payload) => void) => {
    triggers.push(cb)
    return () => {
      triggers = triggers.filter((t) => t !== cb)
    }
  },
}))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

import ForegroundPushToast from '@/components/ui/ForegroundPushToast'

function fire(payload: Payload) {
  act(() => {
    for (const t of triggers) t(payload)
  })
}

function mount() {
  return render(
    <MemoryRouter>
      <ForegroundPushToast />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  triggers = []
  mockNavigate.mockReset()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('ForegroundPushToast — admin_broadcast (Slice 1.6)', () => {
  it('renders a primary-tint banner with poster + title + body', () => {
    mount()
    fire({
      data: {
        type: 'admin_broadcast',
        title: 'Spring Fling tickets',
        body: 'Reserve your seat on the shuttle now.',
        slug: 'spring-fling-2026',
        image: 'https://cdn.example.com/spring.jpg',
      },
    })

    const toast = screen.getByTestId('foreground-toast')
    expect(toast).toBeDefined()
    expect(screen.getByText('Spring Fling tickets')).toBeDefined()
    expect(screen.getByText('Reserve your seat on the shuttle now.')).toBeDefined()
    const img = toast.querySelector('img')
    expect(img).not.toBeNull()
    expect(img?.getAttribute('src')).toBe('https://cdn.example.com/spring.jpg')
  })

  it('renders without a poster element when image is absent', () => {
    mount()
    fire({
      data: {
        type: 'admin_broadcast',
        title: 'Heads up',
        body: 'No image on this one.',
        slug: 'no-image',
      },
    })

    const toast = screen.getByTestId('foreground-toast')
    expect(toast.querySelector('img')).toBeNull()
  })

  it('tap navigates to /c/<slug> when slug present', () => {
    mount()
    fire({
      data: {
        type: 'admin_broadcast',
        title: 'Promo',
        body: 'See more',
        slug: 'spring-fling-2026',
      },
    })

    fireEvent.click(screen.getByRole('button'))
    expect(mockNavigate).toHaveBeenCalledWith('/c/spring-fling-2026')
  })

  it('tap falls back to /notifications when slug is missing', () => {
    mount()
    fire({
      data: {
        type: 'admin_broadcast',
        title: 'Untagged',
        body: 'No slug here',
      },
    })

    fireEvent.click(screen.getByRole('button'))
    expect(mockNavigate).toHaveBeenCalledWith('/notifications')
  })

  it('stays visible past the default 6 s dwell (admin gets 10 s)', () => {
    mount()
    fire({
      data: {
        type: 'admin_broadcast',
        title: 'Long-dwell',
        body: '',
        slug: 'x',
      },
    })

    act(() => { vi.advanceTimersByTime(6_500) })
    expect(screen.queryByTestId('foreground-toast')).not.toBeNull()

    act(() => { vi.advanceTimersByTime(4_000) })
    expect(screen.queryByTestId('foreground-toast')).toBeNull()
  })
})

describe('ForegroundPushToast — pre-existing types still work', () => {
  it('payment_received renders + auto-dismisses after 6 s', () => {
    mount()
    fire({
      data: {
        type: 'payment_received',
        title: 'Payment received',
        body: 'Your ride payment cleared.',
        ride_id: 'r1',
      },
    })

    expect(screen.getByText('Payment received')).toBeDefined()
    act(() => { vi.advanceTimersByTime(6_100) })
    expect(screen.queryByTestId('foreground-toast')).toBeNull()
  })

  it('ride_request is dropped (handled by RideRequestNotification)', () => {
    mount()
    fire({
      data: {
        type: 'ride_request',
        title: 'New request',
        body: 'A rider needs you',
        ride_id: 'r2',
      },
    })

    expect(screen.queryByTestId('foreground-toast')).toBeNull()
  })
})
