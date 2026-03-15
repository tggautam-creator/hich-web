import { useEffect } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { APIProvider } from '@vis.gl/react-google-maps'
import { useAuthStore } from '@/stores/authStore'
import { useOnboardingStore } from '@/stores/onboardingStore'
import { env } from '@/lib/env'
import RideRequestNotification from '@/components/ride/RideRequestNotification'
import IntroCarousel from '@/components/onboarding/IntroCarousel'

// ── Types ─────────────────────────────────────────────────────────────────────

interface AuthGuardProps {
  'data-testid'?: string
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * AuthGuard — wraps all authenticated routes.
 *
 * Decision tree (evaluated in order):
 *  1. isLoading         → spinner (waiting for session + profile to resolve)
 *  2. No session        → redirect to /signup
 *  3. No profile name
 *     AND not on an     → redirect to /onboarding/profile
 *     onboarding path
 *  4. Otherwise         → render <Outlet /> (the requested route)
 *
 * Onboarding paths (/onboarding/*) bypass the full_name check so that:
 *  - A new user can step through the onboarding flow without hitting redirect loops.
 *  - CreateProfilePage can navigate forward to /onboarding/location before the
 *    auth store's in-memory profile is refreshed with the new full_name.
 */
export default function AuthGuard({ 'data-testid': testId }: AuthGuardProps) {
  const { session, profile, isLoading, initialize } = useAuthStore()
  const hasSeenIntro = useOnboardingStore((s) => s.hasSeenIntro)
  const location = useLocation()

  // Initialize the Supabase auth subscription once on mount; clean up on unmount.
  useEffect(() => {
    const unsubscribe = initialize()
    return unsubscribe
  }, [initialize])

  // ── 1. Loading ───────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div
        data-testid={testId ?? 'auth-guard-loading'}
        className="min-h-dvh w-full bg-surface flex items-center justify-center"
      >
        <div className="h-8 w-8 rounded-full border-4 border-primary border-t-transparent animate-spin" />
      </div>
    )
  }

  // ── 2. No session ────────────────────────────────────────────────────────────
  if (!session) {
    return <Navigate to="/signup" replace state={{ from: location }} />
  }

  // ── 3. Profile incomplete ────────────────────────────────────────────────────
  // Allow onboarding paths through even without a full_name so that:
  //  • The user can complete profile creation at /onboarding/profile.
  //  • CreateProfilePage can navigate to /onboarding/location before the store
  //    refreshes (avoiding a redirect loop and a premature bounce back).
  const isOnboardingPath = location.pathname.startsWith('/onboarding/')
  if (!profile?.full_name && !isOnboardingPath) {
    return <Navigate to="/onboarding/profile" replace />
  }

  // ── 4. Authenticated + sufficient profile ────────────────────────────────────
  // Show intro carousel for users who haven't seen it yet (and aren't on onboarding)
  if (!hasSeenIntro && !isOnboardingPath && profile?.full_name) {
    return <IntroCarousel />
  }

  return (
    <APIProvider apiKey={env.GOOGLE_MAPS_KEY ?? ''}>
      <Outlet />
      <RideRequestNotification />
    </APIProvider>
  )
}
