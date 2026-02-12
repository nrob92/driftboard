-- Fix recursive RLS policies on ALL collab tables
-- The infinite loop happens because tables refer to each other in policies
-- We will use the secure function 'public.is_member_of_session' everywhere instead of joins

-- 1. Ensure the function exists and is secure
create or replace function public.is_member_of_session(_session_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.collab_members
    where session_id = _session_id
    and user_id = auth.uid()
    and status = 'approved'
  );
$$;

-- 2. Fix collab_photos
drop policy if exists "Members can view photos" on public.collab_photos;
create policy "Members can view photos"
  on public.collab_photos
  for select
  using (
    public.is_member_of_session(session_id)
  );

drop policy if exists "Members can insert photos" on public.collab_photos;
create policy "Members can insert photos"
  on public.collab_photos
  for insert
  with check (
    public.is_member_of_session(session_id)
  );
  
drop policy if exists "Members can update photos" on public.collab_photos;
create policy "Members can update photos"
  on public.collab_photos
  for update
  using (
    public.is_member_of_session(session_id)
  );
  
drop policy if exists "Members can delete photos" on public.collab_photos;
create policy "Members can delete photos"
  on public.collab_photos
  for delete
  using (
    public.is_member_of_session(session_id)
  );

-- 3. Fix collab_folders
drop policy if exists "Members can view folders" on public.collab_folders;
create policy "Members can view folders"
  on public.collab_folders
  for select
  using (
    public.is_member_of_session(session_id)
  );
  
drop policy if exists "Members can insert folders" on public.collab_folders;
create policy "Members can insert folders"
  on public.collab_folders
  for insert
  with check (
    public.is_member_of_session(session_id)
  );
  
drop policy if exists "Members can update folders" on public.collab_folders;
create policy "Members can update folders"
  on public.collab_folders
  for update
  using (
    public.is_member_of_session(session_id)
  );

drop policy if exists "Members can delete folders" on public.collab_folders;
create policy "Members can delete folders"
  on public.collab_folders
  for delete
  using (
    public.is_member_of_session(session_id)
  );

-- 4. Fix collab_activity
drop policy if exists "Members can view activity" on public.collab_activity;
create policy "Members can view activity"
  on public.collab_activity
  for select
  using (
    public.is_member_of_session(session_id)
  );
  
drop policy if exists "Members can insert activity" on public.collab_activity;
create policy "Members can insert activity"
  on public.collab_activity
  for insert
  with check (
    public.is_member_of_session(session_id)
  );

-- 5. Fix collab_members (using simplified logic to avoid recursion)
drop policy if exists "Session owners can view all members" on public.collab_members;
create policy "Session owners can view all members"
  on public.collab_members
  for select
  using (
    exists (
      select 1 from public.collab_sessions
      where id = collab_members.session_id
      and owner_id = auth.uid()
    )
  );
  
drop policy if exists "Members can view other members in same session" on public.collab_members;
create policy "Members can view other members in same session"
  on public.collab_members
  for select
  using (
    -- If I am a member of this session (checked via function), I can see other members
    public.is_member_of_session(session_id)
  );

