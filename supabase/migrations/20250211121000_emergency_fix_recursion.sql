-- Emergency Fix: Simplify RLS to absolute basics to break all recursion
-- The function approach might still be recursing if it queries collab_members which queries something else

-- 1. Redefine function to use SECURITY DEFINER and raw SQL (bypassing all RLS)
create or replace function public.is_member_of_session_secure(_session_id uuid)
returns boolean
language plpgsql
security definer
stable
as $$
begin
  -- Directly query the table, bypassing RLS because of security definer
  return exists (
    select 1 from public.collab_members
    where session_id = _session_id
    and user_id = auth.uid()
    and status = 'approved'
  );
end;
$$;

-- 2. Apply this secure function to ALL relevant tables
-- COLLAB PHOTOS
drop policy if exists "Members can view photos" on public.collab_photos;
create policy "Members can view photos" on public.collab_photos for select using (public.is_member_of_session_secure(session_id));

drop policy if exists "Members can insert photos" on public.collab_photos;
create policy "Members can insert photos" on public.collab_photos for insert with check (public.is_member_of_session_secure(session_id));
  
drop policy if exists "Members can update photos" on public.collab_photos;
create policy "Members can update photos" on public.collab_photos for update using (public.is_member_of_session_secure(session_id));
  
drop policy if exists "Members can delete photos" on public.collab_photos;
create policy "Members can delete photos" on public.collab_photos for delete using (public.is_member_of_session_secure(session_id));

-- COLLAB FOLDERS
drop policy if exists "Members can view folders" on public.collab_folders;
create policy "Members can view folders" on public.collab_folders for select using (public.is_member_of_session_secure(session_id));
  
drop policy if exists "Members can insert folders" on public.collab_folders;
create policy "Members can insert folders" on public.collab_folders for insert with check (public.is_member_of_session_secure(session_id));
  
drop policy if exists "Members can update folders" on public.collab_folders;
create policy "Members can update folders" on public.collab_folders for update using (public.is_member_of_session_secure(session_id));

drop policy if exists "Members can delete folders" on public.collab_folders;
create policy "Members can delete folders" on public.collab_folders for delete using (public.is_member_of_session_secure(session_id));

-- COLLAB ACTIVITY
drop policy if exists "Members can view activity" on public.collab_activity;
create policy "Members can view activity" on public.collab_activity for select using (public.is_member_of_session_secure(session_id));
  
drop policy if exists "Members can insert activity" on public.collab_activity;
create policy "Members can insert activity" on public.collab_activity for insert with check (public.is_member_of_session_secure(session_id));

-- COLLAB MEMBERS (CRITICAL: Fix recursion here)
-- Instead of checking "is member of session", allow users to see rows where THEY are the user_id
drop policy if exists "Users can view their own membership" on public.collab_members;
create policy "Users can view their own membership"
  on public.collab_members
  for select
  using (
    user_id = auth.uid()
  );

-- Allow users to see OTHER members if they share a session
-- This is where recursion often happens. We use the secure function which bypasses RLS.
drop policy if exists "Members can view other members in same session" on public.collab_members;
create policy "Members can view other members in same session"
  on public.collab_members
  for select
  using (
    public.is_member_of_session_secure(session_id)
  );

-- COLLAB SESSIONS
drop policy if exists "Users can view sessions they are members of" on public.collab_sessions;
create policy "Users can view sessions they are members of"
  on public.collab_sessions
  for select
  using (
    public.is_member_of_session_secure(id)
  );
