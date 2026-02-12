-- Ensure Realtime publication exists and has tables
-- This migration uses specific logic to avoid errors if already added

do $$
declare
  pub_exists boolean;
begin
  select exists(select 1 from pg_publication where pubname = 'supabase_realtime') into pub_exists;
  
  if not pub_exists then
    create publication supabase_realtime;
  end if;
end $$;

-- Add collab_members
do $$
begin
  alter publication supabase_realtime add table public.collab_members;
exception when others then null; -- Ignore if already exists
end $$;

-- Add collab_sessions
do $$
begin
  alter publication supabase_realtime add table public.collab_sessions;
exception when others then null;
end $$;

-- Add photo_edits
do $$
begin
  alter publication supabase_realtime add table public.photo_edits;
exception when others then null;
end $$;

-- Add photo_folders
do $$
begin
  alter publication supabase_realtime add table public.photo_folders;
exception when others then null;
end $$;

-- Add presets
do $$
begin
  alter publication supabase_realtime add table public.presets;
exception when others then null;
end $$;

-- Force Replica Identity for members to ensure updates are broadcast correctly
alter table public.collab_members replica identity full;
