import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'

/**
 * Public-facing marketing surface that admin broadcasts deep-link
 * into when a user taps the notification. Lives outside the
 * auth-gated routes so the page works even when the user isn't
 * signed in (e.g. they got the push, signed out, then tapped).
 *
 * Fetches from the anonymous /api/campaigns/:slug endpoint. The
 * endpoint returns only title / body / poster_url / sent_at — the
 * audience filter + recipient counts + sender stay admin-only.
 */
interface CampaignResponse {
  ok: true
  campaign: {
    slug: string
    title: string
    body: string
    poster_url: string | null
    /** Slice 1.6 — optional URL the poster should open when clicked. */
    poster_link_url: string | null
    sent_at: string
  }
}

export default function CampaignDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const [data, setData] = useState<CampaignResponse['campaign'] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!slug) return
      try {
        const res = await fetch(`/api/campaigns/${slug}`)
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as
            | { error?: { code?: string; message?: string } }
            | undefined
          if (cancelled) return
          if (res.status === 404) {
            setError('This message has expired or was never sent.')
          } else {
            setError(body?.error?.message ?? `Failed to load (${res.status}).`)
          }
          return
        }
        const json = (await res.json()) as CampaignResponse
        if (cancelled) return
        setData(json.campaign)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Network error.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [slug])

  return (
    <div className="min-h-dvh bg-surface">
      <div className="mx-auto max-w-xl px-4 py-8">
        <Link to="/" className="text-xs text-text-secondary hover:text-text-primary">
          ← Back to Tago
        </Link>

        {loading && (
          <div
            data-testid="campaign-detail-loading"
            className="mt-12 text-center text-sm text-text-secondary"
          >
            Loading…
          </div>
        )}

        {error && !loading && (
          <div
            data-testid="campaign-detail-error"
            className="mt-12 rounded-2xl border border-border bg-white p-8 text-center"
          >
            <div className="text-sm font-semibold text-text-primary">
              Couldn't load the message
            </div>
            <p className="mt-1 text-xs text-text-secondary">{error}</p>
          </div>
        )}

        {data && (
          <article
            data-testid="campaign-detail"
            className="mt-6 overflow-hidden rounded-2xl border border-border bg-white"
          >
            {data.poster_url && (
              data.poster_link_url ? (
                <a
                  href={data.poster_link_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="campaign-detail-poster-link"
                  className="block"
                >
                  <img
                    src={data.poster_url}
                    alt=""
                    data-testid="campaign-detail-poster"
                    className="w-full object-cover"
                  />
                </a>
              ) : (
                <img
                  src={data.poster_url}
                  alt=""
                  data-testid="campaign-detail-poster"
                  className="w-full object-cover"
                />
              )
            )}
            <div className="p-6">
              <h1 className="text-2xl font-bold text-text-primary">{data.title}</h1>
              <div className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-text-primary">
                {data.body}
              </div>
              <div className="mt-6 text-[11px] text-text-secondary">
                Sent {new Date(data.sent_at).toLocaleString()}
              </div>
            </div>
          </article>
        )}
      </div>
    </div>
  )
}
