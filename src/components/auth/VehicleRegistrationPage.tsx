import { useState, useRef, useEffect, type FormEvent, type ChangeEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { validateVin, validateYear } from '@/lib/validation'
import { guessBodyType } from '@/lib/vin'
import type { VehicleBodyType } from '@/lib/vin'
import { lookupFuelEconomy, DEFAULT_MPG } from '@/lib/fuelEconomy'
import VehicleIcon from '@/components/ui/VehicleIcon'
import InputField from '@/components/ui/InputField'
import PrimaryButton from '@/components/ui/PrimaryButton'

// ── US states ─────────────────────────────────────────────────────────────────
const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL',
  'GA','HI','ID','IL','IN','IA','KS','KY','LA','ME',
  'MD','MA','MI','MN','MS','MO','MT','NE','NV','NH',
  'NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI',
  'SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
] as const

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

// Shared input class — matches InputField exactly so the select blends in
const INPUT_CLASS = [
  'w-full rounded-2xl border border-border bg-white px-4 py-3',
  'text-base text-text-primary placeholder:text-text-secondary',
  'transition-colors duration-150',
  'focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-0 focus:border-primary',
  'disabled:cursor-not-allowed disabled:opacity-50',
].join(' ')

// ── Types ────────────────────────────────────────────────────────────────────
interface FormErrors {
  vin?: string
  make?: string
  model?: string
  year?: string
  plate?: string
  state?: string
  color?: string
  carPhoto?: string
  submit?: string
}

interface PlateLookupResult {
  vin: string | null
  year: number | null
  make: string | null
  model: string | null
  trim: string | null
  body: string | null
}

interface VehicleRegistrationPageProps {
  'data-testid'?: string
}

// ── Plate lookup helper ──────────────────────────────────────────────────────

class PlateLookupError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

async function lookupPlate(plate: string, state: string): Promise<PlateLookupResult> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new PlateLookupError('UNAUTHENTICATED', 'Not authenticated')

  const res = await fetch('/api/vehicle/plate-lookup', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ plate, state }),
  })

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } }
    throw new PlateLookupError(
      body.error?.code ?? 'LOOKUP_FAILED',
      body.error?.message ?? 'Plate lookup failed',
    )
  }

  return (await res.json()) as PlateLookupResult
}

// ── Component ────────────────────────────────────────────────────────────────
export default function VehicleRegistrationPage({
  'data-testid': testId = 'vehicle-registration-page',
}: VehicleRegistrationPageProps) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const isFromProfile = searchParams.get('from') === 'profile'
  const refreshProfile = useAuthStore((s) => s.refreshProfile)

  // Plate + state (top of form)
  const [plate, setPlate]                   = useState('')
  const [plateState, setPlateState]         = useState('CA')
  const [plateLooking, setPlateLooking]     = useState(false)
  const [plateFound, setPlateFound]         = useState(false)
  // True only when the lookup API explicitly returned PLATE_NOT_FOUND.
  // Service errors (LOOKUP_FAILED, network) leave this false so the user
  // can still register manually during an outage.
  const [plateNotFound, setPlateNotFound]   = useState(false)

  // Vehicle details (auto-filled or manual)
  const [vin, setVin]                       = useState('')
  const [make, setMake]                     = useState('')
  const [model, setModel]                   = useState('')
  const [year, setYear]                     = useState('')
  const [color, setColor]                   = useState('')
  const [carPhoto, setCarPhoto]             = useState<File | null>(null)
  const [seats, setSeats]                   = useState(2)
  const [bodyType, setBodyType]             = useState<VehicleBodyType>('sedan')
  const [errors, setErrors]                 = useState<FormErrors>({})
  const [isLoading, setIsLoading]           = useState(false)
  const [fuelMpg, setFuelMpg]              = useState<number | null>(null)
  const lookupRef                           = useRef<AbortController | null>(null)

  // Auto-lookup plate when plate is 2-8 chars and state is set
  useEffect(() => {
    // Synchronously invalidate any prior lookup result on every edit so we
    // never carry a stale `plateFound=true` flag across plate changes.
    setPlateFound(false)
    setPlateNotFound(false)
    setErrors((prev) => ({ ...prev, plate: undefined, submit: undefined }))

    const cleanPlate = plate.trim().replace(/[\s-]/g, '')
    if (!/^[A-Z0-9]{2,8}$/i.test(cleanPlate) || !plateState) return

    // Debounce — wait 600ms after user stops typing
    const timer = setTimeout(() => {
      lookupRef.current?.abort()
      const controller = new AbortController()
      lookupRef.current = controller

      setPlateLooking(true)

      lookupPlate(cleanPlate, plateState)
        .then(async (result) => {
          if (controller.signal.aborted) return
          setPlateFound(true)
          setPlateNotFound(false)

          if (result.vin) setVin(result.vin)
          if (result.make) setMake(result.make)
          if (result.model) setModel(result.model)
          if (result.year) setYear(String(result.year))

          // Map body string from API to our VehicleBodyType
          if (result.body) {
            const lc = result.body.toLowerCase()
            if (lc.includes('sedan') || lc.includes('saloon')) setBodyType('sedan')
            else if (lc.includes('suv') || lc.includes('sport utility')) setBodyType('suv')
            else if (lc.includes('minivan') || lc.includes('mini van')) setBodyType('minivan')
            else if (lc.includes('pickup') || lc.includes('truck')) setBodyType('pickup')
            else if (lc.includes('hatchback')) setBodyType('hatchback')
            else if (lc.includes('coupe') || lc.includes('convertible')) setBodyType('coupe')
            else if (lc.includes('van') || lc.includes('cargo')) setBodyType('van')
            else if (lc.includes('wagon') || lc.includes('crossover')) setBodyType('wagon')
          } else if (result.model) {
            setBodyType(guessBodyType(result.model))
          }

          // Look up fuel economy
          if (result.year && result.make && result.model) {
            const fuel = await lookupFuelEconomy(result.year, result.make, result.model)
            if (!controller.signal.aborted && fuel) {
              setFuelMpg(fuel.combined_mpg)
            }
          }
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return
          const code = err instanceof PlateLookupError ? err.code : 'LOOKUP_FAILED'
          const msg = err instanceof Error ? err.message : 'Lookup failed'
          // PLATE_NOT_FOUND means the plate is verifiably bogus — block
          // submission. Other errors (service down, network) leave the
          // user free to fill in manually so an outage doesn't lock
          // them out of driver onboarding.
          if (code === 'PLATE_NOT_FOUND') {
            setPlateNotFound(true)
            setErrors((prev) => ({
              ...prev,
              plate: 'No vehicle found for this plate. Please double-check the plate number and state.',
            }))
          } else if (code !== 'UNAUTHENTICATED') {
            setErrors((prev) => ({ ...prev, plate: msg }))
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setPlateLooking(false)
        })
    }, 600)

    return () => {
      clearTimeout(timer)
      lookupRef.current?.abort()
    }
  }, [plate, plateState])

  function handleCarPhotoChange(e: ChangeEvent<HTMLInputElement>) {
    setCarPhoto(e.target.files?.[0] ?? null)
    setErrors((prev) => ({ ...prev, carPhoto: undefined }))
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()

    if (plateLooking) {
      setErrors({ plate: 'Verifying plate — please wait a moment.' })
      return
    }
    if (plateNotFound) {
      setErrors({
        plate: 'No vehicle found for this plate. Please double-check the plate number and state before registering.',
      })
      return
    }

    const plateErr   = !plate.trim() ? 'License plate is required' : undefined
    const stateErr   = !plateState ? 'State is required' : undefined
    const vinErr     = validateVin(vin)
    const makeErr    = !make.trim() ? 'Make is required' : undefined
    const modelErr   = !model.trim() ? 'Model is required' : undefined
    const yearErr    = validateYear(year)
    const colorErr   = !color ? 'Please select a car color' : undefined
    // 2026-05-04 — car photo is now mandatory so riders can identify
    // the vehicle at pickup. License plate photo was removed entirely.
    const photoErr   = !carPhoto ? 'A photo of your car is required.' : undefined
    if (plateErr ?? stateErr ?? vinErr ?? makeErr ?? modelErr ?? yearErr ?? colorErr ?? photoErr) {
      setErrors({
        plate: plateErr, state: stateErr, vin: vinErr,
        make: makeErr, model: modelErr, year: yearErr, color: colorErr,
        carPhoto: photoErr,
      })
      return
    }

    setErrors({})
    setIsLoading(true)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated — please sign in again')

      // Upload car photo (mandatory). The validate-step above guards
      // `carPhoto != null`, but we double-guard here so a future
      // refactor can't accidentally let a null slip through.
      if (!carPhoto) {
        throw new Error('Car photo is required')
      }
      const carExt  = carPhoto.name.split('.').pop() ?? 'jpg'
      const carPath = `${user.id}-${Date.now()}.${carExt}`
      const { error: carUpErr } = await supabase.storage
        .from('car-photos')
        .upload(carPath, carPhoto, { upsert: true, contentType: carPhoto.type })
      if (carUpErr) throw carUpErr
      const { data: carUrlData } = supabase.storage
        .from('car-photos')
        .getPublicUrl(carPath)
      const carPhotoUrl: string = carUrlData.publicUrl

      // When adding another vehicle, deactivate existing ones first
      if (isFromProfile) {
        await supabase
          .from('vehicles')
          .update({ is_active: false })
          .eq('user_id', user.id)
          .eq('is_active', true)
      }

      // Insert vehicle record
      const { error: vehErr } = await supabase.from('vehicles').insert({
        user_id:                 user.id,
        vin:                     vin.trim().toUpperCase() || '',
        make:                    make.trim(),
        model:                   model.trim(),
        year:                    Number(year),
        color:                   color,
        plate:                   plate.trim().toUpperCase(),
        car_photo_url:           carPhotoUrl,
        seats_available:         seats,
        fuel_efficiency_mpg:     fuelMpg ?? DEFAULT_MPG,
        body_type:               bodyType,
        is_active:               true,
      })
      if (vehErr) throw vehErr

      if (!isFromProfile) {
        // First-time onboarding: mark as driver and go to Stripe
        const { error: userErr } = await supabase
          .from('users')
          .update({ is_driver: true })
          .eq('id', user.id)
        if (userErr) throw userErr
      }

      // Refresh auth store so AuthGuard sees is_driver + full_name
      await refreshProfile()
      navigate(isFromProfile ? '/profile' : '/stripe/onboarding')
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
        <button
          data-testid="back-button"
          onClick={() => { navigate(-1) }}
          className="self-start mb-4 text-sm font-medium text-primary"
        >
          &larr; Back
        </button>

        <h1 className="mb-2 text-2xl font-bold text-text-primary">Register your vehicle</h1>
        <p className="mb-8 text-sm text-text-secondary">
          Enter your license plate to auto-fill vehicle details.
        </p>

        <form
          onSubmit={(e) => { void handleSubmit(e) }}
          noValidate
          className="flex flex-col gap-5 pb-8"
        >
          {/* ── License plate + state (primary input) ────────────────── */}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-text-primary">
              License plate
            </label>
            <div className="flex gap-2">
              <select
                data-testid="plate-state-select"
                value={plateState}
                onChange={(e) => { setPlateState(e.target.value) }}
                className={[
                  INPUT_CLASS,
                  '!w-[5rem] !min-w-[5rem] !max-w-[5rem] shrink-0 cursor-pointer',
                  errors.state ? 'border-danger focus:ring-danger' : '',
                ].join(' ')}
                aria-label="State"
              >
                {US_STATES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>

              <input
                id="plate"
                data-testid="plate-input"
                type="text"
                placeholder="ABC1234"
                autoComplete="off"
                value={plate}
                onChange={(e) => { setPlate(e.target.value.toUpperCase()) }}
                aria-invalid={errors.plate ? true : undefined}
                className={[
                  INPUT_CLASS,
                  'flex-1 min-w-0',
                  errors.plate ? 'border-danger focus:ring-danger' : '',
                ].join(' ')}
              />
            </div>
            {plateLooking && (
              <p className="text-xs text-primary mt-1" data-testid="plate-looking">
                Looking up vehicle info...
              </p>
            )}
            {plateFound && !plateLooking && (
              <p className="text-xs text-success mt-1" data-testid="plate-found">
                Vehicle found — details auto-filled below
              </p>
            )}
            {errors.plate && (
              <p className="text-sm text-danger mt-1" role="alert">{errors.plate}</p>
            )}
          </div>

          {/* ── VIN (auto-filled, read-only when from plate lookup) ───── */}
          <InputField
            id="vin"
            data-testid="vin-input"
            label={`VIN${plateFound ? '' : ' (optional)'}`}
            type="text"
            placeholder="17-character vehicle ID"
            value={vin}
            onChange={(e) => { setVin(e.target.value.toUpperCase()) }}
            readOnly={plateFound && vin.length === 17}
            error={errors.vin}
            hint={plateFound && vin ? 'Auto-filled from plate lookup' : 'Will be filled automatically from your plate'}
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

          {/* ── Car photo (mandatory 2026-05-04) ────────────────────── */}
          <div className="flex flex-col gap-1">
            <label htmlFor="car-photo-input" className="text-sm font-medium text-text-primary">
              Car photo
            </label>
            <p className="text-xs text-text-secondary">Required — helps riders spot you at pickup.</p>
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
            disabled={plateLooking || plateNotFound}
          >
            Register vehicle
          </PrimaryButton>
        </form>
      </div>
    </div>
  )
}
