/**
 * v1.3 Sprint 12 Slice 3 — React Query wrapper around
 * `GET /api/rides/:rideId/counterparty-contact`.
 *
 * Mirrors iOS `CallButtonForRide.task(id: rideID)` lifecycle:
 *   - fires on mount + when rideId changes
 *   - silent failure (403 OUTSIDE_WINDOW outside the active window,
 *     403 FORBIDDEN if caller isn't a party, network errors) — the
 *     caller's UX is "hide the button" in every failure mode
 *
 * `retry: false` — 403 is deterministic state ("not in the active
 * window"), not a transient error. Retrying spams the server with
 * doomed requests.
 *
 * Server gates by ride status ∈ {accepted, coordinating, active},
 * so we can pass `enabled: rideStatus matches that set` from the
 * call site to skip the fetch entirely when we already know the
 * window is closed. Defaults to true so the hook is usable in
 * places where status isn't tracked client-side.
 */
import { useQuery } from '@tanstack/react-query'
import {
  fetchCounterpartyContact,
  type CounterpartyContact,
} from '@/lib/counterpartyContactApi'

interface UseCounterpartyContactOptions {
  enabled?: boolean
}

export function useCounterpartyContact(
  rideId: string | null | undefined,
  { enabled = true }: UseCounterpartyContactOptions = {},
) {
  return useQuery<CounterpartyContact>({
    queryKey: ['counterpartyContact', rideId],
    queryFn: () => fetchCounterpartyContact(rideId as string),
    enabled: enabled && typeof rideId === 'string' && rideId.length > 0,
    retry: false,
    // No polling — contact data is stable for the lifetime of the
    // active-ride window. Component re-mounts (new rideId, ride
    // status flips through accepted → active) refetch naturally.
    staleTime: 5 * 60 * 1000,
  })
}
