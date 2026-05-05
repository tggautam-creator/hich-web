import { useState, useEffect, type FormEvent, type ChangeEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import PrimaryButton from '@/components/ui/PrimaryButton'
import type { Vehicle } from '@/types/database'

const CAR_COLORS = [
  { name: 'White',  hex: '#FFFFFF' },
  { name: 'Silver', hex: '#C0C0C0' },
  { name: 'Gray',   hex: '#808080' },
  { name: 'Black',  hex: '#000000' },
  { name: 'Red',    hex: '#D32F2F' },
  { name: 'Blue',   hex: '#1565C0' },
  { name: 'Green',  hex: '#2E7D32' },
  { name: 'Brown',  hex: '#6D4C41' },
  { name: 'Beige',  hex: '#F5F5DC' },
  { name: 'Gold',   hex: '#FFD700' },
] as const

interface VehicleEditPageProps {
  'data-testid'?: string
}

export default function VehicleEditPage({
  'data-testid': testId = 'vehicle-edit-page',
}: VehicleEditPageProps) {
  const navigate = useNavigate()
  const { vehicleId } = useParams<{ vehicleId: string }>()
  const profile = useAuthStore((s) => s.profile)

  const [vehicle, setVehicle] = useState<Vehicle | null>(null)
  const [loading, setLoading] = useState(true)
  const [color, setColor] = useState('')
  const [plate, setPlate] = useState('')
  const [seats, setSeats] = useState(2)
  const [carPhoto, setCarPhoto] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (!profile?.id || !vehicleId) return
    const vid = vehicleId
    async function load() {
      const { data } = await supabase
        .from('vehicles')
        .select('*')
        .eq('id', vid)
        .maybeSingle()
      const raw = data as Vehicle | null
      const v = raw?.deleted_at ? null : raw
      setVehicle(v)
      if (v) {
        setColor(v.color)
        setPlate(v.plate)
        setSeats(v.seats_available)
      }
      setLoading(false)
    }
    void load()
  }, [profile?.id, vehicleId])

  function handleCarPhotoChange(e: ChangeEvent<HTMLInputElement>) {
    setCarPhoto(e.target.files?.[0] ?? null)
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!vehicle || !profile?.id) return

    if (!plate.trim()) {
      setError('License plate is required')
      return
    }
    if (!color) {
      setError('Please select a car color')
      return
    }

    setSaving(true)
    setError(null)
    setSuccess(false)

    try {
      let carPhotoUrl = vehicle.car_photo_url
      if (carPhoto) {
        const carExt = carPhoto.name.split('.').pop() ?? 'jpg'
        const carPath = `${profile.id}-${Date.now()}.${carExt}`
        const { error: carUpErr } = await supabase.storage
          .from('car-photos')
          .upload(carPath, carPhoto, { upsert: true, contentType: carPhoto.type })
        if (carUpErr) throw carUpErr
        const { data: carUrlData } = supabase.storage.from('car-photos').getPublicUrl(carPath)
        carPhotoUrl = carUrlData.publicUrl
      }

      const { error: updateErr } = await supabase
        .from('vehicles')
        .update({
          color,
          plate: plate.trim().toUpperCase(),
          seats_available: seats,
          car_photo_url: carPhotoUrl ?? undefined,
        })
        .eq('id', vehicle.id)

      if (updateErr) throw updateErr
      setSuccess(true)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save changes')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div data-testid={testId} className="min-h-dvh bg-surface flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  if (!vehicle) {
    return (
      <div data-testid={testId} className="min-h-dvh bg-surface flex flex-col items-center justify-center gap-4 px-6">
        <p className="text-sm text-text-secondary">No vehicle found</p>
        <button onClick={() => navigate('/profile')} className="text-sm font-semibold text-primary">
          Back to Profile
        </button>
      </div>
    )
  }

  return (
    <div
      data-testid={testId}
      className="min-h-dvh w-full bg-surface flex flex-col font-sans"
      style={{
        paddingTop: 'max(env(safe-area-inset-top), 2rem)',
        paddingBottom: 'max(env(safe-area-inset-bottom), 2rem)',
      }}
    >
      <div className="flex-1 flex flex-col px-6 py-4">
        {/* Back button */}
        <button
          data-testid="back-button"
          onClick={() => navigate('/profile')}
          className="self-start mb-4 text-sm font-medium text-primary"
        >
          &larr; Back to Profile
        </button>

        <h1 className="mb-2 text-2xl font-bold text-text-primary">Edit Vehicle</h1>

        {/* Read-only info */}
        <div className="mb-6 rounded-2xl bg-white border border-border p-4">
          <p className="text-sm font-semibold text-text-primary">
            {vehicle.year} {vehicle.make} {vehicle.model}
          </p>
          <p className="text-xs text-text-secondary mt-1">VIN: {vehicle.vin}</p>
        </div>

        <form
          onSubmit={(e) => { void handleSubmit(e) }}
          noValidate
          className="flex flex-col gap-5 pb-8"
        >
          {/* License plate */}
          <div className="flex flex-col gap-1">
            <label htmlFor="edit-plate" className="text-sm font-medium text-text-primary">
              License plate
            </label>
            <input
              id="edit-plate"
              data-testid="plate-input"
              type="text"
              value={plate}
              onChange={(e) => setPlate(e.target.value.toUpperCase())}
              className="w-full rounded-lg border border-border px-3 py-2 text-base text-text-primary focus:border-primary focus:outline-none"
            />
          </div>

          {/* Color swatch */}
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-text-primary">Car color</span>
            <div className="flex flex-wrap gap-3" role="radiogroup" aria-label="Car color">
              {CAR_COLORS.map(({ name, hex }) => (
                <button
                  key={name}
                  type="button"
                  data-testid={`color-${name.toLowerCase()}`}
                  onClick={() => setColor(name)}
                  title={name}
                  className={[
                    'w-9 h-9 rounded-full border-2 transition-transform',
                    color === name ? 'border-primary scale-110' : 'border-border',
                  ].join(' ')}
                  style={{ backgroundColor: hex }}
                  aria-pressed={color === name}
                  aria-label={name}
                  role="radio"
                  aria-checked={color === name}
                />
              ))}
            </div>
            {color && <p className="text-xs text-text-secondary mt-1">{color}</p>}
          </div>

          {/* Seats */}
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-text-primary">Available seats</span>
            <div className="flex items-center gap-4">
              <button
                type="button"
                data-testid="seats-decrement"
                onClick={() => setSeats((s) => Math.max(1, s - 1))}
                disabled={seats <= 1}
                className="w-10 h-10 rounded-full border border-border flex items-center justify-center text-lg font-medium disabled:opacity-40"
                aria-label="Decrease seats"
              >
                &minus;
              </button>
              <span data-testid="seats-value" className="text-lg font-semibold text-text-primary w-6 text-center">
                {seats}
              </span>
              <button
                type="button"
                data-testid="seats-increment"
                onClick={() => setSeats((s) => Math.min(4, s + 1))}
                disabled={seats >= 4}
                className="w-10 h-10 rounded-full border border-border flex items-center justify-center text-lg font-medium disabled:opacity-40"
                aria-label="Increase seats"
              >
                +
              </button>
            </div>
          </div>

          {/* Car photo */}
          <div className="flex flex-col gap-1">
            <label htmlFor="edit-car-photo" className="text-sm font-medium text-text-primary">
              Car photo <span className="font-normal text-text-secondary">(optional)</span>
            </label>
            <input
              id="edit-car-photo"
              data-testid="car-photo-input"
              type="file"
              accept="image/*"
              onChange={handleCarPhotoChange}
              className="text-sm text-text-secondary file:mr-3 file:rounded-lg file:border-0 file:bg-primary-light file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary"
            />
          </div>

          {error && (
            <p data-testid="submit-error" role="alert" className="rounded-2xl border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
              {error}
            </p>
          )}

          {success && (
            <p data-testid="submit-success" role="status" className="rounded-2xl border border-success/20 bg-success/5 px-4 py-3 text-sm text-success">
              Vehicle updated successfully!
            </p>
          )}

          <PrimaryButton data-testid="submit-button" type="submit" isLoading={saving}>
            Save Changes
          </PrimaryButton>
        </form>
      </div>
    </div>
  )
}
