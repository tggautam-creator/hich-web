/**
 * v1.3 Sprint 11 Slice 2 — React Query hooks over the trusted-
 * contacts server REST routes.
 *
 * Mirrors the iOS load/add/delete flow in `ProfileSafetySection.swift`
 * + `AddTrustedContactSheet.swift`. Thin wrapper over
 * `lib/trustedContactsApi.ts` so call sites can
 * `useMyTrustedContacts()` without thinking about cache keys.
 *
 * Cache shape: scoped per-user via `useAuthStore.profile.id` so a
 * sign-out doesn't leak the previous user's list. Five-minute
 * staleTime mirrors `useCaregivers` (the other Profile-page list).
 *
 * Mutations invalidate the per-user list immediately AND
 * optimistically mutate the cache so the UI updates on the same
 * frame as the network call resolves (matters most for delete,
 * which iOS removes from the local array before the network
 * round-trip completes per `ProfileSafetySection.delete(id:)`).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  addTrustedContact,
  deleteTrustedContact,
  listTrustedContacts,
  type TrustedContact,
} from '@/lib/trustedContactsApi'
import { useAuthStore } from '@/stores/authStore'

const FIVE_MIN_MS = 5 * 60 * 1000

function listKey(userId: string | undefined) {
  return ['trustedContacts', 'list', userId ?? 'anon'] as const
}

/** Load the signed-in user's trusted contacts, oldest first.
 *  Disabled while signed out. */
export function useMyTrustedContacts() {
  const userId = useAuthStore((s) => s.profile?.id)
  return useQuery<TrustedContact[]>({
    queryKey: listKey(userId),
    queryFn: listTrustedContacts,
    enabled: typeof userId === 'string' && userId.length > 0,
    staleTime: FIVE_MIN_MS,
    // Mirror iOS `ProfileSafetySection.load()` which auto-retries
    // once after 1s before surfacing the banner. React Query's
    // built-in retry covers this with retry=1 + retryDelay=1000.
    retry: 1,
    retryDelay: 1000,
  })
}

export function useAddTrustedContact() {
  const qc = useQueryClient()
  const userId = useAuthStore((s) => s.profile?.id)
  return useMutation<TrustedContact, Error, { name: string; phone: string }>({
    mutationFn: addTrustedContact,
    onSuccess: (newContact) => {
      // Optimistically merge into the cached list so the UI shows
      // the new row without waiting for a re-fetch.
      qc.setQueryData<TrustedContact[]>(listKey(userId), (prev) =>
        prev ? [...prev, newContact] : [newContact],
      )
      void qc.invalidateQueries({ queryKey: listKey(userId) })
    },
  })
}

export function useDeleteTrustedContact() {
  const qc = useQueryClient()
  const userId = useAuthStore((s) => s.profile?.id)
  return useMutation<void, Error, string>({
    mutationFn: deleteTrustedContact,
    onSuccess: (_void, id) => {
      qc.setQueryData<TrustedContact[]>(listKey(userId), (prev) =>
        prev ? prev.filter((c) => c.id !== id) : prev,
      )
      void qc.invalidateQueries({ queryKey: listKey(userId) })
    },
  })
}
