/**
 * v1.2 Sprint 6 — React Query hooks over the caregivers table.
 * Thin wrapper around `lib/caregiversApi.ts` so call sites can
 * `useMyCaregivers()` without thinking about cache keys.
 *
 * Invalidation: every mutation invalidates the per-user list so the
 * Profile section + the RideConfirm / SchedulePost pickers re-render
 * with the new shape immediately.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  addCaregiver,
  deleteCaregiver,
  loadCaregivers,
  updateCaregiver,
  type CaregiverInsertInput,
  type CaregiverUpdateInput,
} from '@/lib/caregiversApi'
import { useAuthStore } from '@/stores/authStore'
import type { Caregiver } from '@/types/database'

const FIVE_MIN_MS = 5 * 60 * 1000

function listKey(userId: string | undefined) {
  return ['caregivers', 'list', userId ?? 'anon'] as const
}

/** Load the signed-in user's caregivers, newest first. Disabled while signed out. */
export function useMyCaregivers() {
  const userId = useAuthStore((s) => s.profile?.id)
  return useQuery<Caregiver[]>({
    queryKey: listKey(userId),
    queryFn:  () => loadCaregivers(userId as string),
    enabled:  typeof userId === 'string' && userId.length > 0,
    staleTime: FIVE_MIN_MS,
  })
}

export function useAddCaregiver() {
  const qc = useQueryClient()
  const userId = useAuthStore((s) => s.profile?.id)
  return useMutation<Caregiver, Error, Omit<CaregiverInsertInput, 'userId'>>({
    mutationFn: (input) => {
      if (!userId) throw new Error('addCaregiver called without a signed-in user')
      return addCaregiver({ ...input, userId })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: listKey(userId) })
    },
  })
}

export function useUpdateCaregiver() {
  const qc = useQueryClient()
  const userId = useAuthStore((s) => s.profile?.id)
  return useMutation<void, Error, CaregiverUpdateInput>({
    mutationFn: updateCaregiver,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: listKey(userId) })
    },
  })
}

export function useDeleteCaregiver() {
  const qc = useQueryClient()
  const userId = useAuthStore((s) => s.profile?.id)
  return useMutation<void, Error, string>({
    mutationFn: (caregiverId) => deleteCaregiver(caregiverId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: listKey(userId) })
    },
  })
}
