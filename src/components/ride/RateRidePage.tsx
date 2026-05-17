import { Navigate, useParams } from 'react-router-dom'

interface RateRidePageProps {
  'data-testid'?: string
}

/**
 * Legacy `/ride/rate/:rideId` route — folded into `RideSummaryPage` in
 * Sprint 2 (W-T1-R1+R2, 2026-05-16). The rating + tip form now lives
 * inline on the summary page so iOS-class single-screen UX matches.
 *
 * This component just redirects so external links (FCM notification
 * taps, bookmarks, email links) keep working. Once enough time has
 * passed that no live link points here we can drop the route and
 * delete this file.
 *
 * The `data-testid` prop is intentionally accepted (and ignored) to
 * preserve the existing route element's API.
 */
export default function RateRidePage(_props: RateRidePageProps) {
  const { rideId } = useParams<{ rideId: string }>()
  if (!rideId) return <Navigate to="/" replace />
  return <Navigate to={`/ride/summary/${rideId}`} replace />
}
