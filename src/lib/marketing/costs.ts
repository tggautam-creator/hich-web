/**
 * Unified cost-display layer for the marketing admin panel.
 *
 * SINGLE SOURCE OF TRUTH for what an AI call costs the founder.
 * Used by tooltips, footer disclaimers, and the regenerate-confirm
 * dialog across src/components/admin/marketing/*.
 *
 * NOT imported by the server-side generators — server code already
 * has its own model/quota knowledge in server/lib/marketing/*.ts.
 * This module's job is display only. Google's actual invoice is the
 * ground truth; numbers here are FYI bounds.
 *
 * Update protocol:
 *  1. Re-check ai.google.dev/pricing on PRICING_LAST_VERIFIED below
 *     — anything more than 90 days old is suspect.
 *  2. Update the per-1M-token rates in GEMINI_MODEL_PRICING.
 *  3. Bump PRICING_LAST_VERIFIED to today (ISO).
 *  4. Run `npm test -- --run marketingCosts` — the snapshot test
 *     forces a deliberate edit if estimates change.
 */

export const PRICING_LAST_VERIFIED = '2026-05-30' as const
export const PRICING_SOURCE_URL = 'https://ai.google.dev/pricing' as const

// ── Model-level pricing ────────────────────────────────────────────

export type GeminiTier =
  | 'gemini-2.5-flash'
  | 'gemini-2.5-pro'
  | 'gemini-2.5-flash-image'

export interface GeminiTextPricing {
  /** USD per 1,000,000 input tokens. */
  inputPerMTokens: number
  /** USD per 1,000,000 output tokens. */
  outputPerMTokens: number
  /** Google's free-tier daily request ceiling. */
  freeTierRequestsPerDay: number
}

export interface GeminiImagePricing {
  /** USD per generated 1024x1024 image. */
  perImage: number
  freeTierImagesPerDay: number
}

export const GEMINI_MODEL_PRICING: {
  'gemini-2.5-flash': GeminiTextPricing
  'gemini-2.5-pro': GeminiTextPricing
  'gemini-2.5-flash-image': GeminiImagePricing
} = {
  'gemini-2.5-flash':       { inputPerMTokens: 0.30, outputPerMTokens: 2.50, freeTierRequestsPerDay: 1500 },
  'gemini-2.5-pro':         { inputPerMTokens: 1.25, outputPerMTokens: 10.0, freeTierRequestsPerDay:   50 },
  'gemini-2.5-flash-image': { perImage: 0.039, freeTierImagesPerDay: 100 },
}

/**
 * Google Search grounding surcharge, paid on top of per-token output
 * cost. Currently only the calendar refresh-AI flow uses it.
 */
export const GROUNDING_SURCHARGE_USD_PER_REQUEST = 0.035 as const

// ── Feature-level estimates ────────────────────────────────────────

/**
 * Every Generate-style button surface in the marketing admin panel.
 * One id per cost-incurring user action. New surfaces must be added
 * here BEFORE wiring a button, so the disclosure exists at click time.
 */
export type CostFeature =
  | 'story-batch-single-audience'  // StoriesPage 'Ask riders' / 'Ask drivers'
  | 'story-batch-both'             // StoriesPage 'Generate (both)' — 6 stories
  | 'poster-batch'                 // PostersPage 'Generate poster' (text only)
  | 'poster-image-gen'             // PostersPage 'Generate image' / 'Regenerate'
  | 'calendar-refresh-ai'          // CalendarPage 'Refresh AI suggestions'
  | 'advisor-message'              // AdvisorPage 'Send' (1 message turn)

export interface FeatureCostEstimate {
  feature: CostFeature
  tiers: ReadonlyArray<GeminiTier>
  /** Rough USD lower bound for one click. */
  minUsd: number
  /** Rough USD upper bound for one click. */
  maxUsd: number
  /** Whether the feature adds the Google Search grounding surcharge. */
  includesGrounding: boolean
  /** One-line explanation surfaced in tooltips. */
  rationale: string
}

/**
 * Hand-tuned from observed token counts in server/lib/marketing/*:
 * - storyGenerator.ts maxOutputTokens=1024, thinkingBudget=0
 * - posterGenerator.ts ~1.5k output tokens per item
 * - eventCalendar.ts refresh uses Pro with maxOutputTokens=8192 + grounding
 */
export const FEATURE_COST_ESTIMATES: Record<CostFeature, FeatureCostEstimate> = {
  'story-batch-single-audience': {
    feature: 'story-batch-single-audience',
    tiers: ['gemini-2.5-flash'],
    minUsd: 0.001, maxUsd: 0.02,
    includesGrounding: false,
    rationale: 'Generates 1–6 corridor stories for one audience via Gemini Flash (one call per top corridor, capped at 6).',
  },
  'story-batch-both': {
    feature: 'story-batch-both',
    tiers: ['gemini-2.5-flash'],
    minUsd: 0.003, maxUsd: 0.02,
    includesGrounding: false,
    rationale: 'Generates up to 6 corridor stories via Gemini Flash (one per top corridor today).',
  },
  'poster-batch': {
    feature: 'poster-batch',
    tiers: ['gemini-2.5-flash'],
    minUsd: 0.001, maxUsd: 0.005,
    includesGrounding: false,
    rationale: 'Generates 1 poster copy (headline + body + image prompt) via Gemini Flash. Image generation is a separate paid call.',
  },
  'poster-image-gen': {
    feature: 'poster-image-gen',
    tiers: ['gemini-2.5-flash-image'],
    minUsd: 0.039, maxUsd: 0.039,
    includesGrounding: false,
    rationale: 'Generates one 1024×1024 poster image via gemini-2.5-flash-image (a.k.a. Nano Banana). Free tier allows ~100/day.',
  },
  'calendar-refresh-ai': {
    feature: 'calendar-refresh-ai',
    tiers: ['gemini-2.5-pro'],
    minUsd: 0.04, maxUsd: 0.08,
    includesGrounding: true,
    rationale: 'Asks Gemini Pro to propose UC Davis student events. Uses Google Search grounding for real concert/festival dates — $0.035 grounding surcharge plus ~$0.03 in tokens.',
  },
  'advisor-message': {
    feature: 'advisor-message',
    tiers: ['gemini-2.5-pro', 'gemini-2.5-flash'],
    minUsd: 0.001, maxUsd: 0.05,
    includesGrounding: false,
    rationale: 'One advisor message turn. Hits Gemini Pro by default; on quota hit (~50 Pro req/day on free tier) falls back to Gemini Flash. Cost varies with tool-call rounds and conversation length.',
  },
}

// ── Helpers ────────────────────────────────────────────────────────

/**
 * Format USD per the marketing UI conventions:
 *  - up to 3 decimal places, TRUNCATED (never rounded up — Google's
 *    invoice is the ground truth, we never want to over-state)
 *  - strip trailing zeros so $0.040 → '$0.04'
 *  - never collapse to '$0' — values < $0.001 render as '<$0.001'
 */
export function formatUsd(usd: number): string {
  if (!Number.isFinite(usd) || usd < 0) return '$0'
  if (usd > 0 && usd < 0.001) return '<$0.001'
  const truncated = Math.floor(usd * 1000) / 1000
  let s = truncated.toFixed(3)
  s = s.replace(/0+$/, '').replace(/\.$/, '')
  return `$${s}`
}

/**
 * Short cost string for tooltips / dialog text.
 * Single-tier: '~$0.039 / call'
 * Range: '$0.001–$0.05 / call'
 * Grounded: ' (incl. grounding)' suffix
 */
export function estimatedCost(feature: CostFeature): string {
  const est = FEATURE_COST_ESTIMATES[feature]
  const grounding = est.includesGrounding ? ' (incl. grounding)' : ''
  if (est.minUsd === est.maxUsd) {
    return `~${formatUsd(est.minUsd)} / call${grounding}`
  }
  return `${formatUsd(est.minUsd)}–${formatUsd(est.maxUsd)} / call${grounding}`
}

/**
 * Long-form copy for tooltips + confirm dialogs.
 * Returns plain text safe for `<Tooltip>` body OR `window.confirm()`.
 */
export function costDisclosure(feature: CostFeature): string {
  const est = FEATURE_COST_ESTIMATES[feature]
  return `Estimated ${estimatedCost(feature)}. ${est.rationale} Verified against Google's pricing on ${PRICING_LAST_VERIFIED}.`
}

/**
 * Short button-subtitle tagline. Prefixes the tier nickname when
 * stable; for advisor (Pro→Flash) shows both.
 */
export function costTagline(feature: CostFeature): string {
  const est = FEATURE_COST_ESTIMATES[feature]
  const tierLabel = est.tiers.length === 1
    ? tierNickname(est.tiers[0]!)
    : est.tiers.map(tierNickname).join('→')
  return `${tierLabel} · ${estimatedCost(feature)}`
}

function tierNickname(tier: GeminiTier): string {
  switch (tier) {
    case 'gemini-2.5-flash': return 'Flash'
    case 'gemini-2.5-pro': return 'Pro'
    case 'gemini-2.5-flash-image': return 'Flash-image'
  }
}

/**
 * Sentinel for buttons that trigger a DB write only (no AI). Lets
 * callers render a uniform "No AI cost" pill instead of hand-rolling.
 */
export const NO_AI_COST_LABEL = 'No AI cost' as const
