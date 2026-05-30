/**
 * /admin/marketing/stories — Phase 1.
 *
 * Daily queue of Instagram-story copies generated from the ride
 * board. Each card surfaces:
 *   - corridor + asking_for badge ("Asking drivers" vs "Asking riders")
 *   - date label + matched-ride count
 *   - headline + body (the actual copy to paste into IG)
 *   - Copy button (writes to clipboard, flips status → 'copied')
 *   - Status pills (Posted / Skipped) so you can track what you used
 *
 * Batches list most-recent-first, expanded by default for today's
 * batch and collapsed for older ones.
 */
import { useState } from 'react'
import {
  useMarketingStoryBatches,
  useGenerateStoryBatch,
  useUpdateStoryItem,
  type StoryBatch,
  type StoryItem,
  type StoryItemStatus,
} from '@/hooks/useMarketingStories'

export default function StoriesPage() {
  const query = useMarketingStoryBatches()
  const generate = useGenerateStoryBatch()

  return (
    <div data-testid="admin-marketing-stories" className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">
            Daily story queue
          </h1>
          <p className="text-sm text-text-secondary">
            6 Instagram-story copies per day, generated from the ride
            board. Copy → paste → post.
          </p>
        </div>
        <button
          data-testid="generate-stories-now"
          type="button"
          onClick={() => generate.mutate()}
          disabled={generate.isPending}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
        >
          {generate.isPending ? 'Generating…' : 'Generate now'}
        </button>
      </header>

      {generate.isError && (
        <div className="rounded-lg border border-danger/30 bg-danger/5 px-4 py-2 text-sm text-danger">
          {generate.error.message}
        </div>
      )}
      {generate.isSuccess && generate.data && (
        <div className="rounded-lg border border-success/30 bg-success/5 px-4 py-2 text-sm text-text-primary">
          {generate.data.skipped_existing
            ? `Today's batch already exists (${generate.data.item_count} stories).`
            : generate.data.item_count > 0
              ? `Generated ${generate.data.item_count} stories.`
              : `Generated empty batch — ${generate.data.reason ?? 'no eligible corridors'}.`}
        </div>
      )}

      {query.isLoading && (
        <p className="text-sm text-text-secondary">Loading queue…</p>
      )}
      {query.error && (
        <div className="rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
          Couldn't load story batches. {query.error.message}
        </div>
      )}
      {query.data && query.data.batches.length === 0 && (
        <div
          data-testid="stories-empty"
          className="rounded-2xl border border-border bg-white p-8 text-center text-sm text-text-secondary"
        >
          <p className="font-semibold text-text-primary mb-1">
            No batches yet
          </p>
          <p>
            Click "Generate now" to create the first batch from today's
            ride board, or wait for the daily 7 AM PT cron.
          </p>
        </div>
      )}

      {query.data?.batches.map((batch, idx) => (
        <BatchCard key={batch.id} batch={batch} defaultExpanded={idx === 0} />
      ))}
    </div>
  )
}

function BatchCard({
  batch,
  defaultExpanded,
}: { batch: StoryBatch; defaultExpanded: boolean }) {
  const [open, setOpen] = useState(defaultExpanded)
  return (
    <section
      data-testid={`story-batch-${batch.id}`}
      className="rounded-2xl border border-border bg-white overflow-hidden"
    >
      <header
        className="flex items-center justify-between gap-3 px-5 py-3 cursor-pointer hover:bg-surface"
        onClick={() => setOpen((v) => !v)}
      >
        <div>
          <p className="text-sm font-bold text-text-primary">
            {batch.for_date}{' '}
            <span className="text-[10px] uppercase tracking-wide text-text-secondary ml-2">
              {batch.source}
            </span>
          </p>
          <p className="text-xs text-text-secondary">
            {batch.item_count} stories · {batch.llm_model}
            {batch.error && (
              <span className="text-danger ml-2">{batch.error}</span>
            )}
          </p>
        </div>
        <span
          aria-hidden="true"
          className={[
            'text-text-secondary transition-transform',
            open ? 'rotate-90' : '',
          ].join(' ')}
        >
          ›
        </span>
      </header>
      {open && batch.items.length === 0 && (
        <div className="px-5 py-4 text-sm text-text-secondary border-t border-border">
          No items in this batch. {batch.error ?? 'Ride board may have been quiet.'}
        </div>
      )}
      {open && batch.items.length > 0 && (
        <div className="px-5 py-4 border-t border-border grid grid-cols-1 gap-4 lg:grid-cols-2">
          {batch.items.map((item) => (
            <StoryCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </section>
  )
}

function StoryCard({ item }: { item: StoryItem }) {
  const update = useUpdateStoryItem()
  const [copied, setCopied] = useState(false)

  const fullText = `${item.headline}\n\n${item.body}`

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(fullText)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
      if (item.status === 'pending') {
        update.mutate({ itemId: item.id, status: 'copied' })
      }
    } catch (err) {
      console.warn('clipboard write failed:', err)
    }
  }

  function setStatus(status: StoryItemStatus) {
    update.mutate({ itemId: item.id, status })
  }

  return (
    <article
      data-testid={`story-item-${item.id}`}
      className="rounded-xl border border-border bg-surface p-4 space-y-3"
    >
      <header className="flex items-center justify-between gap-2">
        <span
          className={[
            'rounded-full px-2 py-0.5 text-[10px] font-semibold',
            item.asking_for === 'driver'
              ? 'bg-primary/10 text-primary'
              : 'bg-success/10 text-success',
          ].join(' ')}
        >
          Asking {item.asking_for === 'driver' ? 'DRIVERS' : 'RIDERS'}
        </span>
        <span className="text-[10px] uppercase tracking-wide text-text-secondary">
          {item.matched_ride_count} ride{item.matched_ride_count === 1 ? '' : 's'}
          {item.date_label && ` · ${item.date_label}`}
        </span>
      </header>

      <div>
        <p className="text-sm font-bold text-text-primary leading-tight">
          {item.headline}
        </p>
        <p className="text-xs text-text-secondary mt-0.5">{item.corridor}</p>
      </div>

      <p className="text-sm text-text-primary whitespace-pre-wrap">
        {item.body}
      </p>

      <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
        <button
          data-testid={`story-copy-${item.id}`}
          type="button"
          onClick={handleCopy}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary/90"
        >
          {copied ? 'Copied!' : 'Copy story text'}
        </button>
        <div className="flex items-center gap-1">
          <StatusPill
            active={item.status === 'posted'}
            label="Posted"
            tone="success"
            onClick={() => setStatus('posted')}
          />
          <StatusPill
            active={item.status === 'skipped'}
            label="Skip"
            tone="muted"
            onClick={() => setStatus('skipped')}
          />
        </div>
      </div>
    </article>
  )
}

function StatusPill({
  active,
  label,
  tone,
  onClick,
}: {
  active: boolean
  label: string
  tone: 'success' | 'muted'
  onClick: () => void
}) {
  const base = 'rounded-md px-2 py-1 text-[11px] font-semibold border transition-colors'
  const toneActive = tone === 'success'
    ? 'bg-success/10 text-success border-success/30'
    : 'bg-text-secondary/10 text-text-secondary border-text-secondary/30'
  const toneInactive = 'bg-white text-text-secondary border-border hover:bg-surface'
  return (
    <button
      type="button"
      onClick={onClick}
      className={[base, active ? toneActive : toneInactive].join(' ')}
    >
      {label}
    </button>
  )
}
