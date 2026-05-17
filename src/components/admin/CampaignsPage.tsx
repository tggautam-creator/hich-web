import { useEffect, useMemo, useState } from 'react'
import {
  useAdminAudiencePreview,
  useAdminSendCampaignPush,
  type Audience,
  type AudienceType,
} from '@/hooks/useAdminCampaigns'
import { AdminApiException } from '@/lib/admin/api'
import { trackEvent } from '@/lib/analytics'
import InfoTooltip from './InfoTooltip'

/**
 * Slice 1.4 — broadcast push composer at /admin/campaigns.
 *
 * Two-pane layout:
 *   - Left: audience selector + composer form
 *   - Right: live "audience size" card + sample users
 *
 * Send is gated by a confirm dialog that echoes the audience count +
 * title + body and requires re-typing the recipient count for ≥ 100
 * recipients. The server enforces the same drift check via
 * confirm_count on the request body, so a 60s gap between preview +
 * send returns 409 AUDIENCE_DRIFT instead of silently messaging a
 * different set of users.
 */
const AUDIENCE_OPTIONS: Array<{
  value: AudienceType
  label: string
  description: string
}> = [
  { value: 'all_users', label: 'All users', description: 'Every user with an account (excluding suspended).' },
  { value: 'all_drivers', label: 'All drivers', description: 'Users with is_driver=true.' },
  { value: 'all_riders', label: 'All riders', description: 'Users with is_driver=false.' },
  { value: 'by_university', label: 'By university (email domain)', description: 'Match email domain — e.g. davis.edu.' },
  { value: 'active_last_7d', label: 'Active in last 7 days', description: 'last_active_at within 7 days.' },
  { value: 'active_last_30d', label: 'Active in last 30 days', description: 'last_active_at within 30 days.' },
  { value: 'dormant_30d', label: 'Dormant (no activity in 30d)', description: 'last_active_at older than 30 days but not NULL.' },
]

const LARGE_AUDIENCE = 100

export default function CampaignsPage() {
  const [audienceType, setAudienceType] = useState<AudienceType>('all_users')
  const [domain, setDomain] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [reason, setReason] = useState('')
  const [showConfirm, setShowConfirm] = useState(false)

  useEffect(() => {
    trackEvent('admin_campaigns_loaded')
  }, [])

  const audience: Audience | null = useMemo(() => {
    if (audienceType === 'by_university') {
      const d = domain.trim().replace(/^@/, '').toLowerCase()
      if (!d) return null
      return { type: audienceType, domain: d }
    }
    return { type: audienceType }
  }, [audienceType, domain])

  const preview = useAdminAudiencePreview({ audience, enabled: audience !== null })
  const send = useAdminSendCampaignPush()

  const composerValid =
    title.trim().length > 0 && body.trim().length > 0 && audience !== null
  const canSend = composerValid && preview.data !== undefined && preview.data.count > 0

  return (
    <div data-testid="admin-campaigns" className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold text-text-primary">Campaigns</h1>
          <InfoTooltip
            testid="campaigns-page-info"
            text="Send a broadcast push to a segment of users. Audience is computed live as you tweak filters. Confirm-send echoes the recipient count and asks you to re-enter it for ≥100 recipients. Server enforces the count match so a 60s gap between preview and send returns AUDIENCE_DRIFT instead of silently messaging a different set of users."
            align="left"
          />
        </div>
        <p className="mt-1 text-sm text-text-secondary">
          Compose a one-shot push to a segment. Email + in-app banner
          composers land in Slice 1.5 / 1.6.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        {/* ── Composer ──────────────────────────────────────────── */}
        <div className="space-y-4 rounded-2xl border border-border bg-white p-5">
          <label className="block">
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
              Audience
            </div>
            <select
              data-testid="campaign-audience"
              value={audienceType}
              onChange={(e) => setAudienceType(e.target.value as AudienceType)}
              className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              {AUDIENCE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-text-secondary">
              {AUDIENCE_OPTIONS.find((o) => o.value === audienceType)?.description}
            </p>
          </label>

          {audienceType === 'by_university' && (
            <label className="block">
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
                Email domain
              </div>
              <input
                data-testid="campaign-audience-domain"
                type="text"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="davis.edu"
                className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              <p className="mt-1 text-[11px] text-text-secondary">
                Match users whose email ends in @{domain.trim() || '…'}. Case-insensitive.
              </p>
            </label>
          )}

          <label className="block">
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
              Title <span className="text-text-secondary">(≤ 120 chars)</span>
            </div>
            <input
              data-testid="campaign-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Heads up"
              maxLength={120}
              className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </label>

          <label className="block">
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
              Body <span className="text-text-secondary">(≤ 500 chars)</span>
            </div>
            <textarea
              data-testid="campaign-body"
              rows={4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="What you want to say…"
              maxLength={500}
              className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </label>

          <label className="block">
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
              Reason (optional)
            </div>
            <input
              data-testid="campaign-reason"
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. weekly Sunday-night reminder"
              maxLength={200}
              className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </label>

          <button
            type="button"
            data-testid="campaign-send"
            onClick={() => setShowConfirm(true)}
            disabled={!canSend}
            className={[
              'w-full rounded-md px-4 py-2 text-sm font-semibold transition-colors',
              !canSend
                ? 'bg-border cursor-not-allowed text-text-secondary'
                : 'bg-primary text-white hover:bg-primary-dark',
            ].join(' ')}
          >
            Review &amp; send…
          </button>

          {send.isSuccess && send.data && (
            <p data-testid="campaign-send-result" className="text-xs text-success">
              ✓ Sent: {send.data.push_sent} pushes delivered to {send.data.recipient_count} users
              ({send.data.notifications_written} inbox notifications written).
            </p>
          )}
          {send.error && (
            <p data-testid="campaign-send-error" className="text-xs text-danger">
              ✗ {send.error instanceof AdminApiException
                ? `${send.error.code}: ${send.error.message}`
                : send.error.message}
            </p>
          )}
        </div>

        {/* ── Audience preview side card ───────────────────────── */}
        <AudiencePreviewCard
          audience={audience}
          preview={preview}
        />
      </div>

      {showConfirm && audience && preview.data && (
        <ConfirmSendDialog
          audience={audience}
          count={preview.data.count}
          title={title.trim()}
          body={body.trim()}
          reason={reason.trim()}
          submitting={send.isPending}
          onCancel={() => setShowConfirm(false)}
          onConfirm={() => {
            send.mutate(
              {
                audience,
                title: title.trim(),
                body: body.trim(),
                reason: reason.trim() || undefined,
                confirm_count: preview.data!.count,
              },
              {
                onSuccess: () => {
                  setShowConfirm(false)
                  setTitle('')
                  setBody('')
                  setReason('')
                },
                onError: () => {
                  // Keep dialog open so the admin sees the error.
                },
              },
            )
          }}
        />
      )}
    </div>
  )
}

// ── Audience preview side card ─────────────────────────────────────────────

function AudiencePreviewCard({
  audience,
  preview,
}: {
  audience: Audience | null
  preview: ReturnType<typeof useAdminAudiencePreview>
}) {
  if (!audience) {
    return (
      <div
        data-testid="campaign-preview-empty"
        className="rounded-2xl border border-dashed border-border bg-white p-5 text-xs text-text-secondary"
      >
        Pick an audience to see the size.
      </div>
    )
  }
  return (
    <div
      data-testid="campaign-preview"
      className="space-y-3 rounded-2xl border border-border bg-white p-5"
    >
      <div className="flex items-center gap-2">
        <div className="text-sm font-semibold text-text-primary">Audience size</div>
        {preview.isFetching && (
          <span className="text-[11px] text-primary">Refreshing…</span>
        )}
      </div>
      {preview.isLoading && !preview.data && (
        <p className="text-xs text-text-secondary">Computing…</p>
      )}
      {preview.error && (
        <p className="text-xs text-danger">
          {preview.error instanceof AdminApiException
            ? `${preview.error.code}: ${preview.error.message}`
            : preview.error.message}
        </p>
      )}
      {preview.data && (
        <>
          <div
            className={[
              'text-3xl font-bold',
              preview.data.count === 0 ? 'text-text-secondary' : 'text-text-primary',
            ].join(' ')}
          >
            {preview.data.count.toLocaleString('en-US')}
          </div>
          <p className="text-[11px] text-text-secondary">
            {preview.data.count === 1 ? 'recipient' : 'recipients'}
            {' '}
            ({audience.type}{audience.domain ? `: ${audience.domain}` : ''})
          </p>
          {preview.data.sample_users.length > 0 && (
            <div className="mt-2 rounded-md border border-border bg-surface p-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
                Sample (first {preview.data.sample_users.length})
              </div>
              <ul className="mt-1 space-y-0.5">
                {preview.data.sample_users.map((u) => (
                  <li key={u.id} className="truncate text-[11px] text-text-primary">
                    {u.full_name ?? '(no name)'}
                    <span className="text-text-secondary"> · {u.email}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Confirm dialog ─────────────────────────────────────────────────────────

function ConfirmSendDialog({
  audience,
  count,
  title,
  body,
  reason,
  submitting,
  onCancel,
  onConfirm,
}: {
  audience: Audience
  count: number
  title: string
  body: string
  reason: string
  submitting: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const [retype, setRetype] = useState('')
  const requireRetype = count >= LARGE_AUDIENCE
  const retypeMatch = parseInt(retype.replace(/[^\d]/g, ''), 10) === count
  const okToConfirm = !requireRetype || retypeMatch

  return (
    <div
      data-testid="campaign-confirm-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div
        role="dialog"
        aria-label="Confirm broadcast push"
        className="w-full max-w-md rounded-2xl border border-border bg-white p-6 shadow-xl"
      >
        <div className="text-sm font-semibold uppercase tracking-wide text-text-secondary">
          Confirm broadcast
        </div>

        <div className="mt-3 text-center">
          <div className="text-4xl font-bold text-primary">
            {count.toLocaleString('en-US')}
          </div>
          <div className="mt-1 text-xs text-text-secondary">
            recipients ({audience.type}{audience.domain ? `: ${audience.domain}` : ''})
          </div>
        </div>

        <div className="mt-4 rounded-md border border-border bg-surface p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
            Title
          </div>
          <div className="mt-1 text-sm font-semibold text-text-primary">{title}</div>
          <div className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
            Body
          </div>
          <div className="mt-1 text-xs text-text-primary whitespace-pre-wrap">{body}</div>
          {reason && (
            <>
              <div className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
                Reason (audit)
              </div>
              <div className="mt-1 text-[11px] text-text-secondary">{reason}</div>
            </>
          )}
        </div>

        {requireRetype && (
          <div className="mt-4">
            <label className="block">
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
                Re-type the recipient count to confirm
              </div>
              <input
                data-testid="campaign-confirm-retype"
                type="text"
                inputMode="numeric"
                autoFocus
                value={retype}
                onChange={(e) => setRetype(e.target.value)}
                placeholder={String(count)}
                className={[
                  'w-full rounded-md border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2',
                  retypeMatch
                    ? 'border-success focus:ring-success/20'
                    : 'border-border focus:ring-primary/20',
                ].join(' ')}
              />
            </label>
            {retype && !retypeMatch && (
              <p className="mt-1 text-[11px] text-danger">
                Doesn't match — expected {count}
              </p>
            )}
          </div>
        )}

        <p className="mt-4 text-xs text-text-secondary">
          Tago will: send a push to every recipient with a registered
          token + write an in-app inbox row for every recipient (whether
          their push delivers or not) + audit-log the broadcast. There's
          no undo — to revoke, send a follow-up push explaining.
        </p>

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            type="button"
            data-testid="campaign-confirm-cancel"
            onClick={onCancel}
            disabled={submitting}
            className="rounded-md border border-border bg-white px-4 py-2 text-sm font-medium text-text-primary hover:bg-surface disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="campaign-confirm-confirm"
            onClick={onConfirm}
            disabled={!okToConfirm || submitting}
            className={[
              'rounded-md px-4 py-2 text-sm font-semibold text-white transition-colors',
              !okToConfirm || submitting
                ? 'bg-border cursor-not-allowed text-text-secondary'
                : 'bg-primary hover:bg-primary-dark',
            ].join(' ')}
          >
            {submitting
              ? 'Sending…'
              : `Send to ${count.toLocaleString('en-US')} ${count === 1 ? 'user' : 'users'}`}
          </button>
        </div>
      </div>
    </div>
  )
}
