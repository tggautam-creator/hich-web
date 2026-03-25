/**
 * Date/time utility functions for ride scheduling
 */

import type { Ride } from '@/types/database'

/**
 * Checks if a scheduled ride is approaching or already past its scheduled time.
 *
 * @param ride - The ride object with schedule_id, trip_date, and trip_time
 * @param thresholdMinutes - How many minutes before the ride to consider "approaching" (default: 15)
 * @param gracePeriodMinutes - How many minutes after scheduled time to still show navigate (default: 60)
 * @returns true if the ride is within the approach window or past but within grace period
 */
export function isScheduledRideApproaching(
  ride: Ride | null,
  thresholdMinutes = 15,
  gracePeriodMinutes = 60
): boolean {
  if (!ride?.schedule_id || !ride.trip_date || !ride.trip_time) {
    return false
  }

  try {
    // Combine trip_date (YYYY-MM-DD) and trip_time (HH:MM:SS) into a Date object
    const rideDateTime = new Date(`${ride.trip_date}T${ride.trip_time}`)

    // Check if the date parsing was successful
    if (isNaN(rideDateTime.getTime())) {
      return false
    }

    const now = new Date()
    const timeDifferenceMs = rideDateTime.getTime() - now.getTime()
    const timeDifferenceMinutes = timeDifferenceMs / (1000 * 60)

    // Return true if:
    // - Within approach window (0 to 15 min before), OR
    // - Already past scheduled time but within grace period (0 to 60 min after)
    return (
      (timeDifferenceMinutes <= thresholdMinutes && timeDifferenceMinutes > 0) || // Before but approaching
      (timeDifferenceMinutes <= 0 && timeDifferenceMinutes >= -gracePeriodMinutes) // After but within grace
    )
  } catch {
    return false
  }
}

/**
 * Gets a human-readable string for when a scheduled ride is starting.
 *
 * @param ride - The ride object with schedule_id, trip_date, and trip_time
 * @returns A formatted string like "Today at 3:30 PM" or "Tomorrow at 8:00 AM"
 */
export function formatScheduledRideTime(ride: Ride | null): string | null {
  if (!ride?.schedule_id || !ride.trip_date || !ride.trip_time) {
    return null
  }

  try {
    const rideDateTime = new Date(`${ride.trip_date}T${ride.trip_time}`)

    if (isNaN(rideDateTime.getTime())) {
      return null
    }

    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const rideDate = new Date(rideDateTime.getFullYear(), rideDateTime.getMonth(), rideDateTime.getDate())

    const daysDiff = Math.floor((rideDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

    let dayLabel: string
    if (daysDiff === 0) {
      dayLabel = 'Today'
    } else if (daysDiff === 1) {
      dayLabel = 'Tomorrow'
    } else if (daysDiff === -1) {
      dayLabel = 'Yesterday'
    } else {
      dayLabel = rideDateTime.toLocaleDateString([], {
        weekday: 'long',
        month: 'short',
        day: 'numeric'
      })
    }

    const timeLabel = rideDateTime.toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit'
    })

    return `${dayLabel} at ${timeLabel}`
  } catch {
    return null
  }
}

/**
 * Returns minutes until a scheduled ride, or negative if past.
 * Returns null if ride has no schedule info.
 */
export function getMinutesUntilRide(ride: Ride | null): number | null {
  if (!ride?.trip_date || !ride?.trip_time) return null

  try {
    const rideDateTime = new Date(`${ride.trip_date}T${ride.trip_time}`)
    if (isNaN(rideDateTime.getTime())) return null
    return Math.round((rideDateTime.getTime() - Date.now()) / (1000 * 60))
  } catch {
    return null
  }
}