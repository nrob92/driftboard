-- Add unique constraint to collab_photos to allow upsert by storage_path and session_id
-- This fixes the 400 Bad Request error when saving photo edits or positions in a session

alter table public.collab_photos
add constraint collab_photos_storage_path_session_key unique (storage_path, session_id);
