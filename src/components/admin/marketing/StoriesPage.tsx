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
 *   - Source-rides drawer (Phase 1.1 — see which ride board posts
 *     the LLM was working from)
 *
 * Phase 2 hardening parity: shares UI primitives with PostersPage
 * via _shared.tsx so button order/verbs, banner audience echo,
 * per-button loading, a11y, and clipboard error UX all stay in
 * lockstep across the two queues.
 */
import { useState, useId, useRef } from 'react'
import {
  useMarketingStoryBatches,
  useGenerateStoryBatch,
  useUpdateStoryItem,
  type AskingForFilter,
  type SourceRide,
  type StoryBatch,
  type StoryItem,
  type StoryItemStatus,
} from '@/hooks/useMarketingStories'
import {
  GenerateButton,
  StatusPill,
  CollapsibleBatchHeader,
  onEnterOrSpace,
  type AudienceVariant,
} from './_shared'

/** "rider" → "riders", "driver" → "drivers", "both" → "both audiences". */
function audienceLabel(a: AskingForFilter): string {
  return a === 'both' ? 'both audiences' : `${a}s`
}

export default function StoriesPage() {
  const query = useMarketingStoryBatches()
  const generate = useGenerateStoryBatch()
  const inFlight: AudienceVariant | null = generate.isPending
    ? ((generate.variables ?? 'both') as AudienceVariant)
    : null

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
        {/* Button order matches PostersPage: rider, driver, both. */}
        <div className="flex items-center gap-2">
          <GenerateButton
            testid="generate-stories-riders"
            label="Ask riders"
            tone="rider"
            variant="rider"
            inFlight={inFlight}
            disabled={generate.isPending}
            onClick={() => generate.mutate('rider')}
          />
          <GenerateButton
            testid="generate-stories-drivers"
            label="Ask drivers"
            tone="driver"
            variant="driver"
            inFlight={inFlight}
            disabled={generate.isPending}
            onClick={() => generate.mutate('driver')}
          />
          <GenerateButton
            testid="generate-stories-both"
            label="Generate (both)"
            tone="both"
            variant="both"
            inFlight={inFlight}
            disabled={generate.isPending}
            onClick={() => generate.mutate('both')}
          />
        </div>
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
              ? `Generated ${generate.data.item_count} stories for ${audienceLabel((generate.variables ?? 'both') as AskingForFilter)}.`
              : `Generated empty batch for ${audienceLabel((generate.variables ?? 'both') as AskingForFilter)} — ${generate.data.reason ?? 'no eligible corridors'}.`}
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
          <p className="font-semibold text-text-primary mb-1">No batches yet</p>
          <p>
            Click a "Generate" button to create the first batch from
            today's ride board, or wait for the daily 7 AM PT cron.
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
  batch, defaultExpanded,
}: { batch: StoryBatch; defaultExpanded: boolean }) {
  const [open, setOpen] = useState(defaultExpanded)
  const regionId = useId()
  return (
    <section
      data-testid={`story-batch-${batch.id}`}
      className="rounded-2xl border border-border bg-white overflow-hidden"
    >
      <CollapsibleBatchHeader
        open={open}
        onToggle={() => setOpen((v) => !v)}
        ariaLabel={`Batch for ${batch.for_date} (${batch.source}, ${batch.item_count} stor${batch.item_count === 1 ? 'y' : 'ies'})`}
        ariaControls={regionId}
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
            {batch.error && <span className="text-danger ml-2">{batch.error}</span>}
          </p>
        </div>
      </CollapsibleBatchHeader>
      <div id={regionId}>
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
      </div>
    </section>
  )
}

function StoryCard({ item }: { item: StoryItem }) {
  const update = useUpdateStoryItem()
  const [copyStatus, setCopyStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [showSources, setShowSources] = useState(false)
  const firstCopiedRef = useRef(false)

  const fullText = `${item.headline}\n\n${item.body}`

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(fullText)
      setCopyStatus('success')
      setTimeout(() => setCopyStatus('idle'), 1200)
      if (!firstCopiedRef.current && item.status === 'pending') {
        firstCopiedRef.current = true
        update.mutate({ itemId: item.id, status: 'copied' })
      }
    } catch (err) {
      console.warn('[marketing/stories] clipboard write failed:', err)
      setCopyStatus('error')
      setTimeout(() => setCopyStatus('idle'), 2400)
    }
  }

  function setStatus(next: StoryItemStatus) {
    // Toggle-back: clicking active pill reverts to pending.
    const target: StoryItemStatus = item.status === next ? 'pending' : next
    update.mutate({ itemId: item.id, status: target })
  }

  const copyLabel = copyStatus === 'success' ? 'Copied!'
    : copyStatus === 'error' ? 'Copy failed'
    : 'Copy story text'
  const copyCls = copyStatus === 'error'
    ? 'bg-danger text-white hover:bg-danger/90'
    : 'bg-primary text-white hover:bg-primary/90'
  const previewLabel = item.headline.slice(0, 40)

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

      <p className="text-sm text-text-primary whitespace-pre-wrap">{item.body}</p>

      <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
        <button
          data-testid={`story-copy-${item.id}`}
          type="button"
          onClick={handleCopy}
          aria-label={`Copy "${previewLabel}" story text`}
          className={`rounded-md px-3 py-1.5 text-xs font-semibold ${copyCls}`}
        >
          {copyLabel}
        </button>
        <div className="flex items-center gap-1">
          <StatusPill
            active={item.status === 'posted'}
            label="Posted"
            tone="success"
            ariaLabel={`Mark "${previewLabel}" as posted (toggle)`}
            onClick={() => setStatus('posted')}
          />
          <StatusPill
            active={item.status === 'skipped'}
            label="Skip"
            tone="muted"
            ariaLabel={`Mark "${previewLabel}" as skipped (toggle)`}
            onClick={() => setStatus('skipped')}
          />
        </div>
      </div>
      {/* aria-live announcement for clipboard copy outcome. */}
      <span className="sr-only" aria-live="polite">
        {copyStatus === 'success' ? 'Story text copied to clipboard.' : ''}
        {copyStatus === 'error' ? 'Story text copy failed.' : ''}
      </span>

      {item.source_rides && item.source_rides.length > 0 && (
        <SourceRidesDrawer
          open={showSources}
          onToggle={() => setShowSources((v) => !v)}
          rides={item.source_rides}
          total={item.matched_ride_count}
        />
      )}
    </article>
  )
}

function SourceRidesDrawer({
  open, onToggle, rides, total,
}: {
  open: boolean
  onToggle: () => void
  rides: SourceRide[]
  total: number
}) {
  return (
    <div className="border-t border-border pt-2">
      <button
        data-testid="source-rides-toggle"
        type="button"
        onClick={onToggle}
        onKeyDown={(e) => onEnterOrSpace(e, onToggle)}
        aria-expanded={open}
        className="flex items-center gap-1 text-[11px] font-semibold text-text-secondary hover:text-text-primary"
      >
        <span
          aria-hidden="true"
          className={`transition-transform ${open ? 'rotate-90' : ''}`}
        >
          ›
        </span>
        Source rides ({total}{rides.length < total ? `, showing ${rides.length}` : ''})
      </button>
      {open && (
        <ul className="mt-2 space-y-2">
          {rides.map((r) => (
            <li
              key={r.ride_id}
              className="rounded-md border border-border bg-white p-2 text-[11px]"
            >
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={[
                    'rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase',
                    r.mode === 'driver'
                      ? 'bg-primary/10 text-primary'
                      : 'bg-success/10 text-success',
                  ].join(' ')}
                >
                  {r.mode}
                </span>
                <span className="text-text-secondary">
                  {r.trip_date}
                  {r.trip_time && ` · ${r.trip_time.slice(0, 5)}`}
                </span>
              </div>
              <div className="text-text-primary">
                <span className="text-text-secondary">From:</span> {r.origin_address}
              </div>
              <div className="text-text-primary">
                <span className="text-text-secondary">To:</span> {r.dest_address}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
