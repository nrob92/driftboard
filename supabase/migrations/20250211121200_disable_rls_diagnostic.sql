-- Disable RLS on collab tables to verify if 500 errors are RLS-related or Usage-related
-- This is a diagnostic step

alter table public.collab_sessions disable row level security;
alter table public.collab_members disable row level security;
alter table public.collab_photos disable row level security;
alter table public.collab_folders disable row level security;
alter table public.collab_activity disable row level security;

-- Also add a "Public Access" policy just in case (though RLS is disabled)
drop policy if exists "Temp bypass" on public.collab_sessions;
create policy "Temp bypass" on public.collab_sessions for select using (true);
