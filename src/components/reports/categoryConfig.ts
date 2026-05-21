/**
 * 2026-05-20 — single source of truth for the report categories
 * exposed in the in-app reporting UI. Mirrors the server's
 * `ALLOWED_CATEGORIES` list (server/routes/report.ts). When adding a
 * category here, also add it to the server allow-list AND the DB
 * CHECK constraint (see migration 086).
 *
 * The `availableIn` field controls where the category surfaces:
 *   - 'active_ride'     — Active Ride screen "Report an issue" sheet
 *   - 'post_ride'       — Ride Summary + My Rides detail report sheet
 *   - 'wallet'          — Wallet row "Issue with this charge?"
 *   - 'messaging'       — Messaging overflow "Report this user"
 *   - 'general'         — Settings → Report a problem (no ride context)
 */

export type ReportCategory =
  | 'driver_conduct'
  | 'rider_conduct'
  | 'vehicle_condition'
  | 'route_issue'
  | 'fare_dispute'
  | 'payment_issue'
  | 'pickup_dropoff'
  | 'lost_item'
  | 'cancellation_dispute'
  | 'safety_during_ride'
  | 'bug_report'
  | 'account_issue'
  | 'harassment_messages'
  | 'feedback_feature'

export type ReportContext =
  | 'active_ride'
  | 'post_ride'
  | 'wallet'
  | 'messaging'
  | 'general'

export interface CategorySpec {
  value: ReportCategory
  label: string
  description: string
  /** When true, the form prompts for a `requested_refund_cents` value. */
  promptsRefund?: boolean
  availableIn: ReadonlyArray<ReportContext>
}

export const CATEGORIES: readonly CategorySpec[] = [
  {
    value: 'safety_during_ride',
    label: 'Safety concern',
    description: 'Unsafe driving, harassment, an accident — anything that needs immediate attention.',
    availableIn: ['active_ride'],
  },
  {
    value: 'driver_conduct',
    label: 'Driver conduct',
    description: 'Rude, late, no-show, or other behavior issues with the driver.',
    availableIn: ['post_ride'],
  },
  {
    value: 'rider_conduct',
    label: 'Rider conduct',
    description: 'Rude, no-show, refused to pay, damaged the car.',
    availableIn: ['post_ride'],
  },
  {
    value: 'vehicle_condition',
    label: 'Vehicle condition',
    description: 'Car was dirty, AC broken, tires looked unsafe.',
    availableIn: ['post_ride'],
  },
  {
    value: 'route_issue',
    label: 'Route problem',
    description: 'Took a detour, drove the wrong way, fare looks inflated.',
    availableIn: ['active_ride', 'post_ride'],
  },
  {
    value: 'pickup_dropoff',
    label: 'Pickup or dropoff',
    description: "QR didn't scan, wrong pickup spot, dropoff at the wrong place.",
    availableIn: ['active_ride', 'post_ride'],
  },
  {
    value: 'fare_dispute',
    label: 'Fare dispute',
    description: 'Charged too much, or the fare looks wrong.',
    promptsRefund: true,
    availableIn: ['post_ride', 'wallet'],
  },
  {
    value: 'payment_issue',
    label: 'Payment issue',
    description: 'Charged twice, refund never arrived, card problem.',
    promptsRefund: true,
    availableIn: ['post_ride', 'wallet'],
  },
  {
    value: 'lost_item',
    label: 'Lost item',
    description: 'Left something in the car. We can put you in touch with the driver.',
    availableIn: ['post_ride'],
  },
  {
    value: 'cancellation_dispute',
    label: 'Cancellation dispute',
    description: 'They cancelled at pickup, or I was charged for a cancellation.',
    availableIn: ['post_ride'],
  },
  {
    value: 'harassment_messages',
    label: 'Harassment via messages',
    description: 'Inappropriate or threatening messages.',
    availableIn: ['messaging', 'general'],
  },
  {
    value: 'bug_report',
    label: 'App bug',
    description: "Something in the app didn't work the way it should.",
    availableIn: ['general'],
  },
  {
    value: 'account_issue',
    label: 'Account issue',
    description: 'Sign-in, profile, photo verification, or .edu rejection problems.',
    availableIn: ['general'],
  },
  {
    value: 'feedback_feature',
    label: 'Feedback or suggestion',
    description: 'General feedback or a feature request.',
    availableIn: ['general'],
  },
]

export function categoriesFor(context: ReportContext): CategorySpec[] {
  return CATEGORIES.filter((c) => c.availableIn.includes(context))
}

export function findCategory(value: ReportCategory | string): CategorySpec | null {
  return CATEGORIES.find((c) => c.value === value) ?? null
}

// ── Display helpers shared by My Reports + admin (later) ───────────

export const SEVERITY_LABEL: Record<'emergency' | 'urgent' | 'normal' | 'low', string> = {
  emergency: 'Emergency',
  urgent: 'Urgent',
  normal: 'Normal',
  low: 'Low',
}

export const SEVERITY_TONE: Record<
  'emergency' | 'urgent' | 'normal' | 'low',
  string
> = {
  emergency: 'bg-danger text-white',
  urgent: 'bg-warning/15 text-warning',
  normal: 'bg-surface text-text-secondary',
  low: 'bg-surface text-text-secondary',
}

export type ReportStatus =
  | 'open'
  | 'in_progress'
  | 'awaiting_user'
  | 'resolved'
  | 'closed'

export const STATUS_LABEL: Record<ReportStatus, string> = {
  open: 'Open',
  in_progress: 'In review',
  awaiting_user: 'Waiting on you',
  resolved: 'Resolved',
  closed: 'Closed',
}

export const STATUS_TONE: Record<ReportStatus, string> = {
  open: 'bg-primary-light text-primary',
  in_progress: 'bg-primary-light text-primary',
  awaiting_user: 'bg-warning/15 text-warning',
  resolved: 'bg-success/15 text-success',
  closed: 'bg-surface text-text-secondary',
}
