/**
 * /admin/marketing/posters — Phase 3.
 *
 * Format-picker + audience-picker + founder steering + per-card
 * image preview + on-demand "Generate image" button calling
 * gemini-2.5-flash-image. Each card surfaces the full Gemini/
 * ChatGPT image-gen prompt so the founder can copy-paste it
 * anywhere instead of using our API call.
 *
 * Phase 3 hardening applied:
 *  - Regenerate-image asks for confirmation (it costs ~$0.04/call)
 *  - <img onError> swaps to the empty-state branch if Storage 404s
 *  - Cron-batch banner only shows when relevant
 *  - Drops the hardcoded $0.04 price string (we don't want to
 *    drift when Google changes pricing)
 */
import { useState, useId } from 'react'
import {
  useMarketingPosterBatches,
  useGeneratePosterBatch,
  useUpdatePosterItem,
  useGeneratePosterImage,
  type GeneratePosterArgs,
  type PosterAudience,
  type PosterBatch,
  type PosterFormat,
  type PosterItem,
  type PosterItemStatus,
} from '@/hooks/useMarketingPosters'
import { StatusPill, CollapsibleBatchHeader, CopyableField } from './_shared'

const FORMAT_OPTIONS: ReadonlyArray<{ key: PosterFormat; label: string; dims: string }> = [
  { key: 'ig_story', label: 'Instagram Story', dims: '9:16 · 1080×1920' },
  { key: 'ig_post',  label: 'Instagram Post',  dims: '1:1 · 1080×1080' },
  { key: 'a4_sheet', label: 'A4 Sheet',        dims: '8.5×11 · printable' },
  { key: 'custom',   label: 'Custom',          dims: 'specify in note' },
]

const AUDIENCE_OPTIONS: ReadonlyArray<{ key: PosterAudience; label: string }> = [
  { key: 'rider',  label: 'For riders' },
  { key: 'driver', label: 'For drivers' },
  { key: 'both',   label: 'For both' },
]

export default function PostersPage() {
  const query = useMarketingPosterBatches()
  const generate = useGeneratePosterBatch()

  return (
    <div data-testid="admin-marketing-posters" className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-text-primary">Poster ideas</h1>
        <p className="text-sm text-text-secondary">
          Generate Instagram posters with brand-styled visuals + ready-to-paste
          captions. Each card includes an image-gen prompt you can copy to
          Gemini/ChatGPT or send to the API directly.
        </p>
      </header>

      <GeneratorForm onGenerate={(args) => generate.mutate(args)} isPending={generate.isPending} />

      {generate.isError && (
        <div className="rounded-lg border border-danger/30 bg-danger/5 px-4 py-2 text-sm text-danger">
          {generate.error.message}
        </div>
      )}
      {generate.isSuccess && generate.data && generate.data.item_count > 0 && (
        <div className="rounded-lg border border-success/30 bg-success/5 px-4 py-2 text-sm text-text-primary">
          Generated 1 poster.
        </div>
      )}

      {query.isLoading && <p className="text-sm text-text-secondary">Loading queue…</p>}
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
          <p>Fill the form above and click Generate, or wait for the daily 7 AM PT cron.</p>
        </div>
      )}

      {query.data?.batches.map((batch, idx) => (
        <BatchCard key={batch.id} batch={batch} defaultExpanded={idx === 0} />
      ))}
    </div>
  )
}

function GeneratorForm({
  onGenerate, isPending,
}: { onGenerate: (args: GeneratePosterArgs) => void; isPending: boolean }) {
  const [format, setFormat] = useState<PosterFormat>('ig_story')
  const [audience, setAudience] = useState<PosterAudience>('both')
  const [founderNote, setFounderNote] = useState('')
  const [eventTag, setEventTag] = useState('')
  const [featureSpotlight, setFeatureSpotlight] = useState('')

  function handleSubmit() {
    onGenerate({
      format,
      audience,
      founder_note: founderNote.trim() || undefined,
      event_tag: eventTag.trim() || undefined,
      feature_spotlight: featureSpotlight.trim() || undefined,
    })
  }

  return (
    <section
      data-testid="poster-generator-form"
      className="rounded-2xl border border-border bg-white p-5 space-y-4"
    >
      <h2 className="text-sm font-bold text-text-primary">Generate a new poster</h2>

      <RadioRow
        legend="Format"
        name="format"
        value={format}
        onChange={(v) => setFormat(v as PosterFormat)}
        options={FORMAT_OPTIONS.map((o) => ({ value: o.key, label: o.label, subtitle: o.dims }))}
      />
      <RadioRow
        legend="Audience"
        name="audience"
        value={audience}
        onChange={(v) => setAudience(v as PosterAudience)}
        options={AUDIENCE_OPTIONS.map((o) => ({ value: o.key, label: o.label }))}
      />

      <div>
        <label htmlFor="founder-note" className="block text-xs font-semibold uppercase tracking-wide text-text-secondary mb-1">
          Anything to emphasize? <span className="font-normal normal-case text-text-secondary">(optional)</span>
        </label>
        <textarea
          id="founder-note"
          data-testid="founder-note"
          value={founderNote}
          onChange={(e) => setFounderNote(e.target.value.slice(0, 500))}
          placeholder="e.g. Picnic Day weekend, finals week, move-in..."
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50"
          rows={2}
        />
        <p className="mt-1 text-[10px] text-text-secondary text-right">{founderNote.length}/500</p>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div>
          <label htmlFor="event-tag" className="block text-xs font-semibold uppercase tracking-wide text-text-secondary mb-1">
            Event / occasion <span className="font-normal normal-case text-text-secondary">(optional)</span>
          </label>
          <input
            id="event-tag"
            data-testid="event-tag"
            type="text"
            value={eventTag}
            onChange={(e) => setEventTag(e.target.value.slice(0, 500))}
            placeholder="e.g. Spring break"
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50"
          />
        </div>
        <div>
          <label htmlFor="feature-spotlight" className="block text-xs font-semibold uppercase tracking-wide text-text-secondary mb-1">
            Feature to spotlight <span className="font-normal normal-case text-text-secondary">(optional)</span>
          </label>
          <input
            id="feature-spotlight"
            data-testid="feature-spotlight"
            type="text"
            value={featureSpotlight}
            onChange={(e) => setFeatureSpotlight(e.target.value.slice(0, 500))}
            placeholder="e.g. QR-scan ride start"
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50"
          />
        </div>
      </div>

      <div className="flex justify-end">
        <button
          data-testid="generate-poster"
          type="button"
          onClick={handleSubmit}
          disabled={isPending}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
        >
          {isPending ? 'Generating…' : 'Generate poster'}
        </button>
      </div>
    </section>
  )
}

interface RadioOption { value: string; label: string; subtitle?: string }

function RadioRow({
  legend, name, value, onChange, options,
}: {
  legend: string; name: string; value: string
  onChange: (next: string) => void; options: ReadonlyArray<RadioOption>
}) {
  return (
    <fieldset>
      <legend className="text-xs font-semibold uppercase tracking-wide text-text-secondary mb-1">
        {legend}
      </legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const active = value === o.value
          return (
            <label
              key={o.value}
              className={[
                'cursor-pointer rounded-lg border px-3 py-2 text-xs font-medium focus-within:ring-2 focus-within:ring-primary/40',
                active
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-white text-text-secondary hover:bg-surface',
              ].join(' ')}
            >
              <input
                type="radio"
                name={name}
                value={o.value}
                checked={active}
                onChange={() => onChange(o.value)}
                className="sr-only"
              />
              <span className="block">{o.label}</span>
              {o.subtitle && (
                <span className="block text-[10px] text-text-secondary mt-0.5">{o.subtitle}</span>
              )}
            </label>
          )
        })}
      </div>
    </fieldset>
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
              <span className="ml-2">· Theme: <span className="text-text-primary">{batch.theme_snapshot}</span></span>
            )}
            {batch.weekly_focus_snapshot && (
              <span className="ml-2">· Focus: <span className="text-text-primary">{batch.weekly_focus_snapshot}</span></span>
            )}
            {batch.error && <span className="text-danger ml-2">{batch.error}</span>}
          </p>
        </div>
      </CollapsibleBatchHeader>
      <div id={regionId}>
        {open && batch.items.length === 0 && (
          <div className="px-5 py-4 text-sm text-text-secondary border-t border-border">
            No items. {batch.error ?? 'Generator returned nothing.'}
          </div>
        )}
        {open && batch.items.length > 0 && (
          <div className="px-5 py-4 border-t border-border space-y-4">
            {batch.items.map((item) => <PosterCard key={item.id} item={item} />)}
          </div>
        )}
      </div>
    </section>
  )
}

function PosterCard({ item }: { item: PosterItem }) {
  const update = useUpdatePosterItem()
  const imageGen = useGeneratePosterImage()
  const [showPrompt, setShowPrompt] = useState(false)
  const [imgErrored, setImgErrored] = useState(false)

  function setStatus(next: PosterItemStatus) {
    const target: PosterItemStatus = item.status === next ? 'pending' : next
    update.mutate({ itemId: item.id, status: target })
  }

  function handleGenerateImage() {
    imageGen.mutate(item.id)
  }
  function handleRegenerate() {
    // Confirm because each regen call costs ~$0.04 on Gemini paid tier.
    const ok = window.confirm(
      'Regenerate this image? Each generation hits Gemini\'s paid API. Continue?'
    )
    if (!ok) return
    imageGen.mutate(item.id)
  }

  const previewLabel = item.headline.slice(0, 40)
  const isStory = item.format === 'ig_story'
  const isGeneratingImage = imageGen.isPending && imageGen.variables === item.id
  const hasUsableImage = Boolean(item.image_url) && !imgErrored

  return (
    <article
      data-testid={`poster-item-${item.id}`}
      className="rounded-xl border border-border bg-surface p-4 space-y-4"
    >
      <header className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <AudienceBadge audience={item.audience} />
          <FormatBadge format={item.format} />
          {item.theme_angle && (
            <span className="rounded-full bg-text-secondary/10 text-text-secondary px-2 py-0.5 text-[10px] font-semibold uppercase">
              {item.theme_angle}
            </span>
          )}
        </div>
        {item.canva_template && (
          <span className="text-[10px] uppercase tracking-wide text-text-secondary">
            Canva: <span className="text-text-primary">{item.canva_template}</span>
          </span>
        )}
      </header>

      {(item.founder_note || item.event_tag || item.feature_spotlight) && (
        <div className="rounded-md border border-border bg-white px-3 py-2 text-[11px] text-text-secondary">
          <span className="font-semibold text-text-primary">Founder context:</span>{' '}
          {[
            item.founder_note,
            item.event_tag && `Event: ${item.event_tag}`,
            item.feature_spotlight && `Feature: ${item.feature_spotlight}`,
          ].filter(Boolean).join(' · ')}
        </div>
      )}

      <div className="rounded-lg border border-border bg-white p-3">
        {hasUsableImage ? (
          <div className="space-y-2">
            <img
              src={item.image_url ?? ''}
              alt={`Generated poster for ${previewLabel}`}
              className="block max-w-full max-h-[60vh] mx-auto rounded"
              loading="lazy"
              onError={() => setImgErrored(true)}
            />
            <div className="flex items-center justify-between text-[10px] text-text-secondary flex-wrap gap-2">
              <span>
                Generated{' '}
                {item.image_generated_at &&
                  new Date(item.image_generated_at).toLocaleString()}
                {item.image_model && ` · ${item.image_model}`}
              </span>
              <div className="flex gap-2">
                <a
                  href={item.image_url ?? '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-md border border-border bg-white px-2 py-1 text-[10px] font-semibold text-text-secondary hover:bg-surface"
                >
                  Open in new tab
                </a>
                <button
                  data-testid={`regenerate-image-${item.id}`}
                  type="button"
                  onClick={handleRegenerate}
                  disabled={isGeneratingImage}
                  className="rounded-md border border-primary/40 bg-primary/5 px-2 py-1 text-[10px] font-semibold text-primary hover:bg-primary/10 disabled:opacity-50"
                >
                  {isGeneratingImage ? 'Regenerating…' : 'Regenerate'}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 py-6">
            <p className="text-xs text-text-secondary text-center">
              {imgErrored
                ? "Previous image couldn't load (deleted or moved). Generate a new one below."
                : 'No image generated yet. Copy the prompt to Gemini/ChatGPT or click below to generate it via the API.'}
            </p>
            <button
              data-testid={`generate-image-${item.id}`}
              type="button"
              onClick={handleGenerateImage}
              disabled={isGeneratingImage}
              className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
            >
              {isGeneratingImage ? 'Generating image…' : 'Generate image with Gemini'}
            </button>
          </div>
        )}
        {imageGen.isError && imageGen.variables === item.id && (
          <p className="mt-2 text-[11px] text-danger break-words">
            Image gen failed: {imageGen.error.message}
          </p>
        )}
      </div>

      <CopyableField label="Headline" value={item.headline} testid={`poster-headline-${item.id}`} />
      {item.subheadline && (
        <CopyableField label="Subheadline" value={item.subheadline} testid={`poster-subheadline-${item.id}`} />
      )}
      <CopyableField label="Body" value={item.body} testid={`poster-body-${item.id}`} multiline />
      {item.hashtags && (
        <CopyableField label="Hashtags" value={item.hashtags} testid={`poster-hashtags-${item.id}`} />
      )}
      {item.caption && !isStory && (
        <CopyableField label="Caption (paste below the IG post)" value={item.caption} testid={`poster-caption-${item.id}`} multiline />
      )}

      {item.image_prompt && (
        <div className="border-t border-border pt-2">
          <button
            type="button"
            onClick={() => setShowPrompt((v) => !v)}
            aria-expanded={showPrompt}
            className="flex items-center gap-1 text-[11px] font-semibold text-text-secondary hover:text-text-primary"
          >
            <span aria-hidden="true" className={`transition-transform ${showPrompt ? 'rotate-90' : ''}`}>›</span>
            Image prompt ({item.image_prompt.length} chars)
          </button>
          {showPrompt && (
            <div className="mt-2">
              <CopyableField
                label="Image prompt (paste into Gemini/ChatGPT/Midjourney)"
                value={item.image_prompt}
                testid={`poster-image-prompt-${item.id}`}
                multiline
              />
            </div>
          )}
        </div>
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
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${tone}`}>{label}</span>
}

function FormatBadge({ format }: { format: PosterFormat }) {
  const label = format === 'ig_story' ? 'IG STORY'
    : format === 'ig_post' ? 'IG POST'
    : format === 'a4_sheet' ? 'A4'
    : 'CUSTOM'
  return (
    <span className="rounded-full bg-warning/10 text-warning px-2 py-0.5 text-[10px] font-semibold">
      {label}
    </span>
  )
}
