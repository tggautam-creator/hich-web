/**
 * v1.3 Sprint 10 Slice 6 — driver-side outgoing board offer branch
 * on RideBoardCard. Mirrors iOS RideBoardCard.swift:445-453 (offerSentRow).
 *
 * Verifies:
 *   • my_offer_id + !ride_id → "Offer Sent" badge + "Withdraw Offer" button render
 *   • my_offer_id with ride_id set → branch suppressed (offer was accepted; legacy chat/withdraw branch takes over)
 *   • onWithdrawOfferClick fires with the offer id, stops propagation
 *   • withdrawingOfferId === my_offer_id → button shows "Withdrawing…" + is disabled
 *   • Legacy "Request Sent / Withdraw" branch (rider-side) is NOT shown when my_offer_id is set
 *   • isOwn=true posts never show either branch
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import RideBoardCard from '@/components/schedule/RideBoardCard'
import type { ScheduledRide } from '@/components/schedule/boardTypes'

function makeRide(overrides: Partial<ScheduledRide> = {}): ScheduledRide {
  return {
    id: 'sched-1',
    user_id: 'u-poster',
    mode: 'rider',
    route_name: '',
    origin_address: '123 Main',
    dest_address: '456 Oak',
    direction_type: 'one_way',
    trip_date: '2026-06-10',
    time_type: 'departure',
    trip_time: '09:00:00',
    created_at: '2026-06-01T12:00:00Z',
    poster: { id: 'u-poster', full_name: 'Bee Rider', avatar_url: null, rating_avg: 4.8, is_driver: false },
    already_requested: true,
    ...overrides,
  } as ScheduledRide
}

const NOOP = () => {}

describe('RideBoardCard — Withdraw Offer (Sprint 10 Slice 6)', () => {
  it('renders Offer Sent + Withdraw Offer when my_offer_id is set and ride_id is null', () => {
    const ride = makeRide({ my_offer_id: 'offer-abc', ride_id: null })
    render(
      <RideBoardCard
        ride={ride}
        isOwn={false}
        deletingId={null}
        onCardClick={NOOP}
        onRequestClick={NOOP}
        onDeleteClick={NOOP}
        onOpenMessages={NOOP}
        onWithdrawOfferClick={() => {}}
      />,
    )
    expect(screen.getByTestId('board-card-offer-sent-row')).toBeInTheDocument()
    expect(screen.getByTestId('board-card-offer-sent-badge')).toHaveTextContent('Offer Sent')
    expect(screen.getByTestId('board-card-withdraw-offer-button')).toHaveTextContent('Withdraw Offer')
  })

  it('SUPPRESSES the rider-side "Request Sent" branch when my_offer_id is set', () => {
    const ride = makeRide({ my_offer_id: 'offer-abc', ride_id: null })
    render(
      <RideBoardCard
        ride={ride}
        isOwn={false}
        deletingId={null}
        onCardClick={NOOP}
        onRequestClick={NOOP}
        onDeleteClick={NOOP}
        onOpenMessages={NOOP}
        onWithdrawOfferClick={NOOP}
        onWithdrawClick={NOOP}
      />,
    )
    expect(screen.queryByTestId('already-requested-badge')).toBeNull()
    expect(screen.queryByTestId('withdraw-button')).toBeNull()
  })

  it('does NOT render the Offer Sent branch when ride_id is set (offer accepted → chat/withdraw branch takes over)', () => {
    const ride = makeRide({
      my_offer_id: 'offer-abc',
      ride_id: 'ride-1',
      ride_status: 'coordinating',
    })
    render(
      <RideBoardCard
        ride={ride}
        isOwn={false}
        deletingId={null}
        onCardClick={NOOP}
        onRequestClick={NOOP}
        onDeleteClick={NOOP}
        onOpenMessages={NOOP}
        onWithdrawOfferClick={NOOP}
      />,
    )
    expect(screen.queryByTestId('board-card-offer-sent-row')).toBeNull()
    // The coordinating/accepted branch should render instead
    expect(screen.getByTestId('ride-confirmed-badge')).toBeInTheDocument()
    expect(screen.getByTestId('open-messages-button')).toBeInTheDocument()
  })

  it('clicking Withdraw Offer fires onWithdrawOfferClick(offerId) and stops propagation', () => {
    const onWithdrawOfferClick = vi.fn()
    const onCardClick = vi.fn()
    const ride = makeRide({ my_offer_id: 'offer-abc', ride_id: null })
    render(
      <RideBoardCard
        ride={ride}
        isOwn={false}
        deletingId={null}
        onCardClick={onCardClick}
        onRequestClick={NOOP}
        onDeleteClick={NOOP}
        onOpenMessages={NOOP}
        onWithdrawOfferClick={onWithdrawOfferClick}
      />,
    )
    fireEvent.click(screen.getByTestId('board-card-withdraw-offer-button'))
    expect(onWithdrawOfferClick).toHaveBeenCalledWith('offer-abc')
    // Card-level click should NOT fire (stopPropagation)
    expect(onCardClick).not.toHaveBeenCalled()
  })

  it('button disables + shows "Withdrawing…" when withdrawingOfferId matches my_offer_id', () => {
    const ride = makeRide({ my_offer_id: 'offer-abc', ride_id: null })
    render(
      <RideBoardCard
        ride={ride}
        isOwn={false}
        deletingId={null}
        withdrawingOfferId="offer-abc"
        onCardClick={NOOP}
        onRequestClick={NOOP}
        onDeleteClick={NOOP}
        onOpenMessages={NOOP}
        onWithdrawOfferClick={NOOP}
      />,
    )
    const btn = screen.getByTestId('board-card-withdraw-offer-button')
    expect(btn).toBeDisabled()
    expect(btn).toHaveTextContent('Withdrawing…')
  })

  it('button stays enabled when withdrawingOfferId is for a DIFFERENT offer', () => {
    const ride = makeRide({ my_offer_id: 'offer-abc', ride_id: null })
    render(
      <RideBoardCard
        ride={ride}
        isOwn={false}
        deletingId={null}
        withdrawingOfferId="some-other-offer"
        onCardClick={NOOP}
        onRequestClick={NOOP}
        onDeleteClick={NOOP}
        onOpenMessages={NOOP}
        onWithdrawOfferClick={NOOP}
      />,
    )
    const btn = screen.getByTestId('board-card-withdraw-offer-button')
    expect(btn).not.toBeDisabled()
    expect(btn).toHaveTextContent('Withdraw Offer')
  })

  it('button hides when onWithdrawOfferClick is not provided (badge still renders for visibility)', () => {
    const ride = makeRide({ my_offer_id: 'offer-abc', ride_id: null })
    render(
      <RideBoardCard
        ride={ride}
        isOwn={false}
        deletingId={null}
        onCardClick={NOOP}
        onRequestClick={NOOP}
        onDeleteClick={NOOP}
        onOpenMessages={NOOP}
      />,
    )
    expect(screen.getByTestId('board-card-offer-sent-badge')).toBeInTheDocument()
    expect(screen.queryByTestId('board-card-withdraw-offer-button')).toBeNull()
  })

  it('isOwn=true posts never render the Offer Sent row even if my_offer_id is set (defensive)', () => {
    const ride = makeRide({ my_offer_id: 'offer-abc', ride_id: null })
    render(
      <RideBoardCard
        ride={ride}
        isOwn
        deletingId={null}
        onCardClick={NOOP}
        onRequestClick={NOOP}
        onDeleteClick={NOOP}
        onOpenMessages={NOOP}
        onWithdrawOfferClick={NOOP}
      />,
    )
    expect(screen.queryByTestId('board-card-offer-sent-row')).toBeNull()
  })
})
