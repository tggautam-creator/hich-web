/**
 * v1.2 Sprint 6 Slice 4 — driver-side caregiver enrichment loader.
 *
 * The `caregivers` table is RLS-scoped to `user_id = auth.uid()`, so
 * a driver can't read the rider's caregiver row directly via
 * supabase-js. The server resolves this on the matched
 * `/api/rides/active` endpoint (see `server/routes/rides.ts:5784-5817`)
 * by joining the row in with the service role and exposing
 * `caregiver: { id, name, phone, avatar_url }` on each ride.
 *
 * This helper hits `/api/rides/active` once and pulls the matching
 * ride's enrichment. Used by `DriverPickupPage` + `DriverActiveRidePage`
 * to render the `CaregiverContextRow`. Returns `null` when the ride
 * has no caregiver attached OR when the call fails for any reason —
 * caller treats "no caregiver" as "don't render the context row" so
 * a transient `/active` failure just hides the row instead of
 * crashing the screen.
 */
import { supabase } from '@/lib/supabase'

export interface CaregiverEnrichment {
  id:           string
  name:         string
  phone:        string | null
  avatar_url:   string | null
}

interface ActiveRideRow {
  id: string
  caregiver: CaregiverEnrichment | null
}

interface ActiveRidesResponse {
  rides: ActiveRideRow[]
}

export async function loadCaregiverForRide(rideId: string): Promise<CaregiverEnrichment | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return null

    const res = await fetch('/api/rides/active', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    if (!res.ok) return null

    const body = (await res.json()) as ActiveRidesResponse
    const match = (body.rides ?? []).find((r) => r.id === rideId)
    return match?.caregiver ?? null
  } catch {
    return null
  }
}
