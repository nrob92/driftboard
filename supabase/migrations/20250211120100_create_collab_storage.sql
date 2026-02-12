-- Create storage bucket for collaborative photos
-- Run this after the main migration to set up storage

-- =============================================================================
-- STORAGE BUCKET SETUP
-- =============================================================================

-- Create the collab-photos bucket
insert into storage.buckets (id, name, public, avif_autodetection, file_size_limit, allowed_mime_types)
values (
  'collab-photos',
  'collab-photos',
  true,
  false,
  52428800, -- 50MB in bytes
  array['image/jpeg', 'image/png', 'image/webp', 'image/dng', 'image/x-adobe-dng']::text[]
)
on conflict (id) do nothing;

-- =============================================================================
-- STORAGE POLICIES (simplified to avoid circular references)
-- =============================================================================

-- Policy: Users can view any file in collab-photos (since bucket is public)
-- No specific policy needed for select as bucket is public

-- Policy: Users can upload to their own session folders
create policy "Users can upload to their session folders"
  on storage.objects
  for insert
  with check (
    bucket_id = 'collab-photos' and
    (storage.foldername(name))[1] in (
      select cm.session_id::text
      from public.collab_members cm
      where cm.user_id = auth.uid()
      and cm.status = 'approved'
    )
  );

-- Policy: Users can update their own files
create policy "Users can update their own files"
  on storage.objects
  for update
  using (
    bucket_id = 'collab-photos' and
    owner = auth.uid()
  );

-- Policy: Users can delete their own files
create policy "Users can delete their own files"
  on storage.objects
  for delete
  using (
    bucket_id = 'collab-photos' and
    owner = auth.uid()
  );

-- Policy: Session members can view all files (redundant for public bucket but good for consistency)
create policy "Session members can view files"
  on storage.objects
  for select
  using (
    bucket_id = 'collab-photos' and
    (storage.foldername(name))[1] in (
      select cm.session_id::text
      from public.collab_members cm
      where cm.user_id = auth.uid()
      and cm.status = 'approved'
    )
  );