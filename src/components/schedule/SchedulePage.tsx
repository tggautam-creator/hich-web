import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import PrimaryButton from '@/components/ui/PrimaryButton'
import SecondaryButton from '@/components/ui/SecondaryButton'
import { trackEvent } from '@/lib/analytics'
import DayPill from '@/components/ui/DayPill'
import type { DayIndex } from '@/components/ui/DayPill'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import {
  searchPlaces,
  getPlaceCoordinates,
  geocodeAddress,
  type PlaceSuggestion,
} from '@/lib/places'
import { calculateBearing } from '@/lib/geo'
import { getDirectionsByLatLng } from '@/lib/directions'

// ── Types ─────────────────────────────────────────────────────────────────────

interface SchedulePageProps {
  mode: 'driver' | 'rider'
  'data-testid'?: string
}

type TripType = 'one-time' | 'routine'
type TimeType = 'departure' | 'arrival'
type Step = 'details' | 'one-time-schedule' | 'routine-schedule'

const ALL_DAYS: DayIndex[] = [0, 1, 2, 3, 4, 5, 6]
const DAY_NAMES: Record<DayIndex, string> = {
  0: 'Sunday', 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday',
  4: 'Thursday', 5: 'Friday', 6: 'Saturday',
}

interface DayTimeConfig {
  timeType: TimeType
  time: string
}

/** Today's date as YYYY-MM-DD in local time */
function todayString(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// ── Component ─────────────────────────────────────────────────────────────────

interface ScheduleLocationState {
  prefillFrom?: PlaceSuggestion
  prefillTo?: PlaceSuggestion
  /** When 'routine', SchedulePage opens directly in recurring-routine mode. */
  tripType?: TripType
}

export default function SchedulePage({ mode: initialMode, 'data-testid': testId }: SchedulePageProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const prefill = location.state as ScheduleLocationState | null

  // Step state
  const [step, setStep] = useState<Step>('details')
  const [showConfirmation, setShowConfirmation] = useState(false)

  // Driver/rider toggle state
  const [activeMode, setActiveMode] = useState<'driver' | 'rider'>(initialMode)

  // Form state
  const [routeName, setRouteName] = useState('')
  const [fromLocation, setFromLocation] = useState<PlaceSuggestion | null>(prefill?.prefillFrom ?? null)
  const [toLocation, setToLocation] = useState<PlaceSuggestion | null>(prefill?.prefillTo ?? null)
  const [tripType, setTripType] = useState<TripType>(prefill?.tripType ?? 'one-time')
  const [availableSeats, setAvailableSeats] = useState(1)
  const [note, setNote] = useState('')

  // One-time schedule state
  const [tripDate, setTripDate] = useState('')
  const [timeType, setTimeType] = useState<TimeType>('departure')
  const [tripTime, setTripTime] = useState('')
  // When true, the poster doesn't care about the hour — only the date.
  // We still submit a noon placeholder for trip_time to satisfy the NOT NULL
  // constraint and keep legacy sort-by-time stable; UI renders "Anytime".
  const [timeFlexible, setTimeFlexible] = useState(false)
  const [isSubmitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Routine schedule state
  const [selectedDays, setSelectedDays] = useState<Set<DayIndex>>(new Set())
  const [sheetTimeType, setSheetTimeType] = useState<TimeType>('departure')
  const [sheetTime, setSheetTime] = useState('')
  const [perDayMode, setPerDayMode] = useState(false)
  const [dayTimes, setDayTimes] = useState<Map<DayIndex, DayTimeConfig>>(new Map())
  const [endDate, setEndDate] = useState('')

  const user = useAuthStore((s) => s.user)
  const isDriver = useAuthStore((s) => s.isDriver)

  // Non-drivers are always locked to rider mode
  useEffect(() => {
    if (!isDriver && activeMode === 'driver') setActiveMode('rider')
  }, [isDriver, activeMode])

  /** Resolve coordinates for a place — use pre-resolved lat/lng if available, otherwise geocode */
  async function resolveCoords(
    place: PlaceSuggestion,
    sessionToken: string,
  ): Promise<{ lat: number; lng: number } | null> {
    // Use pre-resolved coords if available
    if (place.lat != null && place.lng != null) {
      return { lat: place.lat, lng: place.lng }
    }
    // For real Google Place IDs, use the Places API
    if (place.placeId && !place.placeId.startsWith('current-location') && !place.placeId.startsWith('manual-')) {
      return getPlaceCoordinates(place.placeId, sessionToken)
    }
    // Fallback: geocode the address string
    return geocodeAddress(place.fullAddress)
  }

  // From location autocomplete state
  const [fromQuery, setFromQuery] = useState(prefill?.prefillFrom?.mainText ?? '')
  const [fromSuggestions, setFromSuggestions] = useState<PlaceSuggestion[]>([])
  const [fromLoading, setFromLoading] = useState(false)
  const [showFromDropdown, setShowFromDropdown] = useState(false)
  const fromInputRef = useRef<HTMLInputElement>(null)
  const fromSessionTokenRef = useRef(crypto.randomUUID())

  // To location autocomplete state
  const [toQuery, setToQuery] = useState(prefill?.prefillTo?.mainText ?? '')
  const [toSuggestions, setToSuggestions] = useState<PlaceSuggestion[]>([])
  const [toLoading, setToLoading] = useState(false)
  const [showToDropdown, setShowToDropdown] = useState(false)
  const toInputRef = useRef<HTMLInputElement>(null)
  const toSessionTokenRef = useRef(crypto.randomUUID())

  // Validation state
  const [errors, setErrors] = useState<Record<string, string>>({})

  // ── From location debounced search ─────────────────────────────────────────

  useEffect(() => {
    if (!fromQuery.trim() || fromLocation) {
      setFromSuggestions([])
      setFromLoading(false)
      return
    }

    const timer = setTimeout(() => {
      setFromLoading(true)
      void searchPlaces(fromQuery, fromSessionTokenRef.current).then((results) => {
        setFromSuggestions(results)
        setFromLoading(false)
      })
    }, 300)

    return () => { clearTimeout(timer) }
  }, [fromQuery, fromLocation])

  // ── To location debounced search ───────────────────────────────────────────

  useEffect(() => {
    if (!toQuery.trim() || toLocation) {
      setToSuggestions([])
      setToLoading(false)
      return
    }

    const timer = setTimeout(() => {
      setToLoading(true)
      void searchPlaces(toQuery, toSessionTokenRef.current).then((results) => {
        setToSuggestions(results)
        setToLoading(false)
      })
    }, 300)

    return () => { clearTimeout(timer) }
  }, [toQuery, toLocation])

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleFromInputChange(value: string) {
    setFromQuery(value)
    if (fromLocation && value !== fromLocation.mainText) {
      setFromLocation(null)
    }
    setShowFromDropdown(true)
  }

  function handleFromSelect(place: PlaceSuggestion) {
    setFromLocation(place)
    setFromQuery(place.mainText)
    setFromSuggestions([])
    setShowFromDropdown(false)
    fromInputRef.current?.blur()
  }

  function handleToInputChange(value: string) {
    setToQuery(value)
    if (toLocation && value !== toLocation.mainText) {
      setToLocation(null)
    }
    setShowToDropdown(true)
  }

  function handleToSelect(place: PlaceSuggestion) {
    setToLocation(place)
    setToQuery(place.mainText)
    setToSuggestions([])
    setShowToDropdown(false)
    toInputRef.current?.blur()
  }

  function validateForm(): boolean {
    const newErrors: Record<string, string> = {}

    if (!fromLocation) {
      newErrors.fromLocation = 'Please select a From location'
    }

    if (!toLocation) {
      newErrors.toLocation = 'Please select a To location'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  function validateSchedule(): boolean {
    const newErrors: Record<string, string> = {}

    if (!tripDate) {
      newErrors.tripDate = 'Please select a date'
    } else if (tripDate < todayString()) {
      newErrors.tripDate = 'Date cannot be in the past'
    }

    if (!timeFlexible && !tripTime) {
      newErrors.tripTime = 'Please select a time'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  function handleContinue() {
    if (!validateForm()) return

    if (tripType === 'one-time') {
      setStep('one-time-schedule')
    } else {
      setStep('routine-schedule')
    }
  }

  function handleBack() {
    setStep('details')
    setErrors({})
    setSubmitError(null)
  }

  /**
   * Send the user to /payment/add with state to bring them back to this
   * mode of the schedule flow. Mirrors the redirect used by RideBoard's
   * "Request This Ride" → NO_PAYMENT_METHOD flow, so both card-required
   * paths land in the same place.
   */
  function redirectToAddPayment() {
    navigate('/payment/add', { state: { returnTo: `/schedule/${activeMode}` } })
  }

  /**
   * Detect the migration-051 trigger error coming back from a direct
   * Supabase insert. The DB raises a CHECK violation with this exact
   * message; we match on a stable substring rather than the full text.
   */
  function isMissingPaymentMethodDbError(message: string | undefined | null): boolean {
    if (!message) return false
    return /saved payment method/i.test(message)
  }

  /**
   * Rider-mode posts charge a card after the ride completes, so refuse to
   * create the schedule if the poster has no card on file. We hit
   * /api/payment/methods (Stripe-backed) rather than reading
   * users.default_payment_method_id directly — the cached column can go
   * stale when a card is detached out-of-band, and trusting it has let
   * card-less users post in the past. The endpoint also self-heals the
   * column on read, so the migration-051 trigger sees fresh data on the
   * next attempt. Returns true if the submit can proceed.
   */
  async function ensureCardOnFileForRiderMode(): Promise<boolean> {
    if (activeMode !== 'rider' || !user) return true

    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      setSubmitError('Please sign in again.')
      return false
    }

    const res = await fetch('/api/payment/methods', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    if (!res.ok) {
      setSubmitError('Could not verify your payment method. Please try again.')
      return false
    }
    const body = (await res.json()) as {
      methods: Array<unknown>
      default_method_id: string | null
    }

    if (!body.default_method_id || body.methods.length === 0) {
      redirectToAddPayment()
      return false
    }

    return true
  }

  async function handleSubmitSchedule() {
    if (!validateSchedule()) return
    if (!user || !fromLocation || !toLocation) return

    setSubmitting(true)
    setSubmitError(null)

    if (!(await ensureCardOnFileForRiderMode())) {
      setSubmitting(false)
      return
    }

    // When the poster is flexible on time we still need a legal trip_time
    // value (the column is NOT NULL); store noon so anything sorting by time
    // lands in a sensible middle-of-day position.
    const submittedTripTime = timeFlexible ? '12:00:00' : `${tripTime}:00`

    try {
      // Resolve coordinates up-front so they're persisted with the row.
      // Without coords the ride board can't compute fare estimates or
      // "near me" proximity for this schedule.
      const [fromCoords, toCoords] = await Promise.all([
        resolveCoords(fromLocation, fromSessionTokenRef.current),
        resolveCoords(toLocation, toSessionTokenRef.current),
      ])
      fromSessionTokenRef.current = crypto.randomUUID()
      toSessionTokenRef.current = crypto.randomUUID()

      const { error } = await supabase.from('ride_schedules').insert({
        user_id:          user.id,
        mode:             activeMode,
        route_name:       routeName.trim(),
        origin_place_id:  fromLocation.placeId,
        origin_address:   fromLocation.fullAddress,
        dest_place_id:    toLocation.placeId,
        dest_address:     toLocation.fullAddress,
        direction_type:   'one_way',
        trip_date:        tripDate,
        time_type:        timeType,
        trip_time:        submittedTripTime,
        time_flexible:    timeFlexible,
        available_seats:  activeMode === 'driver' ? availableSeats : null,
        note:             note.trim() || null,
        origin_lat:       fromCoords?.lat ?? null,
        origin_lng:       fromCoords?.lng ?? null,
        dest_lat:         toCoords?.lat ?? null,
        dest_lng:         toCoords?.lng ?? null,
      }).select('id')

      if (error) {
        if (isMissingPaymentMethodDbError(error.message)) {
          redirectToAddPayment()
          return
        }
        setSubmitError(error.message)
        return
      }

      // Notify matched drivers (fire-and-forget)
      try {
        const { data: { session } } = await supabase.auth.getSession()
        await fetch('/api/schedule/notify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
          },
          body: JSON.stringify({
            origin_place_id: fromLocation.placeId,
            dest_place_id:   toLocation.placeId,
            trip_date:       tripDate,
            trip_time:       submittedTripTime,
            time_type:       timeType,
            time_flexible:   timeFlexible,
            mode: activeMode,
            ...(fromCoords ? { origin_lat: fromCoords.lat, origin_lng: fromCoords.lng } : {}),
            ...(toCoords ? { dest_lat: toCoords.lat, dest_lng: toCoords.lng } : {}),
          }),
        })
      } catch {
        // Notification failure is non-blocking
      }

      trackEvent('schedule_saved', { mode: activeMode, trip_type: 'one-time' })
      setShowConfirmation(true)
    } catch {
      setSubmitError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Routine handlers ──────────────────────────────────────────────────────

  function handleDayClick(day: DayIndex) {
    const next = new Set(selectedDays)
    if (next.has(day)) {
      next.delete(day)
    } else {
      next.add(day)
    }
    setSelectedDays(next)
  }

  function validateRoutine(): boolean {
    const newErrors: Record<string, string> = {}

    if (selectedDays.size === 0) {
      newErrors.days = 'Please select at least one day'
    }

    if (perDayMode) {
      // Every selected day must have a time set
      for (const day of selectedDays) {
        const cfg = dayTimes.get(day)
        if (!cfg?.time) {
          newErrors[`dayTime_${day}`] = `Please set a time for ${DAY_NAMES[day]}`
          if (!newErrors.routineTime) {
            newErrors.routineTime = 'Please set a time for each day'
          }
        }
      }
    } else {
      if (!sheetTime) {
        newErrors.routineTime = 'Please set a time'
      }
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  async function handleSubmitRoutine() {
    if (!validateRoutine()) return
    if (!user || !fromLocation || !toLocation) return

    setSubmitting(true)
    setSubmitError(null)

    if (!(await ensureCardOnFileForRiderMode())) {
      setSubmitting(false)
      return
    }

    try {
      // Geocode both places
      const [fromCoords, toCoords] = await Promise.all([
        resolveCoords(fromLocation, fromSessionTokenRef.current),
        resolveCoords(toLocation, toSessionTokenRef.current),
      ])
      fromSessionTokenRef.current = crypto.randomUUID()
      toSessionTokenRef.current = crypto.randomUUID()

      if (!fromCoords || !toCoords) {
        setSubmitError('Could not determine coordinates for your locations.')
        return
      }

      const bearing = calculateBearing(
        fromCoords.lat, fromCoords.lng,
        toCoords.lat, toCoords.lng,
      )

      // Fetch driving polyline for transit auto-detection (non-blocking)
      const directions = await getDirectionsByLatLng(
        fromCoords.lat, fromCoords.lng,
        toCoords.lat, toCoords.lng,
      )
      const routePolyline = directions?.polyline ?? null

      // Build per-day configs: in shared mode all days use the same time,
      // in per-day mode each day has its own time config
      const dayConfigs: { day: DayIndex; tType: TimeType; time: string }[] = []
      for (const day of selectedDays) {
        if (perDayMode) {
          const cfg = dayTimes.get(day)
          if (cfg?.time) {
            dayConfigs.push({ day, tType: cfg.timeType, time: cfg.time })
          }
        } else {
          dayConfigs.push({ day, tType: sheetTimeType, time: sheetTime })
        }
      }

      // Group days by identical time config for minimal DB records
      const groups = new Map<string, { tType: TimeType; time: string; days: DayIndex[] }>()
      for (const { day, tType, time } of dayConfigs) {
        const key = `${tType}:${time}`
        const existing = groups.get(key)
        if (existing) {
          existing.days.push(day)
        } else {
          groups.set(key, { tType, time, days: [day] })
        }
      }

      // Insert one driver_routine record per unique time config
      for (const group of groups.values()) {
        const { error } = await supabase.from('driver_routines').insert({
          user_id:             user.id,
          route_name:          routeName.trim(),
          origin:              { type: 'Point' as const, coordinates: [fromCoords.lng, fromCoords.lat] },
          destination:         { type: 'Point' as const, coordinates: [toCoords.lng, toCoords.lat] },
          destination_bearing: bearing,
          direction_type:      'one_way' as const,
          day_of_week:         group.days,
          departure_time:      group.tType === 'departure' ? `${group.time}:00` : null,
          arrival_time:        group.tType === 'arrival'   ? `${group.time}:00` : null,
          origin_address:      fromLocation.fullAddress,
          dest_address:        toLocation.fullAddress,
          route_polyline:      routePolyline,
          available_seats:     activeMode === 'driver' ? availableSeats : null,
          end_date:            endDate || null,
          note:                note.trim() || null,
        })

        if (error) {
          setSubmitError(error.message)
          return
        }
      }

      // Also post each selected day as a ride_schedule so it appears on the Ride Board.
      // For each day-of-week, find the next upcoming date for that day.
      const today = new Date()
      const todayDow = today.getDay() // 0=Sun

      for (const { day, tType, time } of dayConfigs) {
        // Calculate next occurrence of this day-of-week
        let daysUntil = day - todayDow
        if (daysUntil <= 0) daysUntil += 7 // always next week if today or past
        const nextDate = new Date(today)
        nextDate.setDate(today.getDate() + daysUntil)
        const dateStr = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(nextDate.getDate()).padStart(2, '0')}`

        await supabase.from('ride_schedules').insert({
          user_id:          user.id,
          mode:             activeMode,
          route_name:       routeName.trim(),
          origin_place_id:  fromLocation.placeId,
          origin_address:   fromLocation.fullAddress,
          dest_place_id:    toLocation.placeId,
          dest_address:     toLocation.fullAddress,
          direction_type:   'one_way',
          trip_date:        dateStr,
          time_type:        tType,
          trip_time:        `${time}:00`,
          available_seats:  activeMode === 'driver' ? availableSeats : null,
          note:             note.trim() || null,
        })
        // Non-fatal if this fails — the routine is already saved
      }

      trackEvent('schedule_saved', { mode: activeMode, trip_type: 'routine' })

      // BUG-021: Notify matching drivers about the new routine rides (fire-and-forget)
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (session) {
          // Use the first group's time for the notification
          const firstGroup = groups.values().next().value
          const notifyTime = firstGroup ? `${firstGroup.time}:00` : `${sheetTime}:00`
          const notifyTimeType = firstGroup ? firstGroup.tType : sheetTimeType

          await fetch('/api/schedule/notify', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              origin_place_id: fromLocation.placeId,
              dest_place_id:   toLocation.placeId,
              trip_date:       todayString(),
              trip_time:       notifyTime,
              time_type:       notifyTimeType,
              mode: activeMode,
              origin_lat: fromCoords.lat,
              origin_lng: fromCoords.lng,
              dest_lat:   toCoords.lat,
              dest_lng:   toCoords.lng,
            }),
          })
        }
      } catch {
        // Notification failure is non-blocking
      }

      setShowConfirmation(true)
    } catch {
      setSubmitError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Confirmation screen ─────────────────────────────────────────────────
  if (showConfirmation) {
    return (
      <div
        data-testid="schedule-confirmation"
        className="min-h-dvh w-full bg-surface flex flex-col items-center justify-center px-6 font-sans"
      >
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success/10 mb-5">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="h-8 w-8 text-success" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-text-primary mb-2">
          {tripType === 'routine' ? 'Routine Saved!' : 'Ride Scheduled!'}
        </h2>
        <p className="text-sm text-text-secondary text-center max-w-xs mb-8">
          We&apos;ll match you with {activeMode === 'driver' ? 'riders' : 'drivers'} heading the same way and send you a notification when there&apos;s a match.
        </p>
        <PrimaryButton
          data-testid="confirmation-done-button"
          onClick={() => { navigate(activeMode === 'driver' ? '/home/driver' : '/home/rider', { replace: true }) }}
          className="w-full max-w-xs"
        >
          Done
        </PrimaryButton>
        <button
          data-testid="confirmation-board-button"
          onClick={() => { navigate('/rides/board', { replace: true }) }}
          className="mt-3 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
        >
          Browse upcoming rides
        </button>
      </div>
    )
  }

  return (
    <div
      data-testid={testId ?? 'schedule-page'}
      className="h-dvh w-full bg-surface flex flex-col font-sans overflow-hidden"
    >
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div
        className="bg-white border-b border-border px-4 py-4 shadow-sm"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 1rem)' }}
      >
        {step === 'details' && (
          <button
            data-testid="header-back-button"
            onClick={() => { navigate(-1) }}
            aria-label="Go back"
            className="flex items-center gap-1 text-sm text-text-secondary mb-2 hover:text-text-primary transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Back
          </button>
        )}
        <h1 className="text-xl font-bold text-text-primary">
          {step === 'one-time-schedule'
            ? 'Pick Date & Time'
            : step === 'routine-schedule'
              ? 'Pick Your Days'
              : `Schedule a ${activeMode === 'driver' ? 'Drive' : 'Ride'}`}
        </h1>
        <p className="text-sm text-text-secondary mt-1">
          {step === 'one-time-schedule'
            ? 'When do you want to travel?'
            : step === 'routine-schedule'
              ? 'Select the days you travel and set your times'
              : 'Where do you usually travel?'}
        </p>
      </div>

      {step === 'one-time-schedule' ? (
        /* ── One-Time Schedule Step ───────────────────────────────────────── */
        <>
          <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
            {/* Date Picker */}
            <div>
              <label
                htmlFor="trip-date"
                className="block text-sm font-medium text-text-primary mb-1"
              >
                Trip Date
              </label>
              <input
                id="trip-date"
                data-testid="trip-date-input"
                type="date"
                min={todayString()}
                value={tripDate}
                onChange={(e) => { setTripDate(e.target.value); setErrors({}) }}
                className={[
                  'w-full rounded-2xl border bg-white px-4 py-3',
                  'text-base text-text-primary',
                  'transition-colors duration-150',
                  'focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary',
                  errors.tripDate
                    ? 'border-danger focus:ring-danger'
                    : 'border-border',
                ].join(' ')}
              />
              {errors.tripDate && (
                <p data-testid="trip-date-error" className="text-xs text-danger mt-1">
                  {errors.tripDate}
                </p>
              )}
            </div>

            {/* Departure / Arrival / Anytime Toggle */}
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">
                Time is for
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  data-testid="time-type-departure"
                  onClick={() => { setTimeFlexible(false); setTimeType('departure') }}
                  className={[
                    'px-3 py-3 rounded-2xl border transition-all duration-150',
                    'font-medium text-sm',
                    !timeFlexible && timeType === 'departure'
                      ? 'bg-primary text-white border-primary'
                      : 'bg-white text-text-primary border-border hover:border-primary',
                  ].join(' ')}
                >
                  Departure
                </button>
                <button
                  data-testid="time-type-arrival"
                  onClick={() => { setTimeFlexible(false); setTimeType('arrival') }}
                  className={[
                    'px-3 py-3 rounded-2xl border transition-all duration-150',
                    'font-medium text-sm',
                    !timeFlexible && timeType === 'arrival'
                      ? 'bg-primary text-white border-primary'
                      : 'bg-white text-text-primary border-border hover:border-primary',
                  ].join(' ')}
                >
                  Arrival
                </button>
                <button
                  data-testid="time-type-anytime"
                  onClick={() => { setTimeFlexible(true); setErrors({}) }}
                  className={[
                    'px-3 py-3 rounded-2xl border transition-all duration-150',
                    'font-medium text-sm',
                    timeFlexible
                      ? 'bg-primary text-white border-primary'
                      : 'bg-white text-text-primary border-border hover:border-primary',
                  ].join(' ')}
                >
                  Anytime
                </button>
              </div>
              {timeFlexible && (
                <p className="text-xs text-text-secondary mt-2">
                  No specific time — anyone matching this date can propose a pickup window.
                </p>
              )}
            </div>

            {/* Time Picker — hidden when the poster chose Anytime */}
            {!timeFlexible && (
              <div>
                <label
                  htmlFor="trip-time"
                  className="block text-sm font-medium text-text-primary mb-1"
                >
                  {timeType === 'departure' ? 'Departure Time' : 'Arrival Time'}
                </label>
                <input
                  id="trip-time"
                  data-testid="trip-time-input"
                  type="time"
                  value={tripTime}
                  onChange={(e) => { setTripTime(e.target.value); setErrors({}) }}
                  className={[
                    'w-full rounded-2xl border bg-white px-4 py-3',
                    'text-base text-text-primary',
                    'transition-colors duration-150',
                    'focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary',
                    errors.tripTime
                      ? 'border-danger focus:ring-danger'
                      : 'border-border',
                  ].join(' ')}
                />
                {errors.tripTime && (
                  <p data-testid="trip-time-error" className="text-xs text-danger mt-1">
                    {errors.tripTime}
                  </p>
                )}
              </div>
            )}

            {/* Submit Error */}
            {submitError && (
              <p
                data-testid="submit-error"
                className="text-sm text-danger"
                role="alert"
              >
                {submitError}
              </p>
            )}
          </div>

          {/* Footer */}
          <div
            className="bg-white border-t border-border px-4 py-4 space-y-3"
            style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 1rem)' }}
          >
            <PrimaryButton
              data-testid="submit-schedule-button"
              onClick={() => { void handleSubmitSchedule() }}
              isLoading={isSubmitting}
            >
              Schedule Trip
            </PrimaryButton>
            <SecondaryButton
              data-testid="back-button"
              onClick={handleBack}
            >
              Back
            </SecondaryButton>
          </div>
        </>
      ) : step === 'routine-schedule' ? (
        /* ── Routine Schedule Step ────────────────────────────────────────── */
        <>
          <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
            {/* Day Pills */}
            <div>
              <label className="block text-sm font-medium text-text-primary mb-3">
                Which days do you travel?
              </label>
              <div className="flex justify-between gap-2">
                {ALL_DAYS.map((day) => (
                  <DayPill
                    key={day}
                    day={day}
                    selected={selectedDays.has(day)}
                    data-testid={`day-pill-${day}`}
                    onClick={() => { handleDayClick(day) }}
                  />
                ))}
              </div>
              {errors.days && (
                <p data-testid="days-error" className="text-xs text-danger mt-2">
                  {errors.days}
                </p>
              )}
            </div>

            {/* Inline time picker — visible when at least one day is selected */}
            {selectedDays.size > 0 && (
              <div className="space-y-4">
                {/* Mode toggle: same time vs per-day */}
                {selectedDays.size > 1 && (
                  <button
                    type="button"
                    data-testid="per-day-toggle"
                    onClick={() => {
                      if (!perDayMode && sheetTime) {
                        // Pre-fill every selected day with the current shared time
                        const prefilled = new Map(dayTimes)
                        for (const d of selectedDays) {
                          if (!prefilled.has(d) || !prefilled.get(d)?.time) {
                            prefilled.set(d, { timeType: sheetTimeType, time: sheetTime })
                          }
                        }
                        setDayTimes(prefilled)
                      }
                      setPerDayMode(!perDayMode)
                    }}
                    className="text-sm font-medium text-primary hover:text-primary/80 transition-colors"
                  >
                    {perDayMode ? 'Use same time for all days' : 'Set different time per day'}
                  </button>
                )}

                {perDayMode ? (
                  /* ── Per-day time pickers ─────────────────────────────── */
                  <div className="space-y-3">
                    {Array.from(selectedDays).sort((a, b) => a - b).map((day) => {
                      const cfg = dayTimes.get(day) ?? { timeType: 'departure' as TimeType, time: '' }
                      return (
                        <div
                          key={day}
                          data-testid={`day-time-row-${day}`}
                          className="rounded-2xl border border-border bg-white p-4 space-y-3"
                        >
                          <p className="text-sm font-semibold text-text-primary">{DAY_NAMES[day]}</p>

                          {/* Departure / Arrival Toggle */}
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              data-testid={`day-${day}-time-type-departure`}
                              onClick={() => {
                                const next = new Map(dayTimes)
                                next.set(day, { ...cfg, timeType: 'departure' })
                                setDayTimes(next)
                              }}
                              className={[
                                'px-3 py-2 rounded-xl border transition-all duration-150',
                                'font-medium text-xs',
                                cfg.timeType === 'departure'
                                  ? 'bg-primary text-white border-primary'
                                  : 'bg-white text-text-primary border-border hover:border-primary',
                              ].join(' ')}
                            >
                              Departure
                            </button>
                            <button
                              data-testid={`day-${day}-time-type-arrival`}
                              onClick={() => {
                                const next = new Map(dayTimes)
                                next.set(day, { ...cfg, timeType: 'arrival' })
                                setDayTimes(next)
                              }}
                              className={[
                                'px-3 py-2 rounded-xl border transition-all duration-150',
                                'font-medium text-xs',
                                cfg.timeType === 'arrival'
                                  ? 'bg-primary text-white border-primary'
                                  : 'bg-white text-text-primary border-border hover:border-primary',
                              ].join(' ')}
                            >
                              Arrival
                            </button>
                          </div>

                          {/* Time Input */}
                          <input
                            data-testid={`day-${day}-time-input`}
                            type="time"
                            value={cfg.time}
                            onChange={(e) => {
                              const next = new Map(dayTimes)
                              next.set(day, { ...cfg, time: e.target.value })
                              setDayTimes(next)
                            }}
                            className={[
                              'w-full rounded-xl border bg-white px-3 py-2 text-sm text-text-primary',
                              'transition-colors duration-150',
                              'focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary',
                              errors[`dayTime_${day}`] ? 'border-danger' : 'border-border',
                            ].join(' ')}
                          />
                          {errors[`dayTime_${day}`] && (
                            <p className="text-xs text-danger">{errors[`dayTime_${day}`]}</p>
                          )}
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  /* ── Shared time picker (same for all days) ──────────── */
                  <div className="space-y-4 rounded-2xl border border-border bg-white p-4">
                    <p className="text-sm font-medium text-text-primary">
                      Set time for {selectedDays.size === 1 ? '1 day' : `${selectedDays.size} days`}
                    </p>

                    {/* Departure / Arrival Toggle */}
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        data-testid="sheet-time-type-departure"
                        onClick={() => { setSheetTimeType('departure') }}
                        className={[
                          'px-4 py-3 rounded-2xl border transition-all duration-150',
                          'font-medium text-sm',
                          sheetTimeType === 'departure'
                            ? 'bg-primary text-white border-primary'
                            : 'bg-white text-text-primary border-border hover:border-primary',
                        ].join(' ')}
                      >
                        Departure
                      </button>
                      <button
                        data-testid="sheet-time-type-arrival"
                        onClick={() => { setSheetTimeType('arrival') }}
                        className={[
                          'px-4 py-3 rounded-2xl border transition-all duration-150',
                          'font-medium text-sm',
                          sheetTimeType === 'arrival'
                            ? 'bg-primary text-white border-primary'
                            : 'bg-white text-text-primary border-border hover:border-primary',
                        ].join(' ')}
                      >
                        Arrival
                      </button>
                    </div>

                    {/* Time Picker */}
                    <div>
                      <label
                        htmlFor="routine-time"
                        className="block text-sm font-medium text-text-primary mb-1"
                      >
                        {sheetTimeType === 'departure' ? 'Departure Time' : 'Arrival Time'}
                      </label>
                      <input
                        id="routine-time"
                        data-testid="sheet-time-input"
                        type="time"
                        value={sheetTime}
                        onChange={(e) => { setSheetTime(e.target.value) }}
                        className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-base text-text-primary transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                      />
                      {errors.routineTime && (
                        <p data-testid="time-error" className="text-xs text-danger mt-2">
                          {errors.routineTime}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* End Date (optional) */}
            <div>
              <label
                htmlFor="end-date"
                className="block text-sm font-medium text-text-primary mb-1"
              >
                End Date <span className="text-text-secondary font-normal">(optional)</span>
              </label>
              <input
                id="end-date"
                data-testid="end-date-input"
                type="date"
                min={todayString()}
                value={endDate}
                onChange={(e) => { setEndDate(e.target.value) }}
                className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-base text-text-primary transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
              />
              <p className="text-xs text-text-secondary mt-1">
                Leave blank for an ongoing routine
              </p>
            </div>

            {/* Submit Error */}
            {submitError && (
              <p
                data-testid="submit-error"
                className="text-sm text-danger"
                role="alert"
              >
                {submitError}
              </p>
            )}
          </div>

          {/* Footer */}
          <div
            className="bg-white border-t border-border px-4 py-4 space-y-3"
            style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 1rem)' }}
          >
            <PrimaryButton
              data-testid="submit-routine-button"
              onClick={() => { void handleSubmitRoutine() }}
              isLoading={isSubmitting}
            >
              Save Routine
            </PrimaryButton>
            <SecondaryButton
              data-testid="back-button"
              onClick={handleBack}
            >
              Back
            </SecondaryButton>
          </div>
        </>
      ) : (
        /* ── Details Step (existing form) ─────────────────────────────────── */
        <>

      {/* ── Form ────────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">

        {/* Driver / Rider Toggle — only shown if user is a registered driver */}
        {isDriver && (
        <div>
          <label className="block text-sm font-medium text-text-primary mb-2">
            I am a
          </label>
          <div className="grid grid-cols-2 gap-3">
            <button
              data-testid="mode-driver"
              onClick={() => { setActiveMode('driver') }}
              className={[
                'flex items-center justify-center gap-2 px-4 py-3 rounded-2xl border transition-all duration-150',
                'font-medium text-sm',
                activeMode === 'driver'
                  ? 'bg-primary text-white border-primary'
                  : 'bg-white text-text-primary border-border hover:border-primary',
              ].join(' ')}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
                <path d="M5 17h-2a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h1l1.6-4.5A2 2 0 0 1 7.5 5h9a2 2 0 0 1 1.9 1.5L20 11h1a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-2" />
                <circle cx="7.5" cy="17" r="2.5" />
                <circle cx="16.5" cy="17" r="2.5" />
                <path d="M5 11h14" />
              </svg>
              Driver
            </button>
            <button
              data-testid="mode-rider"
              onClick={() => { setActiveMode('rider') }}
              className={[
                'flex items-center justify-center gap-2 px-4 py-3 rounded-2xl border transition-all duration-150',
                'font-medium text-sm',
                activeMode === 'rider'
                  ? 'bg-primary text-white border-primary'
                  : 'bg-white text-text-primary border-border hover:border-primary',
              ].join(' ')}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              Rider
            </button>
          </div>
        </div>
        )}

        {/* From Location */}
        <div className="relative">
          <label className="block text-sm font-medium text-text-primary mb-1">
            From
          </label>
          <div className="relative">
            <input
              ref={fromInputRef}
              data-testid="from-location-input"
              type="text"
              placeholder="Enter starting location"
              value={fromQuery}
              onChange={(e) => { handleFromInputChange(e.target.value) }}
              onFocus={() => { setShowFromDropdown(true) }}
              className={[
                'w-full rounded-2xl border bg-white px-4 py-3',
                'text-base text-text-primary placeholder:text-text-secondary',
                'transition-colors duration-150',
                'focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary',
                errors.fromLocation
                  ? 'border-danger focus:ring-danger'
                  : 'border-border',
              ].join(' ')}
            />
            {fromLoading && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            )}
          </div>
          {errors.fromLocation && (
            <p data-testid="from-location-error" className="text-xs text-danger mt-1">
              {errors.fromLocation}
            </p>
          )}

          {/* From suggestions dropdown */}
          {showFromDropdown && fromSuggestions.length > 0 && (
            <div
              data-testid="from-suggestions"
              className="absolute z-10 mt-1 w-full bg-white rounded-2xl border border-border shadow-lg max-h-64 overflow-y-auto"
            >
              {fromSuggestions.map((suggestion) => (
                <button
                  key={suggestion.placeId}
                  data-testid={`from-suggestion-${suggestion.placeId}`}
                  onClick={() => { handleFromSelect(suggestion) }}
                  className="w-full text-left px-4 py-3 hover:bg-surface transition-colors border-b border-border last:border-0"
                >
                  <p className="text-sm font-medium text-text-primary">
                    {suggestion.mainText}
                  </p>
                  <p className="text-xs text-text-secondary">
                    {suggestion.secondaryText}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* To Location */}
        <div className="relative">
          <label className="block text-sm font-medium text-text-primary mb-1">
            To
          </label>
          <div className="relative">
            <input
              ref={toInputRef}
              data-testid="to-location-input"
              type="text"
              placeholder="Enter destination"
              value={toQuery}
              onChange={(e) => { handleToInputChange(e.target.value) }}
              onFocus={() => { setShowToDropdown(true) }}
              className={[
                'w-full rounded-2xl border bg-white px-4 py-3',
                'text-base text-text-primary placeholder:text-text-secondary',
                'transition-colors duration-150',
                'focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary',
                errors.toLocation
                  ? 'border-danger focus:ring-danger'
                  : 'border-border',
              ].join(' ')}
            />
            {toLoading && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            )}
          </div>
          {errors.toLocation && (
            <p data-testid="to-location-error" className="text-xs text-danger mt-1">
              {errors.toLocation}
            </p>
          )}

          {/* To suggestions dropdown */}
          {showToDropdown && toSuggestions.length > 0 && (
            <div
              data-testid="to-suggestions"
              className="absolute z-10 mt-1 w-full bg-white rounded-2xl border border-border shadow-lg max-h-64 overflow-y-auto"
            >
              {toSuggestions.map((suggestion) => (
                <button
                  key={suggestion.placeId}
                  data-testid={`to-suggestion-${suggestion.placeId}`}
                  onClick={() => { handleToSelect(suggestion) }}
                  className="w-full text-left px-4 py-3 hover:bg-surface transition-colors border-b border-border last:border-0"
                >
                  <p className="text-sm font-medium text-text-primary">
                    {suggestion.mainText}
                  </p>
                  <p className="text-xs text-text-secondary">
                    {suggestion.secondaryText}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Trip Type */}
        <div>
          <label className="block text-sm font-medium text-text-primary mb-2">
            Is this a one-time trip or part of your routine?
          </label>
          <div className="grid grid-cols-2 gap-3">
            <button
              data-testid="trip-type-one-time"
              onClick={() => { setTripType('one-time') }}
              className={[
                'px-4 py-3 rounded-2xl border transition-all duration-150',
                'font-medium text-sm',
                tripType === 'one-time'
                  ? 'bg-primary text-white border-primary'
                  : 'bg-white text-text-primary border-border hover:border-primary',
              ].join(' ')}
            >
              Just this once
            </button>
            <button
              data-testid="trip-type-routine"
              onClick={() => { setTripType('routine') }}
              className={[
                'px-4 py-3 rounded-2xl border transition-all duration-150',
                'font-medium text-sm',
                tripType === 'routine'
                  ? 'bg-primary text-white border-primary'
                  : 'bg-white text-text-primary border-border hover:border-primary',
              ].join(' ')}
            >
              Part of my routine
            </button>
          </div>
        </div>

        {/* Available Seats (driver only) — compact inline row */}
        {activeMode === 'driver' && (
          <div className="flex items-center justify-between rounded-2xl border border-border bg-white px-4 py-3">
            <span className="text-sm font-medium text-text-primary">Available Seats</span>
            <div className="flex items-center gap-3">
              <button
                data-testid="seats-decrease"
                onClick={() => { setAvailableSeats((s) => Math.max(1, s - 1)) }}
                disabled={availableSeats <= 1}
                className={[
                  'h-8 w-8 rounded-full border flex items-center justify-center text-sm font-bold transition-colors',
                  availableSeats <= 1
                    ? 'border-border text-text-secondary/40 cursor-not-allowed'
                    : 'border-primary text-primary active:bg-primary/10',
                ].join(' ')}
                aria-label="Decrease seats"
              >
                −
              </button>
              <span
                data-testid="seats-count"
                className="text-base font-bold text-text-primary w-5 text-center"
              >
                {availableSeats}
              </span>
              <button
                data-testid="seats-increase"
                onClick={() => { setAvailableSeats((s) => Math.min(6, s + 1)) }}
                disabled={availableSeats >= 6}
                className={[
                  'h-8 w-8 rounded-full border flex items-center justify-center text-sm font-bold transition-colors',
                  availableSeats >= 6
                    ? 'border-border text-text-secondary/40 cursor-not-allowed'
                    : 'border-primary text-primary active:bg-primary/10',
                ].join(' ')}
                aria-label="Increase seats"
              >
                +
              </button>
            </div>
          </div>
        )}

        {/* Route Name (optional, only for routines) */}
        {tripType === 'routine' && (
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">
              Route Name <span className="text-text-secondary font-normal">(optional)</span>
            </label>
            <input
              data-testid="route-name-input"
              type="text"
              placeholder="e.g. Home to SF"
              value={routeName}
              onChange={(e) => { setRouteName(e.target.value) }}
              className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
            />
          </div>
        )}

        {/* Note */}
        <div>
          <label
            htmlFor="schedule-note"
            className="block text-sm font-medium text-text-primary mb-1"
          >
            Note <span className="text-text-secondary font-normal">(optional)</span>
          </label>
          <textarea
            id="schedule-note"
            data-testid="note-input"
            value={note}
            onChange={(e) => { setNote(e.target.value) }}
            placeholder={activeMode === 'driver'
              ? 'e.g. No smoking, large trunk available'
              : 'e.g. I have a suitcase, 2 passengers'}
            maxLength={200}
            rows={2}
            className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary resize-none transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
          />
          <p className="text-xs text-text-secondary mt-1 text-right">
            {note.length}/200
          </p>
        </div>
      </div>

      {/* ── Footer Actions ──────────────────────────────────────────────────── */}
      <div
        className="bg-white border-t border-border px-4 py-4 space-y-3"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 1rem)' }}
      >
        <PrimaryButton
          data-testid="continue-button"
          onClick={handleContinue}
        >
          Continue
        </PrimaryButton>
        <SecondaryButton
          data-testid="cancel-button"
          onClick={() => { window.history.back() }}
        >
          Cancel
        </SecondaryButton>
      </div>
        </>
      )}
    </div>
  )
}
