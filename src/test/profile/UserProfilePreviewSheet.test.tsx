/**
 * v1.3 Sprint 10 Slice 5 — UserProfilePreviewSheet behavior tests.
 *
 * Coverage:
 *   • Sheet renders nothing when isOpen=false
 *   • With initialProfile seed → card renders instantly (no spinner)
 *   • Without seed → skeleton renders with fallback name + avatar
 *   • Successful fetch upgrades the card (bio + vehicle + member-since)
 *   • Fetch error WITH seed → keeps seeded card, no error state
 *   • Fetch error WITHOUT seed → renders error state with Try again
 *   • Try again refires the fetch
 *
 * The Card itself (badges, school chip, vehicle row, bio section)
 * is exercised end-to-end through this sheet's success path; no
 * separate Card-only test file because every code path on the Card
 * is reachable from the sheet's profile data fixture.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import UserProfilePreviewSheet from '@/components/profile/UserProfilePreviewSheet'
import type { PublicProfile } from '@/lib/publicProfile'

const { mockGetSession, mockFetch } = vi.hoisted(() => ({
  mockGetSession: vi.fn().mockResolvedValue({
    data: { session: { access_token: 'tok' } },
  }),
  mockFetch: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: mockGetSession } },
}))

beforeEach(() => {
  mockFetch.mockReset()
  vi.stubGlobal('fetch', mockFetch)
})

function makeProfile(overrides: Partial<PublicProfile> = {}): PublicProfile {
  return {
    id: 'u-1',
    full_name: 'Alex Driver',
    avatar_url: 'https://example/alex.jpg',
    is_driver: true,
    rating_avg: 4.9,
    rating_count: 47,
    rides_completed: 23,
    bio: 'Studying CS; happy to share my commute on Tue/Thu.',
    gender: null,
    school: 'UC Davis',
    major: 'Computer Science',
    graduation_year: 2027,
    has_accessibility_needs: false,
    needs_wheelchair: false,
    waive_caregiver_fee: false,
    member_since: '2026-04-15T12:00:00Z',
    vehicle: {
      make: 'Toyota',
      model: 'Camry',
      color: 'Silver',
      year: 2021,
      plate_last4: '4242',
      wheelchair_capable: false,
      trunk_size: 'medium',
    },
    ...overrides,
  }
}

describe('UserProfilePreviewSheet', () => {
  it('renders nothing when isOpen=false', () => {
    render(
      <UserProfilePreviewSheet
        isOpen={false}
        onClose={() => {}}
        userId="u-1"
      />,
    )
    expect(screen.queryByTestId('user-profile-preview')).toBeNull()
    expect(screen.queryByTestId('user-profile-preview-skeleton')).toBeNull()
  })

  it('with initialProfile seed → card renders immediately (no spinner)', async () => {
    // Even though fetch may resolve later, the seeded card shows now.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeProfile(),
    })
    render(
      <UserProfilePreviewSheet
        isOpen
        onClose={() => {}}
        userId="u-1"
        initialProfile={makeProfile()}
      />,
    )
    expect(screen.getByTestId('user-profile-preview')).toBeInTheDocument()
    expect(screen.queryByTestId('user-profile-preview-skeleton')).toBeNull()
    expect(screen.getByText('Alex Driver')).toBeInTheDocument()
  })

  it('without seed → skeleton renders with fallback name + avatar', () => {
    // Hold the fetch indefinitely so we observe the skeleton.
    mockFetch.mockReturnValueOnce(new Promise(() => {}))
    render(
      <UserProfilePreviewSheet
        isOpen
        onClose={() => {}}
        userId="u-1"
        fallbackName="Sarah"
        fallbackAvatarUrl="https://example/sarah.jpg"
      />,
    )
    expect(screen.getByTestId('user-profile-preview-skeleton')).toBeInTheDocument()
    expect(screen.getByText('Sarah')).toBeInTheDocument()
  })

  it('successful fetch upgrades the seeded card with bio + vehicle + meta', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeProfile(),
    })
    // Seed with only a name (no bio / vehicle / meta), then assert
    // the fetch fills those fields in.
    render(
      <UserProfilePreviewSheet
        isOpen
        onClose={() => {}}
        userId="u-1"
        initialProfile={makeProfile({
          bio: null,
          vehicle: null,
          rides_completed: 0,
          member_since: '',
        })}
      />,
    )
    // Seeded fields visible immediately
    expect(screen.getByText('Alex Driver')).toBeInTheDocument()
    expect(screen.queryByTestId('user-profile-preview-bio')).toBeNull()
    expect(screen.queryByTestId('user-profile-preview-vehicle')).toBeNull()

    // After fetch resolves, upgraded fields appear
    await waitFor(() => screen.getByTestId('user-profile-preview-bio'))
    expect(screen.getByText('Studying CS; happy to share my commute on Tue/Thu.')).toBeInTheDocument()
    expect(screen.getByTestId('user-profile-preview-vehicle')).toBeInTheDocument()
    expect(screen.getByText('2021 Silver Toyota Camry')).toBeInTheDocument()
    expect(screen.getByText('Plate ••4242')).toBeInTheDocument()
    expect(screen.getByTestId('user-profile-preview-meta')).toBeInTheDocument()
    expect(screen.getByText(/Member since Apr 2026/)).toBeInTheDocument()
    expect(screen.getByText(/23 rides on Tago/)).toBeInTheDocument()
  })

  it('renders school chip when school/major/graduation_year are present', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => makeProfile() })
    render(
      <UserProfilePreviewSheet
        isOpen
        onClose={() => {}}
        userId="u-1"
        initialProfile={makeProfile()}
      />,
    )
    const chip = screen.getByTestId('user-profile-preview-school-chip')
    expect(chip.textContent).toBe("UC Davis · Computer Science · '27")
  })

  it('renders the right badges based on is_driver / needs_wheelchair / waive_caregiver_fee flags', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeProfile({
        is_driver: true,
        needs_wheelchair: true,
        waive_caregiver_fee: true,
      }),
    })
    render(
      <UserProfilePreviewSheet
        isOpen
        onClose={() => {}}
        userId="u-1"
        initialProfile={makeProfile({
          is_driver: true,
          needs_wheelchair: true,
          waive_caregiver_fee: true,
        })}
      />,
    )
    const badges = screen.getByTestId('user-profile-preview-badges')
    expect(badges.textContent).toContain('Driver')
    expect(badges.textContent).toContain('Mobility aid access')
    expect(badges.textContent).toContain('Waives caregiver fee')
  })

  it('renders "New on Tago" when rating_count=0', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeProfile({ rating_avg: null, rating_count: 0 }),
    })
    render(
      <UserProfilePreviewSheet
        isOpen
        onClose={() => {}}
        userId="u-1"
        initialProfile={makeProfile({ rating_avg: null, rating_count: 0 })}
      />,
    )
    expect(screen.getByText('New on Tago')).toBeInTheDocument()
  })

  it('fetch error WITH seed → keeps seeded card, no error state', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: { code: 'INTERNAL', message: 'boom' } }),
    })
    render(
      <UserProfilePreviewSheet
        isOpen
        onClose={() => {}}
        userId="u-1"
        initialProfile={makeProfile()}
      />,
    )
    // Card visible from seed
    expect(screen.getByTestId('user-profile-preview')).toBeInTheDocument()
    // Wait for fetch to attempt + fail
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    // Error state does NOT replace the card
    expect(screen.queryByTestId('user-profile-preview-error')).toBeNull()
    expect(screen.getByTestId('user-profile-preview')).toBeInTheDocument()
  })

  it('fetch error WITHOUT seed → renders error state with Try again button', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: { code: 'NOT_FOUND', message: 'User not found' } }),
    })
    render(
      <UserProfilePreviewSheet
        isOpen
        onClose={() => {}}
        userId="missing-user"
      />,
    )
    await waitFor(() => screen.getByTestId('user-profile-preview-error'))
    expect(screen.getByText('User not found')).toBeInTheDocument()
    expect(screen.getByTestId('user-profile-preview-retry')).toBeInTheDocument()
  })

  it('Try again button fires the fetch a second time', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: { message: 'transient' } }),
    })
    render(
      <UserProfilePreviewSheet
        isOpen
        onClose={() => {}}
        userId="u-1"
      />,
    )
    await waitFor(() => screen.getByTestId('user-profile-preview-retry'))
    expect(mockFetch).toHaveBeenCalledTimes(1)

    // Second fetch succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeProfile(),
    })
    fireEvent.click(screen.getByTestId('user-profile-preview-retry'))
    await waitFor(() => screen.getByTestId('user-profile-preview'))
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(screen.queryByTestId('user-profile-preview-error')).toBeNull()
  })
})
