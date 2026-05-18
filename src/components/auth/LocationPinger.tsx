import { useEffect, useRef } from 'react'

/**
 * Slice 1.11 — per-user GPS ping for the admin panel's "last seen"
 * feature. Mounted inside `AuthGuard` so it only fires while a user
 * is signed in.
 *
 * Trigger pattern:
 *   - `document.visibilitychange` → 'visible' fires an opportunistic
 *     ping (throttled to 1 per 5 minutes per process)
 *   - Service worker `fcm-foreground` broadcast → notification tap
 *     fires an immediate ping bypassing throttle (per Tarun's
 *     2026-05-18 spec: "every notif tap should immediately update")
 *   - Initial mount fires once if no recent ping
 *
 * The ping is best-effort: silent on errors, no UI feedback. If the
 * browser blocks geolocation we just skip — the user's row stays at
 * its previous last_known_*.
 *
 * Privacy: this component only mounts inside AuthGuard, so a signed-
 * out user is never tracked. Geolocation prompt is handled by the
 * browser the first time it fires; if the user denies, all future
 * pings short-circuit.
 */

const THROTTLE_MS = 5 * 60 * 1000

export default function LocationPinger() {
  const lastPingAtRef = useRef<number>(0)
  const fcmChannelRef = useRef<BroadcastChannel | null>(null)

  useEffect(() => {
    // Ping immediately on mount if it's been long enough.
    void ping(false, lastPingAtRef)

    function onVisibility() {
      if (document.visibilityState === 'visible') {
        void ping(false, lastPingAtRef)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    // Listen for notification taps via the existing fcm-foreground
    // channel (firebase-messaging-sw.js broadcasts on `notificationclick`
    // — but we also separately broadcast on push receipt, so we need
    // to distinguish). For now any message on this channel triggers a
    // forced ping — over-pinging on notif receipt is acceptable.
    try {
      const channel = new BroadcastChannel('fcm-foreground')
      fcmChannelRef.current = channel
      channel.addEventListener('message', () => {
        void ping(true, lastPingAtRef)
      })
    } catch {
      // BroadcastChannel not supported (Safari < 15.4) — no notif-tap
      // ping; visibility-change still fires when the tab refocuses
      // after a notif tap.
    }

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      fcmChannelRef.current?.close()
      fcmChannelRef.current = null
    }
  }, [])

  return null
}

async function ping(
  force: boolean,
  lastPingAtRef: { current: number },
): Promise<void> {
  const now = Date.now()
  if (!force && now - lastPingAtRef.current < THROTTLE_MS) return
  if (typeof navigator === 'undefined' || !navigator.geolocation) return

  // Get current position; bail fast if denied / unavailable.
  const coords = await new Promise<GeolocationCoordinates | null>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos.coords),
      () => resolve(null),
      { maximumAge: 60_000, timeout: 8_000, enableHighAccuracy: false },
    )
  })
  if (!coords) return

  // Dynamic-import supabase so the module-load path of LocationPinger
  // doesn't initialize the client (which throws when VITE_SUPABASE_URL
  // isn't set, e.g. in some unit-test environments).
  const { supabase } = await import('@/lib/supabase')
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) return

  try {
    const res = await fetch('/api/users/me/location', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ lat: coords.latitude, lng: coords.longitude }),
    })
    if (res.ok) lastPingAtRef.current = now
  } catch {
    // Network blip — try again on next trigger.
  }
}
