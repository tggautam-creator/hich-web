/**
 * Hooks for the marketing panel (Phase 0). Just the foundation
 * queries — config probe + current monthly theme. Story/poster/advisor
 * hooks land alongside their respective UIs in Phase 1+.
 */
import { useQuery } from '@tanstack/react-query'
import { adminGet } from '@/lib/admin/api'

interface MarketingConfigResponse {
  ok: true
  gemini_configured: boolean
}

export function useMarketingConfig() {
  return useQuery({
    queryKey: ['admin', 'marketing', 'config'],
    queryFn: () => adminGet<MarketingConfigResponse>('/marketing/config'),
    staleTime: 5 * 60 * 1000,
  })
}

export interface MarketingTheme {
  id: string
  effective_month: string
  theme_name: string
  theme_summary: string
  week_1_feature: string
  week_2_feature: string
  week_3_feature: string
  week_4_feature: string
}

interface CurrentThemeResponse {
  ok: true
  theme: MarketingTheme | null
}

export function useCurrentMarketingTheme() {
  return useQuery({
    queryKey: ['admin', 'marketing', 'theme', 'current'],
    queryFn: () => adminGet<CurrentThemeResponse>('/marketing/themes/current'),
    staleTime: 10 * 60 * 1000,
  })
}
