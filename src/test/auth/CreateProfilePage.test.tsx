/**
 * Task: Create Profile screen — /onboarding/profile
 *
 * Tests cover:
 *  - Rendering: all fields present
 *  - Full name validation (required)
 *  - Phone validation (required, E.164 format)
 *  - Password validation (min 8 chars, at least 1 number)
 *  - Photo upload is optional (no error without it)
 *  - Submit behavior: calls supabase correctly, navigates on success
 *  - Error display on submit failure
 *
 * Isolated validation helpers are also tested directly.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import CreateProfilePage from '@/components/auth/CreateProfilePage'
import { validateFullName, validatePhone, validatePassword } from '@/lib/validation'

// ── Mocks ─────────────────────────────────────────────────────────────────────
// vi.mock is hoisted to the top of the file, so any variables it references
// must also be hoisted via vi.hoisted().

const {
  mockNavigate,
  mockGetUser,
  mockUpdateUser,
  mockStorageUpload,
  mockStorageGetPublicUrl,
  mockUpsert,
} = vi.hoisted(() => ({
  mockNavigate:           vi.fn(),
  mockGetUser:            vi.fn(),
  mockUpdateUser:         vi.fn(),
  mockStorageUpload:      vi.fn(),
  mockStorageGetPublicUrl: vi.fn(),
  mockUpsert:             vi.fn(),
}))

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => mockNavigate }
})

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getUser:    mockGetUser,
      updateUser: mockUpdateUser,
    },
    from: vi.fn().mockReturnValue({
      upsert: mockUpsert,
    }),
    storage: {
      from: vi.fn().mockReturnValue({
        upload:       mockStorageUpload,
        getPublicUrl: mockStorageGetPublicUrl,
      }),
    },
  },
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderPage() {
  return render(
    <MemoryRouter>
      <CreateProfilePage />
    </MemoryRouter>,
  )
}

/** Fill all required fields with valid values */
function fillValidForm() {
  fireEvent.change(screen.getByTestId('full-name-input'), {
    target: { value: 'Jane Smith' },
  })
  fireEvent.change(screen.getByTestId('phone-input'), {
    target: { value: '+15551234567' },
  })
  fireEvent.change(screen.getByTestId('password-input'), {
    target: { value: 'Password1' },
  })
}

function submitForm() {
  fireEvent.click(screen.getByTestId('submit-button'))
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()

  // Default: successful async mocks
  mockGetUser.mockResolvedValue({ data: { user: { id: 'u-1', email: 'jane@ucdavis.edu' } } })
  mockUpdateUser.mockResolvedValue({ error: null })
  mockUpsert.mockResolvedValue({ error: null })
  mockStorageUpload.mockResolvedValue({ error: null })
  mockStorageGetPublicUrl.mockReturnValue({
    data: { publicUrl: 'https://example.com/avatar.jpg' },
  })
})

// ── Rendering ─────────────────────────────────────────────────────────────────

describe('rendering', () => {
  it('renders the page wrapper', () => {
    renderPage()
    expect(screen.getByTestId('create-profile-page')).toBeDefined()
  })

  it('renders the full name input', () => {
    renderPage()
    expect(screen.getByTestId('full-name-input')).toBeDefined()
  })

  it('renders the phone input', () => {
    renderPage()
    expect(screen.getByTestId('phone-input')).toBeDefined()
  })

  it('renders the password input', () => {
    renderPage()
    expect(screen.getByTestId('password-input')).toBeDefined()
    expect(screen.getByTestId('password-input').getAttribute('type')).toBe('password')
  })

  it('renders the photo upload input', () => {
    renderPage()
    expect(screen.getByTestId('photo-input')).toBeDefined()
    expect(screen.getByTestId('photo-input').getAttribute('type')).toBe('file')
  })

  it('renders the submit button', () => {
    renderPage()
    expect(screen.getByTestId('submit-button')).toBeDefined()
  })
})

// ── validateFullName (pure unit) ──────────────────────────────────────────────

describe('validateFullName — unit', () => {
  it('returns error for empty string', () => {
    expect(validateFullName('')).toBe('Full name is required')
  })

  it('returns error for whitespace only', () => {
    expect(validateFullName('   ')).toBe('Full name is required')
  })

  it('returns undefined for a valid name', () => {
    expect(validateFullName('Jane Smith')).toBeUndefined()
  })

  it('returns undefined for single word name', () => {
    expect(validateFullName('Jane')).toBeUndefined()
  })
})

// ── validatePhone (pure unit) ─────────────────────────────────────────────────

describe('validatePhone — unit', () => {
  it('returns error for empty string', () => {
    expect(validatePhone('')).toBe('Phone number is required')
  })

  it('returns error for plain number without +', () => {
    expect(validatePhone('15551234567')).toMatch(/valid phone/)
  })

  it('returns error for + followed by zero (invalid country code)', () => {
    expect(validatePhone('+0123456789')).toMatch(/valid phone/)
  })

  it('returns error for letters', () => {
    expect(validatePhone('abc')).toMatch(/valid phone/)
  })

  it('returns error for too short (only country code digit)', () => {
    // E.164 needs at least 2 digits after +
    expect(validatePhone('+1')).toMatch(/valid phone/)
  })

  it('accepts a valid US E.164 number', () => {
    expect(validatePhone('+15551234567')).toBeUndefined()
  })

  it('accepts a valid UK E.164 number', () => {
    expect(validatePhone('+447700900000')).toBeUndefined()
  })

  it('accepts a valid Australian E.164 number', () => {
    expect(validatePhone('+61412345678')).toBeUndefined()
  })
})

// ── validatePassword (pure unit) ─────────────────────────────────────────────

describe('validatePassword — unit', () => {
  it('returns error when password is less than 8 characters', () => {
    expect(validatePassword('Pass1')).toMatch(/8 characters/)
  })

  it('returns error when exactly 7 characters', () => {
    expect(validatePassword('Pass12a')).toMatch(/8 characters/)
  })

  it('returns error when 8+ chars but no number', () => {
    expect(validatePassword('Password')).toMatch(/one number/)
  })

  it('accepts exactly 8 chars with a number', () => {
    expect(validatePassword('Passwor1')).toBeUndefined()
  })

  it('accepts longer password with number', () => {
    expect(validatePassword('MySecurePassword2026')).toBeUndefined()
  })

  it('accepts password where number appears first', () => {
    expect(validatePassword('1password')).toBeUndefined()
  })
})

// ── Full name validation — in component ───────────────────────────────────────

describe('full name validation — in component', () => {
  it('shows error when full name is empty on submit', async () => {
    renderPage()
    // Leave full name blank, fill others
    fireEvent.change(screen.getByTestId('phone-input'), { target: { value: '+15551234567' } })
    fireEvent.change(screen.getByTestId('password-input'), { target: { value: 'Password1' } })
    submitForm()
    await waitFor(() => {
      expect(screen.getByText('Full name is required')).toBeDefined()
    })
  })

  it('does not show full name error when name is provided', async () => {
    renderPage()
    fillValidForm()
    submitForm()
    await waitFor(() => {
      expect(screen.queryByText('Full name is required')).toBeNull()
    })
  })
})

// ── Phone validation — in component ──────────────────────────────────────────

describe('phone validation — in component', () => {
  it('shows error for a plain number (no + prefix)', async () => {
    renderPage()
    fireEvent.change(screen.getByTestId('full-name-input'), { target: { value: 'Jane' } })
    fireEvent.change(screen.getByTestId('phone-input'), { target: { value: '5551234567' } })
    fireEvent.change(screen.getByTestId('password-input'), { target: { value: 'Password1' } })
    submitForm()
    await waitFor(() => {
      expect(screen.getByText(/valid phone/)).toBeDefined()
    })
  })

  it('shows error for empty phone', async () => {
    renderPage()
    fireEvent.change(screen.getByTestId('full-name-input'), { target: { value: 'Jane' } })
    fireEvent.change(screen.getByTestId('password-input'), { target: { value: 'Password1' } })
    submitForm()
    await waitFor(() => {
      expect(screen.getByText('Phone number is required')).toBeDefined()
    })
  })

  it('accepts a valid E.164 phone with no error shown', async () => {
    renderPage()
    fillValidForm()
    submitForm()
    await waitFor(() => {
      expect(screen.queryByText(/valid phone/)).toBeNull()
      expect(screen.queryByText('Phone number is required')).toBeNull()
    })
  })
})

// ── Password validation — in component ───────────────────────────────────────

describe('password validation — in component', () => {
  it('shows error when password is less than 8 characters', async () => {
    renderPage()
    fireEvent.change(screen.getByTestId('full-name-input'), { target: { value: 'Jane' } })
    fireEvent.change(screen.getByTestId('phone-input'), { target: { value: '+15551234567' } })
    fireEvent.change(screen.getByTestId('password-input'), { target: { value: 'Pass1' } })
    submitForm()
    await waitFor(() => {
      expect(screen.getByText(/8 characters/)).toBeDefined()
    })
  })

  it('shows error when password has no number', async () => {
    renderPage()
    fireEvent.change(screen.getByTestId('full-name-input'), { target: { value: 'Jane' } })
    fireEvent.change(screen.getByTestId('phone-input'), { target: { value: '+15551234567' } })
    fireEvent.change(screen.getByTestId('password-input'), { target: { value: 'NoNumbers' } })
    submitForm()
    await waitFor(() => {
      expect(screen.getByText(/at least one number/)).toBeDefined()
    })
  })

  it('shows no error for valid password (8+ chars, has number)', async () => {
    renderPage()
    fillValidForm()
    submitForm()
    await waitFor(() => {
      expect(screen.queryByText(/8 characters/)).toBeNull()
      expect(screen.queryByText(/at least one number/)).toBeNull()
    })
  })
})

// ── Photo upload is optional ──────────────────────────────────────────────────

describe('photo upload', () => {
  it('allows submit without a photo — no photo-related error', async () => {
    renderPage()
    fillValidForm()
    submitForm()
    await waitFor(() => {
      expect(screen.queryByTestId('submit-error')).toBeNull()
    })
  })
})

// ── Submit behavior ───────────────────────────────────────────────────────────

describe('submit behavior', () => {
  it('calls supabase.auth.updateUser with the password', async () => {
    renderPage()
    fillValidForm()
    submitForm()
    await waitFor(() => {
      expect(mockUpdateUser).toHaveBeenCalledWith({ password: 'Password1' })
    })
  })

  it('upserts the users row with full_name and phone', async () => {
    renderPage()
    fillValidForm()
    submitForm()
    await waitFor(() => {
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          full_name: 'Jane Smith',
          phone: '+15551234567',
        }),
      )
    })
  })

  it('does NOT call storage upload when no photo is selected', async () => {
    renderPage()
    fillValidForm()
    submitForm()
    await waitFor(() => {
      expect(mockUpdateUser).toHaveBeenCalled()
    })
    expect(mockStorageUpload).not.toHaveBeenCalled()
  })

  it('navigates to /onboarding/location on success', async () => {
    renderPage()
    fillValidForm()
    submitForm()
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/onboarding/location')
    })
  })

  it('shows submit error when updateUser returns an error', async () => {
    mockUpdateUser.mockResolvedValue({ error: { message: 'Weak password' } })
    renderPage()
    fillValidForm()
    submitForm()
    await waitFor(() => {
      expect(screen.getByTestId('submit-error')).toBeDefined()
    })
  })

  it('shows submit error when upsert fails', async () => {
    mockUpsert.mockResolvedValue({ error: { message: 'DB error' } })
    renderPage()
    fillValidForm()
    submitForm()
    await waitFor(() => {
      expect(screen.getByTestId('submit-error')).toBeDefined()
    })
  })

  it('shows loading state while submitting', async () => {
    // Make updateUser take a tick so loading state is observable
    mockUpdateUser.mockImplementation(
      () => new Promise(resolve => { setTimeout(() => { resolve({ error: null }) }, 50) }),
    )
    renderPage()
    fillValidForm()
    submitForm()
    // Should be loading immediately after click
    expect(screen.getByTestId('submit-button')).toBeDisabled()
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalled()
    })
  })
})
