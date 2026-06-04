/**
 * v1.3 Sprint 12 Slice 6 — React Query mutation wrapper for the driver
 * "offer on a rider's board post" flow. Mirrors iOS
 * `RideBoardConfirmViewModel.submit()` lifecycle.
 *
 * Caller invokes `mutate(body)` from the confirm sheet's submit
 * handler. On success the parent (`RideBoard.tsx`) flips the row's
 * `already_requested` flag locally and shows a success toast.
 */
import { useMutation } from '@tanstack/react-query'
import {
  createBoardOffer,
  type CreateBoardOfferBody,
  type CreateBoardOfferResult,
} from '@/lib/boardOfferApi'

export function useCreateBoardOffer() {
  return useMutation<CreateBoardOfferResult, Error, CreateBoardOfferBody>({
    mutationFn: createBoardOffer,
  })
}
