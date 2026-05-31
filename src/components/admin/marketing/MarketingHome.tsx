/**
 * Phase 0 placeholder for /admin/marketing. Shows:
 *   - Gemini config status (green or "set GEMINI_API_KEY" CTA)
 *   - Current month's marketing theme + the 4 weekly features
 *   - Coming-soon list for the 3 Phase 1+ features
 *
 * Real Story / Poster / Advisor pages get their own routes once we
 * implement them; this page is the index.
 */
import { Link } from 'react-router-dom'
import { useMarketingConfig, useCurrentMarketingTheme } from '@/hooks/useMarketingConfig'

export default function MarketingHome() {
  const cfg = useMarketingConfig()
  const themeQuery = useCurrentMarketingTheme()
  const theme = themeQuery.data?.theme ?? null

  return (
    <div data-testid="admin-marketing-home" className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-text-primary">Marketing panel</h1>
        <p className="text-sm text-text-secondary">
          Daily story queue, poster ideas, and your AI marketing
          advisor — all in one place.
        </p>
      </header>

      <ConfigBanner
        loading={cfg.isLoading}
        configured={cfg.data?.gemini_configured ?? false}
      />

      <section
        data-testid="marketing-theme-card"
        className="rounded-2xl border border-border bg-white p-5 space-y-3"
      >
        <header className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-bold text-text-primary">
            This month's theme
          </h2>
          <p className="text-[10px] uppercase tracking-wide text-text-secondary">
            Drives poster + story copy
          </p>
        </header>
        {themeQuery.isLoading && (
          <p className="text-sm text-text-secondary">Loading theme…</p>
        )}
        {!themeQuery.isLoading && !theme && (
          <p
            data-testid="marketing-theme-missing"
            className="text-sm text-text-secondary"
          >
            No theme set for this month. Add one in the database
            (table <code>marketing_themes</code>) — the seeded June 2026
            theme covers the launch month.
          </p>
        )}
        {theme && (
          <div className="space-y-3">
            <div>
              <p className="text-xl font-bold text-text-primary">
                {theme.theme_name}
              </p>
              <p className="text-sm text-text-secondary mt-1">
                {theme.theme_summary}
              </p>
            </div>
            <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
              {[
                theme.week_1_feature,
                theme.week_2_feature,
                theme.week_3_feature,
                theme.week_4_feature,
              ].map((feat, idx) => (
                <div
                  key={idx}
                  className="rounded-lg border border-border p-3"
                >
                  <p className="text-[10px] uppercase tracking-wide text-text-secondary">
                    Week {idx + 1}
                  </p>
                  <p className="text-sm text-text-primary mt-0.5">{feat}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section
        data-testid="marketing-features"
        className="rounded-2xl border border-border bg-white p-5"
      >
        <h2 className="text-sm font-bold text-text-primary mb-3">Features</h2>
        <ul className="text-sm text-text-secondary space-y-3">
          <li>
            <Link
              to="/admin/marketing/stories"
              className="block rounded-lg border border-primary/30 bg-primary/5 p-3 hover:bg-primary/10 transition-colors"
            >
              <p className="font-semibold text-primary">
                Daily story queue →
              </p>
              <p className="text-xs text-text-secondary mt-0.5">
                6 Instagram-story copies generated from the ride board
                every morning. Copy button per card.
              </p>
            </Link>
          </li>
          <li>
            <Link
              to="/admin/marketing/posters"
              className="block rounded-lg border border-primary/30 bg-primary/5 p-3 hover:bg-primary/10 transition-colors"
            >
              <p className="font-semibold text-primary">
                Poster ideas →
              </p>
              <p className="text-xs text-text-secondary mt-0.5">
                1 themed feed-post copy per day, grounded in this
                month's theme + this week's feature focus. Paste into
                your Canva templates.
              </p>
            </Link>
          </li>
          <li>
            <Link
              to="/admin/marketing/advisor"
              className="block rounded-lg border border-primary/30 bg-primary/5 p-3 hover:bg-primary/10 transition-colors"
            >
              <p className="font-semibold text-primary">
                Marketing advisor →
              </p>
              <p className="text-xs text-text-secondary mt-0.5">
                Chat with an agent that knows everything about Tago —
                brand voice, features, live KPIs, monthly theme. Daily
                focus + weekly Slack review coming in a follow-up
                phase.
              </p>
            </Link>
          </li>
        </ul>
      </section>
    </div>
  )
}

function ConfigBanner({
  loading,
  configured,
}: { loading: boolean; configured: boolean }) {
  if (loading) return null
  if (configured) {
    return (
      <div
        data-testid="marketing-config-ok"
        className="rounded-lg border border-success/30 bg-success/5 px-4 py-3 text-sm text-success"
      >
        Gemini API key is configured. Phase 1+ generators are ready to
        wire up.
      </div>
    )
  }
  return (
    <div
      data-testid="marketing-config-missing"
      className="rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-text-primary space-y-1"
    >
      <p className="font-semibold text-warning">
        Gemini API key not set
      </p>
      <p className="text-text-secondary text-xs">
        Add <code>GEMINI_API_KEY</code> to <code>.env.prod</code> on
        the EC2 server (and <code>.env.dev</code> locally), then
        restart the API. The marketing panel UI still works; the
        generators just won't run until the key is present.
      </p>
    </div>
  )
}
