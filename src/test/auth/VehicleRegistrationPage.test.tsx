import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import VehicleRegistrationPage from '@/components/auth/VehicleRegistrationPage'
import { validateVin, validateYear } from '@/lib/validation'

// ── Mocks ────────────────────────────────────────────────────────────────────
const {
  mockNavigate, mockGetUser, mockGetSession, mockStorageUpload, mockStorageGetPublicUrl,
  mockInsert, mockEq, mockUpdate,
} = vi.hoisted(() => {
  const mockEq = vi.fn()
  const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
  return {
    mockNavigate: vi.fn(),
    mockGetUser: vi.fn(),
    mockGetSession: vi.fn(),
    mockStorageUpload: vi.fn(),
    mockStorageGetPublicUrl: vi.fn(),
    mockInsert: vi.fn(),
    mockEq,
    mockUpdate,
  }
})

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => mockNavigate }
})

vi.mock('@/lib/vin', () => ({
  guessBodyType: () => 'sedan',
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: mockGetUser,
      getSession: mockGetSession,
    },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'vehicles') return { insert: mockInsert }
      if (table === 'users') return { update: mockUpdate }
      return {}
    }),
    storage: {
      from: vi.fn().mockReturnValue({
        upload: mockStorageUpload,
        getPublicUrl: mockStorageGetPublicUrl,
      }),
    },
  },
}))

// ── Helpers ──────────────────────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks()
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'u-1', email: 'test@ucdavis.edu' } },
  })
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: 'test-token' } },
  })
  mockStorageUpload.mockResolvedValue({ error: null })
  mockStorageGetPublicUrl.mockReturnValue({
    data: { publicUrl: 'https://storage.example.com/car.jpg' },
  })
  mockInsert.mockResolvedValue({ error: null })
  mockEq.mockResolvedValue({ error: null })
})

function renderPage() {
  return render(
    <MemoryRouter>
      <VehicleRegistrationPage />
    </MemoryRouter>,
  )
}

/** Fill all required fields with valid data (photos are optional, omitted here). */
function fillValidForm() {
  fireEvent.change(screen.getByTestId('plate-input'), { target: { value: 'ABC1234' } })
  fireEvent.change(screen.getByTestId('make-input'), { target: { value: 'Honda' } })
  fireEvent.change(screen.getByTestId('model-input'), { target: { value: 'Accord' } })
  fireEvent.change(screen.getByTestId('year-input'), { target: { value: '2020' } })
  fireEvent.click(screen.getByTestId('color-blue'))
}

/** Fill required fields + both optional photos. */
function fillValidFormWithPhotos() {
  fillValidForm()
  const carFile = new File(['car'], 'car.jpg', { type: 'image/jpeg' })
  fireEvent.change(screen.getByTestId('car-photo-input'), { target: { files: [carFile] } })
  const licFile = new File(['lic'], 'license.jpg', { type: 'image/jpeg' })
  fireEvent.change(screen.getByTestId('license-photo-input'), { target: { files: [licFile] } })
}

// ── Unit tests for validators ────────────────────────────────────────────────
describe('validateVin', () => {
  it('returns undefined for empty string (VIN is optional)', () => {
    expect(validateVin('')).toBeUndefined()
  })

  it('returns error for too short (non-empty)', () => {
    expect(validateVin('ABCDEF1234567890')).toBe('VIN must be 17 alphanumeric characters')
  })

  it('returns error for too long', () => {
    expect(validateVin('ABCDEF12345678901X')).toBe('VIN must be 17 alphanumeric characters')
  })

  it('returns error for non-alphanumeric', () => {
    expect(validateVin('ABCDEF123456789!!')).toBe('VIN must be 17 alphanumeric characters')
  })

  it('returns undefined for valid 17-char alphanumeric', () => {
    expect(validateVin('1HGBH41JXMN109186')).toBeUndefined()
  })

  it('accepts lowercase (case insensitive)', () => {
    expect(validateVin('1hgbh41jxmn109186')).toBeUndefined()
  })

  it('trims whitespace', () => {
    expect(validateVin('  1HGBH41JXMN109186  ')).toBeUndefined()
  })
})

describe('validateYear', () => {
  it('returns error for empty string', () => {
    expect(validateYear('')).toBe('Year is required')
  })

  it('returns error for non-numeric', () => {
    expect(validateYear('abc')).toBe('Enter a valid year')
  })

  it('returns error for year below 1990', () => {
    expect(validateYear('1989')).toBe('Year must be between 1990 and 2026')
  })

  it('returns error for year above 2026', () => {
    expect(validateYear('2027')).toBe('Year must be between 1990 and 2026')
  })

  it('returns undefined for 1990', () => {
    expect(validateYear('1990')).toBeUndefined()
  })

  it('returns undefined for 2026', () => {
    expect(validateYear('2026')).toBeUndefined()
  })

  it('returns undefined for 2020', () => {
    expect(validateYear('2020')).toBeUndefined()
  })

  it('returns error for decimal', () => {
    expect(validateYear('2020.5')).toBe('Enter a valid year')
  })
})

// ── Rendering tests ──────────────────────────────────────────────────────────
describe('VehicleRegistrationPage', () => {
  describe('rendering', () => {
    it('renders the page', () => {
      renderPage()
      expect(screen.getByTestId('vehicle-registration-page')).toBeDefined()
    })

    it('shows heading', () => {
      renderPage()
      expect(screen.getByText('Register your vehicle')).toBeDefined()
    })

    it('renders all input fields', () => {
      renderPage()
      expect(screen.getByTestId('plate-input')).toBeDefined()
      expect(screen.getByTestId('plate-state-select')).toBeDefined()
      expect(screen.getByTestId('vin-input')).toBeDefined()
      expect(screen.getByTestId('make-input')).toBeDefined()
      expect(screen.getByTestId('model-input')).toBeDefined()
      expect(screen.getByTestId('year-input')).toBeDefined()
    })

    it('renders 10 color swatches', () => {
      renderPage()
      const colors = ['white', 'silver', 'gray', 'black', 'red', 'blue', 'green', 'brown', 'beige', 'gold']
      colors.forEach((c) => {
        expect(screen.getByTestId(`color-${c}`)).toBeDefined()
      })
    })

    it('renders file inputs', () => {
      renderPage()
      expect(screen.getByTestId('car-photo-input')).toBeDefined()
      expect(screen.getByTestId('license-photo-input')).toBeDefined()
    })

    it('renders seats stepper defaulting to 2', () => {
      renderPage()
      expect(screen.getByTestId('seats-value').textContent).toBe('2')
    })

    it('renders state selector defaulting to CA', () => {
      renderPage()
      expect((screen.getByTestId('plate-state-select') as HTMLSelectElement).value).toBe('CA')
    })
  })

  // ── Seats stepper ────────────────────────────────────────────────────────
  describe('seats stepper', () => {
    it('increments seats', () => {
      renderPage()
      fireEvent.click(screen.getByTestId('seats-increment'))
      expect(screen.getByTestId('seats-value').textContent).toBe('3')
    })

    it('decrements seats', () => {
      renderPage()
      fireEvent.click(screen.getByTestId('seats-decrement'))
      expect(screen.getByTestId('seats-value').textContent).toBe('1')
    })

    it('does not go below 1', () => {
      renderPage()
      fireEvent.click(screen.getByTestId('seats-decrement'))  // 2 → 1
      fireEvent.click(screen.getByTestId('seats-decrement'))  // should stay 1
      expect(screen.getByTestId('seats-value').textContent).toBe('1')
    })

    it('does not go above 4', () => {
      renderPage()
      fireEvent.click(screen.getByTestId('seats-increment'))  // 2 → 3
      fireEvent.click(screen.getByTestId('seats-increment'))  // 3 → 4
      fireEvent.click(screen.getByTestId('seats-increment'))  // should stay 4
      expect(screen.getByTestId('seats-value').textContent).toBe('4')
    })

    it('disables decrement at 1', () => {
      renderPage()
      fireEvent.click(screen.getByTestId('seats-decrement'))  // 2 → 1
      expect(screen.getByTestId('seats-decrement')).toBeDisabled()
    })

    it('disables increment at 4', () => {
      renderPage()
      fireEvent.click(screen.getByTestId('seats-increment'))  // 2 → 3
      fireEvent.click(screen.getByTestId('seats-increment'))  // 3 → 4
      expect(screen.getByTestId('seats-increment')).toBeDisabled()
    })
  })

  // ── Color swatch ─────────────────────────────────────────────────────────
  describe('color swatch', () => {
    it('selects a color and shows the name', () => {
      renderPage()
      fireEvent.click(screen.getByTestId('color-red'))
      expect(screen.getByTestId('selected-color').textContent).toBe('Red')
    })

    it('sets aria-pressed on selected color', () => {
      renderPage()
      fireEvent.click(screen.getByTestId('color-blue'))
      expect(screen.getByTestId('color-blue').getAttribute('aria-pressed')).toBe('true')
      expect(screen.getByTestId('color-red').getAttribute('aria-pressed')).toBe('false')
    })
  })

  // ── Validation on submit ─────────────────────────────────────────────────
  describe('validation', () => {
    it('shows errors when submitting empty form', async () => {
      renderPage()
      await act(async () => {
        fireEvent.click(screen.getByTestId('submit-button'))
      })
      // VIN is optional — no error for empty VIN
      expect(screen.queryByText('VIN is required')).toBeNull()
      expect(screen.getByText('Make is required')).toBeDefined()
      expect(screen.getByText('Model is required')).toBeDefined()
      expect(screen.getByText('Year is required')).toBeDefined()
      expect(screen.getByText('License plate is required')).toBeDefined()
      expect(screen.getByText('Please select a car color')).toBeDefined()
      // photos are optional — no required errors
      expect(screen.queryByText('Car photo is required')).toBeNull()
      expect(screen.queryByText('License plate photo is required')).toBeNull()
    })

    it('shows VIN error for invalid VIN', async () => {
      renderPage()
      fireEvent.change(screen.getByTestId('vin-input'), { target: { value: 'SHORT' } })
      await act(async () => {
        fireEvent.click(screen.getByTestId('submit-button'))
      })
      expect(screen.getByText('VIN must be 17 alphanumeric characters')).toBeDefined()
    })

    it('shows year error for out-of-range year', async () => {
      renderPage()
      fireEvent.change(screen.getByTestId('year-input'), { target: { value: '1989' } })
      await act(async () => {
        fireEvent.click(screen.getByTestId('submit-button'))
      })
      expect(screen.getByText('Year must be between 1990 and 2026')).toBeDefined()
    })

    it('does not call supabase when validation fails', async () => {
      renderPage()
      await act(async () => {
        fireEvent.click(screen.getByTestId('submit-button'))
      })
      expect(mockGetUser).not.toHaveBeenCalled()
    })
  })

  // ── Successful submit ────────────────────────────────────────────────────
  describe('successful submit', () => {
    it('inserts vehicle, updates user, and navigates without photos', async () => {
      renderPage()
      fillValidForm()

      await act(async () => {
        fireEvent.click(screen.getByTestId('submit-button'))
      })

      await waitFor(() => {
        // No uploads when no photos selected
        expect(mockStorageUpload).not.toHaveBeenCalled()
        // Inserted vehicle
        expect(mockInsert).toHaveBeenCalledTimes(1)
        const insertArg = mockInsert.mock.calls[0][0] as Record<string, unknown>
        expect(insertArg.vin).toBeNull() // VIN not provided — stored as null
        expect(insertArg.make).toBe('Honda')
        expect(insertArg.model).toBe('Accord')
        expect(insertArg.year).toBe(2020)
        expect(insertArg.color).toBe('Blue')
        expect(insertArg.seats_available).toBe(2)
        expect(insertArg.car_photo_url).toBeNull()
        expect(insertArg.license_plate_photo_url).toBeNull()
        // Updated user is_driver
        expect(mockUpdate).toHaveBeenCalledWith({ is_driver: true })
        // Navigated
        expect(mockNavigate).toHaveBeenCalledWith('/stripe/onboarding')
      })
    })

    it('uploads both photos when provided', async () => {
      renderPage()
      fillValidFormWithPhotos()

      await act(async () => {
        fireEvent.click(screen.getByTestId('submit-button'))
      })

      await waitFor(() => {
        expect(mockStorageUpload).toHaveBeenCalledTimes(2)
      })
    })

    it('stores license photo path (not public URL) when provided', async () => {
      renderPage()
      fillValidFormWithPhotos()

      await act(async () => {
        fireEvent.click(screen.getByTestId('submit-button'))
      })

      await waitFor(() => {
        const insertArg = mockInsert.mock.calls[0][0] as Record<string, unknown>
        // license_plate_photo_url should be a storage path, NOT a public URL
        expect(insertArg.license_plate_photo_url).toMatch(/^u-1-/)
        expect(insertArg.license_plate_photo_url).not.toContain('https://')
      })
    })

    it('stores public URL for car photo when provided', async () => {
      renderPage()
      fillValidFormWithPhotos()

      await act(async () => {
        fireEvent.click(screen.getByTestId('submit-button'))
      })

      await waitFor(() => {
        const insertArg = mockInsert.mock.calls[0][0] as Record<string, unknown>
        expect(insertArg.car_photo_url).toBe('https://storage.example.com/car.jpg')
      })
    })
  })

  // ── Error handling ───────────────────────────────────────────────────────
  describe('error handling', () => {
    it('shows error when not authenticated', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } })
      renderPage()
      fillValidForm()

      await act(async () => {
        fireEvent.click(screen.getByTestId('submit-button'))
      })

      await waitFor(() => {
        expect(screen.getByTestId('submit-error').textContent).toContain(
          'Not authenticated',
        )
      })
    })

    it('shows error when vehicle insert fails', async () => {
      mockInsert.mockResolvedValue({ error: { message: 'DB insert failed' } })
      renderPage()
      fillValidForm()

      await act(async () => {
        fireEvent.click(screen.getByTestId('submit-button'))
      })

      await waitFor(() => {
        expect(screen.getByTestId('submit-error').textContent).toBe('DB insert failed')
      })
    })

    it('shows error when photo upload fails', async () => {
      mockStorageUpload.mockResolvedValue({ error: { message: 'Upload quota exceeded' } })
      renderPage()
      fillValidFormWithPhotos()  // must include photos so upload is attempted

      await act(async () => {
        fireEvent.click(screen.getByTestId('submit-button'))
      })

      await waitFor(() => {
        expect(screen.getByTestId('submit-error').textContent).toBe('Upload quota exceeded')
      })
    })
  })

  // ── File input display ───────────────────────────────────────────────────
  describe('file inputs', () => {
    it('shows car photo filename after selection', () => {
      renderPage()
      const file = new File(['img'], 'my-car.png', { type: 'image/png' })
      fireEvent.change(screen.getByTestId('car-photo-input'), { target: { files: [file] } })
      expect(screen.getByTestId('car-photo-name').textContent).toBe('my-car.png')
    })

    it('shows license photo filename after selection', () => {
      renderPage()
      const file = new File(['img'], 'plate.jpg', { type: 'image/jpeg' })
      fireEvent.change(screen.getByTestId('license-photo-input'), { target: { files: [file] } })
      expect(screen.getByTestId('license-photo-name').textContent).toBe('plate.jpg')
    })
  })
})
