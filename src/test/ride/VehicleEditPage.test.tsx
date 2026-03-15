import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import VehicleEditPage from '@/components/ride/VehicleEditPage'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }))

const mockVehicle = {
  id: 'v-1',
  user_id: 'u-1',
  vin: '1HGCM82633A123456',
  make: 'Honda',
  model: 'Accord',
  year: 2020,
  color: 'Silver',
  plate: 'ABC1234',
  car_photo_url: null,
  license_plate_photo_url: null,
  seats_available: 2,
  fuel_efficiency_mpg: 30,
  is_active: true,
}

const mockSingle = vi.fn().mockResolvedValue({ data: mockVehicle, error: null })
const mockLimit = vi.fn(() => ({ single: mockSingle }))
const mockEqActive = vi.fn(() => ({ limit: mockLimit }))
const mockEqUser = vi.fn(() => ({ eq: mockEqActive }))
const mockSelect = vi.fn(() => ({ eq: mockEqUser }))
const mockUpdate = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'vehicles') {
        return { select: mockSelect, update: mockUpdate }
      }
      return { select: vi.fn(), update: vi.fn() }
    },
    storage: {
      from: () => ({
        upload: vi.fn().mockResolvedValue({ error: null }),
        getPublicUrl: () => ({ data: { publicUrl: 'https://example.com/photo.jpg' } }),
      }),
    },
  },
}))

vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: { profile: { id: string } }) => unknown) =>
    selector({ profile: { id: 'u-1' } }),
}))

describe('VehicleEditPage', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
    mockSingle.mockResolvedValue({ data: mockVehicle, error: null })
  })

  it('renders the page', async () => {
    render(<VehicleEditPage />)
    // Wait for loading to finish
    const heading = await screen.findByText('Edit Vehicle')
    expect(heading).toBeDefined()
  })

  it('shows vehicle info (read-only)', async () => {
    render(<VehicleEditPage />)
    await screen.findByText('Edit Vehicle')
    expect(screen.getByText('2020 Honda Accord')).toBeDefined()
    expect(screen.getByText('VIN: 1HGCM82633A123456')).toBeDefined()
  })

  it('pre-populates plate input', async () => {
    render(<VehicleEditPage />)
    await screen.findByText('Edit Vehicle')
    const plateInput = screen.getByTestId('plate-input') as HTMLInputElement
    expect(plateInput.value).toBe('ABC1234')
  })

  it('navigates back on button click', async () => {
    render(<VehicleEditPage />)
    await screen.findByText('Edit Vehicle')
    fireEvent.click(screen.getByTestId('back-button'))
    expect(mockNavigate).toHaveBeenCalledWith('/profile')
  })

  it('shows no vehicle message when none found', async () => {
    mockSingle.mockResolvedValueOnce({ data: null, error: null })
    render(<VehicleEditPage />)
    const msg = await screen.findByText('No vehicle found')
    expect(msg).toBeDefined()
  })
})
