/**
 * v1.3 Sprint 14 — Suggestions hooks.
 *
 * Three React Query wrappers around the `/api/suggestions/*`
 * endpoints. Mirrors iOS `SuggestedRidesHero` lifecycle (fetch on
 * appear + on scene-active + on `suggestionsRefreshRequested` push).
 *
 * Web refetch triggers (composed via React Query options):
 *   - Mount (queryKey activation)
 *   - Window focus (default RQ behaviour)
 *   - Manual `queryClient.invalidateQueries(['suggestions'])` —
 *     fired by the FCM push handler when a `suggested_match` lands
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  dismissSuggestion,
  fetchSuggestionsBoard,
  fetchSuggestionsTop,
  type Suggestion,
  type SuggestionSide,
} from '@/lib/suggestionsApi'

interface UseSuggestionsTopOptions {
  enabled?: boolean
}

/**
 * Top 3 suggestions for the home-page hero, filtered by viewer side.
 * `side='rider'` on rider home; `side='driver'` on driver home.
 * `side=undefined` returns both sides (legacy contract — rarely needed).
 */
export function useSuggestionsTop(
  side?: SuggestionSide,
  { enabled = true }: UseSuggestionsTopOptions = {},
) {
  return useQuery<Suggestion[]>({
    queryKey: ['suggestions', 'top', side ?? 'both'],
    queryFn: () => fetchSuggestionsTop(side),
    enabled,
    retry: false,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
  })
}

interface UseSuggestionsBoardOptions {
  enabled?: boolean
  limit?: number
}

/**
 * Paginated list for the Suggested tab on the ride board. Server
 * caps `limit` at 50. No cursor pagination yet (server uses
 * top-N sort).
 */
export function useSuggestionsBoard({
  enabled = true,
  limit = 20,
}: UseSuggestionsBoardOptions = {}) {
  return useQuery<Suggestion[]>({
    queryKey: ['suggestions', 'board', limit],
    queryFn: () => fetchSuggestionsBoard(limit),
    enabled,
    retry: false,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
  })
}

/**
 * Dismiss a suggestion for the viewer side. Optimistically removes
 * the row from every `['suggestions', ...]` query in cache so the
 * UI updates instantly + invalidates on settle so any other open
 * surface (other tab) catches up.
 */
export function useDismissSuggestion() {
  const queryClient = useQueryClient()
  return useMutation<void, Error, string>({
    mutationFn: dismissSuggestion,
    onMutate: async (suggestionId) => {
      await queryClient.cancelQueries({ queryKey: ['suggestions'] })
      // Snapshot every cached suggestions query so we can roll back
      // on error.
      const snapshots = queryClient
        .getQueriesData<Suggestion[]>({ queryKey: ['suggestions'] })
      for (const [key, list] of snapshots) {
        if (!list) continue
        queryClient.setQueryData<Suggestion[]>(
          key,
          list.filter((s) => s.id !== suggestionId),
        )
      }
      return { snapshots }
    },
    onError: (_err, _id, context) => {
      const ctx = context as { snapshots?: Array<[unknown, Suggestion[] | undefined]> } | undefined
      if (!ctx?.snapshots) return
      for (const [key, list] of ctx.snapshots) {
        queryClient.setQueryData(key as readonly unknown[], list)
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['suggestions'] })
    },
  })
}
