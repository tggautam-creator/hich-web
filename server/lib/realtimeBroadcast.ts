/**
 * Broadcast a message to a Supabase Realtime channel via the REST API.
 * This avoids creating ephemeral WebSocket channels that time out on Free Tier.
 *
 * Endpoint: POST https://<project>.supabase.co/realtime/v1/api/broadcast
 * Auth: apikey header with the service role key.
 *
 * Reads env vars directly from process.env so tests that mock supabaseAdmin
 * don't need every env var present — broadcast simply returns false.
 */
export async function realtimeBroadcast(
  channelName: string,
  event: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  const supabaseUrl = process.env['SUPABASE_URL']
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY']

  if (!supabaseUrl || !serviceRoleKey) {
    console.warn('[Realtime REST] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — skipping broadcast')
    return false
  }

  const url = `${supabaseUrl}/realtime/v1/api/broadcast`

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({
        messages: [
          {
            topic: channelName,
            event,
            payload,
          },
        ],
      }),
      signal: AbortSignal.timeout(5000),
    })

    if (!res.ok) {
      console.warn(`[Realtime REST] HTTP ${res.status} broadcasting '${event}' to ${channelName}`)
      return false
    }

    return true
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.warn(`[Realtime REST] Failed broadcasting '${event}' to ${channelName}: ${message}`)
    return false
  }
}

/**
 * Broadcast to multiple channels in parallel. Fire-and-forget; failures are logged but never throw.
 */
export async function realtimeBroadcastMany(
  channels: string[],
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await Promise.allSettled(channels.map((ch) => realtimeBroadcast(ch, event, payload)))
}
