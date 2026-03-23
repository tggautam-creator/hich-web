/**
 * Tests for datetime utility functions
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { isScheduledRideApproaching, formatScheduledRideTime } from '@/lib/datetime'
import type { Ride } from '@/types/database'

describe('datetime utilities', () => {
  beforeEach(() => {
    // Reset system time between tests
    vi.useRealTimers()
  })

  describe('isScheduledRideApproaching', () => {
    it('returns false for non-scheduled rides', () => {
      const ride: Partial<Ride> = {
        schedule_id: null,
        trip_date: '2026-03-23',
        trip_time: '09:00:00'
      }

      expect(isScheduledRideApproaching(ride as Ride)).toBe(false)
    })

    it('returns false for scheduled rides missing trip data', () => {
      const rideNoDate: Partial<Ride> = {
        schedule_id: 'sched-123',
        trip_date: null,
        trip_time: '09:00:00'
      }

      const rideNoTime: Partial<Ride> = {
        schedule_id: 'sched-123',
        trip_date: '2026-03-23',
        trip_time: null
      }

      expect(isScheduledRideApproaching(rideNoDate as Ride)).toBe(false)
      expect(isScheduledRideApproaching(rideNoTime as Ride)).toBe(false)
    })

    it('returns false for null/undefined ride', () => {
      expect(isScheduledRideApproaching(null)).toBe(false)
    })

    it('returns true when ride is within 15 minutes', () => {
      // Mock current time to be 08:50:00
      const mockNow = new Date('2026-03-23T08:50:00')
      vi.setSystemTime(mockNow)

      const ride: Partial<Ride> = {
        schedule_id: 'sched-123',
        trip_date: '2026-03-23',
        trip_time: '09:00:00' // 10 minutes from now
      }

      expect(isScheduledRideApproaching(ride as Ride)).toBe(true)
    })

    it('returns false when ride is more than 15 minutes away', () => {
      // Mock current time to be 08:30:00
      const mockNow = new Date('2026-03-23T08:30:00')
      vi.setSystemTime(mockNow)

      const ride: Partial<Ride> = {
        schedule_id: 'sched-123',
        trip_date: '2026-03-23',
        trip_time: '09:00:00' // 30 minutes from now
      }

      expect(isScheduledRideApproaching(ride as Ride)).toBe(false)
    })

    it('returns false when ride time has already passed beyond grace period', () => {
      // Mock current time to be 10:30:00
      const mockNow = new Date('2026-03-23T10:30:00')
      vi.setSystemTime(mockNow)

      const ride: Partial<Ride> = {
        schedule_id: 'sched-123',
        trip_date: '2026-03-23',
        trip_time: '09:00:00' // 90 minutes ago (beyond 60 min grace period)
      }

      expect(isScheduledRideApproaching(ride as Ride)).toBe(false)
    })

    it('returns true when ride time has passed but within grace period', () => {
      // Mock current time to be 09:30:00
      const mockNow = new Date('2026-03-23T09:30:00')
      vi.setSystemTime(mockNow)

      const ride: Partial<Ride> = {
        schedule_id: 'sched-123',
        trip_date: '2026-03-23',
        trip_time: '09:00:00' // 30 minutes ago (within 60 min grace period)
      }

      expect(isScheduledRideApproaching(ride as Ride)).toBe(true)
    })

    it('returns true when ride time just passed', () => {
      // Mock current time to be 09:05:00
      const mockNow = new Date('2026-03-23T09:05:00')
      vi.setSystemTime(mockNow)

      const ride: Partial<Ride> = {
        schedule_id: 'sched-123',
        trip_date: '2026-03-23',
        trip_time: '09:00:00' // 5 minutes ago
      }

      expect(isScheduledRideApproaching(ride as Ride)).toBe(true)
    })

    it('respects custom threshold', () => {
      // Mock current time to be 08:40:00
      const mockNow = new Date('2026-03-23T08:40:00')
      vi.setSystemTime(mockNow)

      const ride: Partial<Ride> = {
        schedule_id: 'sched-123',
        trip_date: '2026-03-23',
        trip_time: '09:00:00' // 20 minutes from now
      }

      // Default threshold (15 min) should be false
      expect(isScheduledRideApproaching(ride as Ride)).toBe(false)

      // Custom threshold (30 min) should be true
      expect(isScheduledRideApproaching(ride as Ride, 30)).toBe(true)
    })

    it('respects custom grace period', () => {
      // Mock current time to be 10:30:00
      const mockNow = new Date('2026-03-23T10:30:00')
      vi.setSystemTime(mockNow)

      const ride: Partial<Ride> = {
        schedule_id: 'sched-123',
        trip_date: '2026-03-23',
        trip_time: '09:00:00' // 90 minutes ago
      }

      // Default grace period (60 min) should be false
      expect(isScheduledRideApproaching(ride as Ride)).toBe(false)

      // Custom grace period (120 min) should be true
      expect(isScheduledRideApproaching(ride as Ride, 15, 120)).toBe(true)
    })

    it('handles invalid date formats gracefully', () => {
      const ride: Partial<Ride> = {
        schedule_id: 'sched-123',
        trip_date: 'invalid-date',
        trip_time: '09:00:00'
      }

      expect(isScheduledRideApproaching(ride as Ride)).toBe(false)
    })

    it('handles invalid time formats gracefully', () => {
      const ride: Partial<Ride> = {
        schedule_id: 'sched-123',
        trip_date: '2026-03-23',
        trip_time: 'invalid-time'
      }

      expect(isScheduledRideApproaching(ride as Ride)).toBe(false)
    })
  })

  describe('formatScheduledRideTime', () => {
    beforeEach(() => {
      // Mock current date to March 23, 2026 10:00 AM
      const mockNow = new Date('2026-03-23T10:00:00')
      vi.setSystemTime(mockNow)
    })

    it('returns null for non-scheduled rides', () => {
      const ride: Partial<Ride> = {
        schedule_id: null,
        trip_date: '2026-03-23',
        trip_time: '09:00:00'
      }

      expect(formatScheduledRideTime(ride as Ride)).toBeNull()
    })

    it('returns null for rides missing trip data', () => {
      const rideNoDate: Partial<Ride> = {
        schedule_id: 'sched-123',
        trip_date: null,
        trip_time: '09:00:00'
      }

      const rideNoTime: Partial<Ride> = {
        schedule_id: 'sched-123',
        trip_date: '2026-03-23',
        trip_time: null
      }

      expect(formatScheduledRideTime(rideNoDate as Ride)).toBeNull()
      expect(formatScheduledRideTime(rideNoTime as Ride)).toBeNull()
    })

    it('returns null for null/undefined ride', () => {
      expect(formatScheduledRideTime(null)).toBeNull()
    })

    it('formats today rides correctly', () => {
      const ride: Partial<Ride> = {
        schedule_id: 'sched-123',
        trip_date: '2026-03-23',
        trip_time: '15:30:00'
      }

      const result = formatScheduledRideTime(ride as Ride)
      expect(result).toMatch(/Today at 3:30/)
    })

    it('formats tomorrow rides correctly', () => {
      const ride: Partial<Ride> = {
        schedule_id: 'sched-123',
        trip_date: '2026-03-24',
        trip_time: '08:15:00'
      }

      const result = formatScheduledRideTime(ride as Ride)
      expect(result).toMatch(/Tomorrow at 8:15/)
    })

    it('formats future dates correctly', () => {
      const ride: Partial<Ride> = {
        schedule_id: 'sched-123',
        trip_date: '2026-03-25',
        trip_time: '14:45:00'
      }

      const result = formatScheduledRideTime(ride as Ride)
      expect(result).toMatch(/Wednesday/)
      expect(result).toMatch(/2:45/)
    })

    it('handles invalid date formats gracefully', () => {
      const ride: Partial<Ride> = {
        schedule_id: 'sched-123',
        trip_date: 'invalid-date',
        trip_time: '09:00:00'
      }

      expect(formatScheduledRideTime(ride as Ride)).toBeNull()
    })
  })
})