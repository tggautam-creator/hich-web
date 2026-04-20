import { useEffect, useState } from 'react'
import BottomSheet from '@/components/ui/BottomSheet'
import { countActiveFilters, DEFAULT_FILTERS, type RideBoardFilters } from './boardFilters'

interface RideBoardFilterSheetProps {
  isOpen: boolean
  filters: RideBoardFilters
  hasUserLocation: boolean
  showSeatsFilter: boolean
  onApply: (f: RideBoardFilters) => void
  onClose: () => void
}

export default function RideBoardFilterSheet({
  isOpen,
  filters,
  hasUserLocation,
  showSeatsFilter,
  onApply,
  onClose,
}: RideBoardFilterSheetProps) {
  const [draft, setDraft] = useState<RideBoardFilters>(filters)

  // Reset draft each time the sheet opens so unsaved changes are discarded on cancel
  useEffect(() => {
    if (isOpen) setDraft(filters)
  }, [isOpen, filters])

  const radioClass = (active: boolean) => [
    'flex items-center justify-between rounded-xl border px-3 py-2.5 text-sm font-medium active:bg-surface',
    active ? 'border-primary bg-primary/5 text-primary' : 'border-border bg-white text-text-primary',
  ].join(' ')

  const handleApply = () => {
    onApply(draft)
    onClose()
  }

  const handleClear = () => setDraft(DEFAULT_FILTERS)

  const activeCount = countActiveFilters(draft)

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title="Filters & Sort"
      data-testid="filter-sheet"
    >
      <div className="space-y-5">
        {/* ── Date ────────────────────────────────────────────────── */}
        <div>
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">Date</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              data-testid="filter-date-all"
              onClick={() => setDraft({ ...draft, time: 'all', customDate: undefined })}
              className={radioClass(draft.time === 'all')}
            >All dates</button>
            <button
              type="button"
              data-testid="filter-date-today"
              onClick={() => setDraft({ ...draft, time: 'today', customDate: undefined })}
              className={radioClass(draft.time === 'today')}
            >Today</button>
            <button
              type="button"
              data-testid="filter-date-week"
              onClick={() => setDraft({ ...draft, time: 'week', customDate: undefined })}
              className={radioClass(draft.time === 'week')}
            >Next 7 days</button>
            <button
              type="button"
              data-testid="filter-date-custom"
              onClick={() => setDraft({ ...draft, time: 'custom' })}
              className={radioClass(draft.time === 'custom')}
            >Pick date</button>
          </div>
          {draft.time === 'custom' && (
            <input
              type="date"
              data-testid="filter-date-picker"
              value={draft.customDate ?? ''}
              onChange={(e) => setDraft({ ...draft, customDate: e.target.value })}
              className="mt-2 w-full rounded-xl border border-border px-3 py-2.5 text-sm text-text-primary focus:border-primary focus:outline-none"
            />
          )}
        </div>

        {/* ── Seats (only for driver posts) ───────────────────────── */}
        {showSeatsFilter && (
          <div>
            <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">Seats</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                data-testid="filter-seats-any"
                onClick={() => setDraft({ ...draft, seats: 'any' })}
                className={radioClass(draft.seats === 'any')}
              >Any seats</button>
              <button
                type="button"
                data-testid="filter-seats-2plus"
                onClick={() => setDraft({ ...draft, seats: '2plus' })}
                className={radioClass(draft.seats === '2plus')}
              >2+ seats</button>
            </div>
          </div>
        )}

        {/* ── Near me toggle ──────────────────────────────────────── */}
        <div>
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">Proximity</p>
          <button
            type="button"
            data-testid="filter-near-me"
            disabled={!hasUserLocation}
            onClick={() => setDraft({ ...draft, nearMeOnly: !draft.nearMeOnly })}
            className={[
              'flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-sm active:bg-surface disabled:opacity-50',
              draft.nearMeOnly ? 'border-primary bg-primary/5 text-primary' : 'border-border bg-white text-text-primary',
            ].join(' ')}
          >
            <span className="font-medium">Near me only</span>
            <span className="text-xs text-text-secondary">
              {hasUserLocation ? 'within ~5-min walk of route' : 'needs location'}
            </span>
          </button>
        </div>

        {/* ── Sort ────────────────────────────────────────────────── */}
        <div>
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">Sort</p>
          <div className="space-y-2">
            <button
              type="button"
              data-testid="filter-sort-recent"
              onClick={() => setDraft({ ...draft, sort: 'recent' })}
              className={radioClass(draft.sort === 'recent')}
            >Recently posted</button>
            <button
              type="button"
              data-testid="filter-sort-nearest"
              disabled={!hasUserLocation}
              onClick={() => setDraft({ ...draft, sort: 'nearest' })}
              className={[
                ...radioClass(draft.sort === 'nearest').split(' '),
                !hasUserLocation ? 'opacity-50' : '',
              ].join(' ')}
            >Closest to me{!hasUserLocation ? ' (needs location)' : ''}</button>
          </div>
        </div>

        {/* ── Actions ─────────────────────────────────────────────── */}
        <div className="flex gap-2 pt-2">
          <button
            type="button"
            data-testid="filter-clear"
            onClick={handleClear}
            className="flex-1 rounded-2xl border border-border py-3 text-sm font-semibold text-text-secondary active:bg-surface"
          >
            Clear
          </button>
          <button
            type="button"
            data-testid="filter-apply"
            onClick={handleApply}
            className="flex-1 rounded-2xl bg-primary py-3 text-sm font-semibold text-white active:opacity-90"
          >
            Apply{activeCount > 0 ? ` (${activeCount})` : ''}
          </button>
        </div>
      </div>
    </BottomSheet>
  )
}
