import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import InputField from '@/components/ui/InputField'
import PrimaryButton from '@/components/ui/PrimaryButton'
import SecondaryButton from '@/components/ui/SecondaryButton'
import { trackEvent } from '@/lib/analytics'
import DayPill from '@/components/ui/DayPill'
import type { DayIndex } from '@/components/ui/DayPill'
import BottomSheet from '@/components/ui/BottomSheet'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import {
  searchPlaces,
  getPlaceCoordinates,
  type PlaceSuggestion,
} from '@/lib/places'
import { calculateBearing } from '@/lib/geo'
import { getDirectionsByLatLng } from '@/lib/directions'

// ── Types ─────────────────────────────────────────────────────────────────────

interface SchedulePageProps {
  mode: 'driver' | 'rider'
  'data-testid'?: string
}

type DirectionType = 'one-way' | 'roundtrip'
type TripType = 'one-time' | 'routine'
type TimeType = 'departure' | 'arrival'
type Step = 'details' | 'one-time-schedule' | 'routine-schedule'

const ALL_DAYS: DayIndex[] = [0, 1, 2, 3, 4, 5, 6]

const DAY_NAMES: Record<DayIndex, string> = {
  0: 'Sunday',
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
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

export default function SchedulePage({ mode, 'data-testid': testId }: SchedulePageProps) {
  const navigate = useNavigate()

  // Step state
  const [step, setStep] = useState<Step>('details')
  const [showConfirmation, setShowConfirmation] = useState(false)

  // Form state
  const [routeName, setRouteName] = useState('')
  const [fromLocation, setFromLocation] = useState<PlaceSuggestion | null>(null)
  const [toLocation, setToLocation] = useState<PlaceSuggestion | null>(null)
  const [directionType, setDirectionType] = useState<DirectionType>('one-way')
  const [tripType, setTripType] = useState<TripType>('one-time')

  // One-time schedule state
  const [tripDate, setTripDate] = useState('')
  const [timeType, setTimeType] = useState<TimeType>('departure')
  const [tripTime, setTripTime] = useState('')
  const [isSubmitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Routine schedule state
  const [selectedDays, setSelectedDays] = useState<Set<DayIndex>>(new Set())
  const [dayTimes, setDayTimes] = useState<Map<DayIndex, DayTimeConfig>>(new Map())
  const [bottomSheetDay, setBottomSheetDay] = useState<DayIndex | null>(null)
  const [sheetTimeType, setSheetTimeType] = useState<TimeType>('departure')
  const [sheetTime, setSheetTime] = useState('')

  const user = useAuthStore((s) => s.user)

  // From location autocomplete state
  const [fromQuery, setFromQuery] = useState('')
  const [fromSuggestions, setFromSuggestions] = useState<PlaceSuggestion[]>([])
  const [fromLoading, setFromLoading] = useState(false)
  const [showFromDropdown, setShowFromDropdown] = useState(false)
  const fromInputRef = useRef<HTMLInputElement>(null)

  // To location autocomplete state
  const [toQuery, setToQuery] = useState('')
  const [toSuggestions, setToSuggestions] = useState<PlaceSuggestion[]>([])
  const [toLoading, setToLoading] = useState(false)
  const [showToDropdown, setShowToDropdown] = useState(false)
  const toInputRef = useRef<HTMLInputElement>(null)

  // Validation state
  const [errors, setErrors] = useState<Record<string, string>>({})

  // ── From location debounced search ─────────────────────────────────────────

  useEffect(() => {
    if (!fromQuery.trim()) {
      setFromSuggestions([])
      setFromLoading(false)
      return
    }

    const timer = setTimeout(() => {
      setFromLoading(true)
      void searchPlaces(fromQuery).then((results) => {
        setFromSuggestions(results)
        setFromLoading(false)
      })
    }, 300)

    return () => { clearTimeout(timer) }
  }, [fromQuery])

  // ── To location debounced search ───────────────────────────────────────────

  useEffect(() => {
    if (!toQuery.trim()) {
      setToSuggestions([])
      setToLoading(false)
      return
    }

    const timer = setTimeout(() => {
      setToLoading(true)
      void searchPlaces(toQuery).then((results) => {
        setToSuggestions(results)
        setToLoading(false)
      })
    }, 300)

    return () => { clearTimeout(timer) }
  }, [toQuery])

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

    if (!routeName.trim()) {
      newErrors.routeName = 'Please enter a route name'
    }

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

    if (!tripTime) {
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

  async function handleSubmitSchedule() {
    if (!validateSchedule()) return
    if (!user || !fromLocation || !toLocation) return

    setSubmitting(true)
    setSubmitError(null)

    try {
      const { error } = await supabase.from('ride_schedules').insert({
        user_id:          user.id,
        mode,
        route_name:       routeName.trim(),
        origin_place_id:  fromLocation.placeId,
        origin_address:   fromLocation.fullAddress,
        dest_place_id:    toLocation.placeId,
        dest_address:     toLocation.fullAddress,
        direction_type:   directionType === 'one-way' ? 'one_way' : 'roundtrip',
        trip_date:        tripDate,
        time_type:        timeType,
        trip_time:        `${tripTime}:00`,
      }).select('id')

      if (error) {
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
            trip_time:       `${tripTime}:00`,
            time_type:       timeType,
            mode,
          }),
        })
      } catch {
        // Notification failure is non-blocking
      }

      trackEvent('schedule_saved', { mode, trip_type: 'one-time' })
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
      // Already selected — check if it has a time configured
      const existing = dayTimes.get(day)
      if (existing?.time) {
        // Has time set → open sheet to edit
        setSheetTimeType(existing.timeType)
        setSheetTime(existing.time)
        setBottomSheetDay(day)
      } else {
        // No time set yet → deselect (toggle off)
        next.delete(day)
        setSelectedDays(next)
        const nextTimes = new Map(dayTimes)
        nextTimes.delete(day)
        setDayTimes(nextTimes)
        return
      }
    } else {
      // Not selected → select + open sheet
      next.add(day)
      setSelectedDays(next)
      setSheetTimeType('departure')
      setSheetTime('')
      setBottomSheetDay(day)
    }
  }

  function handleSheetSave() {
    if (bottomSheetDay === null) return
    const next = new Map(dayTimes)
    next.set(bottomSheetDay, { timeType: sheetTimeType, time: sheetTime })
    setDayTimes(next)
    setBottomSheetDay(null)
    setErrors({})
  }

  function handleSheetRemove() {
    if (bottomSheetDay === null) return
    const nextDays = new Set(selectedDays)
    nextDays.delete(bottomSheetDay)
    setSelectedDays(nextDays)
    const nextTimes = new Map(dayTimes)
    nextTimes.delete(bottomSheetDay)
    setDayTimes(nextTimes)
    setBottomSheetDay(null)
  }

  function validateRoutine(): boolean {
    const newErrors: Record<string, string> = {}

    if (selectedDays.size === 0) {
      newErrors.days = 'Please select at least one day'
    }

    for (const day of selectedDays) {
      const cfg = dayTimes.get(day)
      if (!cfg || !cfg.time) {
        newErrors.days = 'Please set a time for each selected day'
        break
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

    try {
      // Geocode both places
      const [fromCoords, toCoords] = await Promise.all([
        getPlaceCoordinates(fromLocation.placeId),
        getPlaceCoordinates(toLocation.placeId),
      ])

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

      // Group days by identical time config to minimise records
      const groups = new Map<string, { days: number[]; timeType: TimeType; time: string }>()
      for (const day of selectedDays) {
        const cfg = dayTimes.get(day)
        if (!cfg) continue
        const key = `${cfg.timeType}|${cfg.time}`
        const existing = groups.get(key)
        if (existing) {
          existing.days.push(day)
        } else {
          groups.set(key, { days: [day], timeType: cfg.timeType, time: cfg.time })
        }
      }

      for (const group of groups.values()) {
        const { error } = await supabase.from('driver_routines').insert({
          user_id:             user.id,
          route_name:          routeName.trim(),
          origin:              { type: 'Point' as const, coordinates: [fromCoords.lng, fromCoords.lat] },
          destination:         { type: 'Point' as const, coordinates: [toCoords.lng, toCoords.lat] },
          destination_bearing: bearing,
          direction_type:      directionType === 'one-way' ? 'one_way' as const : 'roundtrip' as const,
          day_of_week:         group.days,
          departure_time:      group.timeType === 'departure' ? `${group.time}:00` : null,
          arrival_time:        group.timeType === 'arrival'   ? `${group.time}:00` : null,
          origin_address:      fromLocation.fullAddress,
          dest_address:        toLocation.fullAddress,
          route_polyline:      routePolyline,
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

      for (const day of selectedDays) {
        const cfg = dayTimes.get(day)
        if (!cfg) continue

        // Calculate next occurrence of this day-of-week
        let daysUntil = day - todayDow
        if (daysUntil <= 0) daysUntil += 7 // always next week if today or past
        const nextDate = new Date(today)
        nextDate.setDate(today.getDate() + daysUntil)
        const dateStr = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(nextDate.getDate()).padStart(2, '0')}`

        await supabase.from('ride_schedules').insert({
          user_id:          user.id,
          mode,
          route_name:       routeName.trim(),
          origin_place_id:  fromLocation.placeId,
          origin_address:   fromLocation.fullAddress,
          dest_place_id:    toLocation.placeId,
          dest_address:     toLocation.fullAddress,
          direction_type:   directionType === 'one-way' ? 'one_way' : 'roundtrip',
          trip_date:        dateStr,
          time_type:        cfg.timeType,
          trip_time:        `${cfg.time}:00`,
        })
        // Non-fatal if this fails — the routine is already saved
      }

      trackEvent('schedule_saved', { mode, trip_type: 'routine' })
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
          We&apos;ll match you with {mode === 'driver' ? 'riders' : 'drivers'} heading the same way and send you a notification when there&apos;s a match.
        </p>
        <PrimaryButton
          data-testid="confirmation-done-button"
          onClick={() => { navigate(mode === 'driver' ? '/home/driver' : '/home/rider', { replace: true }) }}
          className="w-full max-w-xs"
        >
          Done
        </PrimaryButton>
        <button
          data-testid="confirmation-board-button"
          onClick={() => { navigate('/rides/board', { replace: true }) }}
          className="mt-3 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
        >
          Browse Ride Board
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
              : `Schedule a ${mode === 'driver' ? 'Drive' : 'Ride'}`}
        </h1>
        <p className="text-sm text-text-secondary mt-1">
          {step === 'one-time-schedule'
            ? 'When do you want to travel?'
            : step === 'routine-schedule'
              ? 'Select the days you travel and set a time for each'
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

            {/* Departure / Arrival Toggle */}
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">
                Time is for
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  data-testid="time-type-departure"
                  onClick={() => { setTimeType('departure') }}
                  className={[
                    'px-4 py-3 rounded-2xl border transition-all duration-150',
                    'font-medium text-sm',
                    timeType === 'departure'
                      ? 'bg-primary text-white border-primary'
                      : 'bg-white text-text-primary border-border hover:border-primary',
                  ].join(' ')}
                >
                  Departure
                </button>
                <button
                  data-testid="time-type-arrival"
                  onClick={() => { setTimeType('arrival') }}
                  className={[
                    'px-4 py-3 rounded-2xl border transition-all duration-150',
                    'font-medium text-sm',
                    timeType === 'arrival'
                      ? 'bg-primary text-white border-primary'
                      : 'bg-white text-text-primary border-border hover:border-primary',
                  ].join(' ')}
                >
                  Arrival
                </button>
              </div>
            </div>

            {/* Time Picker */}
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

            {/* Configured days summary */}
            {selectedDays.size > 0 && (
              <div className="space-y-2">
                <label className="block text-sm font-medium text-text-primary">
                  Scheduled times
                </label>
                {Array.from(selectedDays).sort().map((day) => {
                  const cfg = dayTimes.get(day)
                  return (
                    <button
                      key={day}
                      data-testid={`day-summary-${day}`}
                      onClick={() => { handleDayClick(day) }}
                      className="w-full flex items-center justify-between rounded-2xl border border-border bg-white px-4 py-3 text-left hover:bg-surface transition-colors"
                    >
                      <span className="text-sm font-medium text-text-primary">
                        {DAY_NAMES[day]}
                      </span>
                      <span className="text-sm text-text-secondary">
                        {cfg?.time
                          ? `${cfg.timeType === 'departure' ? 'Dep' : 'Arr'} ${cfg.time}`
                          : 'Tap to set time'}
                      </span>
                    </button>
                  )
                })}
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

          {/* BottomSheet for per-day time config */}
          <BottomSheet
            isOpen={bottomSheetDay !== null}
            onClose={() => { setBottomSheetDay(null) }}
            title={bottomSheetDay !== null ? `Set Time — ${DAY_NAMES[bottomSheetDay]}` : ''}
            data-testid="day-time-sheet"
          >
            <div className="space-y-5">
              {/* Departure / Arrival Toggle */}
              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">
                  Time is for
                </label>
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
              </div>

              {/* Time Picker */}
              <div>
                <label
                  htmlFor="sheet-time"
                  className="block text-sm font-medium text-text-primary mb-1"
                >
                  {sheetTimeType === 'departure' ? 'Departure Time' : 'Arrival Time'}
                </label>
                <input
                  id="sheet-time"
                  data-testid="sheet-time-input"
                  type="time"
                  value={sheetTime}
                  onChange={(e) => { setSheetTime(e.target.value) }}
                  className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-base text-text-primary transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                />
              </div>

              {/* Actions */}
              <div className="space-y-3">
                <PrimaryButton
                  data-testid="sheet-save-button"
                  onClick={handleSheetSave}
                  disabled={!sheetTime}
                >
                  Save
                </PrimaryButton>
                {bottomSheetDay !== null && selectedDays.has(bottomSheetDay) && dayTimes.has(bottomSheetDay) && (
                  <button
                    data-testid="sheet-remove-button"
                    onClick={handleSheetRemove}
                    className="w-full py-3 text-sm font-medium text-danger hover:text-danger/80 transition-colors"
                  >
                    Remove Day
                  </button>
                )}
              </div>
            </div>
          </BottomSheet>

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

        {/* Route Name */}
        <div>
          <InputField
            data-testid="route-name-input"
            label="Route Name"
            placeholder="e.g. Home to SF"
            value={routeName}
            onChange={(e) => { setRouteName(e.target.value) }}
            error={errors.routeName}
            hint="Give this route a memorable name"
          />
        </div>

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

        {/* Direction Type */}
        <div>
          <label className="block text-sm font-medium text-text-primary mb-2">
            Direction
          </label>
          <div className="grid grid-cols-2 gap-3">
            <button
              data-testid="direction-one-way"
              onClick={() => { setDirectionType('one-way') }}
              className={[
                'px-4 py-3 rounded-2xl border transition-all duration-150',
                'font-medium text-sm',
                directionType === 'one-way'
                  ? 'bg-primary text-white border-primary'
                  : 'bg-white text-text-primary border-border hover:border-primary',
              ].join(' ')}
            >
              One-way
            </button>
            <button
              data-testid="direction-roundtrip"
              onClick={() => { setDirectionType('roundtrip') }}
              className={[
                'px-4 py-3 rounded-2xl border transition-all duration-150',
                'font-medium text-sm',
                directionType === 'roundtrip'
                  ? 'bg-primary text-white border-primary'
                  : 'bg-white text-text-primary border-border hover:border-primary',
              ].join(' ')}
            >
              Roundtrip
            </button>
          </div>
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
