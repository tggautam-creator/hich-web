/**
 * v1.2 Sprint 7 Slice 2 — EditProfileSheet behaviour tests. Mirrors the
 * iOS XCTest coverage on `EditProfileSheet.swift` 1:1 for the cases
 * that map cleanly to web UX (toggle gating, optional clear, write
 * payload shape, driver-only waive visibility).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import EditProfileSheet from '@/components/profile/EditProfileSheet'

// ── Auth store mock ──────────────────────────────────────────────────

const { mockUpdateProfileFields, mockProfile } = vi.hoisted(() => ({
  mockUpdateProfileFields: vi.fn().mockResolvedValue(undefined),
  mockProfile: {
    id:                       'user-1',
    email:                    'test@uni.edu',
    full_name:                'Test User',
    phone:                    '+15551234567',
    avatar_url:               null,
    wallet_balance:           0,
    is_driver:                false,
    rating_avg:               4.7,
    rating_count:             3,
    home_location:            null,
    bio:                      'Existing bio',
    gender:                   'female' as const,
    school:                   'UC Davis',
    major:                    'Computer Science',
    graduation_year:          2027,
    has_accessibility_needs:  false,
    accessibility_profile:    {},
    waive_caregiver_fee:      false,
    created_at:               '2024-01-01T00:00:00Z',
  },
}))

interface AuthSelector<T> { (s: { profile: typeof mockProfile; updateProfileFields: typeof mockUpdateProfileFields }): T }

vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: AuthSelector<unknown>) =>
    selector({ profile: mockProfile, updateProfileFields: mockUpdateProfileFields }),
}))

// ── Portal root for BottomSheet ──────────────────────────────────────

beforeEach(() => {
  mockUpdateProfileFields.mockClear()
  document.body.innerHTML = '<div id="portal-root"></div>'
})

// ── Tests ────────────────────────────────────────────────────────────

describe('EditProfileSheet', () => {
  it('seeds form fields from the current profile when opened', () => {
    render(<EditProfileSheet isOpen={true} onClose={() => {}} />)

    expect((screen.getByTestId('edit-profile-bio') as HTMLTextAreaElement).value).toBe('Existing bio')
    expect((screen.getByTestId('edit-profile-gender') as HTMLSelectElement).value).toBe('female')
    expect((screen.getByTestId('edit-profile-school') as HTMLSelectElement).value).toBe('UC Davis')
    expect((screen.getByTestId('edit-profile-major') as HTMLInputElement).value).toBe('Computer Science')
    expect((screen.getByTestId('edit-profile-graduation-year') as HTMLSelectElement).value).toBe('2027')
    expect((screen.getByTestId('edit-profile-has-access') as HTMLInputElement).checked).toBe(false)
  })

  it('hides sub-rows until the top-level access toggle is on', () => {
    render(<EditProfileSheet isOpen={true} onClose={() => {}} />)

    expect(screen.queryByTestId('edit-profile-needs-wheelchair')).toBeNull()

    fireEvent.click(screen.getByTestId('edit-profile-has-access'))

    expect(screen.getByTestId('edit-profile-needs-wheelchair')).toBeTruthy()
    expect(screen.getByTestId('edit-profile-needs-other')).toBeTruthy()
  })

  it('hides the caregiver subsection until both access + wheelchair are on', () => {
    render(<EditProfileSheet isOpen={true} onClose={() => {}} />)

    fireEvent.click(screen.getByTestId('edit-profile-has-access'))
    expect(screen.queryByTestId('edit-profile-needs-caregiver')).toBeNull()

    fireEvent.click(screen.getByTestId('edit-profile-needs-wheelchair'))
    expect(screen.getByTestId('edit-profile-needs-caregiver')).toBeTruthy()
  })

  it('hides the driver waive section for non-drivers', () => {
    render(<EditProfileSheet isOpen={true} onClose={() => {}} />)
    expect(screen.queryByTestId('edit-profile-waive-caregiver')).toBeNull()
  })

  it('writes the iOS-matching snake_case payload via updateProfileFields on save', async () => {
    const onClose = vi.fn()
    render(<EditProfileSheet isOpen={true} onClose={onClose} />)

    fireEvent.change(screen.getByTestId('edit-profile-bio'), { target: { value: '  New bio  ' } })
    fireEvent.change(screen.getByTestId('edit-profile-major'), { target: { value: 'Music' } })
    fireEvent.click(screen.getByTestId('edit-profile-has-access'))
    fireEvent.click(screen.getByTestId('edit-profile-needs-wheelchair'))
    fireEvent.click(screen.getByTestId('edit-profile-needs-caregiver'))

    fireEvent.click(screen.getByTestId('edit-profile-save'))

    await waitFor(() => {
      expect(mockUpdateProfileFields).toHaveBeenCalledOnce()
    })

    expect(mockUpdateProfileFields).toHaveBeenCalledWith({
      bio:                  'New bio',
      gender:               'female',
      school:               'UC Davis',
      major:                'Music',
      graduationYear:       2027,
      hasAccessibilityNeeds: true,
      accessibilityProfile: {
        needs_wheelchair: true,
        needs_caregiver:  true,
        other_notes:      null,
      },
      waiveCaregiverFee:    false,
    })
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  })

  it('clears bio to null when the field is emptied', async () => {
    render(<EditProfileSheet isOpen={true} onClose={() => {}} />)

    fireEvent.change(screen.getByTestId('edit-profile-bio'), { target: { value: '   ' } })
    fireEvent.click(screen.getByTestId('edit-profile-save'))

    await waitFor(() => {
      expect(mockUpdateProfileFields).toHaveBeenCalledOnce()
    })
    const payload = mockUpdateProfileFields.mock.calls[0]?.[0] as { bio: string | null }
    expect(payload.bio).toBeNull()
  })

  it('surfaces a save error inline without closing the sheet', async () => {
    mockUpdateProfileFields.mockRejectedValueOnce(new Error('RLS denied'))
    const onClose = vi.fn()
    render(<EditProfileSheet isOpen={true} onClose={onClose} />)

    fireEvent.click(screen.getByTestId('edit-profile-save'))

    await waitFor(() => {
      const err = screen.getByTestId('edit-profile-error')
      expect(err.textContent).toContain('RLS denied')
    })
    expect(onClose).not.toHaveBeenCalled()
  })
})

// ── Driver-only waive section ────────────────────────────────────────

describe('EditProfileSheet — driver waive caregiver fee', () => {
  beforeEach(() => {
    mockProfile.is_driver = true
  })

  it('renders the waive toggle when the profile is a driver', () => {
    render(<EditProfileSheet isOpen={true} onClose={() => {}} />)
    expect(screen.getByTestId('edit-profile-waive-caregiver')).toBeTruthy()
  })
})
