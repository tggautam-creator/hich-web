/**
 * Per-ride story-idea hooks for the "Browse rides for story ideas"
 * section on /admin/marketing/stories. Fetches upcoming
 * ride_schedules and lets the founder generate 3 story angles per
 * specific ride.
 */
import { useMutation, useQuery } from '@tanstack/react-query'
import { adminGet, adminPost } from '@/lib/admin/api'
import { useQueryClient } from '@tanstack/react-query'

export type RideAudience = 'rider' | 'driver' | 'both'

export interface RideForStory {
  id: string
  audience: 'rider' | 'driver'
  poster_name: string
  user_id_short: string
  route_name: string
  origin_address: string
  dest_address: string
  trip_date: string
  trip_time: string
  time_type: 'departure' | 'arrival'
  direction_type: 'one_way' | 'roundtrip'
  available_seats: number | null
  note: string | null
  created_at: string
  days_until: number
}

export interface StoryIdea {
  angle: string
  headline: string
  body: string
  visual_idea: string
  hashtags: string | null
}

interface RidesResponse {
  ok: true
  riders: RideForStory[]
  drivers: RideForStory[]
}

interface GenerateResponse {
  ok: true
  ideas: StoryIdea[]
  ride: RideForStory
  model_used?: string
}

export function useRidesForStories(days: number, audience: RideAudience) {
  return useQuery({
    queryKey: ['admin', 'marketing', 'stories', 'rides', days, audience] as const,
    queryFn: () =>
      adminGet<RidesResponse>(`/marketing/stories/rides?days=${days}&audience=${audience}`),
    staleTime: 60 * 1000,
  })
}

export function useGenerateStoriesForRide() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (rideId: string) =>
      adminPost<GenerateResponse>(`/marketing/stories/from-ride/${rideId}`, {}),
    onSuccess: () => {
      // Quota counter changes — refresh banner.
      void qc.invalidateQueries({ queryKey: ['admin', 'api-usage'] })
    },
  })
}
