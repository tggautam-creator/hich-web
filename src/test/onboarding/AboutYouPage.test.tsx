/**
 * v1.2 Sprint 7 Slice 5 — AboutYouPage onboarding step behaviour.
 * Mirrors the iOS XCTest coverage on `AboutYouPage.swift` for the
 * cases that map cleanly to web (seeding, gating, Continue + Skip
 * routing, payload shape, caregiver hint).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import AboutYouPage from '@/components/onboarding/AboutYouPage'

// ── Mocks ────────────────────────────────────────────────────────────

const { mockNavigate, mockUpdate, mockProfile } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockUpdate:   vi.fn().mockResolvedValue(undefined),
  mockProfile: {
    id:                       'user-1',
    email:                    'maya@uni.edu',
    full_name:                'Maya',
    phone:                    '+15551234567',
    avatar_url:               null,
    wallet_balance:           0,
    is_driver:                false,
    rating_avg:               null,
    rating_count:             0,
    home_location:            null,
    bio:                      null as string | null,
    gender:                   null as 'female' | null,
    school:                   null as string | null,
    major:                    null as string | null,
    graduation_year:          null as number | null,
    has_accessibility_needs:  false,
    accessibility_profile:    {} as Record<string, unknown>,
    waive_caregiver_fee:      false,
    created_at:               '2024-01-01T00:00:00Z',
  },
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

interface AuthState {
  profile:              typeof mockProfile
  updateProfileFields:  typeof mockUpdate
}

vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: AuthState) => unknown) =>
    selector({ profile: mockProfile, updateProfileFields: mockUpdate }),
}))

beforeEach(() => {
  mockNavigate.mockClear()
  mockUpdate.mockClear()
  // Reset seed-able fields between tests
  mockProfile.bio                     = null
  mockProfile.gender                  = null
  mockProfile.school                  = null
  mockProfile.major                   = null
  mockProfile.graduation_year         = null
  mockProfile.has_accessibility_needs = false
  mockProfile.accessibility_profile   = {}
  mockProfile.waive_caregiver_fee     = false
})

function renderPage() {
  return render(
    <MemoryRouter>
      <AboutYouPage />
    </MemoryRouter>,
  )
}

// ── Tests ────────────────────────────────────────────────────────────

describe('AboutYouPage', () => {
  it('renders the page with all 3 sections + Continue + Skip', () => {
    renderPage()
    expect(screen.getByText('Tell us about you')).toBeTruthy()
    expect(screen.getByTestId('about-you-bio')).toBeTruthy()
    expect(screen.getByTestId('about-you-gender')).toBeTruthy()
    expect(screen.getByTestId('about-you-school')).toBeTruthy()
    expect(screen.getByTestId('about-you-major')).toBeTruthy()
    expect(screen.getByTestId('about-you-graduation-year')).toBeTruthy()
    expect(screen.getByTestId('about-you-has-access')).toBeTruthy()
    expect(screen.getByTestId('about-you-continue')).toBeTruthy()
    expect(screen.getByTestId('about-you-skip')).toBeTruthy()
  })

  it('hides access-needs sub-rows until the top toggle is on', () => {
    renderPage()
    expect(screen.queryByTestId('about-you-needs-wheelchair')).toBeNull()

    fireEvent.click(screen.getByTestId('about-you-has-access'))

    expect(screen.getByTestId('about-you-needs-wheelchair')).toBeTruthy()
    expect(screen.getByTestId('about-you-needs-other')).toBeTruthy()
  })

  it('hides the caregiver sub-toggle until both access + wheelchair are on', () => {
    renderPage()
    fireEvent.click(screen.getByTestId('about-you-has-access'))
    expect(screen.queryByTestId('about-you-needs-caregiver')).toBeNull()

    fireEvent.click(screen.getByTestId('about-you-needs-wheelchair'))
    expect(screen.getByTestId('about-you-needs-caregiver')).toBeTruthy()
  })

  it('shows "We\'ll set up your caregiver next." hint when wheelchair + caregiver are on', () => {
    renderPage()
    fireEvent.click(screen.getByTestId('about-you-has-access'))
    fireEvent.click(screen.getByTestId('about-you-needs-wheelchair'))
    expect(screen.queryByTestId('about-you-caregiver-hint')).toBeNull()

    fireEvent.click(screen.getByTestId('about-you-needs-caregiver'))
    expect(screen.getByTestId('about-you-caregiver-hint')).toBeTruthy()
  })

  it('seeds form from the profile on mount', () => {
    mockProfile.bio                     = 'Existing'
    mockProfile.gender                  = 'female'
    mockProfile.school                  = 'UC Davis'
    mockProfile.major                   = 'CS'
    mockProfile.graduation_year         = 2027
    mockProfile.has_accessibility_needs = true
    mockProfile.accessibility_profile   = { needs_wheelchair: true, needs_caregiver: false }

    renderPage()

    expect((screen.getByTestId('about-you-bio') as HTMLTextAreaElement).value).toBe('Existing')
    expect((screen.getByTestId('about-you-gender') as HTMLSelectElement).value).toBe('female')
    expect((screen.getByTestId('about-you-school') as HTMLSelectElement).value).toBe('UC Davis')
    expect((screen.getByTestId('about-you-major') as HTMLInputElement).value).toBe('CS')
    expect((screen.getByTestId('about-you-graduation-year') as HTMLSelectElement).value).toBe('2027')
    expect((screen.getByTestId('about-you-has-access') as HTMLInputElement).checked).toBe(true)
    expect((screen.getByTestId('about-you-needs-wheelchair') as HTMLInputElement).checked).toBe(true)
  })

  it('Skip navigates to /onboarding/location without writing', () => {
    renderPage()
    fireEvent.click(screen.getByTestId('about-you-skip'))
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockNavigate).toHaveBeenCalledWith('/onboarding/location', { replace: true })
  })

  it('Continue writes the iOS-matching snake_case payload + navigates forward', async () => {
    renderPage()

    fireEvent.change(screen.getByTestId('about-you-bio'),   { target: { value: '  New bio  ' } })
    fireEvent.change(screen.getByTestId('about-you-major'), { target: { value: 'Music' } })
    fireEvent.click(screen.getByTestId('about-you-has-access'))
    fireEvent.click(screen.getByTestId('about-you-needs-wheelchair'))
    fireEvent.click(screen.getByTestId('about-you-needs-caregiver'))
    fireEvent.click(screen.getByTestId('about-you-continue'))

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledOnce())
    expect(mockUpdate).toHaveBeenCalledWith({
      bio:                  'New bio',
      gender:               null,
      school:               null,
      major:                'Music',
      graduationYear:       null,
      hasAccessibilityNeeds: true,
      accessibilityProfile: {
        needs_wheelchair: true,
        needs_caregiver:  true,
        other_notes:      null,
      },
      waiveCaregiverFee:    false,
    })
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/onboarding/location', { replace: true }),
    )
  })

  it('preserves driver waive_caregiver_fee state when continuing', async () => {
    mockProfile.is_driver           = true
    mockProfile.waive_caregiver_fee = true
    renderPage()
    fireEvent.click(screen.getByTestId('about-you-continue'))
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledOnce())
    const payload = mockUpdate.mock.calls[0]?.[0] as { waiveCaregiverFee: boolean }
    expect(payload.waiveCaregiverFee).toBe(true)
  })

  it('surfaces a save error inline without navigating', async () => {
    mockUpdate.mockRejectedValueOnce(new Error('RLS denied'))
    renderPage()
    fireEvent.click(screen.getByTestId('about-you-continue'))
    await waitFor(() => {
      expect(screen.getByTestId('about-you-error').textContent).toContain('RLS denied')
    })
    expect(mockNavigate).not.toHaveBeenCalled()
  })
})
