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
    // Flag to prevent infinite server-recovery loops
    let serverRecoveryAttempted = false

    /**
     * Try to restore the session from the server's HTTP-only cookie.
     * Called when client-side storage returns no session (iOS PWA force-kill)
     * or when Supabase's auto-refresh fails (stale JS cookies).
     */
    async function attemptServerRecovery(): Promise<boolean> {
      if (serverRecoveryAttempted) return false
      serverRecoveryAttempted = true

      const recovered = await recoverSessionFromServer()
      if (!recovered) return false

      await supabase.auth.setSession({
        access_token: recovered.access_token,
        refresh_token: recovered.refresh_token,
      })
      // onAuthStateChange will fire and handle profile load + cookie sync
      return true
    }

    // Subscribe to future auth-state changes (token refresh, sign-out, new sign-in)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        set({ session, user: session?.user ?? null })
        if (session?.user) {
          // Reset flag so future losses can try recovery again
          serverRecoveryAttempted = false
          // Sync refresh token to server HTTP-only cookie (survives iOS force-kill)
          void syncSessionToServer(session)
          // Silently refresh profile; isLoading stays false (already initialised)
          void get().refreshProfile()
        } else if (event === 'SIGNED_OUT') {
          // Explicit sign-out — don't try recovery
          set({ profile: null, isDriver: false })
        } else {
          // Session lost unexpectedly (auto-refresh failed, stale tokens) —
          // try to recover from server HTTP-only cookie before giving up
          void attemptServerRecovery().then((recovered) => {
            if (!recovered) {
              set({ profile: null, isDriver: false, isLoading: false })
            }
          })
        }
      },
    )

    // Load the current session from client-side storage.
    // If that fails (iOS cleared localStorage/cookies on force-kill),
    // recover from the server's HTTP-only cookie as a last resort.
    void supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session) {
        set({ session, user: session.user })
        void get().refreshProfile()  // sets isLoading: false when done
        return
      }

      // Client storage is empty — try server-side HTTP-only cookie recovery
      const recovered = await attemptServerRecovery()
      if (!recovered) {
        set({ isLoading: false })
      }
    })

    // Re-validate session when app resumes (tab focus, phone unlock, PWA foreground)
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return
      void supabase.auth.getSession().then(async ({ data: { session } }) => {
        if (session) {
          set({ session, user: session.user, sessionExpired: false })
          if (!get().profile) void get().refreshProfile()
        } else if (get().session) {
          // Had a session but it's gone now — try server recovery first
          serverRecoveryAttempted = false // allow retry on foreground
          const recovered = await attemptServerRecovery()
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
