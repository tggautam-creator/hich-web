/** Shared formatting helpers for ride board components */

const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/** Format "2026-03-15" → "Mar 15" */
export function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** Format "14:30:00" → "2:30 PM" */
export function formatTime(timeStr: string): string {
  const [h, m] = timeStr.split(':').map(Number)
  if (h === undefined || m === undefined) return timeStr
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

/** Format day_of_week array → "Mon, Wed, Fri" */
export function formatDays(days: number[]): string {
  return [...days].sort((a, b) => a - b).map((d) => SHORT_DAYS[d] ?? '?').join(', ')
}

export { SHORT_DAYS }
