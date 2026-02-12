-- Force Realtime Subscriptions for missing tables
-- This migration fixes the "up to date" issue by being a new file

do $$
begin
  alter publication supabase_realtime add table public.collab_sessions;
exception when others then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.photo_edits;
exception when others then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.photo_folders;
exception when others then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.presets;
exception when others then null;
end $$;

-- Fix RLS for sessions (drop first to avoid conflict)
drop policy if exists "Users can view sessions they are members of" on public.collab_sessions;

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
