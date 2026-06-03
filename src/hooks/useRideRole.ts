/**
 * v1.3 Sprint 11 Slice 3 — `useRideRole(rideId)` shared primitive.
 *
 * Returns `'rider' | 'driver' | null` for the signed-in user on a
 * specific ride. The hook honours the role-per-ride memory rule —
 * role is always derived from comparing `auth.profile.id` against
 * `rides.rider_id` and `rides.driver_id`, NEVER inferred from the
 * tab the user came from, the nav stack, or any per-session
 * capability flag. iOS `auth.isDriver` and the equivalent web
 * `profile.is_driver` are PER-USER capabilities; the role on a
 * specific ride is decided by the IDs on that ride row.
 *
 * Slice 4b consumes this hook to derive the `safety-warning-
 * response` action prefix (`rider_in_car` vs `driver_in_car` etc.)
 * before posting — mismatched prefix 403s with WRONG_ROLE.
 * Slice 3 consumes it to pick the role-aware safety report
 * category list (`SafetyReportCategory.availableFor(role:)`).
 *
 * Returns `null` while loading, on auth errors, when the ride is
 * not found, or when the current user is neither rider nor driver
 * on the ride. Callers should treat null as "skip role-dependent
 * behaviour and show a generic surface."
 */
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'

export type RideRole = 'rider' | 'driver'

const ONE_MIN_MS = 60 * 1000

function ridePartiesKey(rideId: string | undefined) {
  return ['rides', 'parties', rideId ?? 'none'] as const
}

interface RideParties {
  riderId: string | null
  driverId: string | null
}

async function fetchRideParties(rideId: string): Promise<RideParties> {
  const { data, error } = await supabase
    .from('rides')
    .select('rider_id, driver_id')
    .eq('id', rideId)
    .single()
  if (error || !data) {
    throw error ?? new Error('Ride not found')
  }
  return {
    riderId: (data.rider_id as string | null) ?? null,
    driverId: (data.driver_id as string | null) ?? null,
  }
}

export interface UseRideRoleResult {
  /** `'rider' | 'driver' | null`. Null while loading, on error, or when the
   *  signed-in user is neither party on this ride. */
  role: RideRole | null
  isLoading: boolean
  error: Error | null
}

export function useRideRole(rideId: string | null | undefined): UseRideRoleResult {
  const userId = useAuthStore((s) => s.profile?.id) ?? null
  const enabled = typeof rideId === 'string' && rideId.length > 0 && typeof userId === 'string'
  const query = useQuery<RideParties>({
    queryKey: ridePartiesKey(rideId ?? undefined),
    queryFn: () => fetchRideParties(rideId as string),
    enabled,
    staleTime: ONE_MIN_MS,
    // No auto-retry — the role lookup is read-only and a stale role
    // gracefully degrades to a generic rider-list fallback in the
    // EmergencySheet report wizard. Auto-retry adds latency without
    // protecting against any real failure mode the user cares about.
    retry: false,
  })

  let role: RideRole | null = null
  if (query.data && userId) {
    if (query.data.riderId === userId) {
      role = 'rider'
    } else if (query.data.driverId === userId) {
      role = 'driver'
    }
  }

  return {
    role,
    isLoading: query.isLoading,
    error: query.error as Error | null,
  }
}
