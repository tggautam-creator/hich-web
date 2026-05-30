-- v1.3 marketing panel (2026-05-24) — Phase 3 image-gen + format-picker.
--
-- Extends marketing_poster_items with format + image fields +
-- founder steering inputs + theme angle, and creates the
-- marketing-posters storage bucket with public-read + admin-write
-- policies so generated PNGs can be served via a stable CDN URL.
--
-- All new columns nullable / defaulted so existing rows survive.
-- Idempotent via ADD COLUMN IF NOT EXISTS, ON CONFLICT, IF EXISTS
-- guards.

ALTER TABLE marketing_poster_items
  ADD COLUMN IF NOT EXISTS format TEXT NOT NULL DEFAULT 'ig_story'
    CHECK (format IN ('ig_story', 'ig_post', 'a4_sheet', 'custom')),
  ADD COLUMN IF NOT EXISTS image_prompt TEXT,
  ADD COLUMN IF NOT EXISTS caption TEXT,
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS image_generated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS image_model TEXT,
  ADD COLUMN IF NOT EXISTS founder_note TEXT,
  ADD COLUMN IF NOT EXISTS event_tag TEXT,
  ADD COLUMN IF NOT EXISTS feature_spotlight TEXT,
  ADD COLUMN IF NOT EXISTS theme_angle TEXT;

COMMENT ON COLUMN marketing_poster_items.format IS
  'Phase 3 — output aspect ratio. ig_story=9:16 (1080x1920), '
  'ig_post=1:1 (1080x1080), a4_sheet=8.5x11" (2550x3300 @ 300dpi), '
  'custom=free-text dimensions provided in founder_note.';

COMMENT ON COLUMN marketing_poster_items.image_prompt IS
  'Phase 3 — full Gemini/ChatGPT image-gen prompt (200-400 words). '
  'Brand-styled, ready to paste into Gemini/ChatGPT/Midjourney OR '
  'send to our /generate-image endpoint which calls '
  'gemini-2.5-flash-image directly.';

COMMENT ON COLUMN marketing_poster_items.caption IS
  'Phase 3 — Instagram FEED post caption (separate from headline/'
  'body which live ON the image). Empty for ig_story format.';

COMMENT ON COLUMN marketing_poster_items.image_url IS
  'Phase 3 — Supabase Storage public URL of the generated image. '
  'NULL until "Generate image" is clicked.';

COMMENT ON COLUMN marketing_poster_items.theme_angle IS
  'Phase 3 — angle slug from POSTER_ANGLES rotation. See '
  'server/lib/marketing/posterAngles.ts for the canonical list '
  '(currently: gas-reimbursement, trust-edu, break-week, '
  'split-cost, driver-keeps-100, verified-only, smart-matching, '
  'frictionless, campus-life, qr-scan). The list is authoritative; '
  'reorder/extend freely.';

-- ── Storage bucket ────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'marketing-posters',
  'marketing-posters',
  true,
  10485760,
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS marketing_posters_admin_write ON storage.objects;
CREATE POLICY marketing_posters_admin_write ON storage.objects
  FOR INSERT
  WITH CHECK (bucket_id = 'marketing-posters' AND fn_is_admin());

DROP POLICY IF EXISTS marketing_posters_admin_update ON storage.objects;
CREATE POLICY marketing_posters_admin_update ON storage.objects
  FOR UPDATE
  USING (bucket_id = 'marketing-posters' AND fn_is_admin())
  WITH CHECK (bucket_id = 'marketing-posters' AND fn_is_admin());

DROP POLICY IF EXISTS marketing_posters_admin_delete ON storage.objects;
CREATE POLICY marketing_posters_admin_delete ON storage.objects
  FOR DELETE
  USING (bucket_id = 'marketing-posters' AND fn_is_admin());

DROP POLICY IF EXISTS marketing_posters_public_read ON storage.objects;
CREATE POLICY marketing_posters_public_read ON storage.objects
  FOR SELECT
  USING (bucket_id = 'marketing-posters');
