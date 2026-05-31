/**
 * Phase 6 quota guardrails — wraps useAdminApiUsage() and exposes a
 * marketing-panel-friendly view of how close we are to each Gemini
 * model's daily ceiling. Drives:
 *   - <GeminiQuotaBanner /> on every marketing page header
 *   - soft-disable + confirm friction on Generate buttons when within
 *     one call of the daily quota (per model)
 *
 * Best-effort, not authoritative. The snapshot is fetched every 60s
 * and each Gemini-call mutation invalidates the cache on success so
 * the banner refreshes within ~1s of a call landing. Even so, there
 * are two race windows the founder should know exist:
 *   1) Rapid click-storm between invalidations — the founder could
 *      fire 2-3 Generate calls before any refetch lands, slipping
 *      past the 'near' confirm. The server-side counter keeps the
 *      actual quota math correct; the gate is just UI friction.
 *   2) UTC-midnight boundary — for up to a minute after rollover, a
 *      stale snapshot may either incorrectly block (yesterday's
 *      'exhausted' status persists) or incorrectly permit. Wait a
 *      moment if you hit either case.
 * The server-side recordGeminiCall counter is the ground truth; the
 * Google API itself is the actual hard ceiling.
 */
import { useMemo } from 'react'
import {
  useAdminApiUsage,
  type ServiceUsage,
  type ApiUsageResponse,
} from './useAdminApiUsage'
import { FEATURE_COST_ESTIMATES, type CostFeature, type GeminiTier } from '@/lib/marketing/costs'

export type GeminiService =
  | 'gemini_flash'
  | 'gemini_pro'
  | 'gemini_flash_image'
  | 'gemini_flash_2'
  | 'gemini_flash_lite'

export type QuotaStatus = 'ok' | 'near' | 'exhausted'

export interface GeminiServiceQuota {
  service: GeminiService
  label: string
  today: number
  daily_quota: number | null
  remaining: number | null
  pct: number | null
  status: QuotaStatus
}

export interface GeminiQuotaSnapshot {
  /** Per-model status keyed by service token. */
  byService: Record<GeminiService, GeminiServiceQuota>
  /** True if ANY Gemini model is at or beyond its daily quota. */
  anyExhausted: boolean
  /** True if ANY Gemini model is within 1 call of its daily quota. */
  anyNear: boolean
  /** Underlying response (loading / error state for the consumer). */
  query: ReturnType<typeof useAdminApiUsage>
}

const GEMINI_SERVICES: ReadonlyArray<GeminiService> = [
  'gemini_flash',
  'gemini_pro',
  'gemini_flash_image',
  'gemini_flash_2',
  'gemini_flash_lite',
]

const FALLBACK_LABEL: Record<GeminiService, string> = {
  gemini_flash:       'Gemini 2.5 Flash',
  gemini_pro:         'Gemini 2.5 Pro',
  gemini_flash_image: 'Gemini Flash Image',
  gemini_flash_2:     'Gemini 2.0 Flash',
  gemini_flash_lite:  'Gemini Flash Lite',
}

/** Maps a Gemini model ID (as used by costs.ts tiers + the server)
 *  to the api_usage_daily service token. Lets us walk a CostFeature's
 *  chain and check quota status for each tier in order. */
function tierToService(tier: GeminiTier): GeminiService {
  switch (tier) {
    case 'gemini-2.5-flash':       return 'gemini_flash'
    case 'gemini-2.5-pro':         return 'gemini_pro'
    case 'gemini-2.5-flash-image': return 'gemini_flash_image'
    case 'gemini-2.0-flash':       return 'gemini_flash_2'
    case 'gemini-2.5-flash-lite':  return 'gemini_flash_lite'
  }
}

/**
 * "near" fires when remaining <= NEAR_THRESHOLD_CALLS. For Pro (50/day)
 * this is meaningful warning headroom; for Flash (1500/day) it's
 * essentially never going to fire in practice. We intentionally use
 * an absolute count instead of a percentage so the 50-cap Pro tier
 * gets a useful warning ("3 calls left") instead of percentage drift.
 */
const NEAR_THRESHOLD_CALLS = 3

function deriveStatus(today: number, dailyQuota: number | null): {
  status: QuotaStatus
  remaining: number | null
  pct: number | null
} {
  if (dailyQuota == null || dailyQuota <= 0) {
    return { status: 'ok', remaining: null, pct: null }
  }
  const remaining = Math.max(0, dailyQuota - today)
  const pct = Math.min(1, today / dailyQuota)
  if (remaining <= 0) return { status: 'exhausted', remaining, pct }
  if (remaining <= NEAR_THRESHOLD_CALLS) return { status: 'near', remaining, pct }
  return { status: 'ok', remaining, pct }
}

function findSvc(data: ApiUsageResponse | undefined, key: GeminiService): ServiceUsage | undefined {
  return data?.services.find((s) => s.service === key)
}

export function useGeminiQuota(): GeminiQuotaSnapshot {
  const query = useAdminApiUsage()

  const byService = useMemo(() => {
    const out = {} as Record<GeminiService, GeminiServiceQuota>
    for (const key of GEMINI_SERVICES) {
      const svc = findSvc(query.data, key)
      const today = svc?.today ?? 0
      const dailyQuota = svc?.daily_quota ?? null
      const { status, remaining, pct } = deriveStatus(today, dailyQuota)
      out[key] = {
        service: key,
        label: svc?.label ?? FALLBACK_LABEL[key],
        today,
        daily_quota: dailyQuota,
        remaining,
        pct,
        status,
      }
    }
    return out
  }, [query.data])

  const anyExhausted = GEMINI_SERVICES.some((s) => byService[s].status === 'exhausted')
  const anyNear = GEMINI_SERVICES.some((s) => byService[s].status === 'near')

  return { byService, anyExhausted, anyNear, query }
}

/**
 * Map a CostFeature → the Gemini service of its CHAIN HEAD (i.e.
 * the preferred tier). Kept for callers that want the primary
 * quota's status. For chain-aware checks (all-exhausted, primary-
 * exhausted) use quotaChainForFeature() below.
 *
 * Both helpers derive the chain from FEATURE_COST_ESTIMATES.tiers so
 * adding a CostFeature without wiring its tiers list compile-fails.
 */
export function quotaServiceForFeature(feature: CostFeature): GeminiService | null {
  const chain = FEATURE_COST_ESTIMATES[feature]?.tiers
  if (!chain || chain.length === 0) return null
  return tierToService(chain[0]!)
}

/**
 * The full chain of services a feature can try, in order. Length 1
 * for single-tier features (poster-image-gen); 2-3 for everything
 * else. Drives the chain-aware "fully disabled = ALL tiers
 * exhausted" check in useQuotaGate.
 */
export function quotaChainForFeature(feature: CostFeature): GeminiService[] {
  const chain = FEATURE_COST_ESTIMATES[feature]?.tiers ?? []
  return chain.map(tierToService)
}
