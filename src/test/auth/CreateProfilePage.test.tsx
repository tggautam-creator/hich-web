/**
 * Task: Create Profile screen — /onboarding/profile
 *
 * Tests cover:
 *  - Rendering: all fields present including country code selector
 *  - Full name validation (required)
 *  - Phone validation: combines country dial code + local number into E.164
 *  - Password validation (min 8 chars, at least 1 number)
 *  - Photo upload is optional (no error without it)
 *  - Submit behavior: calls supabase correctly, navigates on success
 *  - Returning user path: update().eq().select() returns a row → no insert
 *  - New user path: update finds nothing → insert is called
 *  - Same-password error from Supabase is swallowed (returning user)
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

const {
  mockNavigate,
  mockGetUser,
  mockUpdateUser,
  mockStorageUpload,
  mockStorageGetPublicUrl,
  mockDbUpdate,
  mockDbSelect,
  mockDbInsert,
} = vi.hoisted(() => ({
  mockNavigate:            vi.fn(),
  mockGetUser:             vi.fn(),
  mockUpdateUser:          vi.fn(),
  mockStorageUpload:       vi.fn(),
  mockStorageGetPublicUrl: vi.fn(),
  mockDbUpdate:  vi.fn(),
  mockDbSelect:  vi.fn(),
  mockDbInsert:  vi.fn(),
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
      update: mockDbUpdate,
      insert: mockDbInsert,
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

/**
 * Fill all required fields. Phone uses local number only (country code
 * defaults to US +1, so the combined E.164 becomes +15551234567).
 */
function fillValidForm() {
  fireEvent.change(screen.getByTestId('full-name-input'), {
    target: { value: 'Jane Smith' },
  })
  fireEvent.change(screen.getByTestId('phone-input'), {
    target: { value: '5551234567' },
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

  // Default: returning user — update finds an existing row
  mockDbSelect.mockResolvedValue({ data: [{ id: 'u-1' }], error: null })
  mockDbUpdate.mockReturnValue({
    eq: vi.fn().mockReturnValue({
      select: mockDbSelect,
    }),
  })
  mockDbInsert.mockResolvedValue({ error: null })

  mockGetUser.mockResolvedValue({ data: { user: { id: 'u-1', email: 'jane@ucdavis.edu' } } })
  mockUpdateUser.mockResolvedValue({ error: null })
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

  it('renders the country code selector defaulting to US', () => {
    renderPage()
    const select = screen.getByTestId('country-code-select') as HTMLSelectElement
    expect(select).toBeDefined()
    expect(select.value).toBe('US')
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

// ── Phone validation — combined E.164 ────────────────────────────────────────

describe('phone validation — in component', () => {
  it('shows error when local phone is empty (combined E.164 is just the dial code)', async () => {
    renderPage()
    fireEvent.change(screen.getByTestId('full-name-input'), { target: { value: 'Jane' } })
    // leave phone empty
    fireEvent.change(screen.getByTestId('password-input'), { target: { value: 'Password1' } })
    submitForm()
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined()
    })
  })

  it('shows error when local phone has no digits (combined is dial code only)', async () => {
    renderPage()
    fireEvent.change(screen.getByTestId('full-name-input'), { target: { value: 'Jane' } })
    fireEvent.change(screen.getByTestId('phone-input'), { target: { value: '   ' } })
    fireEvent.change(screen.getByTestId('password-input'), { target: { value: 'Password1' } })
    submitForm()
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined()
    })
  })

  it('accepts a valid local number with US country code (+1)', async () => {
    renderPage()
    fillValidForm()   // uses 5551234567 → +15551234567
    submitForm()
    await waitFor(() => {
      expect(screen.queryByText(/valid phone/)).toBeNull()
    })
  })

  it('changes country code via selector', () => {
    renderPage()
    const select = screen.getByTestId('country-code-select') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'GB' } })
    expect(select.value).toBe('GB')
  })
})

// ── Full name validation — in component ───────────────────────────────────────

describe('full name validation — in component', () => {
  it('shows error when full name is empty on submit', async () => {
    renderPage()
    fireEvent.change(screen.getByTestId('phone-input'), { target: { value: '5551234567' } })
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

// ── Password validation — in component ───────────────────────────────────────

describe('password validation — in component', () => {
  it('shows error when password is less than 8 characters', async () => {
    renderPage()
    fireEvent.change(screen.getByTestId('full-name-input'), { target: { value: 'Jane' } })
    fireEvent.change(screen.getByTestId('phone-input'), { target: { value: '5551234567' } })
    fireEvent.change(screen.getByTestId('password-input'), { target: { value: 'Pass1' } })
    submitForm()
    await waitFor(() => {
      expect(screen.getByText(/8 characters/)).toBeDefined()
    })
  })

  it('shows error when password has no number', async () => {
    renderPage()
    fireEvent.change(screen.getByTestId('full-name-input'), { target: { value: 'Jane' } })
    fireEvent.change(screen.getByTestId('phone-input'), { target: { value: '5551234567' } })
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

  it('stores the full E.164 phone (dial code + local number) in the DB', async () => {
    renderPage()
    fillValidForm()   // US (+1) + 5551234567 → +15551234567
    submitForm()
    await waitFor(() => {
      expect(mockDbUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          full_name: 'Jane Smith',
          phone:     '+15551234567',
        }),
      )
    })
  })

  it('uses the correct dial code when a non-US country is selected', async () => {
    renderPage()
    fireEvent.change(screen.getByTestId('country-code-select'), { target: { value: 'GB' } })
    fireEvent.change(screen.getByTestId('full-name-input'),     { target: { value: 'Jane' } })
    fireEvent.change(screen.getByTestId('phone-input'),         { target: { value: '7700900000' } })
    fireEvent.change(screen.getByTestId('password-input'),      { target: { value: 'Password1' } })
    submitForm()
    await waitFor(() => {
      expect(mockDbUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ phone: '+447700900000' }),
      )
    })
  })

  it('does NOT call insert when update finds an existing row', async () => {
    renderPage()
    fillValidForm()
    submitForm()
    await waitFor(() => { expect(mockNavigate).toHaveBeenCalled() })
    expect(mockDbInsert).not.toHaveBeenCalled()
  })

  it('calls insert when update finds no existing row (new-user path)', async () => {
    mockDbSelect.mockResolvedValue({ data: [], error: null })
    renderPage()
    fillValidForm()
    submitForm()
    await waitFor(() => {
      expect(mockDbInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          id:        'u-1',
          email:     'jane@ucdavis.edu',
          full_name: 'Jane Smith',
          phone:     '+15551234567',
        }),
      )
    })
  })

  it('swallows "same password" error from Supabase and continues', async () => {
    mockUpdateUser.mockResolvedValue({
      error: { message: 'New password should be different from the old password.' },
    })
    renderPage()
    fillValidForm()
    submitForm()
    // Should still navigate — the same-password error is not fatal
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/onboarding/location', { replace: true })
    })
    expect(screen.queryByTestId('submit-error')).toBeNull()
  })

  it('does NOT swallow unrelated auth errors', async () => {
    mockUpdateUser.mockResolvedValue({
      error: { message: 'Rate limit exceeded' },
    })
    renderPage()
    fillValidForm()
    submitForm()
    await waitFor(() => {
      expect(screen.getByTestId('submit-error')).toBeDefined()
    })
  })

  it('does NOT call storage upload when no photo is selected', async () => {
    renderPage()
    fillValidForm()
    submitForm()
    await waitFor(() => { expect(mockUpdateUser).toHaveBeenCalled() })
    expect(mockStorageUpload).not.toHaveBeenCalled()
  })

  it('navigates to /onboarding/location on success', async () => {
    renderPage()
    fillValidForm()
    submitForm()
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/onboarding/location', { replace: true })
    })
  })

  it('shows submit error when updateUser returns an unrecognised error', async () => {
    mockUpdateUser.mockResolvedValue({ error: { message: 'Weak password' } })
    renderPage()
    fillValidForm()
    submitForm()
    await waitFor(() => {
      expect(screen.getByTestId('submit-error')).toBeDefined()
    })
  })

  it('shows submit error when update fails', async () => {
    mockDbSelect.mockResolvedValue({ data: null, error: { message: 'DB error' } })
    renderPage()
    fillValidForm()
    submitForm()
    await waitFor(() => {
      expect(screen.getByTestId('submit-error')).toBeDefined()
    })
  })

  it('shows submit error when insert fails (new-user path)', async () => {
    mockDbSelect.mockResolvedValue({ data: [], error: null })
    mockDbInsert.mockResolvedValue({ error: { message: 'Insert failed' } })
    renderPage()
    fillValidForm()
    submitForm()
    await waitFor(() => {
      expect(screen.getByTestId('submit-error')).toBeDefined()
    })
  })

  it('shows loading state while submitting', async () => {
    mockUpdateUser.mockImplementation(
      () => new Promise(resolve => { setTimeout(() => { resolve({ error: null }) }, 50) }),
    )
    renderPage()
    fillValidForm()
    submitForm()
    expect(screen.getByTestId('submit-button')).toBeDisabled()
    await waitFor(() => { expect(mockNavigate).toHaveBeenCalled() })
  })
})
