/**
 * Web mirror of iOS' `BoardOfferAcceptPage.swift` (Phase A Slice
 * A3b, 2026-05-17). Rider lands here when a driver has posted an
 * offer on the rider's board entry — either by tapping a
 * `board_offer` push notification or a `board_offer` row in the
 * Notifications inbox.
 *
 * Shows every pending offer for the schedule (a single schedule
 * can attract multiple driver offers — the rider picks one).
 * Accept opens the standard payment gate; web's lack of an inline
 * AddCardSheet means we delegate to `/payment/add` with returnTo
 * so the rider lands back here after adding a card and the accept
 * auto-retries via `state.pendingAcceptOfferId`.
 */

import { useEffect, useMemo, useState, useCallback } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { supabase } from '@/lib/supabase'

interface OfferDriver {
  id: string
  full_name: string | null
  avatar_url: string | null
  rating_avg: number | null
  rating_count: number | null
}

interface OfferVehicle {
  id: string
  make: string | null
  model: string | null
  year: number | null
  color: string | null
  plate: string | null
}

interface BoardOffer {
  id: string
  status: string
  created_at: string
  proposed_pickup_name: string | null
  proposed_dropoff_name: string | null
  proposed_fare_cents: number | null
  proposed_eta_minutes: number | null
  driver: OfferDriver
  vehicle: OfferVehicle | null
}

interface ListOffersResponse {
  offers: BoardOffer[]
}

interface AcceptResponse {
  ride_id: string
  offer_id: string
  status: string
}

interface ServerErrorBody {
  error?: { code?: string; message?: string }
}

interface RestoredAcceptState {
  // SaveCardForm forwards the original `confirmState` value back to
  // the returnTo route as `state.confirmState` (when `fromTab` is
  // set, which we always set here). Nested shape is what we sent.
  confirmState?: { pendingAcceptOfferId?: string }
}

async function fetchOffers(scheduleId: string): Promise<BoardOffer[]> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not authenticated')
  const resp = await fetch(`/api/schedule/board/schedule/${scheduleId}/offers`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  })
  if (!resp.ok) {
    const body = await resp.json().catch(() => null) as ServerErrorBody | null
    throw new Error(body?.error?.message ?? `Failed to load offers (${resp.status})`)
  }
  const json = await resp.json() as ListOffersResponse
  return json.offers ?? []
}

export default function BoardOfferAcceptPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { scheduleId } = useParams<{ scheduleId: string }>()
  const restoredState = useMemo(
    () => (location.state as RestoredAcceptState | null) ?? null,
    [location.state],
  )

  const [offers, setOffers] = useState<BoardOffer[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actingOfferId, setActingOfferId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!scheduleId) return
    setLoadError(null)
    try {
      const list = await fetchOffers(scheduleId)
      setOffers(list)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load offers')
    } finally {
      setLoading(false)
    }
  }, [scheduleId])

  useEffect(() => {
    void reload()
  }, [reload])

  const accept = useCallback(async (offerId: string) => {
    setActingOfferId(offerId)
    setActionError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        setActionError('Please sign in again.')
        setActingOfferId(null)
        return
      }
      const resp = await fetch(`/api/schedule/board/offers/${offerId}/accept`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!resp.ok) {
        const body = await resp.json().catch(() => null) as ServerErrorBody | null
        const code = body?.error?.code
        if (code === 'NO_PAYMENT_METHOD') {
          // Web has no inline AddCardSheet — bounce to /payment/add
          // with returnTo so the rider lands back here and the
          // accept auto-retries. SaveCardForm passes our
          // `confirmState` payload back verbatim under
          // `state.confirmState`, so we stash the offerId there.
          navigate('/payment/add', {
            state: {
              returnTo: location.pathname,
              fromTab: 'rides',
              confirmState: { pendingAcceptOfferId: offerId },
            },
          })
          setActingOfferId(null)
          return
        }
        if (code === 'ALREADY_RELEASED' || code === 'ALREADY_MATCHED' || code === 'OFFER_NOT_FOUND') {
          // Stale state — refresh the list so the rider sees the
          // current set without the dead row.
          setActionError(body?.error?.message ?? 'This offer is no longer available — refreshing the list.')
          setActingOfferId(null)
          await reload()
          return
        }
        setActionError(body?.error?.message ?? 'Could not accept this offer. Try again.')
        setActingOfferId(null)
        return
      }
      const json = await resp.json() as AcceptResponse
      // Drop straight into chat with the matched driver — same
      // post-accept routing iOS uses.
      navigate(`/ride/messaging/${json.ride_id}`, { replace: true })
    } catch {
      setActionError('Network error. Try again.')
      setActingOfferId(null)
    }
  }, [navigate, location.pathname, reload])

  const decline = useCallback(async (offerId: string) => {
    setActingOfferId(offerId)
    setActionError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        setActionError('Please sign in again.')
        setActingOfferId(null)
        return
      }
      const resp = await fetch(`/api/schedule/board/offers/${offerId}/decline`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!resp.ok) {
        const body = await resp.json().catch(() => null) as ServerErrorBody | null
        setActionError(body?.error?.message ?? 'Could not decline this offer. Try again.')
      }
    } catch {
      setActionError('Network error. Try again.')
    } finally {
      setActingOfferId(null)
      await reload()
    }
  }, [reload])

  // Auto-retry the accept once the rider returns from /payment/add
  // after adding a card. SaveCardForm forwards our `confirmState`
  // payload back under `state.confirmState`.
  useEffect(() => {
    const pending = restoredState?.confirmState?.pendingAcceptOfferId
    if (!pending || loading) return
    // Clear before triggering so a refresh / back-button doesn't
    // re-fire the retry indefinitely.
    navigate(location.pathname, { replace: true, state: null })
    void accept(pending)
  }, [restoredState?.confirmState?.pendingAcceptOfferId, loading, accept, navigate, location.pathname])

  return (
    <div className="min-h-dvh bg-surface pb-16">
      <header className="flex items-center gap-3 px-4 pt-4">
        <button
          type="button"
          onClick={() => { navigate('/rides') }}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm border border-border"
          aria-label="Close"
          data-testid="board-offer-close"
        >
          <span className="text-lg text-textPrimary">×</span>
        </button>
        <h1 className="text-base font-bold text-textPrimary">Offers on your post</h1>
      </header>

      {loading && (
        <div className="mt-12 flex justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      )}

      {!loading && loadError && (
        <div className="mx-4 mt-6 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          {loadError}
          <button
            type="button"
            onClick={() => { void reload() }}
            className="ml-2 underline"
          >
            Retry
          </button>
        </div>
      )}

      {!loading && !loadError && offers.length === 0 && (
        <div className="mx-4 mt-12 rounded-2xl border border-border bg-white p-6 text-center">
          <div className="text-2xl">📭</div>
          <h2 className="mt-2 text-sm font-bold text-textPrimary">No pending offers right now</h2>
          <p className="mt-1 text-xs text-textSecondary">
            We&apos;ll send you a push the moment a driver responds.
          </p>
        </div>
      )}

      {actionError && (
        <div className="mx-4 mt-4 rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
          {actionError}
        </div>
      )}

      {!loading && offers.length > 0 && (
        <ul className="mx-4 mt-4 flex flex-col gap-3">
          {offers.map((offer) => {
            const acting = actingOfferId === offer.id
            const fare = offer.proposed_fare_cents
            return (
              <li
                key={offer.id}
                className="rounded-2xl border border-border bg-white p-4 shadow-sm"
                data-testid="board-offer-card"
              >
                <div className="flex items-center gap-3">
                  {offer.driver.avatar_url ? (
                    <img
                      src={offer.driver.avatar_url}
                      alt=""
                      className="h-12 w-12 rounded-full object-cover"
                    />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary font-bold">
                      {(offer.driver.full_name ?? '?')[0]?.toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold text-textPrimary">
                      {offer.driver.full_name ?? 'Driver'}
                    </div>
                    {offer.driver.rating_avg != null && (
                      <div className="text-xs text-textSecondary">
                        ★ {offer.driver.rating_avg.toFixed(1)}
                        {offer.driver.rating_count != null && ` · ${offer.driver.rating_count} rides`}
                      </div>
                    )}
                  </div>
                </div>

                {offer.vehicle && (offer.vehicle.year ?? offer.vehicle.make ?? offer.vehicle.model) && (
                  <div className="mt-3 text-xs text-textSecondary">
                    {[offer.vehicle.year, offer.vehicle.color, offer.vehicle.make, offer.vehicle.model]
                      .filter(Boolean)
                      .join(' ')}
                    {offer.vehicle.plate && ` · ${offer.vehicle.plate}`}
                  </div>
                )}

                <div className="mt-3 space-y-1 text-sm">
                  {offer.proposed_pickup_name && (
                    <div className="flex items-start gap-2">
                      <span className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-success" />
                      <span className="text-textPrimary">Pickup: {offer.proposed_pickup_name}</span>
                    </div>
                  )}
                  {offer.proposed_dropoff_name && (
                    <div className="flex items-start gap-2">
                      <span className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-primary" />
                      <span className="text-textPrimary">Drop: {offer.proposed_dropoff_name}</span>
                    </div>
                  )}
                </div>

                <div className="mt-3 text-sm font-semibold text-textPrimary">
                  {fare != null ? `~$${(fare / 100).toFixed(2)} you'll pay` : 'Fare: confirm in chat'}
                </div>

                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    onClick={() => { void decline(offer.id) }}
                    disabled={acting}
                    className="flex-1 rounded-full bg-surface px-3 py-2 text-sm font-semibold text-textPrimary border border-border disabled:opacity-50"
                    data-testid="board-offer-decline"
                  >
                    Decline
                  </button>
                  <button
                    type="button"
                    onClick={() => { void accept(offer.id) }}
                    disabled={acting}
                    className="flex-1 rounded-full bg-primary px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
                    data-testid="board-offer-accept"
                  >
                    {acting ? 'Working…' : 'Accept'}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
