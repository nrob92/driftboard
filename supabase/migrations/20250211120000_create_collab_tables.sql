-- Create collaborative session tables with RLS policies
-- Tables are created first to avoid circular dependency issues in policies

-- =============================================================================
-- TYPE DEFINITIONS
-- =============================================================================

create type public.collab_member_status as enum ('pending', 'approved', 'rejected', 'removed');
create type public.collab_member_role as enum ('master', 'collaborator');

-- =============================================================================
-- COLLABORATIVE SESSIONS TABLE
-- =============================================================================

create table public.collab_sessions (
  id uuid not null default gen_random_uuid(),
  owner_id uuid not null,
  name text not null,
  invite_code text not null,
  max_collaborators integer not null default 4,
  is_active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint collab_sessions_pkey primary key (id),
  constraint collab_sessions_invite_code_key unique (invite_code),
  constraint collab_sessions_owner_id_fkey foreign key (owner_id) references auth.users(id) on delete cascade,
  constraint collab_sessions_max_collaborators_check check (max_collaborators > 0 and max_collaborators <= 10)
) tablespace pg_default;

-- =============================================================================
-- COLLAB MEMBERS TABLE (Approval workflow)
-- =============================================================================

create table public.collab_members (
  id uuid not null default gen_random_uuid(),
  session_id uuid not null,
  user_id uuid,
  role public.collab_member_role not null default 'collaborator',
  status public.collab_member_status not null default 'pending',
  invited_email text,
  approved_at timestamp with time zone,
  joined_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint collab_members_pkey primary key (id),
  constraint collab_members_session_user_unique unique (session_id, user_id),
  constraint collab_members_session_id_fkey foreign key (session_id) references public.collab_sessions(id) on delete cascade,
  constraint collab_members_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade,
  constraint collab_members_email_or_user check (
    (user_id is not null) or (invited_email is not null)
  )
) tablespace pg_default;

-- =============================================================================
-- COLLAB FOLDERS TABLE
-- =============================================================================

create table public.collab_folders (
  id text not null,
  session_id uuid not null,
  user_id uuid not null,
  name text not null,
  x double precision not null default 0,
  y double precision not null default 0,
  width double precision not null default 600,
  height double precision not null default 400,
  color text not null default '#3b82f6',
  type text not null default 'folder',
  page_count integer not null default 1,
  background_color text,
  duplicated_from_id text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint collab_folders_pkey primary key (id),
  constraint collab_folders_session_id_fkey foreign key (session_id) references public.collab_sessions(id) on delete cascade,
  constraint collab_folders_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade,
  constraint collab_folders_type_check check (type in ('folder', 'social_layout'))
) tablespace pg_default;

-- =============================================================================
-- COLLAB PHOTOS TABLE
-- =============================================================================

create table public.collab_photos (
  id uuid not null default gen_random_uuid(),
  session_id uuid not null,
  user_id uuid not null,
  storage_path text not null,
  thumbnail_path text,
  folder_id text,
  x double precision not null default 0,
  y double precision not null default 0,
  width double precision not null default 400,
  height double precision not null default 400,
  rotation double precision not null default 0,
  scale_x double precision not null default 1,
  scale_y double precision not null default 1,
  exposure double precision not null default 0,
  contrast double precision not null default 0,
  highlights double precision not null default 0,
  shadows double precision not null default 0,
  whites double precision not null default 0,
  blacks double precision not null default 0,
  temperature double precision not null default 0,
  vibrance double precision not null default 0,
  saturation double precision not null default 0,
  clarity double precision not null default 0,
  dehaze double precision not null default 0,
  vignette double precision not null default 0,
  grain double precision not null default 0,
  curves jsonb not null default '{"red": [{"x": 0, "y": 0}, {"x": 255, "y": 255}], "rgb": [{"x": 0, "y": 0}, {"x": 255, "y": 255}], "blue": [{"x": 0, "y": 0}, {"x": 255, "y": 255}], "green": [{"x": 0, "y": 0}, {"x": 255, "y": 255}]}'::jsonb,
  brightness double precision not null default 0,
  hue double precision not null default 0,
  blur double precision not null default 0,
  filters text[] not null default '{}'::text[],
  texture double precision not null default 0,
  shadow_tint double precision not null default 0,
  color_hsl jsonb,
  split_toning jsonb,
  color_grading jsonb,
  color_calibration jsonb,
  grain_size double precision not null default 0,
  grain_roughness double precision not null default 0,
  border_width integer,
  border_color text,
  is_raw boolean not null default false,
  original_storage_path text,
  original_width integer,
  original_height integer,
  taken_at timestamp with time zone,
  camera_make text,
  camera_model text,
  labels text[] not null default '{}'::text[],
  duplicated_from_id uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint collab_photos_pkey primary key (id),
  constraint collab_photos_session_id_fkey foreign key (session_id) references public.collab_sessions(id) on delete cascade,
  constraint collab_photos_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade,
  constraint collab_photos_folder_id_fkey foreign key (folder_id) references public.collab_folders(id) on delete set null,
  constraint collab_photos_duplicated_from_id_fkey foreign key (duplicated_from_id) references public.collab_photos(id) on delete set null
) tablespace pg_default;

-- =============================================================================
-- COLLAB CURSOR POSITIONS TABLE
-- =============================================================================

create table public.collab_cursor_positions (
  session_id uuid not null,
  user_id uuid not null,
  x double precision not null default 0,
  y double precision not null default 0,
  last_seen timestamp with time zone not null default now(),
  constraint collab_cursor_positions_pkey primary key (session_id, user_id),
  constraint collab_cursor_positions_session_id_fkey foreign key (session_id) references public.collab_sessions(id) on delete cascade,
  constraint collab_cursor_positions_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade
) tablespace pg_default;

-- =============================================================================
-- COLLAB ACTIVITY LOG TABLE
-- =============================================================================

create table public.collab_activity (
  id uuid not null default gen_random_uuid(),
  session_id uuid not null,
  user_id uuid not null,
  action text not null,
  target_type text,
  target_id text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  constraint collab_activity_pkey primary key (id),
  constraint collab_activity_session_id_fkey foreign key (session_id) references public.collab_sessions(id) on delete cascade,
  constraint collab_activity_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade
) tablespace pg_default;

-- =============================================================================
-- ENABLE RLS ON ALL TABLES
-- =============================================================================

alter table public.collab_sessions enable row level security;
alter table public.collab_members enable row level security;
alter table public.collab_folders enable row level security;
alter table public.collab_photos enable row level security;
alter table public.collab_cursor_positions enable row level security;
alter table public.collab_activity enable row level security;

-- =============================================================================
-- RLS POLICIES FOR collab_sessions
-- =============================================================================

create policy "Users can view their own sessions"
  on public.collab_sessions
  for select
  using (
    owner_id = auth.uid()
  );

create policy "Users can create their own sessions"
  on public.collab_sessions
  for insert
  with check (owner_id = auth.uid());

create policy "Owners can update their sessions"
  on public.collab_sessions
  for update
  using (owner_id = auth.uid());

create policy "Owners can delete their sessions"
  on public.collab_sessions
  for delete
  using (owner_id = auth.uid());

-- =============================================================================
-- RLS POLICIES FOR collab_members
-- =============================================================================

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

create policy "Users can view their own membership"
  on public.collab_members
  for select
  using (
    user_id = auth.uid()
  );

create policy "Approved members can view other approved members"
  on public.collab_members
  for select
  using (
    status = 'approved' and
    exists (
      select 1 from public.collab_members cm2
      where cm2.session_id = collab_members.session_id
      and cm2.user_id = auth.uid()
      and cm2.status = 'approved'
    )
  );

-- Master can be inserted via trigger (for session creation)
create policy "Master can be inserted via trigger"
  on public.collab_members
  for insert
  with check (
    role = 'master' and
    status = 'approved'
  );

create policy "Anyone can request to join sessions"
  on public.collab_members
  for insert
  with check (
    user_id = auth.uid() and
    status = 'pending' and
    role = 'collaborator'
  );

create policy "Masters can update member status"
  on public.collab_members
  for update
  using (
    exists (
      select 1 from public.collab_sessions
      where id = collab_members.session_id
      and owner_id = auth.uid()
    )
  );

create policy "Masters can delete members"
  on public.collab_members
  for delete
  using (
    exists (
      select 1 from public.collab_sessions
      where id = collab_members.session_id
      and owner_id = auth.uid()
    )
  );

create policy "Users can leave sessions"
  on public.collab_members
  for delete
  using (user_id = auth.uid());

-- =============================================================================
-- RLS POLICIES FOR collab_folders
-- =============================================================================

create policy "Session members can view all folders"
  on public.collab_folders
  for select
  using (
    exists (
      select 1 from public.collab_members
      where session_id = collab_folders.session_id
      and user_id = auth.uid()
      and status = 'approved'
    ) or
    exists (
      select 1 from public.collab_sessions
      where id = collab_folders.session_id
      and owner_id = auth.uid()
    )
  );

create policy "Users can create their own folders"
  on public.collab_folders
  for insert
  with check (
    user_id = auth.uid() and
    exists (
      select 1 from public.collab_members
      where session_id = collab_folders.session_id
      and user_id = auth.uid()
      and status = 'approved'
    )
  );

create policy "Users can update their own folders"
  on public.collab_folders
  for update
  using (user_id = auth.uid());

create policy "Users can delete their own folders"
  on public.collab_folders
  for delete
  using (user_id = auth.uid());

-- =============================================================================
-- RLS POLICIES FOR collab_photos
-- =============================================================================

create policy "Session members can view all photos"
  on public.collab_photos
  for select
  using (
    exists (
      select 1 from public.collab_members
      where session_id = collab_photos.session_id
      and user_id = auth.uid()
      and status = 'approved'
    ) or
    exists (
      select 1 from public.collab_sessions
      where id = collab_photos.session_id
      and owner_id = auth.uid()
    )
  );

create policy "Users can create their own photos"
  on public.collab_photos
  for insert
  with check (
    user_id = auth.uid() and
    exists (
      select 1 from public.collab_members
      where session_id = collab_photos.session_id
      and user_id = auth.uid()
      and status = 'approved'
    )
  );

create policy "Users can update their own photos"
  on public.collab_photos
  for update
  using (user_id = auth.uid());

create policy "Users can delete their own photos"
  on public.collab_photos
  for delete
  using (user_id = auth.uid());

-- =============================================================================
-- RLS POLICIES FOR collab_cursor_positions
-- =============================================================================

create policy "Session members can view cursor positions"
  on public.collab_cursor_positions
  for select
  using (
    exists (
      select 1 from public.collab_members
      where session_id = collab_cursor_positions.session_id
      and user_id = auth.uid()
      and status = 'approved'
    ) or
    exists (
      select 1 from public.collab_sessions
      where id = collab_cursor_positions.session_id
      and owner_id = auth.uid()
    )
  );

create policy "Users can update their own cursor"
  on public.collab_cursor_positions
  for insert
  with check (user_id = auth.uid());

create policy "Users can update their own cursor position"
  on public.collab_cursor_positions
  for update
  using (user_id = auth.uid());

create policy "Users can delete their own cursor"
  on public.collab_cursor_positions
  for delete
  using (user_id = auth.uid());

-- =============================================================================
-- RLS POLICIES FOR collab_activity
-- =============================================================================

create policy "Session members can view activity"
  on public.collab_activity
  for select
  using (
    exists (
      select 1 from public.collab_members
      where session_id = collab_activity.session_id
      and user_id = auth.uid()
      and status = 'approved'
    ) or
    exists (
      select 1 from public.collab_sessions
      where id = collab_activity.session_id
      and owner_id = auth.uid()
    )
  );

create policy "Users can create activity entries"
  on public.collab_activity
  for insert
  with check (user_id = auth.uid());

-- =============================================================================
-- INDEXES
-- =============================================================================

create index idx_collab_sessions_owner on public.collab_sessions using btree (owner_id);
create index idx_collab_sessions_invite_code on public.collab_sessions using btree (invite_code);
create index idx_collab_sessions_is_active on public.collab_sessions using btree (is_active);

create index idx_collab_members_session on public.collab_members using btree (session_id);
create index idx_collab_members_user on public.collab_members using btree (user_id);
create index idx_collab_members_status on public.collab_members using btree (status);
create index idx_collab_members_session_status on public.collab_members using btree (session_id, status);

create index idx_collab_folders_session on public.collab_folders using btree (session_id);
create index idx_collab_folders_user on public.collab_folders using btree (user_id);
create index idx_collab_folders_session_user on public.collab_folders using btree (session_id, user_id);

create index idx_collab_photos_session on public.collab_photos using btree (session_id);
create index idx_collab_photos_user on public.collab_photos using btree (user_id);
create index idx_collab_photos_session_user on public.collab_photos using btree (session_id, user_id);
create index idx_collab_photos_folder on public.collab_photos using btree (folder_id) where folder_id is not null;
create index idx_collab_photos_created on public.collab_photos using btree (created_at desc);
create index idx_collab_photos_labels on public.collab_photos using gin (labels);

create index idx_collab_cursor_session on public.collab_cursor_positions using btree (session_id);
create index idx_collab_cursor_last_seen on public.collab_cursor_positions using btree (last_seen);

create index idx_collab_activity_session on public.collab_activity using btree (session_id);
create index idx_collab_activity_created on public.collab_activity using btree (created_at desc);
create index idx_collab_activity_session_created on public.collab_activity using btree (session_id, created_at desc);

-- =============================================================================
-- FUNCTIONS AND TRIGGERS
-- =============================================================================

create or replace function public.update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

CREATE TRIGGER update_collab_sessions_updated_at
  BEFORE UPDATE ON public.collab_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_collab_members_updated_at
  BEFORE UPDATE ON public.collab_members
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_collab_folders_updated_at
  BEFORE UPDATE ON public.collab_folders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_collab_photos_updated_at
  BEFORE UPDATE ON public.collab_photos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

create or replace function public.generate_invite_code()
returns text as $$
begin
  return upper(substring(md5(random()::text), 1, 8));
end;
$$ language plpgsql;

create or replace function public.set_invite_code()
returns trigger as $$
begin
  if new.invite_code is null or new.invite_code = '' then
    new.invite_code := public.generate_invite_code();
  end if;
  return new;
end;
$$ language plpgsql;

CREATE TRIGGER set_collab_session_invite_code
  BEFORE INSERT ON public.collab_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_invite_code();

create or replace function public.add_master_as_member()
returns trigger as $$
begin
  insert into public.collab_members (session_id, user_id, role, status, approved_at, joined_at)
  values (new.id, new.owner_id, 'master', 'approved', now(), now());
  return new;
end;
$$ language plpgsql;

CREATE TRIGGER add_master_member_on_session_create
  AFTER INSERT ON public.collab_sessions
  FOR EACH ROW EXECUTE FUNCTION public.add_master_as_member();

create or replace function public.check_max_collaborators()
returns trigger as $$
declare
  current_count integer;
  max_allowed integer;
begin
  if new.status = 'approved' and old.status = 'pending' then
    select max_collaborators into max_allowed
    from public.collab_sessions
    where id = new.session_id;
    
    select count(*) into current_count
    from public.collab_members
    where session_id = new.session_id
    and status = 'approved';
    
    if current_count >= max_allowed then
      raise exception 'Session has reached maximum number of collaborators';
    end if;
    
    new.approved_at := now();
    new.joined_at := now();
  end if;
  
  return new;
end;
$$ language plpgsql;

CREATE TRIGGER check_max_collaborators_on_approve
  BEFORE UPDATE ON public.collab_members
  FOR EACH ROW EXECUTE FUNCTION public.check_max_collaborators();

create or replace function public.cleanup_old_cursor_positions()
returns void as $$
begin
  delete from public.collab_cursor_positions
  where last_seen < now() - interval '5 minutes';
end;
$$ language plpgsql;

-- =============================================================================
-- REALTIME CONFIGURATION
-- =============================================================================

alter publication supabase_realtime add table public.collab_photos;
alter publication supabase_realtime add table public.collab_folders;
alter publication supabase_realtime add table public.collab_members;
alter publication supabase_realtime add table public.collab_cursor_positions;
alter publication supabase_realtime add table public.collab_activity;
