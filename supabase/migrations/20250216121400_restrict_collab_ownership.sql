-- Restrict collab_photos and collab_folders UPDATE/DELETE to:
--   (a) the item's own creator (user_id = auth.uid()), OR
--   (b) the session owner/master
--
-- Previously, any approved member could update/delete any content in the session.
-- This migration adds ownership enforcement at the DB level (defense in depth).
-- The session owner check uses collab_sessions directly (no recursion risk).

-- === PHOTOS ===

drop policy if exists "Members can update photos" on public.collab_photos;
drop policy if exists "Members can delete photos" on public.collab_photos;

create policy "Own or master can update photos" on public.collab_photos
  for update using (
    user_id = auth.uid()
    or session_id in (
      select id from public.collab_sessions where owner_id = auth.uid()
    )
  );

create policy "Own or master can delete photos" on public.collab_photos
  for delete using (
    user_id = auth.uid()
    or session_id in (
      select id from public.collab_sessions where owner_id = auth.uid()
    )
  );

-- === FOLDERS ===

drop policy if exists "Members can update folders" on public.collab_folders;
drop policy if exists "Members can delete folders" on public.collab_folders;

create policy "Own or master can update folders" on public.collab_folders
  for update using (
    user_id = auth.uid()
    or session_id in (
      select id from public.collab_sessions where owner_id = auth.uid()
    )
  );

create policy "Own or master can delete folders" on public.collab_folders
  for delete using (
    user_id = auth.uid()
    or session_id in (
      select id from public.collab_sessions where owner_id = auth.uid()
    )
  );
