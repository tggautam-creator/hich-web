/**
 * v1.3 Sprint 12 Slice 3 — host-surface wrapper that pairs
 * `useCounterpartyContact` with `CallButton` so the 4 mount
 * sites (chat header, driver pickup drawer, both active-ride
 * drawers) don't duplicate the hook + render-branching code.
 * Mirrors iOS `CallButtonForRide`.
 *
 * Renders `null` while:
 *   - the hook is still loading (avoids a "Phone unavailable"
 *     flash before the real state arrives)
 *   - the fetch errored (403 OUTSIDE_WINDOW, FORBIDDEN, etc. — the
 *     server's "don't show this UI right now" signal)
 *   - the call window is closed upstream (`enabled={false}`)
 *
 * Renders the CallButton (enabled or disabled state) once the hook
 * resolves with data.
 */
import CallButton from '@/components/ui/CallButton'
import { useCounterpartyContact } from '@/hooks/useCounterpartyContact'

interface CallButtonForRideProps {
  rideId: string | null | undefined
  partnerName?: string | null
  size?: 'compact' | 'standard'
  /** Pass `false` to skip the fetch entirely — useful when the
   *  caller already knows the ride is outside the server's
   *  active-window gate (e.g. status === 'completed'). */
  enabled?: boolean
  'data-testid'?: string
}

export default function CallButtonForRide({
  rideId,
  partnerName,
  size = 'standard',
  enabled = true,
  'data-testid': testId = 'call-button-for-ride',
}: CallButtonForRideProps) {
  const { data, isLoading, error } = useCounterpartyContact(rideId, { enabled })
  if (!enabled || isLoading || error || !data) return null
  return (
    <CallButton
      partnerName={partnerName ?? data.fullName}
      phone={data.phone}
      size={size}
      data-testid={testId}
    />
  )
}
