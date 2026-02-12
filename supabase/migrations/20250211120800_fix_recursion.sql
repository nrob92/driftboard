-- Fix infinite recursion in RLS policies by using a security definer function

-- 1. Create a helper function to check membership securely (bypassing RLS on members table)
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

-- 2. Update collab_sessions policy to use the function
drop policy if exists "Users can view sessions they are members of" on public.collab_sessions;

create policy "Users can view sessions they are members of"
  on public.collab_sessions
  for select
  using (
    public.is_member_of_session(id)
  );

-- 3. Update collab_members policy to avoid recursion
-- We ensure the owner check is direct and doesn't trigger a session select policy loop if possible
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
