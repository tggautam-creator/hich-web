import { useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { formatCents } from '@/lib/fare'
import AppIcon from '@/components/ui/AppIcon'
import { getNavigationUrl } from '@/lib/pwa'
import type { Ride, User, Vehicle } from '@/types/database'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TransitInfoData {
  station_name: string
  transit_options: Array<{
    type: string
    icon: string
    line_name: string
    departure_stop?: string
    arrival_stop?: string
    duration_minutes?: number
    walk_minutes: number
    total_minutes: number
  }>
  walk_to_station_minutes: number
  transit_to_dest_minutes: number
  rider_dest_name: string
  total_rider_minutes: number
  // Coordinates for Google Maps transit link
  dropoff_lat: number
  dropoff_lng: number
  rider_dest_lat: number
  rider_dest_lng: number
}

interface JourneyDrawerProps {
  ride: Ride
  driver?: Pick<User, 'id' | 'full_name' | 'avatar_url' | 'rating_avg' | 'rating_count'> | null
  rider?: Pick<User, 'id' | 'full_name' | 'avatar_url' | 'rating_avg' | 'rating_count'> | null
  vehicle?: Pick<Vehicle, 'color' | 'plate' | 'make' | 'model'> | null
  isRider: boolean
  estimatedFare?: number | null
  etaMinutes?: number | null
  distanceKm?: number | null
  onShowQr: () => void
  onNavigate: () => void
  onChat: () => void
  onEmergency: () => void
  unreadChat?: number
  // Signal (rider pickup)
  onSignal?: () => void
  signalled?: boolean
  signalling?: boolean
  // Start ride (pickup screens)
  startRideLabel?: string
  // End/Cancel ride
  onEndRide?: () => void
  onCancelRide?: () => void
  endRideLabel?: string
  // Progress bar
  progress?: number | null
  progressLabel?: string
  remainingLabel?: string
  // Hide ETA column (active ride screens)
  hideEta?: boolean
  // Transit remaining journey (rider active ride)
  transitInfo?: TransitInfoData | null
  // Pickup note override
  pickupNote?: string | null
  'data-testid'?: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

// Fixed pixel heights for each drawer section visible when collapsed
const HANDLE_H = 36     // drag handle (pt-3 pb-1 + bar)
const ACTION_ROW_H = 76 // QR / Navigate / Chat row + bottom border
const EXTRA_ROW_H = 48  // each extra button row (Signal, Start Ride, End Ride, Cancel)

const EXPANDED_Y = 25   // % from top (expanded = 75% of screen)
const SNAP_THRESHOLD = 15 // % drag required to switch state

// ── Component ─────────────────────────────────────────────────────────────────

export default function JourneyDrawer({
  ride, driver, rider, vehicle, isRider, estimatedFare, etaMinutes, distanceKm,
  onShowQr, onNavigate, onChat, onEmergency, unreadChat = 0,
  onSignal, signalled, signalling,
  startRideLabel,
  onEndRide, onCancelRide, endRideLabel,
  progress, progressLabel, remainingLabel,
  hideEta,
  transitInfo,
  pickupNote,
  'data-testid': testId = 'journey-drawer',
}: JourneyDrawerProps) {
  // Fixed-pixel collapsed height: only buttons visible, nothing else
  const extraRows = (onSignal ? 1 : 0) + (startRideLabel ? 1 : 0) + (onEndRide ? 1 : 0) + (onCancelRide ? 1 : 0)
  const collapsedPx = HANDLE_H + ACTION_ROW_H + extraRows * EXTRA_ROW_H

  const [expanded, setExpanded] = useState(false)
  // translateY is in % for expanded, but we use CSS calc for collapsed
  const [dragging, setDragging] = useState(false)
  const [dragTopPx, setDragTopPx] = useState(0)
  const dragRef = useRef<{ startY: number; startTopPx: number } | null>(null)

  // Collapsed top = window.innerHeight - collapsedPx
  // Expanded top = EXPANDED_Y% of viewport
  const collapsedTop = `calc(100dvh - ${collapsedPx}px)`
  const expandedTop = `${EXPANDED_Y}dvh`

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const el = e.currentTarget.closest('[data-testid]') as HTMLElement | null
    const currentTop = el ? el.getBoundingClientRect().top : 0
    dragRef.current = { startY: e.touches[0].clientY, startTopPx: currentTop }
    setDragging(true)
    setDragTopPx(currentTop)
  }, [])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!dragRef.current) return
    const deltaY = e.touches[0].clientY - dragRef.current.startY
    const minTop = (EXPANDED_Y / 100) * window.innerHeight
    const maxTop = window.innerHeight - collapsedPx
    const newTop = Math.max(minTop, Math.min(maxTop, dragRef.current.startTopPx + deltaY))
    setDragTopPx(newTop)
  }, [collapsedPx])

  const handleTouchEnd = useCallback(() => {
    if (!dragRef.current) return
    const moved = dragTopPx - dragRef.current.startTopPx
    const threshold = window.innerHeight * (SNAP_THRESHOLD / 100)
    if (Math.abs(moved) > threshold) {
      setExpanded(moved < 0)
    }
    setDragging(false)
    dragRef.current = null
  }, [dragTopPx])

  const toggleExpand = useCallback(() => {
    setExpanded((prev) => !prev)
  }, [])

  const otherPerson = isRider ? driver : rider
  const fareDisplay = estimatedFare ?? ride.fare_cents
  const noteDisplay = pickupNote ?? ride.pickup_note

  const portalTarget =
    (typeof document !== 'undefined' && document.getElementById('portal-root')) ||
    (typeof document !== 'undefined' ? document.body : null)

  if (!portalTarget) return null

  return createPortal(
    <>
      {/* Backdrop when expanded */}
      {expanded && (
        <div
          className="fixed inset-0 bg-black/30 z-[900]"
          onClick={toggleExpand}
          data-testid="drawer-backdrop"
        />
      )}

      {/* Safety pill — floats above drawer */}
      <button
        type="button"
        onClick={onEmergency}
        data-testid="safety-button"
        className={`fixed left-4 z-[915] flex items-center gap-1 rounded-full bg-white shadow-md border border-danger/20 px-3 py-1.5 text-xs font-semibold text-danger active:bg-danger/10 ${dragging ? '' : 'transition-all duration-300 ease-out'}`}
        style={{ top: dragging ? `${dragTopPx - 44}px` : `calc(${expanded ? expandedTop : collapsedTop} - 44px)` }}
      >
        <AppIcon name="shield" className="h-4 w-4" />
        Safety
      </button>

      {/* Drawer */}
      <div
        data-testid={testId}
        className={`fixed left-0 right-0 z-[910] bg-white rounded-t-3xl shadow-2xl flex flex-col ${dragging ? '' : 'transition-[top] duration-300 ease-out'}`}
        style={{ top: dragging ? `${dragTopPx}px` : (expanded ? expandedTop : collapsedTop), bottom: 0 }}
      >
          {/* Drag handle */}
          <div
            className="flex justify-center pt-3 pb-1 cursor-grab"
            onClick={toggleExpand}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            <div className="w-10 h-1 rounded-full bg-border" />
          </div>

          {/* Action buttons row — always visible */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border gap-2">
            <button
              type="button"
              onClick={onShowQr}
              data-testid="drawer-qr-button"
              className="flex-1 flex flex-col items-center gap-1 px-3 py-2 rounded-xl bg-primary/10 active:bg-primary/20"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-primary" aria-hidden="true">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="4" height="4" rx="0.5" />
              </svg>
              <span className="text-[10px] font-medium text-primary">{isRider ? 'Scan QR' : 'Show QR'}</span>
            </button>

            <button
              type="button"
              onClick={onNavigate}
              data-testid="drawer-navigate-button"
              className="flex-1 flex flex-col items-center gap-1 px-3 py-2 rounded-xl bg-success/10 active:bg-success/20"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-success" aria-hidden="true">
                <polygon points="3 11 22 2 13 21 11 13 3 11" />
              </svg>
              <span className="text-[10px] font-medium text-success">Navigate</span>
            </button>

            <button
              type="button"
              onClick={onChat}
              data-testid="drawer-chat-button"
              className="relative flex-1 flex flex-col items-center gap-1 px-3 py-2 rounded-xl bg-surface active:bg-border"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-text-primary" aria-hidden="true">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <span className="text-[10px] font-medium text-text-primary">Chat</span>
              {unreadChat > 0 && (
                <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-danger text-white text-[9px] font-bold flex items-center justify-center">
                  {unreadChat > 9 ? '9+' : unreadChat}
                </span>
              )}
            </button>
          </div>

          {/* Signal button — rider pickup only */}
          {onSignal && (
            <div className="px-4 py-2 border-b border-border/50">
              <button
                type="button"
                data-testid="drawer-signal-button"
                onClick={onSignal}
                disabled={signalling || signalled}
                className={`w-full flex items-center justify-center gap-2 rounded-2xl py-2.5 text-sm font-medium transition-colors disabled:opacity-50 ${
                  signalled
                    ? 'bg-success/10 text-success'
                    : 'bg-warning/10 text-warning active:bg-warning/20'
                }`}
              >
                {signalled ? 'Driver notified' : signalling ? 'Signalling\u2026' : "Signal Driver \u2014 I'm Close"}
              </button>
            </div>
          )}

          {/* Start Ride QR button — pickup screens */}
          {startRideLabel && (
            <div className="px-4 py-2 border-b border-border/50">
              <button
                type="button"
                data-testid="drawer-start-ride-button"
                onClick={onShowQr}
                className="w-full flex items-center justify-center gap-2 rounded-2xl bg-success/10 py-3 active:bg-success/20 transition-colors"
              >
                <span className="text-sm font-medium text-success">{startRideLabel}</span>
              </button>
            </div>
          )}

          {/* End Ride / Cancel Ride buttons */}
          {(onEndRide || onCancelRide) && (
            <div className="px-4 py-2 space-y-2 border-b border-border/50">
              {onEndRide && (
                <button
                  type="button"
                  data-testid="drawer-end-ride-button"
                  onClick={onEndRide}
                  className="w-full flex items-center justify-center gap-2 rounded-2xl bg-danger/10 py-3 active:bg-danger/20 transition-colors"
                >
                  <span className="text-sm font-medium text-danger">{endRideLabel ?? 'End Ride'}</span>
                </button>
              )}
              {onCancelRide && (
                <button
                  type="button"
                  data-testid="drawer-cancel-ride-button"
                  onClick={onCancelRide}
                  className="w-full flex items-center justify-center gap-2 rounded-2xl border border-danger/30 py-2.5 active:bg-danger/10 transition-colors"
                >
                  <span className="text-sm font-medium text-danger">Cancel Ride</span>
                </button>
              )}
            </div>
          )}

          {/* Scrollable expanded content */}
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-3 space-y-4">
            {/* ETA summary — visible when expanded */}
            {(etaMinutes != null || fareDisplay != null) && (
              <div className="flex items-center justify-around py-2 border-b border-border/50 -mt-1">
                {etaMinutes != null && !hideEta && (
                  <div className="text-center">
                    <p className="text-lg font-bold text-text-primary">{etaMinutes} min</p>
                    <p className="text-[10px] text-text-secondary">ETA</p>
                  </div>
                )}
                {distanceKm != null && (
                  <div className="text-center">
                    <p className="text-lg font-bold text-text-primary">{(distanceKm * 0.621371).toFixed(1)} mi</p>
                    <p className="text-[10px] text-text-secondary">Distance</p>
                  </div>
                )}
                {fareDisplay != null && (
                  <div className="text-center">
                    <p className="text-lg font-bold text-success">{formatCents(fareDisplay)}</p>
                    <p className="text-[10px] text-text-secondary">Fare</p>
                  </div>
                )}
              </div>
            )}
            {/* Progress bar */}
            {progress != null && (
              <div>
                <h3 className="text-xs font-bold text-text-secondary uppercase tracking-wide mb-2">Journey Progress</h3>
                <div className="h-1.5 rounded-full bg-border overflow-hidden mb-2">
                  <div
                    data-testid="drawer-journey-progress"
                    className="h-full rounded-full bg-primary transition-all duration-500"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-text-secondary">{progressLabel ?? `${progress}% complete`}</span>
                  {remainingLabel && <span className="font-semibold text-text-primary">{remainingLabel}</span>}
                </div>
              </div>
            )}

            {/* Journey route / Transit remaining journey */}
            {transitInfo ? (
              <div data-testid="transit-remaining-journey">
                <h3 className="text-xs font-bold text-text-secondary uppercase tracking-wide mb-2">Your Remaining Journey</h3>
                <div className="space-y-3">
                  {/* Walk to station */}
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 h-8 w-8 rounded-full bg-success/10 flex items-center justify-center shrink-0">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4 text-success" aria-hidden="true">
                        <path d="M13.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM9.8 8.9L7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-text-primary">Walk to {transitInfo.station_name}</p>
                      <p className="text-xs text-text-secondary">~{transitInfo.walk_to_station_minutes} min walk</p>
                    </div>
                  </div>

                  {/* Best transit option */}
                  {transitInfo.transit_options.length > 0 && (() => {
                    const best = transitInfo.transit_options[0]
                    return (
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                          <span className="text-sm">{best.icon}</span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-text-primary">{best.line_name}</p>
                          <p className="text-xs text-text-secondary">
                            To {transitInfo.rider_dest_name} · ~{best.total_minutes} min
                            {transitInfo.transit_options.length > 1 && (
                              <span className="text-text-secondary/60"> (+{transitInfo.transit_options.length - 1} other route{transitInfo.transit_options.length > 2 ? 's' : ''})</span>
                            )}
                          </p>
                        </div>
                      </div>
                    )
                  })()}

                  {/* Total remaining + Google Maps link */}
                  <div className="bg-surface rounded-2xl p-3 mt-2 space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-text-secondary">Total remaining journey</p>
                        <p className="text-sm font-bold text-text-primary">~{transitInfo.total_rider_minutes} min</p>
                      </div>
                    </div>
                    <a
                      href={getNavigationUrl(transitInfo.rider_dest_lat, transitInfo.rider_dest_lng, 'transit', transitInfo.dropoff_lat, transitInfo.dropoff_lng)}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-testid="transit-directions-link"
                      className="flex items-center justify-center gap-2 w-full rounded-xl bg-primary/10 py-2.5 text-sm font-medium text-primary active:bg-primary/20 transition-colors"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
                        <polygon points="3 11 22 2 13 21 11 13 3 11" />
                      </svg>
                      Get transit directions
                    </a>
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <h3 className="text-xs font-bold text-text-secondary uppercase tracking-wide mb-2">Your Journey</h3>
                <div className="space-y-2">
                  <div className="flex items-start gap-3">
                    <div className="mt-1 h-3 w-3 rounded-full bg-success border-2 border-success/30 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs text-text-secondary">Pickup</p>
                      <p className="text-sm font-medium text-text-primary truncate">{noteDisplay ?? 'Pickup point'}</p>
                    </div>
                  </div>
                  <div className="ml-1.5 border-l-2 border-dashed border-border h-4" />
                  <div className="flex items-start gap-3">
                    <div className="mt-1 h-3 w-3 rounded-full bg-danger border-2 border-danger/30 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs text-text-secondary">Destination</p>
                      <p className="text-sm font-medium text-text-primary truncate">{ride.destination_name ?? 'Destination'}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Driver's remaining journey — from dropoff to their destination */}
            {!isRider && ride.driver_destination_name && ride.driver_destination && (() => {
              const driverDest = ride.driver_destination as { type: string; coordinates: [number, number] }
              const dropoff = (ride.destination ?? ride.origin) as { type: string; coordinates: [number, number] }
              return (
                <div data-testid="driver-remaining-journey">
                  <h3 className="text-xs font-bold text-text-secondary uppercase tracking-wide mb-2">Your Remaining Journey</h3>
                  <div className="space-y-2">
                    <div className="flex items-start gap-3">
                      <div className="mt-1 h-3 w-3 rounded-full bg-primary border-2 border-primary/30 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs text-text-secondary">Drop-off</p>
                        <p className="text-sm font-medium text-text-primary truncate">{ride.destination_name ?? 'Drop-off point'}</p>
                      </div>
                    </div>
                    <div className="ml-1.5 border-l-2 border-dashed border-border h-4" />
                    <div className="flex items-start gap-3">
                      <div className="mt-1 h-3 w-3 rounded-full bg-success border-2 border-success/30 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs text-text-secondary">Your Destination</p>
                        <p className="text-sm font-medium text-text-primary truncate">{ride.driver_destination_name}</p>
                      </div>
                    </div>
                  </div>
                  <a
                    href={getNavigationUrl(driverDest.coordinates[1], driverDest.coordinates[0], 'driving', dropoff.coordinates[1], dropoff.coordinates[0])}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="driver-dest-navigate-link"
                    className="flex items-center justify-center gap-2 w-full rounded-xl bg-success/10 py-2.5 mt-3 text-sm font-medium text-success active:bg-success/20 transition-colors"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
                      <polygon points="3 11 22 2 13 21 11 13 3 11" />
                    </svg>
                    Navigate to your destination
                  </a>
                </div>
              )
            })()}

            {/* Other person info */}
            {otherPerson && (
              <div>
                <h3 className="text-xs font-bold text-text-secondary uppercase tracking-wide mb-2">
                  {isRider ? 'Your Driver' : 'Your Rider'}
                </h3>
                <div className="flex items-center gap-3 bg-surface rounded-2xl p-3">
                  {otherPerson.avatar_url ? (
                    <img src={otherPerson.avatar_url} alt="" className="h-11 w-11 rounded-full object-cover shrink-0" />
                  ) : (
                    <div className="h-11 w-11 rounded-full bg-primary-light flex items-center justify-center shrink-0">
                      <span className="text-lg font-bold text-primary">{otherPerson.full_name?.[0]?.toUpperCase() ?? '?'}</span>
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-text-primary truncate">{otherPerson.full_name}</p>
                    <div className="flex items-center gap-2 text-xs text-text-secondary">
                      {otherPerson.rating_avg != null && (
                        <span className="inline-flex items-center gap-0.5">
                          <AppIcon name="star" className="h-3 w-3 text-warning" />
                          {otherPerson.rating_avg.toFixed(1)}
                        </span>
                      )}
                      {(otherPerson.rating_count ?? 0) > 0 && (
                        <span>({otherPerson.rating_count} rides)</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Vehicle info (rider view only) */}
            {isRider && vehicle && (
              <div>
                <h3 className="text-xs font-bold text-text-secondary uppercase tracking-wide mb-2">Vehicle</h3>
                <div className="bg-surface rounded-2xl p-3 flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5 text-primary" aria-hidden="true">
                      <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/>
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-text-primary">{vehicle.color} {vehicle.make} {vehicle.model}</p>
                    <p className="text-xs font-bold text-primary tracking-wide">{vehicle.plate}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Fare breakdown */}
            {fareDisplay != null && (
              <div>
                <h3 className="text-xs font-bold text-text-secondary uppercase tracking-wide mb-2">Fare Breakdown</h3>
                <div className="bg-surface rounded-2xl p-3 space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-text-secondary">Estimated Fare</span>
                    <span className="font-semibold text-text-primary">{formatCents(fareDisplay)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-secondary">Platform Fee (15%)</span>
                    <span className="font-semibold text-text-primary">{formatCents(Math.round(fareDisplay * 0.15))}</span>
                  </div>
                  <div className="border-t border-border pt-1.5 flex justify-between">
                    <span className="font-semibold text-text-primary">{isRider ? 'You Pay' : 'You Earn'}</span>
                    <span className="font-bold text-success">
                      {formatCents(isRider ? fareDisplay : fareDisplay - Math.round(fareDisplay * 0.15))}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
      </div>
    </>,
    portalTarget,
  )
}
