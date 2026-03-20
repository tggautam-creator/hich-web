import { useState, useRef, useEffect, type FormEvent, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { validateVin, validateYear } from '@/lib/validation'
import { decodeVin, guessBodyType } from '@/lib/vin'
import type { VehicleBodyType } from '@/lib/vin'
import { lookupFuelEconomy, DEFAULT_MPG } from '@/lib/fuelEconomy'
import VehicleIcon from '@/components/ui/VehicleIcon'
import InputField from '@/components/ui/InputField'
import PrimaryButton from '@/components/ui/PrimaryButton'

// ── Body type options ─────────────────────────────────────────────────────────
const BODY_TYPES: { value: VehicleBodyType; label: string }[] = [
  { value: 'sedan',     label: 'Sedan' },
  { value: 'suv',       label: 'SUV' },
  { value: 'hatchback', label: 'Hatchback' },
  { value: 'coupe',     label: 'Coupe' },
  { value: 'minivan',   label: 'Minivan' },
  { value: 'pickup',    label: 'Pickup' },
  { value: 'van',       label: 'Van' },
  { value: 'wagon',     label: 'Wagon' },
] as const

// ── Car color options (data, not UI tokens) ──────────────────────────────────
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

// ── Types ────────────────────────────────────────────────────────────────────
interface FormErrors {
  vin?: string
  make?: string
  model?: string
  year?: string
  plate?: string
  color?: string
  carPhoto?: string
  licensePhoto?: string
  submit?: string
}

interface VehicleRegistrationPageProps {
  'data-testid'?: string
}

// ── Component ────────────────────────────────────────────────────────────────
export default function VehicleRegistrationPage({
  'data-testid': testId = 'vehicle-registration-page',
}: VehicleRegistrationPageProps) {
  const navigate = useNavigate()
  const refreshProfile = useAuthStore((s) => s.refreshProfile)

  const [vin, setVin]                       = useState('')
  const [make, setMake]                     = useState('')
  const [model, setModel]                   = useState('')
  const [year, setYear]                     = useState('')
  const [plate, setPlate]                   = useState('')
  const [color, setColor]                   = useState('')
  const [carPhoto, setCarPhoto]             = useState<File | null>(null)
  const [licensePhoto, setLicensePhoto]     = useState<File | null>(null)
  const [seats, setSeats]                   = useState(2)
  const [bodyType, setBodyType]             = useState<VehicleBodyType>('sedan')
  const [errors, setErrors]                 = useState<FormErrors>({})
  const [isLoading, setIsLoading]           = useState(false)
  const [vinDecoding, setVinDecoding]       = useState(false)
  const [fuelMpg, setFuelMpg]               = useState<number | null>(null)
  const vinDecodeRef                        = useRef<AbortController | null>(null)

  // Auto-decode VIN when it reaches 17 valid alphanumeric characters
  useEffect(() => {
    if (!/^[A-Z0-9]{17}$/i.test(vin.trim())) return

    // Cancel any previous in-flight request
    vinDecodeRef.current?.abort()
    const controller = new AbortController()
    vinDecodeRef.current = controller

    setVinDecoding(true)
    decodeVin(vin.trim())
      .then(async (result) => {
        if (controller.signal.aborted) return
        if (result.make) setMake(result.make)
        if (result.model) setModel(result.model)
        if (result.year) setYear(result.year)
        if (result.bodyType) setBodyType(result.bodyType)
        else if (result.model) setBodyType(guessBodyType(result.model))

        // Look up fuel economy from EPA database
        if (result.year && result.make && result.model) {
          const fuel = await lookupFuelEconomy(
            Number(result.year),
            result.make,
            result.model,
          )
          if (!controller.signal.aborted && fuel) {
            setFuelMpg(fuel.combined_mpg)
          }
        }
      })
      .catch(() => {
        // Silently ignore — user can still type make/model/year manually
      })
      .finally(() => {
        if (!controller.signal.aborted) setVinDecoding(false)
      })

    return () => { controller.abort() }
  }, [vin])

  function handleCarPhotoChange(e: ChangeEvent<HTMLInputElement>) {
    setCarPhoto(e.target.files?.[0] ?? null)
  }

  function handleLicensePhotoChange(e: ChangeEvent<HTMLInputElement>) {
    setLicensePhoto(e.target.files?.[0] ?? null)
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()

    const vinErr   = validateVin(vin)
    const makeErr  = !make.trim() ? 'Make is required' : undefined
    const modelErr = !model.trim() ? 'Model is required' : undefined
    const yearErr  = validateYear(year)
    const plateErr = !plate.trim() ? 'License plate is required' : undefined
    const colorErr = !color ? 'Please select a car color' : undefined

    if (vinErr ?? makeErr ?? modelErr ?? yearErr ?? plateErr ?? colorErr) {
      setErrors({
        vin: vinErr, make: makeErr, model: modelErr, year: yearErr,
        plate: plateErr, color: colorErr,
      })
      return
    }

    setErrors({})
    setIsLoading(true)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated — please sign in again')

      // Upload car photo if provided (optional)
      let carPhotoUrl: string | null = null
      if (carPhoto) {
        const carExt  = carPhoto.name.split('.').pop() ?? 'jpg'
        const carPath = `${user.id}-${Date.now()}.${carExt}`
        const { error: carUpErr } = await supabase.storage
          .from('car-photos')
          .upload(carPath, carPhoto, { upsert: true })
        if (carUpErr) throw carUpErr
        const { data: carUrlData } = supabase.storage
          .from('car-photos')
          .getPublicUrl(carPath)
        carPhotoUrl = carUrlData.publicUrl
      }

      // Upload license plate photo if provided (optional — private bucket, store path only)
      let licPath: string | null = null
      if (licensePhoto) {
        const licExt = licensePhoto.name.split('.').pop() ?? 'jpg'
        licPath = `${user.id}-${Date.now()}.${licExt}`
        const { error: licUpErr } = await supabase.storage
          .from('license-photos')
          .upload(licPath, licensePhoto, { upsert: true })
        if (licUpErr) throw licUpErr
      }

      // Insert vehicle record
      const { error: vehErr } = await supabase.from('vehicles').insert({
        user_id:                 user.id,
        vin:                     vin.trim().toUpperCase(),
        make:                    make.trim(),
        model:                   model.trim(),
        year:                    Number(year),
        color:                   color,
        plate:                   plate.trim().toUpperCase(),
        car_photo_url:           carPhotoUrl,
        license_plate_photo_url: licPath,
        seats_available:         seats,
        fuel_efficiency_mpg:     fuelMpg ?? DEFAULT_MPG,
        body_type:               bodyType,
      })
      if (vehErr) throw vehErr

      // Mark user as a driver
      const { error: userErr } = await supabase
        .from('users')
        .update({ is_driver: true })
        .eq('id', user.id)
      if (userErr) throw userErr

      // Refresh auth store so AuthGuard sees is_driver + full_name
      await refreshProfile()
      navigate('/stripe/onboarding')
    } catch (err: unknown) {
      // eslint-disable-next-line no-console
      console.error('[VehicleRegistrationPage] submit error:', err)
      let message = 'Something went wrong. Please try again.'
      if (err instanceof Error) {
        message = err.message
      } else if (
        typeof err === 'object' &&
        err !== null &&
        'message' in err &&
        typeof (err as Record<string, unknown>).message === 'string'
      ) {
        message = (err as { message: string }).message
      }
      setErrors({ submit: message })
    } finally {
      setIsLoading(false)
    }
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
        <h1 className="mb-2 text-2xl font-bold text-text-primary">Register your vehicle</h1>
        <p className="mb-8 text-sm text-text-secondary">
          This info helps riders identify your car.
        </p>

        <form
          onSubmit={(e) => { void handleSubmit(e) }}
          noValidate
          className="flex flex-col gap-5 pb-8"
        >
          <InputField
            id="vin"
            data-testid="vin-input"
            label="VIN"
            type="text"
            placeholder="17-character vehicle ID"
            value={vin}
            onChange={(e) => { setVin(e.target.value.toUpperCase()) }}
            error={errors.vin}
            hint={vinDecoding ? 'Looking up vehicle info...' : 'Enter your VIN to auto-fill make, model, and year'}
          />

          <InputField
            id="make"
            data-testid="make-input"
            label="Make"
            type="text"
            placeholder="Toyota"
            value={make}
            onChange={(e) => { setMake(e.target.value) }}
            error={errors.make}
          />

          <InputField
            id="model"
            data-testid="model-input"
            label="Model"
            type="text"
            placeholder="Camry"
            value={model}
            onChange={(e) => { setModel(e.target.value) }}
            error={errors.model}
          />

          <InputField
            id="year"
            data-testid="year-input"
            label="Year"
            type="number"
            placeholder="1990–2026"
            min={1990}
            max={2026}
            value={year}
            onChange={(e) => { setYear(e.target.value) }}
            error={errors.year}
          />

          <InputField
            id="plate"
            data-testid="plate-input"
            label="License plate"
            type="text"
            placeholder="ABC1234"
            value={plate}
            onChange={(e) => { setPlate(e.target.value.toUpperCase()) }}
            error={errors.plate}
          />

          {/* ── Color swatch ────────────────────────────────────────── */}
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-text-primary">Car color</span>
            <div className="flex flex-wrap gap-3" role="radiogroup" aria-label="Car color">
              {CAR_COLORS.map(({ name, hex }) => (
                <button
                  key={name}
                  type="button"
                  data-testid={`color-${name.toLowerCase()}`}
                  onClick={() => { setColor(name) }}
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
            {color && (
              <p className="text-xs text-text-secondary mt-1" data-testid="selected-color">
                {color}
              </p>
            )}
            {errors.color && (
              <p className="text-xs text-danger mt-1" role="alert">{errors.color}</p>
            )}
          </div>

          {/* ── Car photo ───────────────────────────────────────────── */}
          <div className="flex flex-col gap-1">
            <label htmlFor="car-photo-input" className="text-sm font-medium text-text-primary">
              Car photo{' '}
              <span className="font-normal text-text-secondary">(optional)</span>
            </label>
            <input
              id="car-photo-input"
              data-testid="car-photo-input"
              type="file"
              accept="image/*"
              onChange={handleCarPhotoChange}
              className="text-sm text-text-secondary file:mr-3 file:rounded-lg file:border-0 file:bg-primary-light file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary"
            />
            {carPhoto && (
              <p className="text-xs text-text-secondary" data-testid="car-photo-name">
                {carPhoto.name}
              </p>
            )}
            {errors.carPhoto && (
              <p className="text-xs text-danger" role="alert">{errors.carPhoto}</p>
            )}
          </div>

          {/* ── License plate photo ─────────────────────────────────── */}
          <div className="flex flex-col gap-1">
            <label htmlFor="license-photo-input" className="text-sm font-medium text-text-primary">
              License plate photo{' '}
              <span className="font-normal text-text-secondary">(optional)</span>
            </label>
            <p className="text-xs text-text-secondary">Stored securely — not visible to riders</p>
            <input
              id="license-photo-input"
              data-testid="license-photo-input"
              type="file"
              accept="image/*"
              onChange={handleLicensePhotoChange}
              className="text-sm text-text-secondary file:mr-3 file:rounded-lg file:border-0 file:bg-primary-light file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary"
            />
            {licensePhoto && (
              <p className="text-xs text-text-secondary" data-testid="license-photo-name">
                {licensePhoto.name}
              </p>
            )}
            {errors.licensePhoto && (
              <p className="text-xs text-danger" role="alert">{errors.licensePhoto}</p>
            )}
          </div>

          {/* ── Vehicle type + preview ────────────────────────────────── */}
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-text-primary">Vehicle type</span>
            <div className="flex items-center gap-4">
              <select
                data-testid="body-type-select"
                value={bodyType}
                onChange={(e) => { setBodyType(e.target.value as VehicleBodyType) }}
                className="flex-1 rounded-xl border border-border bg-white px-3 py-2.5 text-sm text-text-primary"
              >
                {BODY_TYPES.map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <div className="h-14 w-20 rounded-xl bg-surface flex items-center justify-center shrink-0">
                <VehicleIcon
                  color={CAR_COLORS.find((c) => c.name.toLowerCase() === color.toLowerCase())?.hex ?? '#6b7280'}
                  className="h-10 w-auto"
                />
              </div>
            </div>
          </div>

          {/* ── Seats stepper ───────────────────────────────────────── */}
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-text-primary">Available seats</span>
            <div className="flex items-center gap-4">
              <button
                type="button"
                data-testid="seats-decrement"
                onClick={() => { setSeats((s) => Math.max(1, s - 1)) }}
                disabled={seats <= 1}
                className="w-10 h-10 rounded-full border border-border flex items-center justify-center text-lg font-medium disabled:opacity-40"
                aria-label="Decrease seats"
              >
                &minus;
              </button>
              <span
                data-testid="seats-value"
                className="text-lg font-semibold text-text-primary w-6 text-center"
              >
                {seats}
              </span>
              <button
                type="button"
                data-testid="seats-increment"
                onClick={() => { setSeats((s) => Math.min(4, s + 1)) }}
                disabled={seats >= 4}
                className="w-10 h-10 rounded-full border border-border flex items-center justify-center text-lg font-medium disabled:opacity-40"
                aria-label="Increase seats"
              >
                +
              </button>
            </div>
          </div>

          {errors.submit && (
            <p
              data-testid="submit-error"
              role="alert"
              className="rounded-2xl border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger"
            >
              {errors.submit}
            </p>
          )}

          <PrimaryButton
            data-testid="submit-button"
            type="submit"
            isLoading={isLoading}
          >
            Register vehicle
          </PrimaryButton>
        </form>
      </div>
    </div>
  )
}
