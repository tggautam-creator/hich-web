/**
 * /admin/marketing/emails — admin UI for lifecycle email templates.
 * Lists every template + lets you edit / preview / test-send a
 * single one. The cron uses the same template at send time, so
 * edits here flow to live sends without a deploy.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  useEmailTemplates,
  useEmailTemplate,
  useUpdateEmailTemplate,
  useTestSendEmailTemplate,
  type EmailTemplateRow,
  type EmailSendRow,
  type FromAllowlistEntry,
} from '@/hooks/useEmailTemplates'
import { CostFooterNote } from './_shared'

export default function EmailsPage() {
  const list = useEmailTemplates()
  const [activeKey, setActiveKey] = useState<string | null>(null)

  // Auto-pick the first template on load so the editor isn't empty.
  useEffect(() => {
    if (!activeKey && list.data?.templates?.[0]) {
      setActiveKey(list.data.templates[0].key)
    }
  }, [activeKey, list.data])

  return (
    <div data-testid="admin-marketing-emails" className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-text-primary">Lifecycle emails</h1>
        <p className="text-sm text-text-secondary">
          Edit the templates the cron uses for welcome, drip, and
          re-engagement messages. Changes apply on the next send — no
          deploy needed.
        </p>
      </header>

      {list.isLoading && (
        <p className="text-sm text-text-secondary">Loading templates…</p>
      )}
      {list.error && (
        <div className="rounded-lg border border-danger/30 bg-danger/5 px-4 py-2 text-sm text-danger">
          Couldn't load templates. {list.error.message}
        </div>
      )}

      {list.data && (
        <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-4">
          <TemplateSidebar
            templates={list.data.templates}
            activeKey={activeKey}
            onSelect={setActiveKey}
          />
          {activeKey && (
            <TemplateEditor
              templateKey={activeKey}
              fromAllowlist={list.data.from_address_allowlist}
            />
          )}
        </div>
      )}

      <CostFooterNote />
    </div>
  )
}

function TemplateSidebar({
  templates, activeKey, onSelect,
}: {
  templates: EmailTemplateRow[]
  activeKey: string | null
  onSelect: (k: string) => void
}) {
  return (
    <aside className="rounded-2xl border border-border bg-white p-3 space-y-1">
      <p className="text-[10px] uppercase tracking-wide font-semibold text-text-secondary px-2 py-1">
        Templates
      </p>
      {templates.map((t) => {
        const active = t.key === activeKey
        return (
          <button
            key={t.key}
            type="button"
            data-testid={`template-row-${t.key}`}
            onClick={() => onSelect(t.key)}
            className={[
              'w-full text-left rounded-lg px-3 py-2 text-sm transition-colors',
              active
                ? 'bg-primary/10 text-primary'
                : 'text-text-primary hover:bg-surface',
            ].join(' ')}
          >
            <p className="font-semibold leading-tight">{t.name}</p>
            <p className="text-[10px] text-text-secondary truncate mt-0.5">
              {t.key} · {t.is_active ? 'active' : 'inactive'}
            </p>
          </button>
        )
      })}
    </aside>
  )
}

function TemplateEditor({
  templateKey, fromAllowlist,
}: {
  templateKey: string
  fromAllowlist: FromAllowlistEntry[]
}) {
  const detail = useEmailTemplate(templateKey)
  const update = useUpdateEmailTemplate(templateKey)
  const test = useTestSendEmailTemplate(templateKey)

  // Form state — initialized from server on load and on key change.
  const [name, setName] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [fromEmail, setFromEmail] = useState('')
  const [fromName, setFromName] = useState('')
  const [replyTo, setReplyTo] = useState('')
  const [isActive, setIsActive] = useState(true)

  useEffect(() => {
    const t = detail.data?.template
    if (t) {
      setName(t.name)
      setSubject(t.subject)
      setBody(t.body_markdown)
      setFromEmail(t.from_email)
      setFromName(t.from_name)
      setReplyTo(t.reply_to ?? '')
      setIsActive(t.is_active)
    }
  }, [detail.data?.template])

  const original = detail.data?.template
  const dirty = useMemo(() => {
    if (!original) return false
    return (
      name !== original.name
      || subject !== original.subject
      || body !== original.body_markdown
      || fromEmail !== original.from_email
      || fromName !== original.from_name
      || (replyTo || null) !== (original.reply_to ?? null)
      || isActive !== original.is_active
    )
  }, [name, subject, body, fromEmail, fromName, replyTo, isActive, original])

  // Auto-clear the test-send result after 4s so the button can re-run.
  useEffect(() => {
    if (test.isSuccess || test.isError) {
      const t = window.setTimeout(() => test.reset(), 4000)
      return () => window.clearTimeout(t)
    }
    return undefined
  }, [test.isSuccess, test.isError, test])

  if (detail.isLoading) {
    return <p className="text-sm text-text-secondary">Loading template…</p>
  }
  if (detail.error) {
    return (
      <div className="rounded-lg border border-danger/30 bg-danger/5 px-4 py-2 text-sm text-danger">
        Couldn't load template. {detail.error.message}
      </div>
    )
  }
  if (!detail.data) return null
  const tpl = detail.data.template

  function handleSave() {
    update.mutate({
      name, subject, body_markdown: body,
      from_email: fromEmail, from_name: fromName,
      reply_to: replyTo.trim() || null,
      is_active: isActive,
    })
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-border bg-white p-5 space-y-3">
        <header className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase tracking-wide font-semibold text-text-secondary">
              Editing
            </p>
            <h2 className="text-base font-bold text-text-primary mt-0.5">
              {tpl.name} <span className="text-text-secondary font-normal">·</span> <code className="text-xs text-text-secondary">{tpl.key}</code>
            </h2>
            <p className="text-xs text-text-secondary mt-1">
              Allowed variables: {tpl.variables.length === 0 ? '(none)' : tpl.variables.map((v) => <code key={v} className="mx-1 text-[10px] bg-surface px-1 py-0.5 rounded">{`{{${v}}}`}</code>)}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                data-testid="template-active"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
              />
              <span className={isActive ? 'text-success font-semibold' : 'text-text-secondary'}>
                {isActive ? 'Active' : 'Paused'}
              </span>
            </label>
            <button
              data-testid="template-save"
              type="button"
              onClick={handleSave}
              disabled={!dirty || update.isPending}
              className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
            >
              {update.isPending ? 'Saving…' : dirty ? 'Save changes' : 'No changes'}
            </button>
            {update.isError && (
              <p className="text-[10px] text-danger">{update.error.message}</p>
            )}
            {update.isSuccess && !dirty && (
              <p data-testid="template-saved" className="text-[10px] text-success">Saved ✓</p>
            )}
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <Field label="Template name">
            <input
              data-testid="field-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-primary"
            />
          </Field>
          <Field label="Subject">
            <input
              data-testid="field-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-primary"
            />
          </Field>
          <Field label="From address">
            <select
              data-testid="field-from-email"
              value={fromEmail}
              onChange={(e) => setFromEmail(e.target.value)}
              className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-primary"
            >
              {fromAllowlist.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </Field>
          <Field label="From name">
            <input
              data-testid="field-from-name"
              value={fromName}
              onChange={(e) => setFromName(e.target.value)}
              className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-primary"
            />
          </Field>
          <Field label="Reply-To (optional)">
            <input
              data-testid="field-reply-to"
              value={replyTo}
              onChange={(e) => setReplyTo(e.target.value)}
              placeholder="(defaults to From)"
              className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-primary"
            />
          </Field>
        </div>

        <Field label={`Body (Markdown · ${body.length} chars)`}>
          <textarea
            data-testid="field-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={18}
            spellCheck
            className="w-full rounded-lg border border-border bg-white px-3 py-2 text-xs font-mono text-text-primary"
          />
        </Field>

        <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
          <button
            data-testid="template-test-send"
            type="button"
            onClick={() => test.mutate(undefined)}
            disabled={test.isPending || dirty}
            title={dirty ? 'Save changes first' : 'Sends to your own admin email'}
            className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-text-primary hover:bg-surface disabled:opacity-50"
          >
            {test.isPending ? 'Sending test…' : '✉ Send test to me'}
          </button>
          {test.isSuccess && test.data && (
            <p data-testid="template-test-success" className="text-[10px] text-success">
              ✓ Sent to {test.data.recipient}
            </p>
          )}
          {test.isError && (
            <p data-testid="template-test-error" className="text-[10px] text-danger">
              {test.error.message}
            </p>
          )}
        </div>
      </section>

      <PreviewSection
        subject={detail.data.preview.subject}
        html={detail.data.preview.html}
      />

      <SendsHistorySection rows={detail.data.recent_sends} />
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-wide font-semibold text-text-secondary mb-1">
        {label}
      </label>
      {children}
    </div>
  )
}

function PreviewSection({ subject, html }: { subject: string; html: string }) {
  return (
    <section className="rounded-2xl border border-border bg-white p-5 space-y-3">
      <header>
        <h2 className="text-sm font-bold text-text-primary">Live preview</h2>
        <p className="text-xs text-text-secondary">
          Rendered with stub variables: <code>first_name = Sam</code>,{' '}
          <code>email = sam.example@ucdavis.edu</code>. Save to refresh.
        </p>
      </header>
      <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text-secondary">
        <span className="font-semibold text-text-primary">Subject:</span> {subject}
      </div>
      <iframe
        data-testid="email-preview-iframe"
        title="Rendered email preview"
        srcDoc={html}
        className="w-full min-h-[500px] rounded-lg border border-border bg-white"
        sandbox=""
      />
    </section>
  )
}

function SendsHistorySection({ rows }: { rows: EmailSendRow[] }) {
  if (rows.length === 0) {
    return (
      <section className="rounded-2xl border border-border bg-white p-5">
        <h2 className="text-sm font-bold text-text-primary mb-1">Recent sends</h2>
        <p className="text-xs text-text-secondary">No sends yet.</p>
      </section>
    )
  }
  return (
    <section className="rounded-2xl border border-border bg-white p-5 space-y-2">
      <h2 className="text-sm font-bold text-text-primary">Recent sends ({rows.length})</h2>
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li
            key={r.id}
            data-testid={`send-row-${r.id}`}
            className="py-2 flex items-center justify-between gap-3"
          >
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-text-primary truncate">
                {r.recipient_email}
                {r.is_test && (
                  <span className="ml-2 rounded-full bg-text-secondary/10 text-text-secondary px-1.5 py-0.5 text-[9px] font-semibold uppercase">
                    test
                  </span>
                )}
              </p>
              <p className="text-[10px] text-text-secondary">
                {new Date(r.created_at).toLocaleString()}
                {r.error && <span className="text-danger ml-2">{r.error}</span>}
              </p>
            </div>
            <div className="text-[10px] text-text-secondary shrink-0 text-right">
              <StatusPill status={r.status} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function StatusPill({ status }: { status: EmailSendRow['status'] }) {
  const tone = status === 'sent'
    ? 'bg-success/10 text-success'
    : status === 'failed'
      ? 'bg-danger/10 text-danger'
      : status === 'skipped'
        ? 'bg-text-secondary/10 text-text-secondary'
        : 'bg-warning/10 text-warning'
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${tone}`}>
      {status}
    </span>
  )
}
