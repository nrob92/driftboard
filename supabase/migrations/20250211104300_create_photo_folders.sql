create table public.photo_folders (
  id text not null,
  user_id uuid not null,
  name text not null,
  x double precision null default 100,
  y double precision null default 100,
  color text null default '#3ECF8E'::text,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  width integer null default 500,
  height numeric null,
  type text null default 'folder'::text,
  page_count integer null,
  background_color text null,
  owner_id uuid null,
  constraint photo_folders_pkey primary key (id),
  constraint photo_folders_owner_id_fkey foreign KEY (owner_id) references auth.users (id) on delete CASCADE,
  constraint photo_folders_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_photo_folders_user_id on public.photo_folders using btree (user_id) TABLESPACE pg_default;

create index IF not exists idx_photo_folders_user_created on public.photo_folders using btree (user_id, created_at desc) TABLESPACE pg_default;

create index IF not exists idx_photo_folders_owner on public.photo_folders using btree (owner_id) TABLESPACE pg_default;

create trigger photo_folders_delete_cascade_photo_edits
after DELETE on photo_folders for EACH row
execute FUNCTION delete_photo_edits_on_folder_delete ();
