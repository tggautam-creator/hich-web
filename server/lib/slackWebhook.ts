/**
 * 2026-05-21 — Phase 4 of docs/REPORTS_PLAN.md. Thin wrapper around
 * Slack's incoming-webhook endpoint. Used by `adminAlerts.ts` to
 * post Block Kit messages to `#tago-alerts` (or whatever channel
 * the webhook is bound to) when an emergency / urgent report
 * lands.
 *
 * Webhook URL lives in env (`SLACK_ALERTS_WEBHOOK_URL`); when it's
 * empty we silently no-op so local-dev environments without the
 * URL set don't blow up the report-create endpoint.
 */
import { getServerEnv } from '../env.ts'

/**
 * Slack Block Kit message shape. We only need a tiny subset of the
 * full spec (header, section with markdown text, action buttons),
 * so a hand-typed interface keeps the wire shape obvious without
 * pulling in a full Block Kit library.
 *
 * @see https://api.slack.com/block-kit
 */
export interface SlackMessage {
  /** Fallback text shown in notifications + when blocks fail to render. */
  text: string
  blocks?: SlackBlock[]
}

export type SlackBlock = SlackHeaderBlock | SlackSectionBlock | SlackDividerBlock | SlackActionsBlock

export interface SlackHeaderBlock {
  type: 'header'
  text: { type: 'plain_text'; text: string }
}

export interface SlackSectionBlock {
  type: 'section'
  text: { type: 'mrkdwn'; text: string }
  fields?: { type: 'mrkdwn'; text: string }[]
}

export interface SlackDividerBlock {
  type: 'divider'
}

export interface SlackActionsBlock {
  type: 'actions'
  elements: {
    type: 'button'
    text: { type: 'plain_text'; text: string }
    url: string
    style?: 'primary' | 'danger'
  }[]
}

/**
 * POSTs a Block Kit message to the configured Slack webhook.
 *
 * Returns `false` (without throwing) when the webhook URL is empty
 * — keeps the report-create endpoint happy on local-dev setups
 * that don't have Slack configured. Returns `true` on a 200 from
 * Slack; logs + returns `false` on any other response.
 *
 * **Fire-and-forget by design.** Callers should NOT await this
 * inside the request handler — wrap in `void postToSlack(...)`
 * or `setImmediate(() => void postToSlack(...))` so a slow Slack
 * response doesn't add latency to a user-facing report submission.
 */
export async function postToSlack(message: SlackMessage): Promise<boolean> {
  const { SLACK_ALERTS_WEBHOOK_URL } = getServerEnv()
  if (!SLACK_ALERTS_WEBHOOK_URL) {
    // No URL = silently no-op. We log ONCE per server boot rather
    // than per call to keep PM2 logs quiet.
    warnOnce()
    return false
  }

  try {
    const res = await fetch(SLACK_ALERTS_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    })
    if (!res.ok) {
      // Slack returns plain "invalid_payload" / "channel_not_found"
      // strings on 4xx — capture for ops debugging.
      const body = await res.text().catch(() => '<no body>')
      console.error('[slackWebhook] failed:', res.status, body)
      return false
    }
    return true
  } catch (err) {
    console.error(
      '[slackWebhook] network error:',
      err instanceof Error ? err.message : String(err),
    )
    return false
  }
}

let warnedMissingUrl = false
function warnOnce(): void {
  if (warnedMissingUrl) return
  warnedMissingUrl = true
  console.warn(
    '[slackWebhook] SLACK_ALERTS_WEBHOOK_URL not set — admin alerts will not fire. ' +
      'Set it in the EC2 .env (or .env.dev locally) and restart to enable.',
  )
}

/**
 * Exposed only for tests so they can reset the once-per-boot warn
 * latch between assertions. Don't call from app code.
 */
export function _resetWarnLatchForTests(): void {
  warnedMissingUrl = false
}
