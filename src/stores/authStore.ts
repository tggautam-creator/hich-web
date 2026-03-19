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
    // Subscribe to future auth-state changes (token refresh, sign-out, new sign-in)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        set({ session, user: session?.user ?? null })
        if (session?.user) {
          // Silently refresh profile; isLoading stays false (already initialised)
          void get().refreshProfile()
        } else {
          set({ profile: null, isDriver: false })
        }
      },
    )

    // Load the current session from localStorage.
    // On iOS PWA, localStorage is occasionally not ready on the very first
    // read after an app relaunch — retry once after 300ms before giving up.
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        set({ session, user: session.user })
        void get().refreshProfile()  // sets isLoading: false when done
      } else {
        // Retry once: iOS can return null on the first tick after a cold start
        setTimeout(() => {
          void supabase.auth.getSession().then(({ data: { session: s2 } }) => {
            if (s2) {
              set({ session: s2, user: s2.user })
              void get().refreshProfile()
            } else {
              set({ isLoading: false })
            }
          })
        }, 300)
      }
    })

    // Re-validate session when app resumes (tab focus, phone unlock, PWA foreground)
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return
      void supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) {
          // Refresh in store and silently update profile if missing
          set({ session, user: session.user, sessionExpired: false })
          if (!get().profile) void get().refreshProfile()
        } else if (get().session) {
          // Had a session but it's gone now — mark expired so AuthGuard shows re-login
          set({ sessionExpired: true, session: null, user: null })
        }
        // If session is null and we never had one, do nothing — initialize() handles it
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
