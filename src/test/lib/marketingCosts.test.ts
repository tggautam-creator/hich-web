/**
 * Tests for src/lib/marketing/costs.ts — the unified cost-display
 * source-of-truth. The snapshot of FEATURE_COST_ESTIMATES is the
 * change-review gate: any pricing edit forces a deliberate snapshot
 * update via `npm test -- --update marketingCosts`.
 */
import { describe, it, expect } from 'vitest'
import {
  FEATURE_COST_ESTIMATES,
  GEMINI_MODEL_PRICING,
  GROUNDING_SURCHARGE_USD_PER_REQUEST,
  PRICING_LAST_VERIFIED,
  PRICING_SOURCE_URL,
  NO_AI_COST_LABEL,
  costDisclosure,
  costTagline,
  estimatedCost,
  formatUsd,
} from '@/lib/marketing/costs'

describe('formatUsd', () => {
  it('truncates to 3 decimals — never rounds up', () => {
    expect(formatUsd(0.0399999)).toBe('$0.039')
    expect(formatUsd(0.04999)).toBe('$0.049')
  })
  it('strips trailing zeros', () => {
    expect(formatUsd(0.04)).toBe('$0.04')
    expect(formatUsd(0.1)).toBe('$0.1')
    expect(formatUsd(1.0)).toBe('$1')
  })
  it('floors sub-millicent values to <$0.001', () => {
    expect(formatUsd(0.0001)).toBe('<$0.001')
    expect(formatUsd(0.0009)).toBe('<$0.001')
  })
  it('returns $0 for zero, negatives, and non-finite', () => {
    expect(formatUsd(0)).toBe('$0')
    expect(formatUsd(-1)).toBe('$0')
    expect(formatUsd(NaN)).toBe('$0')
    expect(formatUsd(Infinity)).toBe('$0')
  })
  it('handles boundary at exactly $0.001', () => {
    expect(formatUsd(0.001)).toBe('$0.001')
  })
})

describe('estimatedCost', () => {
  it('collapses to ~$X / call when min === max', () => {
    expect(estimatedCost('poster-image-gen')).toBe('~$0.039 / call')
  })
  it('renders a range when min !== max', () => {
    const out = estimatedCost('advisor-message')
    expect(out).toMatch(/^\$0\.001.+\$0\.05 \/ call$/)
  })
  it('appends grounding suffix only for grounded features', () => {
    expect(estimatedCost('calendar-refresh-ai')).toMatch(/incl\. grounding/)
    expect(estimatedCost('poster-batch')).not.toMatch(/grounding/)
  })
})

describe('costDisclosure', () => {
  it('embeds the cost + rationale + verified-on date', () => {
    const out = costDisclosure('poster-image-gen')
    expect(out).toContain('~$0.039 / call')
    expect(out).toContain('Nano Banana')
    expect(out).toContain(PRICING_LAST_VERIFIED)
  })
})

describe('costTagline', () => {
  it('joins chain tiers with → for fallback-enabled features', () => {
    // poster-batch now chains Flash → 2.0 Flash → Flash Lite
    expect(costTagline('poster-batch')).toMatch(/^Flash→2\.0 Flash→Flash Lite · /)
    // calendar-refresh-ai is Pro → Flash
    expect(costTagline('calendar-refresh-ai')).toMatch(/^Pro→Flash · /)
    // advisor is Pro → Flash
    expect(costTagline('advisor-message')).toMatch(/^Pro→Flash · /)
  })
})

describe('pricing source-of-truth', () => {
  it('exports the published Google pricing URL', () => {
    expect(PRICING_SOURCE_URL).toBe('https://ai.google.dev/pricing')
  })
  it('pins LAST_VERIFIED to an ISO date', () => {
    expect(PRICING_LAST_VERIFIED).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
  it('exposes per-model rates for every tier the panel uses', () => {
    expect(GEMINI_MODEL_PRICING['gemini-2.5-flash'].freeTierRequestsPerDay).toBeGreaterThan(0)
    expect(GEMINI_MODEL_PRICING['gemini-2.5-pro'].freeTierRequestsPerDay).toBeGreaterThan(0)
    expect(GEMINI_MODEL_PRICING['gemini-2.5-flash-image'].perImage).toBeGreaterThan(0)
  })
  it('exposes the grounding surcharge as a positive number', () => {
    expect(GROUNDING_SURCHARGE_USD_PER_REQUEST).toBeGreaterThan(0)
  })
})

describe('FEATURE_COST_ESTIMATES snapshot (change-review gate)', () => {
  // If this snapshot fails because of a deliberate pricing edit, run
  // `npm test -- --update marketingCosts` to refresh — but ONLY after
  // re-checking ai.google.dev/pricing and bumping PRICING_LAST_VERIFIED.
  it('matches the recorded shape', () => {
    expect(FEATURE_COST_ESTIMATES).toMatchInlineSnapshot(`
      {
        "advisor-message": {
          "feature": "advisor-message",
          "includesGrounding": false,
          "maxUsd": 0.05,
          "minUsd": 0.001,
          "rationale": "One advisor message turn with tool access. Hits Gemini Pro by default; on quota hit falls back to 2.5 Flash WITH TOOLS PRESERVED. Cost varies with tool-call rounds and conversation length.",
          "tiers": [
            "gemini-2.5-pro",
            "gemini-2.5-flash",
          ],
        },
        "calendar-refresh-ai": {
          "feature": "calendar-refresh-ai",
          "includesGrounding": true,
          "maxUsd": 0.08,
          "minUsd": 0.01,
          "rationale": "Asks Gemini Pro to propose UC Davis student events with Google Search grounding ($0.035 surcharge + ~$0.03 in tokens). On Pro quota exhaustion (~50 req/day free tier), falls back to 2.5 Flash with grounding still attached.",
          "tiers": [
            "gemini-2.5-pro",
            "gemini-2.5-flash",
          ],
        },
        "poster-batch": {
          "feature": "poster-batch",
          "includesGrounding": false,
          "maxUsd": 0.005,
          "minUsd": 0.0005,
          "rationale": "Generates 1 poster copy (headline + body + image prompt) via Gemini Flash. Auto-falls back to 2.0 Flash or Flash Lite on quota exhaustion. Image generation is a separate paid call.",
          "tiers": [
            "gemini-2.5-flash",
            "gemini-2.0-flash",
            "gemini-2.5-flash-lite",
          ],
        },
        "poster-image-gen": {
          "feature": "poster-image-gen",
          "includesGrounding": false,
          "maxUsd": 0.039,
          "minUsd": 0.039,
          "rationale": "Generates one 1024×1024 poster image via gemini-2.5-flash-image (a.k.a. Nano Banana). Free tier allows ~100/day.",
          "tiers": [
            "gemini-2.5-flash-image",
          ],
        },
        "story-batch-both": {
          "feature": "story-batch-both",
          "includesGrounding": false,
          "maxUsd": 0.02,
          "minUsd": 0.001,
          "rationale": "Generates up to 6 corridor stories via Gemini Flash. Auto-falls back to 2.0 Flash or Flash Lite on quota exhaustion.",
          "tiers": [
            "gemini-2.5-flash",
            "gemini-2.0-flash",
            "gemini-2.5-flash-lite",
          ],
        },
        "story-batch-single-audience": {
          "feature": "story-batch-single-audience",
          "includesGrounding": false,
          "maxUsd": 0.02,
          "minUsd": 0.0005,
          "rationale": "Generates 1–6 corridor stories for one audience via Gemini Flash. Auto-falls back to 2.0 Flash or Flash Lite on quota exhaustion (separate quota buckets, cheaper output).",
          "tiers": [
            "gemini-2.5-flash",
            "gemini-2.0-flash",
            "gemini-2.5-flash-lite",
          ],
        },
      }
    `)
  })
})

describe('NO_AI_COST_LABEL sentinel', () => {
  it('is a non-empty string for the pill text', () => {
    expect(typeof NO_AI_COST_LABEL).toBe('string')
    expect(NO_AI_COST_LABEL.length).toBeGreaterThan(0)
  })
})
