/**
 * /admin/marketing/posters — Phase 2.
 *
 * Daily themed feed-post copy generated from the current monthly
 * theme + this week's feature focus (marketing_themes row).
 *
 * Phase 2 review hardening:
 *  - Banner echoes the audience that was generated (no more
 *    indistinguishable "Generated 1 poster." messages).
 *  - Per-button "Generating…" state via React Query mutation.variables.
 *  - Button order (rider → driver → both) and verbs match StoriesPage.
 *  - Keyboard-accessible batch headers (real <button>).
 *  - Clipboard error UI + aria-live announcements.
 *  - Status pills are aria-pressed toggles with contextual labels.
 */
import { useState, useId } from 'react'
import {
  useMarketingPosterBatches,
  useGeneratePosterBatch,
  useUpdatePosterItem,
  type PosterAudience,
  type PosterBatch,
  type PosterItem,
  type PosterItemStatus,
} from '@/hooks/useMarketingPosters'
import {
  GenerateButton,
  StatusPill,
  CollapsibleBatchHeader,
  CopyableField,
  type AudienceVariant,
} from './_shared'

function audienceLabel(a: PosterAudience): string {
  return a === 'both' ? 'both audiences' : `${a}s`
}

export default function PostersPage() {
  const query = useMarketingPosterBatches()
  const generate = useGeneratePosterBatch()
  const inFlight: AudienceVariant | null = generate.isPending
    ? ((generate.variables ?? 'both') as AudienceVariant)
    : null

  return (
    <div data-testid="admin-marketing-posters" className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Poster ideas</h1>
          <p className="text-sm text-text-secondary">
            1 themed feed-post copy per day, grounded in this month's
            theme + this week's feature focus. Paste into your Canva
            template.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <GenerateButton
            testid="generate-posters-riders"
            label="For riders"
            tone="rider"
            variant="rider"
            inFlight={inFlight}
            disabled={generate.isPending}
            onClick={() => generate.mutate('rider')}
          />
          <GenerateButton
            testid="generate-posters-drivers"
            label="For drivers"
            tone="driver"
            variant="driver"
            inFlight={inFlight}
            disabled={generate.isPending}
            onClick={() => generate.mutate('driver')}
          />
          <GenerateButton
            testid="generate-posters-both"
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
            ? `Today's cron batch already exists (${generate.data.item_count}).`
            : generate.data.item_count > 0
              ? `Generated 1 poster for ${audienceLabel((generate.variables ?? 'both') as PosterAudience)}.`
              : `Generated empty batch for ${audienceLabel((generate.variables ?? 'both') as PosterAudience)} — ${generate.data.reason ?? 'no item produced'}.`}
        </div>
      )}

      {query.isLoading && (
        <p className="text-sm text-text-secondary">Loading queue…</p>
      )}
      {query.error && (
        <div className="rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
          Couldn't load poster batches. {query.error.message}
        </div>
      )}
      {query.data && query.data.batches.length === 0 && (
        <div
          data-testid="posters-empty"
          className="rounded-2xl border border-border bg-white p-8 text-center text-sm text-text-secondary"
        >
          <p className="font-semibold text-text-primary mb-1">No batches yet</p>
          <p>
            Click a "Generate" button to create the first poster from
            this month's theme, or wait for the daily 7 AM PT cron.
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
}: { batch: PosterBatch; defaultExpanded: boolean }) {
  const [open, setOpen] = useState(defaultExpanded)
  const regionId = useId()
  return (
    <section
      data-testid={`poster-batch-${batch.id}`}
      className="rounded-2xl border border-border bg-white overflow-hidden"
    >
      <CollapsibleBatchHeader
        open={open}
        onToggle={() => setOpen((v) => !v)}
        ariaLabel={`Batch for ${batch.for_date} (${batch.source}, ${batch.item_count} poster${batch.item_count === 1 ? '' : 's'})`}
        ariaControls={regionId}
      >
        <div>
          <p className="text-sm font-bold text-text-primary">
            {batch.for_date}
            <span className="text-[10px] uppercase tracking-wide text-text-secondary ml-2">
              {batch.source}
            </span>
          </p>
          <p className="text-xs text-text-secondary">
            {batch.item_count} poster{batch.item_count === 1 ? '' : 's'} · {batch.llm_model}
            {batch.theme_snapshot && (
              <span className="ml-2">
                · Theme: <span className="text-text-primary">{batch.theme_snapshot}</span>
              </span>
            )}
            {batch.weekly_focus_snapshot && (
              <span className="ml-2">
                · Focus: <span className="text-text-primary">{batch.weekly_focus_snapshot}</span>
              </span>
            )}
            {batch.error && <span className="text-danger ml-2">{batch.error}</span>}
          </p>
        </div>
      </CollapsibleBatchHeader>
      <div id={regionId}>
        {open && batch.items.length === 0 && (
          <div className="px-5 py-4 text-sm text-text-secondary border-t border-border">
            No items in this batch. {batch.error ?? 'Generator returned nothing.'}
          </div>
        )}
        {open && batch.items.length > 0 && (
          <div className="px-5 py-4 border-t border-border space-y-4">
            {batch.items.map((item) => (
              <PosterCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function PosterCard({ item }: { item: PosterItem }) {
  const update = useUpdatePosterItem()

  function setStatus(next: PosterItemStatus) {
    // Toggle-back UX: clicking an active pill reverts to 'pending'
    // (gives the admin a way to undo without leaving the keyboard).
    const target: PosterItemStatus = item.status === next ? 'pending' : next
    update.mutate({ itemId: item.id, status: target })
  }

  const previewLabel = item.headline.slice(0, 40)

  return (
    <article
      data-testid={`poster-item-${item.id}`}
      className="rounded-xl border border-border bg-surface p-4 space-y-4"
    >
      <header className="flex items-center justify-between gap-2">
        <AudienceBadge audience={item.audience} />
        {item.canva_template && (
          <span className="text-[10px] uppercase tracking-wide text-text-secondary">
            Canva: <span className="text-text-primary">{item.canva_template}</span>
          </span>
        )}
      </header>

      <CopyableField label="Headline" value={item.headline} testid={`poster-headline-${item.id}`} />
      {item.subheadline && (
        <CopyableField label="Subheadline" value={item.subheadline} testid={`poster-subheadline-${item.id}`} />
      )}
      <CopyableField label="Body" value={item.body} testid={`poster-body-${item.id}`} multiline />
      {item.hashtags && (
        <CopyableField label="Hashtags" value={item.hashtags} testid={`poster-hashtags-${item.id}`} />
      )}

      <div className="flex items-center justify-end gap-1 pt-2 border-t border-border">
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
    </article>
  )
}

function AudienceBadge({ audience }: { audience: PosterAudience }) {
  const tone = audience === 'rider'
    ? 'bg-success/10 text-success'
    : audience === 'driver'
      ? 'bg-primary/10 text-primary'
      : 'bg-text-secondary/10 text-text-secondary'
  const label = audience === 'both' ? 'BOTH SIDES' : audience.toUpperCase() + 'S'
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${tone}`}>
      {label}
    </span>
  )
}
