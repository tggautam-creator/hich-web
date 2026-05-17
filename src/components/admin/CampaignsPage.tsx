import { useEffect, useMemo, useState } from 'react'
import {
  useAdminAudiencePreview,
  useAdminSendCampaignPush,
  useAdminSendCampaignEmail,
  useAdminFromAddresses,
  useAdminCampaignHistory,
  useAdminRecallCampaign,
  type Audience,
  type AudienceType,
  type CampaignHistoryRow,
} from '@/hooks/useAdminCampaigns'
import RichTextEditor from './RichTextEditor'
import { AdminApiException } from '@/lib/admin/api'
import { trackEvent } from '@/lib/analytics'
import { supabase } from '@/lib/supabase'
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
  const [channel, setChannel] = useState<'push' | 'email'>('push')
  const [audienceType, setAudienceType] = useState<AudienceType>('all_users')
  const [domain, setDomain] = useState('')
  // Push fields
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [posterUrl, setPosterUrl] = useState<string | null>(null)
  const [posterUploading, setPosterUploading] = useState(false)
  const [posterError, setPosterError] = useState<string | null>(null)
  // Email fields (Slice 1.5)
  const [subject, setSubject] = useState('')
  const [bodyHtml, setBodyHtml] = useState('')
  const [emailFrom, setEmailFrom] = useState<string>('')
  // Shared
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

  const preview = useAdminAudiencePreview({ audience, enabled: audience !== null, channel })
  const send = useAdminSendCampaignPush()
  const sendEmail = useAdminSendCampaignEmail()
  const fromAddresses = useAdminFromAddresses(channel === 'email')

  // Default the From address to the first allowlisted entry once it loads.
  useEffect(() => {
    if (channel === 'email' && !emailFrom && fromAddresses.data?.addresses[0]) {
      setEmailFrom(fromAddresses.data.addresses[0].value)
    }
  }, [channel, emailFrom, fromAddresses.data])

  const composerValid = audience !== null && (
    channel === 'push'
      ? title.trim().length > 0 && body.trim().length > 0
      : subject.trim().length > 0
        && bodyHtml.replace(/<[^>]+>/g, '').trim().length > 0
        && emailFrom.length > 0
  )
  const canSend = composerValid && preview.data !== undefined && preview.data.count > 0
  const activeMutation = channel === 'push' ? send : sendEmail

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

      {/* Slice 1.5 — channel switcher above the composer */}
      <div data-testid="campaign-channel-tabs" className="inline-flex rounded-lg border border-border bg-white p-0.5">
        {(['push', 'email'] as const).map((ch) => {
          const active = ch === channel
          return (
            <button
              key={ch}
              type="button"
              data-testid={`campaign-channel-${ch}`}
              onClick={() => setChannel(ch)}
              className={[
                'rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
                active
                  ? 'bg-primary-light text-primary'
                  : 'text-text-secondary hover:text-text-primary',
              ].join(' ')}
            >
              {ch === 'push' ? 'Push notification' : 'Email'}
            </button>
          )
        })}
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

          {channel === 'push' && (
            <>
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
            </>
          )}

          {channel === 'email' && (
            <>
              <label className="block">
                <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
                  From
                </div>
                <select
                  data-testid="campaign-email-from"
                  value={emailFrom}
                  onChange={(e) => setEmailFrom(e.target.value)}
                  className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  {fromAddresses.isLoading && <option>Loading…</option>}
                  {fromAddresses.data?.addresses.map((a) => (
                    <option key={a.value} value={a.value}>{a.label}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
                  Subject <span className="text-text-secondary">(≤ 200 chars)</span>
                </div>
                <input
                  data-testid="campaign-email-subject"
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Your Tago weekly digest"
                  maxLength={200}
                  className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </label>
              <label className="block">
                <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
                  Body
                </div>
                <RichTextEditor
                  value={bodyHtml}
                  onChange={setBodyHtml}
                  placeholder="Write the email — bold, lists, links, headings…"
                />
              </label>
            </>
          )}

          {channel === 'push' && <PosterUploadField
            posterUrl={posterUrl}
            uploading={posterUploading}
            error={posterError}
            onChange={async (file) => {
              setPosterError(null)
              if (!file) {
                setPosterUrl(null)
                return
              }
              if (file.size > 2 * 1024 * 1024) {
                setPosterError('Poster must be ≤ 2 MB.')
                return
              }
              if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
                setPosterError('Poster must be a JPEG, PNG, or WebP.')
                return
              }
              setPosterUploading(true)
              try {
                // Filename: timestamp-randomslug.<ext> — collision-free
                // without leaking the admin's identity.
                const ext = file.name.split('.').pop()?.toLowerCase() ?? 'png'
                const rand = Math.random().toString(36).slice(2, 10)
                const path = `${Date.now()}-${rand}.${ext}`
                const { error: uploadErr } = await supabase.storage
                  .from('campaign-posters')
                  .upload(path, file, { upsert: false, contentType: file.type })
                if (uploadErr) {
                  setPosterError(uploadErr.message)
                  setPosterUploading(false)
                  return
                }
                const { data: urlData } = supabase.storage
                  .from('campaign-posters')
                  .getPublicUrl(path)
                setPosterUrl(urlData.publicUrl)
              } catch (err) {
                setPosterError(err instanceof Error ? err.message : 'Upload failed.')
              } finally {
                setPosterUploading(false)
              }
            }}
          />}

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

          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="campaign-send"
              onClick={() => setShowConfirm(true)}
              disabled={!canSend}
              className={[
                'flex-1 rounded-md px-4 py-2 text-sm font-semibold transition-colors',
                !canSend
                  ? 'bg-border cursor-not-allowed text-text-secondary'
                  : 'bg-primary text-white hover:bg-primary-dark',
              ].join(' ')}
            >
              Review &amp; send…
            </button>
            <button
              type="button"
              data-testid="campaign-send-test"
              disabled={!composerValid || activeMutation.isPending}
              onClick={() => {
                if (!audience) return
                if (channel === 'push') {
                  send.mutate({
                    audience,
                    title: title.trim(),
                    body: body.trim(),
                    reason: reason.trim() || undefined,
                    poster_url: posterUrl ?? undefined,
                    test_to_self: true,
                  })
                } else {
                  sendEmail.mutate({
                    audience,
                    subject: subject.trim(),
                    body_html: bodyHtml,
                    from: emailFrom,
                    reason: reason.trim() || undefined,
                    test_to_self: true,
                  })
                }
              }}
              className={[
                'rounded-md border px-3 py-2 text-sm font-medium transition-colors',
                !composerValid || activeMutation.isPending
                  ? 'border-border bg-white cursor-not-allowed text-text-secondary'
                  : 'border-primary bg-white text-primary hover:bg-primary-light',
              ].join(' ')}
              title="Sends just to your own user. Bypasses audience + opt-outs."
            >
              Test to me
            </button>
          </div>

          {channel === 'push' && send.isSuccess && send.data && (
            <p data-testid="campaign-send-result" className="text-xs text-success">
              ✓ Sent: {send.data.push_sent} pushes delivered to {send.data.recipient_count} users
              ({send.data.notifications_written} inbox notifications written).
            </p>
          )}
          {channel === 'email' && sendEmail.isSuccess && sendEmail.data && (
            <p data-testid="campaign-send-result" className="text-xs text-success">
              ✓ Sent: {sendEmail.data.sent} emails delivered to {sendEmail.data.recipient_count} users
              ({sendEmail.data.failed} failed).
            </p>
          )}
          {activeMutation.error && (
            <p data-testid="campaign-send-error" className="text-xs text-danger">
              ✗ {activeMutation.error instanceof AdminApiException
                ? `${activeMutation.error.code}: ${activeMutation.error.message}`
                : activeMutation.error.message}
            </p>
          )}
        </div>

        {/* ── Audience preview side card ───────────────────────── */}
        <AudiencePreviewCard
          audience={audience}
          preview={preview}
        />
      </div>

      {/* ── Past campaigns history (Slice 1.4d) ────────────────── */}
      <CampaignHistorySection
        onDuplicate={(row) => {
          // Prefill the composer + scroll to top so the admin can
          // tweak before resending. Swap to the right channel tab
          // based on which channel the original was.
          const aud = row.audience as { type?: string; domain?: string }
          if (aud?.type) setAudienceType(aud.type as AudienceType)
          if (aud?.domain) setDomain(aud.domain)
          setChannel(row.channel)
          if (row.channel === 'push') {
            setTitle(row.title)
            setBody(row.body)
            setPosterUrl(row.poster_url)
          } else {
            setSubject(row.title)
            setBodyHtml(row.body)
            if (row.email_from) setEmailFrom(row.email_from)
          }
          setReason('')
          window.scrollTo({ top: 0, behavior: 'smooth' })
        }}
      />

      {showConfirm && audience && preview.data && (
        <ConfirmSendDialog
          channel={channel}
          audience={audience}
          count={preview.data.count}
          title={channel === 'push' ? title.trim() : subject.trim()}
          body={channel === 'push' ? body.trim() : bodyHtml}
          reason={reason.trim()}
          submitting={activeMutation.isPending}
          onCancel={() => setShowConfirm(false)}
          onConfirm={() => {
            if (channel === 'push') {
              send.mutate(
                {
                  audience,
                  title: title.trim(),
                  body: body.trim(),
                  reason: reason.trim() || undefined,
                  confirm_count: preview.data!.count,
                  poster_url: posterUrl ?? undefined,
                },
                {
                  onSuccess: () => {
                    setShowConfirm(false)
                    setTitle('')
                    setBody('')
                    setReason('')
                    setPosterUrl(null)
                  },
                  onError: () => { /* keep dialog open */ },
                },
              )
            } else {
              sendEmail.mutate(
                {
                  audience,
                  subject: subject.trim(),
                  body_html: bodyHtml,
                  from: emailFrom,
                  reason: reason.trim() || undefined,
                  confirm_count: preview.data!.count,
                },
                {
                  onSuccess: () => {
                    setShowConfirm(false)
                    setSubject('')
                    setBodyHtml('')
                    setReason('')
                  },
                  onError: () => { /* keep dialog open */ },
                },
              )
            }
          }}
          posterUrl={channel === 'push' ? posterUrl : null}
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
  channel,
  audience,
  count,
  title,
  body,
  reason,
  posterUrl,
  submitting,
  onCancel,
  onConfirm,
}: {
  channel: 'push' | 'email'
  audience: Audience
  count: number
  title: string
  body: string
  reason: string
  posterUrl: string | null
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
          Confirm {channel === 'push' ? 'broadcast push' : 'broadcast email'}
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
          {posterUrl && (
            <>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
                Poster
              </div>
              <img
                src={posterUrl}
                alt=""
                className="mt-1 max-h-40 w-full rounded-md object-cover"
              />
            </>
          )}
          <div className={posterUrl ? 'mt-3 text-[10px] font-semibold uppercase tracking-wide text-text-secondary' : 'text-[10px] font-semibold uppercase tracking-wide text-text-secondary'}>
            {channel === 'push' ? 'Title' : 'Subject'}
          </div>
          <div className="mt-1 text-sm font-semibold text-text-primary">{title}</div>
          <div className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
            Body
          </div>
          {channel === 'email' ? (
            <div
              className="mt-1 max-h-40 overflow-y-auto rounded bg-white p-2 text-xs text-text-primary prose prose-sm max-w-none"
              dangerouslySetInnerHTML={{ __html: body }}
            />
          ) : (
            <div className="mt-1 text-xs text-text-primary whitespace-pre-wrap">{body}</div>
          )}
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

// ── Poster upload field ────────────────────────────────────────────────────

function PosterUploadField({
  posterUrl,
  uploading,
  error,
  onChange,
}: {
  posterUrl: string | null
  uploading: boolean
  error: string | null
  onChange: (file: File | null) => void
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
        Marketing poster (optional)
        <InfoTooltip
          text="Optional image shown in the push banner (Android + web — iOS needs a Notification Service Extension which ships in Slice 1.4c) AND inline on the /c/<slug> detail page that the push deep-links to. Recommended size: 1200×600 px (2:1 landscape, best for push banners) OR 1080×1080 px (square, best for the in-app inbox + detail page). The image will render at native aspect ratio, max-width on every surface. ≤ 2 MB, JPEG / PNG / WebP."
          align="left"
        />
      </div>
      {posterUrl ? (
        <div className="rounded-md border border-border bg-surface p-2">
          <img
            src={posterUrl}
            alt=""
            data-testid="campaign-poster-preview"
            className="max-h-40 w-full rounded object-cover"
          />
          <div className="mt-2 flex items-center justify-between">
            <span className="truncate font-mono text-[10px] text-text-secondary">
              {posterUrl.split('/').pop()}
            </span>
            <button
              type="button"
              data-testid="campaign-poster-remove"
              onClick={() => onChange(null)}
              className="rounded-md border border-border bg-white px-2 py-1 text-[11px] font-medium text-text-primary hover:bg-surface"
            >
              Remove
            </button>
          </div>
        </div>
      ) : (
        <label
          data-testid="campaign-poster-dropzone"
          className="flex cursor-pointer flex-col items-center gap-1 rounded-md border border-dashed border-border bg-surface px-3 py-6 text-xs text-text-secondary hover:bg-white"
        >
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null
              onChange(f)
              // Allow re-selecting the same file later.
              e.target.value = ''
            }}
          />
          {uploading ? (
            <span data-testid="campaign-poster-uploading">Uploading…</span>
          ) : (
            <>
              <span className="font-medium text-text-primary">Add a poster</span>
              <span>Click to pick a file (≤ 2 MB, JPEG/PNG/WebP)</span>
              <span className="text-text-secondary">Recommended: 1200×600 px (banner) or 1080×1080 (square)</span>
            </>
          )}
        </label>
      )}
      {error && (
        <p data-testid="campaign-poster-error" className="mt-1 text-[11px] text-danger">
          {error}
        </p>
      )}
    </div>
  )
}


// ── Campaign history section (Slice 1.4d) ──────────────────────────────────

function CampaignHistorySection({
  onDuplicate,
}: {
  onDuplicate: (row: CampaignHistoryRow) => void
}) {
  const { data, isLoading, error } = useAdminCampaignHistory({})
  const [recallTarget, setRecallTarget] = useState<CampaignHistoryRow | null>(null)

  return (
    <div className="space-y-3 rounded-2xl border border-border bg-white p-5">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-text-primary">Past campaigns</h2>
        <InfoTooltip
          align="left"
          text="Every broadcast Tago has sent, newest first. Recall removes the message from all recipients' in-app inboxes AND 404s the public /c/<slug> page — both are reversible only by clearing the recalled_at column in SQL. Duplicate pre-fills the composer above with this campaign's title, body, audience, and poster so you can tweak + resend."
        />
      </div>

      {isLoading && !data && (
        <p className="text-xs text-text-secondary">Loading…</p>
      )}
      {error && (
        <p className="text-xs text-danger">
          {error instanceof AdminApiException
            ? `${error.code}: ${error.message}`
            : error.message}
        </p>
      )}
      {data && data.campaigns.length === 0 && (
        <p className="text-xs text-text-secondary">
          No campaigns yet. Compose one above.
        </p>
      )}
      {data && data.campaigns.length > 0 && (
        <ul className="divide-y divide-border">
          {data.campaigns.map((row) => {
            const aud = row.audience as { type?: string; domain?: string }
            return (
              <li
                key={row.id}
                data-testid={`history-row-${row.id}`}
                className="py-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span
                        className={[
                          'rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide font-semibold',
                          row.channel === 'email' ? 'bg-success/10 text-success' : 'bg-primary-light text-primary',
                        ].join(' ')}
                      >
                        {row.channel}
                      </span>
                      <span className="text-sm font-semibold text-text-primary truncate">
                        {row.title}
                      </span>
                      {row.recalled_at && (
                        <span className="rounded bg-danger/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide font-semibold text-danger">
                          recalled
                        </span>
                      )}
                      {row.poster_url && (
                        <span className="rounded bg-primary-light px-1.5 py-0.5 text-[10px] uppercase tracking-wide font-semibold text-primary">
                          poster
                        </span>
                      )}
                    </div>
                    {row.channel === 'email' ? (
                      <p className="mt-0.5 text-xs text-text-secondary line-clamp-2">
                        {row.body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}
                      </p>
                    ) : (
                      <p className="mt-0.5 text-xs text-text-secondary line-clamp-2">
                        {row.body}
                      </p>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-text-secondary">
                      <span>{aud.type ?? 'unknown'}{aud.domain ? `: ${aud.domain}` : ''}</span>
                      <span>·</span>
                      <span>{row.recipient_count} recipients</span>
                      <span>·</span>
                      <span>{row.push_sent_count} pushes delivered</span>
                      <span>·</span>
                      <span>{new Date(row.sent_at).toLocaleString()}</span>
                      <span>·</span>
                      <span>by {row.sent_by_email ?? row.sent_by.slice(0, 8) + '…'}</span>
                    </div>
                    {row.recalled_at && (
                      <div className="mt-1 text-[11px] text-danger">
                        Recalled {new Date(row.recalled_at).toLocaleString()}
                        {row.recalled_reason && ` — ${row.recalled_reason}`}
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    <button
                      type="button"
                      data-testid={`history-duplicate-${row.id}`}
                      onClick={() => onDuplicate(row)}
                      className="rounded-md border border-border bg-white px-2.5 py-1 text-xs font-medium text-text-primary hover:bg-surface"
                    >
                      Duplicate
                    </button>
                    {!row.recalled_at && (
                      <button
                        type="button"
                        data-testid={`history-recall-${row.id}`}
                        onClick={() => setRecallTarget(row)}
                        className="rounded-md border border-danger bg-white px-2.5 py-1 text-xs font-medium text-danger hover:bg-danger/5"
                      >
                        Recall
                      </button>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {recallTarget && (
        <RecallCampaignDialog
          row={recallTarget}
          onCancel={() => setRecallTarget(null)}
          onSuccess={() => setRecallTarget(null)}
        />
      )}
    </div>
  )
}

function RecallCampaignDialog({
  row,
  onCancel,
  onSuccess,
}: {
  row: CampaignHistoryRow
  onCancel: () => void
  onSuccess: () => void
}) {
  const [reason, setReason] = useState('')
  const m = useAdminRecallCampaign(row.id)
  const ok = reason.trim().length > 0

  return (
    <div
      data-testid="campaign-recall-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div
        role="dialog"
        aria-label="Confirm recall"
        className="w-full max-w-md rounded-2xl border border-border bg-white p-6 shadow-xl"
      >
        <div className="text-sm font-semibold uppercase tracking-wide text-text-secondary">
          Confirm recall
        </div>
        <div className="mt-3 text-3xl font-bold text-danger text-center">RECALL</div>
        <div className="mt-2 text-center text-xs text-text-secondary">
          “{row.title}”
        </div>

        <p className="mt-4 text-xs text-text-secondary">
          Tago will delete the in-app inbox row for every recipient
          ({row.recipient_count} users) AND make the public /c/{row.slug} page
          return 404. Audit-logged. Reversible only by clearing
          <span className="font-mono"> recalled_at </span>
          in SQL.
        </p>

        <div className="mt-4">
          <label className="block">
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
              Reason (required)
            </div>
            <input
              data-testid="campaign-recall-reason"
              type="text"
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. typo in the title"
              maxLength={300}
              className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </label>
        </div>

        {m.error && (
          <p className="mt-2 text-xs text-danger">
            ✗ {m.error instanceof AdminApiException
              ? `${m.error.code}: ${m.error.message}`
              : m.error.message}
          </p>
        )}

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            type="button"
            data-testid="campaign-recall-cancel"
            onClick={onCancel}
            disabled={m.isPending}
            className="rounded-md border border-border bg-white px-4 py-2 text-sm font-medium text-text-primary hover:bg-surface disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="campaign-recall-confirm"
            disabled={!ok || m.isPending}
            onClick={() => {
              m.mutate(
                { reason: reason.trim() },
                { onSuccess: () => onSuccess() },
              )
            }}
            className={[
              'rounded-md px-4 py-2 text-sm font-semibold text-white transition-colors',
              !ok || m.isPending
                ? 'bg-border cursor-not-allowed text-text-secondary'
                : 'bg-danger hover:opacity-90',
            ].join(' ')}
          >
            {m.isPending ? 'Recalling…' : 'Confirm recall'}
          </button>
        </div>
      </div>
    </div>
  )
}
