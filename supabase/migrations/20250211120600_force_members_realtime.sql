-- Force Realtime for collab_members (was potentially missing from previous updates)

do $$
begin
  alter publication supabase_realtime add table public.collab_members;
exception when others then null;
end $$;
