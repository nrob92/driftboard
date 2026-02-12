-- Create storage buckets for user photos
-- Run this to set up storage for personal photos

-- =============================================================================
-- PHOTOS BUCKET (Public)
-- =============================================================================

insert into storage.buckets (id, name, public, avif_autodetection, file_size_limit, allowed_mime_types)
values (
  'photos',
  'photos',
  true,
  false,
  52428800, -- 50MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/dng', 'image/x-adobe-dng']::text[]
)
on conflict (id) do nothing;

-- =============================================================================
-- ORIGINALS BUCKET (Private)
-- =============================================================================

insert into storage.buckets (id, name, public, avif_autodetection, file_size_limit, allowed_mime_types)
values (
  'originals',
  'originals',
  false, -- Private, requires signed URLs
  false,
  104857600, -- 100MB for RAW files
  array['image/x-adobe-dng', 'image/dng', 'image/tiff']::text[]
)
on conflict (id) do nothing;

-- =============================================================================
-- STORAGE POLICIES
-- =============================================================================

-- PHOTOS BUCKET POLICIES

create policy "Users can upload their own photos"
  on storage.objects
  for insert
  with check (
    bucket_id = 'photos' and
    (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can update their own photos"
  on storage.objects
  for update
  using (
    bucket_id = 'photos' and
    owner = auth.uid()
  );

create policy "Users can delete their own photos"
  on storage.objects
  for delete
  using (
    bucket_id = 'photos' and
    owner = auth.uid()
  );

create policy "Users can view their own photos"
  on storage.objects
  for select
  using (
    bucket_id = 'photos' and
    (storage.foldername(name))[1] = auth.uid()::text
  );

-- ORIGINALS BUCKET POLICIES

create policy "Users can upload their own originals"
  on storage.objects
  for insert
  with check (
    bucket_id = 'originals' and
    (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can update their own originals"
  on storage.objects
  for update
  using (
    bucket_id = 'originals' and
    owner = auth.uid()
  );

create policy "Users can delete their own originals"
  on storage.objects
  for delete
  using (
    bucket_id = 'originals' and
    owner = auth.uid()
  );

create policy "Users can view their own originals"
  on storage.objects
  for select
  using (
    bucket_id = 'originals' and
    (storage.foldername(name))[1] = auth.uid()::text
  );

-- =============================================================================
-- REALTIME SUBSCRIPTIONS
-- =============================================================================

alter publication supabase_realtime add table public.collab_sessions;
alter publication supabase_realtime add table public.photo_edits;
alter publication supabase_realtime add table public.photo_folders;
alter publication supabase_realtime add table public.presets;

-- =============================================================================
-- RLS FIX FOR COLLABORATORS
-- =============================================================================

create policy "Users can view sessions they are members of"
  on public.collab_sessions
  for select
  using (
    exists (
      select 1 from public.collab_members
      where session_id = collab_sessions.id
      and user_id = auth.uid()
      and status = 'approved'
    )
  );
