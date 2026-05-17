import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { adminGet, adminPost } from '@/lib/admin/api'

/**
 * Slice 1.4 — admin broadcast push composer hooks.
 *
 * Response shapes mirror server/routes/admin/campaigns.ts. Keep in
 * sync — the server return type and client expectation are checked
 * only at runtime via React Query's generic; a drift will surface as
 * "undefined is not an object" in the composer rather than a TS error.
 */

export type AudienceType =
  | 'all_users'
  | 'all_drivers'
  | 'all_riders'
  | 'by_university'
  | 'active_last_7d'
  | 'active_last_30d'
  | 'dormant_30d'

export interface Audience {
  type: AudienceType
  domain?: string
}

export interface AudiencePreviewResponse {
  ok: true
  audience: Audience
  count: number
  opted_out_count?: number
  sample_users: Array<{ id: string; email: string; full_name: string | null }>
}

export interface SendCampaignPushArgs {
  audience: Audience
  title: string
  body: string
  reason?: string
  confirm_count?: number
  poster_url?: string
  /** Slice 1.4d — when true, push only to the calling admin's uid. Bypasses audience + opt-outs. */
  test_to_self?: boolean
}

export interface SendCampaignPushResult {
  ok: true
  campaign_id: string
  slug: string
  recipient_count: number
  push_sent: number
  tokens_attempted?: number
  notifications_written: number
  audience: Audience
}

// ── Slice 1.4d — history list + recall ──────────────────────────────────────

export interface CampaignHistoryRow {
  id: string
  slug: string
  audience: Record<string, unknown>
  title: string
  body: string
  poster_url: string | null
  recipient_count: number
  push_sent_count: number
  sent_by: string
  sent_by_email: string | null
  sent_at: string
  recalled_at: string | null
  recalled_reason: string | null
  recalled_by: string | null
  recalled_by_email: string | null
}

export interface CampaignHistoryResponse {
  ok: true
  campaigns: CampaignHistoryRow[]
  total: number
  limit: number
  offset: number
}

export function useAdminCampaignHistory(args: { enabled?: boolean; limit?: number; offset?: number } = {}) {
  const { enabled = true, limit = 25, offset = 0 } = args
  return useQuery<CampaignHistoryResponse>({
    queryKey: ['admin', 'campaigns', 'history', limit, offset],
    queryFn: () =>
      adminGet<CampaignHistoryResponse>(`/campaigns?limit=${limit}&offset=${offset}`),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: HALF_MIN_MS,
  })
}

interface RecallArgs { reason: string }
interface RecallResult { ok: true; campaign_id: string; notifications_deleted: number }

export function useAdminRecallCampaign(campaignId: string) {
  const qc = useQueryClient()
  return useMutation<RecallResult, Error, RecallArgs>({
    mutationFn: (args) =>
      adminPost<RecallResult>(`/campaigns/${campaignId}/recall`, args),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'campaigns', 'history'] })
      void qc.invalidateQueries({ queryKey: ['admin', 'users', 'audit'] })
      void qc.invalidateQueries({ queryKey: ['admin', 'users', 'notifications'] })
    },
  })
}

const HALF_MIN_MS = 30 * 1000

function audienceQuery(audience: Audience): string {
  const params = new URLSearchParams({ type: audience.type })
  if (audience.domain) params.set('domain', audience.domain)
  return params.toString()
}

/**
 * Live audience-size preview. Re-fires whenever the audience descriptor
 * changes. 30s staleTime so opening the composer + tweaking filters
 * doesn't trigger a request per keystroke on the domain field.
 */
export function useAdminAudiencePreview(args: {
  audience: Audience | null
  enabled: boolean
}) {
  const { audience, enabled } = args
  return useQuery<AudiencePreviewResponse>({
    queryKey: ['admin', 'campaigns', 'audience', audience],
    queryFn: () =>
      adminGet<AudiencePreviewResponse>(
        `/campaigns/audience/preview?${audienceQuery(audience as Audience)}`,
      ),
    enabled: enabled && audience !== null,
    placeholderData: keepPreviousData,
    staleTime: HALF_MIN_MS,
  })
}

export function useAdminSendCampaignPush() {
  const qc = useQueryClient()
  return useMutation<SendCampaignPushResult, Error, SendCampaignPushArgs>({
    mutationFn: (args) =>
      adminPost<SendCampaignPushResult>('/campaigns/push', args),
    onSuccess: () => {
      // Invalidate every per-user audit list — any of those users may
      // now have a fresh admin_broadcast notification + the audit
      // shows up in the global audit feed.
      void qc.invalidateQueries({ queryKey: ['admin', 'users', 'audit'] })
      void qc.invalidateQueries({ queryKey: ['admin', 'users', 'notifications'] })
    },
  })
}
