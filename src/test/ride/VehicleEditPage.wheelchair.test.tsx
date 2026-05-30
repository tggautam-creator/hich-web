/**
 * v1.2 Sprint 7 Slice 3 — VehicleEditPage wheelchair / trunk-size
 * auto-derivation. Pins the contract: toggle ON without an explicit
 * trunk_size derives from body_type; toggle OFF nulls trunk_size; the
 * submit payload reflects both fields.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import VehicleEditPage from '@/components/ride/VehicleEditPage'

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useParams:   () => ({ vehicleId: 'v-1' }),
}))

const baseVehicle = {
  id:                  'v-1',
  user_id:             'u-1',
  vin:                 '1HGCM82633A123456',
  make:                'Honda',
  model:               'Accord',
  year:                2020,
  color:               'Silver',
  plate:               'ABC1234',
  car_photo_url:       null,
  seats_available:     2,
  fuel_efficiency_mpg: 30,
  is_active:           true,
  body_type:           'suv',   // → derives to 'medium'
  deleted_at:          null,
  wheelchair_capable:  false,
  trunk_size:          null,
}

const {
  mockSingle,
  mockUpdate,
  capturedUpdates,
} = vi.hoisted(() => ({
  mockSingle:      vi.fn(),
  mockUpdate:      vi.fn(),
  capturedUpdates: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'vehicles') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: mockSingle }) }),
          update: (payload: Record<string, unknown>) => {
            capturedUpdates.push(payload)
            mockUpdate(payload)
            return { eq: vi.fn().mockResolvedValue({ error: null }) }
          },
        }
      }
      return { select: vi.fn(), update: vi.fn() }
    },
    storage: {
      from: () => ({
        upload:        vi.fn().mockResolvedValue({ error: null }),
        getPublicUrl: () => ({ data: { publicUrl: 'https://example.com/photo.jpg' } }),
      }),
    },
  },
}))

vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: { profile: { id: string } }) => unknown) =>
    selector({ profile: { id: 'u-1' } }),
}))

beforeEach(() => {
  capturedUpdates.length = 0
  mockUpdate.mockClear()
  mockSingle.mockReset()
})

describe('VehicleEditPage — mobility-aid space', () => {
  it('hides the trunk-size picker by default for a non-wheelchair vehicle', async () => {
    mockSingle.mockResolvedValue({ data: { ...baseVehicle }, error: null })
    render(<VehicleEditPage />)
    await screen.findByText('Edit Vehicle')

    expect((screen.getByTestId('wheelchair-capable-toggle') as HTMLInputElement).checked).toBe(false)
    expect(screen.queryByTestId('trunk-size-picker')).toBeNull()
  })

  it('reveals the picker pre-derived from body_type when toggled on', async () => {
    mockSingle.mockResolvedValue({ data: { ...baseVehicle, body_type: 'suv' }, error: null })
    render(<VehicleEditPage />)
    await screen.findByText('Edit Vehicle')

    fireEvent.click(screen.getByTestId('wheelchair-capable-toggle'))

    expect(screen.getByTestId('trunk-size-picker')).toBeTruthy()
    expect(screen.getByTestId('trunk-size-medium').getAttribute('aria-checked')).toBe('true')
  })

  it('seeds picker from existing wheelchair vehicle row', async () => {
    mockSingle.mockResolvedValue({
      data: { ...baseVehicle, wheelchair_capable: true, trunk_size: 'large' },
      error: null,
    })
    render(<VehicleEditPage />)
    await screen.findByText('Edit Vehicle')

    expect((screen.getByTestId('wheelchair-capable-toggle') as HTMLInputElement).checked).toBe(true)
    expect(screen.getByTestId('trunk-size-large').getAttribute('aria-checked')).toBe('true')
  })

  it('submits with wheelchair_capable=true + derived trunk_size when newly toggled on', async () => {
    mockSingle.mockResolvedValue({ data: { ...baseVehicle, body_type: 'minivan' }, error: null })
    render(<VehicleEditPage />)
    await screen.findByText('Edit Vehicle')

    fireEvent.click(screen.getByTestId('wheelchair-capable-toggle'))
    fireEvent.click(screen.getByTestId('submit-button'))

    await waitFor(() => expect(capturedUpdates).toHaveLength(1))
    expect(capturedUpdates[0]).toMatchObject({
      wheelchair_capable: true,
      trunk_size:         'large',  // minivan → large
    })
  })

  it('submits with wheelchair_capable=false + trunk_size=null when toggled off', async () => {
    mockSingle.mockResolvedValue({
      data: { ...baseVehicle, wheelchair_capable: true, trunk_size: 'large' },
      error: null,
    })
    render(<VehicleEditPage />)
    await screen.findByText('Edit Vehicle')

    fireEvent.click(screen.getByTestId('wheelchair-capable-toggle'))  // off
    fireEvent.click(screen.getByTestId('submit-button'))

    await waitFor(() => expect(capturedUpdates).toHaveLength(1))
    expect(capturedUpdates[0]).toMatchObject({
      wheelchair_capable: false,
      trunk_size:         null,
    })
  })

  it('honours an explicit trunk-size override over the derivation', async () => {
    mockSingle.mockResolvedValue({ data: { ...baseVehicle, body_type: 'sedan' }, error: null })
    render(<VehicleEditPage />)
    await screen.findByText('Edit Vehicle')

    fireEvent.click(screen.getByTestId('wheelchair-capable-toggle'))    // on, derives 'small'
    fireEvent.click(screen.getByTestId('trunk-size-large'))             // override
    fireEvent.click(screen.getByTestId('submit-button'))

    await waitFor(() => expect(capturedUpdates).toHaveLength(1))
    expect(capturedUpdates[0]).toMatchObject({
      wheelchair_capable: true,
      trunk_size:         'large',
    })
  })
})
