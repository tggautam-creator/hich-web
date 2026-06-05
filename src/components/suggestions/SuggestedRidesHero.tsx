/**
 * v1.3 Sprint 14 Slice B — home-page suggestions hero.
 *
 * Stacks up to 3 SuggestedRideCard rows. Self-hides when empty so the
 * map-first home UX is preserved (matches iOS SuggestedRidesHero
 * Presentation.floating behaviour).
 *
 * `side` filters the server query so the rider home only shows
 * "Request this ride" cards and the driver home only shows "Offer
 * this ride" cards.
 *
 * CTA → routes to /rides/board/browse with `openRideId` state to
 * auto-open the existing RideBoardConfirmSheet (same pattern web
 * already uses for tap-through edits + offers). iOS opens a sheet
 * inline; web reuses the existing confirm sheet for now. A future
 * polish slice can inline it if the round-trip feels too heavy.
 *
 * Dismiss → useDismissSuggestion (optimistic remove).
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSuggestionsTop, useDismissSuggestion } from '@/hooks/useSuggestions'
import type { Suggestion, SuggestionSide } from '@/lib/suggestionsApi'
import SuggestedRideCard from './SuggestedRideCard'
import SuggestionDetailSheet from './SuggestionDetailSheet'

interface SuggestedRidesHeroProps {
  /** Which side the viewer is on — drives both the server filter
   *  and the card's CTA copy/tint. */
  side: SuggestionSide
  /** When true, the hero never renders (no suggestions OR fetch
   *  errored OR loading). Default true — matches iOS .floating. */
  hideWhenEmpty?: boolean
  'data-testid'?: string
}

export default function SuggestedRidesHero({
  side,
  hideWhenEmpty = true,
  'data-testid': testId = 'suggested-rides-hero',
}: SuggestedRidesHeroProps) {
  const navigate = useNavigate()
  const { data, isLoading } = useSuggestionsTop(side)
  const dismissMutation = useDismissSuggestion()
  // v1.3 Sprint 14 Slice C — tap card body → open detail sheet.
  const [detailSuggestion, setDetailSuggestion] = useState<Suggestion | null>(null)

  const suggestions = data ?? []

  if (hideWhenEmpty && (isLoading || suggestions.length === 0)) {
    return null
  }

  const handleAct = (s: Suggestion) => {
    // Open the schedule on the existing board detail surface. iOS
    // opens RideBoardConfirmSheet inline; web reuses the existing
    // openRideId pattern. The "other side" schedule id is the right
    // target — that's the schedule the viewer would Request / Offer
    // against.
    const otherSchedule = s.side === 'rider' ? s.driver_source?.schedule : s.rider_source?.schedule
    // Routine matches use `projected_schedule_id` (server fills it in
    // when a daily projection row exists for the suggestion's trip_date).
    const otherRoutineProjection = s.side === 'rider'
      ? s.driver_source?.routine?.projected_schedule_id
      : s.rider_source?.routine?.projected_schedule_id
    const targetScheduleId = otherSchedule?.id ?? otherRoutineProjection
    if (!targetScheduleId) return // server hasn't projected yet — degrade silently
    navigate('/rides/board/browse', { state: { openRideId: targetScheduleId } })
  }

  const handleDismiss = (s: Suggestion) => {
    dismissMutation.mutate(s.id)
  }

  return (
    <>
      <div data-testid={testId} className="w-full flex flex-col gap-2">
        {suggestions.map((s) => (
          <SuggestedRideCard
            key={s.id}
            suggestion={s}
            onAct={() => handleAct(s)}
            onDismiss={() => handleDismiss(s)}
            onTap={() => setDetailSuggestion(s)}
          />
        ))}
      </div>

      {detailSuggestion && (
        <SuggestionDetailSheet
          isOpen={detailSuggestion !== null}
          onClose={() => setDetailSuggestion(null)}
          suggestion={detailSuggestion}
          onAct={() => handleAct(detailSuggestion)}
        />
      )}
    </>
  )
}
