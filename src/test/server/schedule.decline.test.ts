// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'

const { mockAuth, mockFrom, mockSendFcmPush, mockRealtimeBroadcast } = vi.hoisted(() => {
  const mockAuth = { getUser: vi.fn() }
  const mockFrom = vi.fn()
  const mockSendFcmPush = vi.fn()
  const mockRealtimeBroadcast = vi.fn().mockResolvedValue(true)
  return { mockAuth, mockFrom, mockSendFcmPush, mockRealtimeBroadcast }
})

vi.mock('../../../server/lib/supabaseAdmin.ts', () => ({
  supabaseAdmin: {
    auth: mockAuth,
    from: mockFrom,
  },
}))

vi.mock('../../../server/lib/fcm.ts', () => ({
  sendFcmPush: mockSendFcmPush,
}))

vi.mock('../../../server/lib/realtimeBroadcast.ts', () => ({
  realtimeBroadcast: mockRealtimeBroadcast,
}))

vi.mock('../../../server/lib/scheduledReminders.ts', () => ({
  checkUpcomingRides: vi.fn(),
  expireMissedRides: vi.fn(),
  expireStaleRequests: vi.fn(),
}))

import { app } from '../../../server/app.ts'

const VALID_JWT = 'Bearer valid.jwt.token'

function authAs(userId = 'user-123') {
  mockAuth.getUser.mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  })
}

function chainOk(data: unknown = null, error: unknown = null) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = new Proxy({} as Record<string, unknown>, {
    get(_target, key: string) {
      if (key === 'then') return (resolve: (v: unknown) => void) => resolve({ data, error })
      if (key === 'catch' || key === 'finally') return undefined
      return (..._args: unknown[]) => chain
    },
  })
  return chain
}

describe('PATCH /api/schedule/decline-board', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authAs('driver-123')
    mockSendFcmPush.mockResolvedValue(1)

    mockFrom.mockImplementation((table: string) => {
      if (table === 'rides') {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({
                data: { id: 'ride-001', rider_id: 'rider-001', driver_id: 'driver-123', status: 'requested' },
                error: null,
              }),
            }),
          }),
          update: () => ({
            eq: () => ({
              eq: () => ({
                select: () => Promise.resolve({ data: [{ id: 'ride-001' }], error: null }),
              }),
            }),
          }),
        }
      }
      if (table === 'notifications') {
        return {
          update: () => chainOk(null),
          insert: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      }
      if (table === 'push_tokens') {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: [{ token: 'fcm-rider-1' }], error: null }),
          }),
        }
      }
      return {}
    })
  })

  it('sends an FCM decline notification and returns cancelled', async () => {
    const res = await request(app)
      .patch('/api/schedule/decline-board')
      .set('Authorization', VALID_JWT)
      .send({ ride_id: 'ride-001' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ride_id: 'ride-001', status: 'cancelled' })
    expect(mockSendFcmPush).toHaveBeenCalledWith([
      'fcm-rider-1',
    ], expect.objectContaining({
      title: 'Request Declined',
      body: 'Your ride request was declined. Try another ride on the board!',
      data: { type: 'board_declined', ride_id: 'ride-001' },
    }))
  })
})
