-- Tighten collab_photos UPDATE/DELETE to own photos only.
-- Master previously had a bypass; this removes it so only the original uploader
-- can modify or delete their own photos. Folders keep the master exception.

-- === PHOTOS: own only (no master bypass) ===

drop policy if exists "Own or master can update photos" on public.collab_photos;
drop policy if exists "Own or master can delete photos" on public.collab_photos;
-- Also clean up the folder-owner policy added earlier (now reverted)
drop policy if exists "Folder owner can update photos in their folder" on public.collab_photos;
drop policy if exists "Folder owner can delete photos in their folder" on public.collab_photos;

create policy "Own only can update photos" on public.collab_photos
  for update using (
    user_id = auth.uid()
  );

create policy "Own only can delete photos" on public.collab_photos
  for delete using (
    user_id = auth.uid()
  );
