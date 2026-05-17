-- 077_campaigns_and_posters.sql
--
-- Campaign-history table + storage bucket for marketing posters
-- (Phase 1, Slice 1.4b of the admin panel).
--
-- 1. `public.campaigns` — one row per broadcast push, with:
--      * slug              short URL-friendly id for /c/:slug
--      * audience          jsonb snapshot of the audience descriptor
--                          (mirrors what was sent to the server)
--      * title / body      what was pushed
--      * poster_url        optional public URL of the marketing poster
--                          (uploaded to the campaign-posters bucket
--                          below). NULL = text-only campaign.
--      * recipient_count   users matched by the audience filter at send time
--      * push_sent_count   subset of recipients whose push actually delivered
--      * sent_by           admin user who fired it
--      * sent_at           when the broadcast went out
--      * created_at        row created
--
--    The slug is short + URL-friendly so a tap on the notification can
--    deep-link to /c/<slug> without leaking a UUID. We generate it
--    server-side from a random alphabet to avoid collisions.
--
--    RLS: service-role only for writes; PUBLIC read so the
--    /api/campaigns/:slug endpoint (which doesn't require auth) can
--    resolve a campaign for the marketing surface. We expose only the
--    title / body / poster_url / sent_at fields on that endpoint —
--    the audience filter + counts stay admin-only via a separate
--    /api/admin/campaigns route.
--
-- 2. `campaign-posters` storage bucket — public read, admin write.
--    Public read so marketing pages + push banners can render the
--    image. Admin write so only signed-in admins can upload (the RLS
--    policy on storage.objects checks public.users.is_admin via the
--    JWT's auth.uid()).

-- ── campaigns table ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.campaigns (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              TEXT NOT NULL UNIQUE,
  audience          JSONB NOT NULL,
  title             TEXT NOT NULL,
  body              TEXT NOT NULL,
  poster_url        TEXT,
  recipient_count   INTEGER NOT NULL DEFAULT 0,
  push_sent_count   INTEGER NOT NULL DEFAULT 0,
  sent_by           UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  sent_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.campaigns IS
  'One row per admin broadcast push (Slice 1.4b). Public-read slug so /c/:slug works without auth. See migration 077 + ADMIN_PLAN.md.';

CREATE INDEX IF NOT EXISTS idx_campaigns_sent_by_sent_at
  ON public.campaigns (sent_by, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_campaigns_sent_at
  ON public.campaigns (sent_at DESC);

ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

-- Public SELECT — anyone with the slug can resolve title/body/poster_url
-- via /api/campaigns/:slug. Reasonable because marketing pages should
-- be shareable.
DROP POLICY IF EXISTS campaigns_public_select ON public.campaigns;
CREATE POLICY campaigns_public_select
  ON public.campaigns
  FOR SELECT
  USING (true);

-- Writes are service-role only — admin panel uses supabaseAdmin
-- which bypasses RLS entirely. No INSERT / UPDATE / DELETE policies
-- granted to authenticated/anon roles.

-- ── campaign-posters storage bucket ───────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'campaign-posters',
  'campaign-posters',
  true,
  2 * 1024 * 1024,  -- 2 MB cap per object — posters are marketing assets, not photos
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Storage policies live on storage.objects.
--
-- Public SELECT — the bucket itself is public=true (above), so anyone
-- with the URL can fetch the file. We still add the SELECT policy
-- explicitly because Supabase's bucket public flag and storage.objects
-- RLS interact subtly: the policy lets supabase.storage.from(...).getPublicUrl()
-- responses serve OK without the caller holding a JWT.
DROP POLICY IF EXISTS campaign_posters_public_select ON storage.objects;
CREATE POLICY campaign_posters_public_select
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'campaign-posters');

-- Admin-only INSERT (upload) — auth.uid() must map to a public.users
-- row with is_admin=true.
DROP POLICY IF EXISTS campaign_posters_admin_insert ON storage.objects;
CREATE POLICY campaign_posters_admin_insert
  ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'campaign-posters'
    AND EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND is_admin = true
    )
  );

-- Admin-only DELETE — same check, so admins can clean up unused
-- posters from the storage bucket.
DROP POLICY IF EXISTS campaign_posters_admin_delete ON storage.objects;
CREATE POLICY campaign_posters_admin_delete
  ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'campaign-posters'
    AND EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND is_admin = true
    )
  );
