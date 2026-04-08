-- 040_storage_buckets_and_policies.sql
-- Creates required Supabase Storage buckets and RLS policies for media uploads.
-- Buckets expected by frontend:
--   - avatars (public)
--   - car-photos (public)
--   - license-photos (private)

-- ── Buckets ────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values
  ('avatars', 'avatars', true),
  ('car-photos', 'car-photos', true),
  ('license-photos', 'license-photos', false)
on conflict (id) do nothing;

-- ── AVATARS policies ───────────────────────────────────────────────────────
drop policy if exists "avatars public read" on storage.objects;
create policy "avatars public read"
  on storage.objects for select
  to public
  using (bucket_id = 'avatars');

drop policy if exists "avatars insert own" on storage.objects;
create policy "avatars insert own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (
      split_part(name, '/', 1) = auth.uid()::text
      or name like auth.uid()::text || '-%'
      or name like auth.uid()::text || '.%'
    )
  );

drop policy if exists "avatars update own" on storage.objects;
create policy "avatars update own"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (
      split_part(name, '/', 1) = auth.uid()::text
      or name like auth.uid()::text || '-%'
      or name like auth.uid()::text || '.%'
    )
  )
  with check (
    bucket_id = 'avatars'
    and (
      split_part(name, '/', 1) = auth.uid()::text
      or name like auth.uid()::text || '-%'
      or name like auth.uid()::text || '.%'
    )
  );

drop policy if exists "avatars delete own" on storage.objects;
create policy "avatars delete own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (
      split_part(name, '/', 1) = auth.uid()::text
      or name like auth.uid()::text || '-%'
      or name like auth.uid()::text || '.%'
    )
  );

-- ── CAR PHOTOS policies ────────────────────────────────────────────────────
drop policy if exists "car photos public read" on storage.objects;
create policy "car photos public read"
  on storage.objects for select
  to public
  using (bucket_id = 'car-photos');

drop policy if exists "car photos insert own" on storage.objects;
create policy "car photos insert own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'car-photos'
    and (
      split_part(name, '/', 1) = auth.uid()::text
      or name like auth.uid()::text || '-%'
      or name like auth.uid()::text || '.%'
    )
  );

drop policy if exists "car photos update own" on storage.objects;
create policy "car photos update own"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'car-photos'
    and (
      split_part(name, '/', 1) = auth.uid()::text
      or name like auth.uid()::text || '-%'
      or name like auth.uid()::text || '.%'
    )
  )
  with check (
    bucket_id = 'car-photos'
    and (
      split_part(name, '/', 1) = auth.uid()::text
      or name like auth.uid()::text || '-%'
      or name like auth.uid()::text || '.%'
    )
  );

drop policy if exists "car photos delete own" on storage.objects;
create policy "car photos delete own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'car-photos'
    and (
      split_part(name, '/', 1) = auth.uid()::text
      or name like auth.uid()::text || '-%'
      or name like auth.uid()::text || '.%'
    )
  );

-- ── LICENSE PHOTOS policies (private bucket) ──────────────────────────────
drop policy if exists "license photos select own" on storage.objects;
create policy "license photos select own"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'license-photos'
    and (
      split_part(name, '/', 1) = auth.uid()::text
      or name like auth.uid()::text || '-%'
      or name like auth.uid()::text || '.%'
    )
  );

drop policy if exists "license photos insert own" on storage.objects;
create policy "license photos insert own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'license-photos'
    and (
      split_part(name, '/', 1) = auth.uid()::text
      or name like auth.uid()::text || '-%'
      or name like auth.uid()::text || '.%'
    )
  );

drop policy if exists "license photos update own" on storage.objects;
create policy "license photos update own"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'license-photos'
    and (
      split_part(name, '/', 1) = auth.uid()::text
      or name like auth.uid()::text || '-%'
      or name like auth.uid()::text || '.%'
    )
  )
  with check (
    bucket_id = 'license-photos'
    and (
      split_part(name, '/', 1) = auth.uid()::text
      or name like auth.uid()::text || '-%'
      or name like auth.uid()::text || '.%'
    )
  );

drop policy if exists "license photos delete own" on storage.objects;
create policy "license photos delete own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'license-photos'
    and (
      split_part(name, '/', 1) = auth.uid()::text
      or name like auth.uid()::text || '-%'
      or name like auth.uid()::text || '.%'
    )
  );
