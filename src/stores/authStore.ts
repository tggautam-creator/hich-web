/**
 * Auth store — single source of truth for authentication state.
 *
 * Initialization:
 *   Call `useAuthStore.getState().initialize()` once from AuthGuard (via useEffect).
 *   The returned cleanup fn unsubscribes the Supabase listener on unmount.
 *
 * Usage in components:
 *   const { session, profile, isLoading, isDriver, signOut } = useAuthStore()
 *
 * Key design decisions:
 *  - `isLoading` starts true and becomes false exactly once (after first session/profile load).
 *  - `refreshProfile()` does NOT toggle `isLoading` for subsequent calls so that navigating
 *    between guarded routes never shows a spinner flash (Zustand store is a singleton).
 *  - `signOut()` explicitly clears all state after the Supabase call.
 */

import { create } from 'zustand'
import type { User as SupabaseUser, Session } from '@supabase/supabase-js'
import type { User } from '@/types/database'
import { supabase } from '@/lib/supabase'
import { requestAndSaveFcmToken } from '@/lib/fcm'
import { identifyUser, resetAnalytics } from '@/lib/analytics'
import { syncSessionToServer, recoverSessionFromServer, clearServerSession } from '@/lib/serverSession'
import { requestPersistentStorage, cacheRefreshToken, getCachedRefreshToken, clearCachedRefreshToken } from '@/lib/persistentStorage'
import { authLog } from '@/lib/authLogger'

// ── State & Actions ────────────────────────────────────────────────────────────

export interface AuthState {
  /** Supabase auth user — null until session is confirmed */
  user: SupabaseUser | null
  /** Active Supabase session — null if logged out */
  session: Session | null
  /** users-table row for the current user */
  profile: User | null
  /** True while the initial session + profile are loading */
  isLoading: boolean
  /** Derived from profile.is_driver for quick access */
  isDriver: boolean
  /** True when the session has expired and needs re-authentication */
  sessionExpired: boolean

  /**
   * Subscribe to Supabase auth changes and load the initial session.
   * Call once from a top-level component (e.g. AuthGuard) via useEffect.
   * Returns a cleanup function that unsubscribes the listener.
   */
  initialize: () => () => void

  /** Sign out and clear all auth state */
  signOut: () => Promise<void>

  /**
   * Refresh the users-table row for the current auth user.
   * Called automatically by initialize() and on SIGNED_IN auth events.
   * Sets isLoading=false when complete (used to mark initial load done).
   */
  refreshProfile: () => Promise<void>
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useAuthStore = create<AuthState>((set, get) => ({
  user:      null,
  session:   null,
  profile:   null,
  isLoading: true,
  isDriver:  false,
  sessionExpired: false,

  initialize: () => {
    // Recovery rate-limiter: allow up to 3 attempts, reset after 30 seconds
    let recoveryCount = 0
    let recoveryLastAttempt = 0
    const RECOVERY_MAX = 3
    const RECOVERY_RESET_MS = 30_000

    /**
     * Try to restore the session from multiple fallback sources:
     *   1. Server HTTP-only cookie (most reliable on iOS)
     *   2. Cache Storage (shared between Safari and standalone PWA)
     * Called when client-side storage returns no session (iOS PWA force-kill)
     * or when Supabase's auto-refresh fails (stale tokens).
     */
    async function attemptRecovery(): Promise<boolean> {
      // Reset counter after 30s of inactivity
      if (Date.now() - recoveryLastAttempt > RECOVERY_RESET_MS) {
        recoveryCount = 0
      }
      if (recoveryCount >= RECOVERY_MAX) {
        authLog('recovery', 'attemptRecovery', false, `blocked: ${recoveryCount}/${RECOVERY_MAX} attempts used`)
        return false
      }
      recoveryCount++
      recoveryLastAttempt = Date.now()
      authLog('recovery', 'attemptRecovery:start', true, `attempt ${recoveryCount}/${RECOVERY_MAX}`)

      // Layer 1: Server HTTP-only cookie recovery
      authLog('recovery', 'trying serverCookie', true)
      const recovered = await recoverSessionFromServer()
      if (recovered) {
        authLog('recovery', 'serverCookie recovered session', true)
        await supabase.auth.setSession({
          access_token: recovered.access_token,
          refresh_token: recovered.refresh_token,
        })
        return true
      }

      // Layer 2: Cache Storage refresh token recovery
      authLog('recovery', 'trying cacheStorage', true)
      const cachedToken = await getCachedRefreshToken()
      if (cachedToken) {
        const { data, error } = await supabase.auth.refreshSession({ refresh_token: cachedToken })
        if (data.session && !error) {
          authLog('recovery', 'cacheStorage recovered session', true)
          await supabase.auth.setSession({
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token,
          })
          return true
        }
        authLog('recovery', 'cacheStorage refreshSession failed', false, error?.message)
      }

      authLog('recovery', 'all layers exhausted', false)
      return false
    }

    // Guard: prevent concurrent recovery attempts from consuming retry budget
    let recoveryInProgress = false

    // Subscribe to future auth-state changes (token refresh, sign-out, new sign-in)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        authLog('supabaseAuth', `onAuthStateChange: ${event}`, session !== null)
        set({ session, user: session?.user ?? null })
        if (session?.user) {
          // Reset counter so future losses can try recovery again
          recoveryCount = 0
          recoveryInProgress = false
          // Persist refresh token across multiple layers for iOS PWA survival
          void syncSessionToServer(session)     // Layer: server HTTP-only cookie
          void cacheRefreshToken(session.refresh_token)  // Layer: Cache Storage
          void requestPersistentStorage()        // Ask iOS to keep our data
          // Load/refresh profile — sets isLoading: false when done
          void get().refreshProfile()
        } else if (event === 'SIGNED_OUT') {
          // Explicit sign-out — don't try recovery
          recoveryInProgress = false
          set({ profile: null, isDriver: false })
        } else if (event === 'INITIAL_SESSION') {
          // No session on cold start — trigger recovery from server cookie / CacheStorage.
          // This is the SINGLE path that resolves isLoading for the no-session case.
          if (recoveryInProgress) return
          recoveryInProgress = true
          authLog('recovery', 'INITIAL_SESSION with no session — starting recovery', true)
          attemptRecovery().then((recovered) => {
            if (!recovered) {
              authLog('recovery', 'cold-start recovery failed', false)
              set({ profile: null, isDriver: false, isLoading: false })
            }
          }).catch((err: unknown) => {
            authLog('recovery', 'cold-start recovery threw', false, String(err))
            set({ profile: null, isDriver: false, isLoading: false })
          }).finally(() => {
            recoveryInProgress = false
          })
        } else {
          // Session lost unexpectedly (auto-refresh failed, stale tokens)
          if (recoveryInProgress) return
          recoveryInProgress = true
          authLog('recovery', `session lost unexpectedly (event=${event})`, false)
          attemptRecovery().then((recovered) => {
            if (!recovered) {
              set({ profile: null, isDriver: false, isLoading: false })
            }
          }).catch((err: unknown) => {
            authLog('recovery', 'unexpected-loss recovery threw', false, String(err))
            set({ profile: null, isDriver: false, isLoading: false })
          }).finally(() => {
            recoveryInProgress = false
          })
        }
      },
    )

    // Kick Supabase's internal _initialize() which fires INITIAL_SESSION above.
    // Do NOT call refreshProfile() here — onAuthStateChange is the single gatekeeper
    // for isLoading. Calling it here would race: if the stored session is stale,
    // refreshProfile() could set isLoading: false before recovery has a chance to run.
    void supabase.auth.getSession().then(({ data: { session } }) => {
      authLog('supabaseAuth', 'getSession', session !== null, session ? 'session found in storage' : 'no session in storage')
    })

    // Re-validate session when app resumes (tab focus, phone unlock, PWA foreground)
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return
      authLog('supabaseAuth', 'visibility changed to visible', true)
      void supabase.auth.getSession().then(async ({ data: { session } }) => {
        if (session) {
          set({ session, user: session.user, sessionExpired: false })
          if (!get().profile) void get().refreshProfile()
        } else if (get().session) {
          // Had a session but it's gone now — try server recovery first
          authLog('recovery', 'session lost on foreground — attempting recovery', true)
          const recovered = await attemptRecovery()
          if (!recovered) {
            set({ sessionExpired: true, session: null, user: null })
          }
        }
      })
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      subscription.unsubscribe()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  },

  signOut: async () => {
    // Remove this device's FCM token before signing out
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { getLastFcmToken } = await import('@/lib/fcm')
        const token = getLastFcmToken()
        if (token) {
          await supabase.from('push_tokens').delete().eq('user_id', user.id).eq('token', token)
        }
      }
    } catch {
      // non-fatal: token cleanup failure shouldn't block sign-out
    }
    await supabase.auth.signOut()
    void clearServerSession()
    void clearCachedRefreshToken()
    resetAnalytics()
    set({ user: null, session: null, profile: null, isDriver: false, isLoading: false })
  },

  refreshProfile: async () => {
    const { user } = get()
    if (!user) {
      set({ isLoading: false })
      return
    }

    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', user.id)
      .single()

    if (error || !data) {
      set({ profile: null, isDriver: false, isLoading: false })
      return
    }

    // TypeScript sometimes resolves the Supabase query chain to '{}' in strict mode
    // when the Row type contains custom shapes (e.g. GeoPoint). We know the runtime
    // shape is always User when the query succeeds and data is truthy.
    const profile = data as unknown as User
    set({ profile, isDriver: profile.is_driver, isLoading: false })

    identifyUser(user.id, {
      is_driver: profile.is_driver,
      edu_domain: user.email?.split('@')[1],
      created_at: profile.created_at,
    })

    // Request FCM push notification permission and save token (fire-and-forget)
    void requestAndSaveFcmToken()
  },
}))
