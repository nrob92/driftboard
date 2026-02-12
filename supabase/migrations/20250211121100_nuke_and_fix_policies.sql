-- DEFINITIVE FIX FOR RECURSION
-- 1. Drop functions with CASCADE to remove all dependent policies automatically
drop function if exists public.is_member_of_session_secure(_session_id uuid) cascade;
drop function if exists public.is_member_of_session(_session_id uuid) cascade;

-- 2. Re-create the secure function with search_path set for security
create or replace function public.is_member_of_session_secure(_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  -- This query runs as database owner, BYPASSING RLS on collab_members
  return exists (
    select 1 from public.collab_members
    where session_id = _session_id
    and user_id = auth.uid()
    and status = 'approved'
  );
end;
$$;

-- Grant execute permission
grant execute on function public.is_member_of_session_secure to authenticated;
grant execute on function public.is_member_of_session_secure to service_role;

-- 3. Re-apply Policies (The cascade dropped them, so we must recreate ALL)

-- === SESSIONS ===
create policy "Owner can do everything" on public.collab_sessions
  for all using (owner_id = auth.uid());

create policy "Members can view sessions" on public.collab_sessions
  for select using (public.is_member_of_session_secure(id));

-- === MEMBERS ===
create policy "Users can see their own membership" on public.collab_members
  for select using (user_id = auth.uid());

create policy "Owners can see session members" on public.collab_members
  for select using (
    exists (
      select 1 from public.collab_sessions
      where id = collab_members.session_id
      and owner_id = auth.uid()
    )
  );

create policy "Members can see other members" on public.collab_members
  for select using (public.is_member_of_session_secure(session_id));

create policy "Users can join (insert)" on public.collab_members
  for insert with check (user_id = auth.uid());

-- === PHOTOS ===
create policy "Members can view photos" on public.collab_photos
  for select using (public.is_member_of_session_secure(session_id));

create policy "Members can insert photos" on public.collab_photos
  for insert with check (public.is_member_of_session_secure(session_id));
  
create policy "Members can update photos" on public.collab_photos
  for update using (public.is_member_of_session_secure(session_id));
  
create policy "Members can delete photos" on public.collab_photos
  for delete using (public.is_member_of_session_secure(session_id));

-- === FOLDERS ===
create policy "Members can view folders" on public.collab_folders
  for select using (public.is_member_of_session_secure(session_id));
  
create policy "Members can insert folders" on public.collab_folders
  for insert with check (public.is_member_of_session_secure(session_id));
  
create policy "Members can update folders" on public.collab_folders
  for update using (public.is_member_of_session_secure(session_id));

create policy "Members can delete folders" on public.collab_folders
  for delete using (public.is_member_of_session_secure(session_id));

-- === ACTIVITY ===
create policy "Members can view activity" on public.collab_activity
  for select using (public.is_member_of_session_secure(session_id));
  
create policy "Members can insert activity" on public.collab_activity
  for insert with check (public.is_member_of_session_secure(session_id));
