create table public.photo_edits (
  id uuid not null default gen_random_uuid (),
  storage_path text not null,
  user_id uuid not null,
  x double precision null default 0,
  y double precision null default 0,
  width double precision null default 400,
  height double precision null default 400,
  rotation double precision null default 0,
  scale_x double precision null default 1,
  scale_y double precision null default 1,
  exposure double precision null default 0,
  contrast double precision null default 0,
  highlights double precision null default 0,
  shadows double precision null default 0,
  whites double precision null default 0,
  blacks double precision null default 0,
  temperature double precision null default 0,
  vibrance double precision null default 0,
  saturation double precision null default 0,
  clarity double precision null default 0,
  dehaze double precision null default 0,
  vignette double precision null default 0,
  grain double precision null default 0,
  curves jsonb null default '{"red": [{"x": 0, "y": 0}, {"x": 255, "y": 255}], "rgb": [{"x": 0, "y": 0}, {"x": 255, "y": 255}], "blue": [{"x": 0, "y": 0}, {"x": 255, "y": 255}], "green": [{"x": 0, "y": 0}, {"x": 255, "y": 255}]}'::jsonb,
  brightness double precision null default 0,
  hue double precision null default 0,
  blur double precision null default 0,
  filters text[] null default '{}'::text[],
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  folder_id text null,
  texture double precision null default 0,
  shadow_tint double precision null default 0,
  color_hsl jsonb null,
  split_toning jsonb null,
  color_grading jsonb null,
  color_calibration jsonb null,
  grain_size double precision null default 0,
  grain_roughness double precision null default 0,
  original_storage_path text null,
  is_raw boolean null default false,
  original_width integer null,
  original_height integer null,
  taken_at timestamp with time zone null,
  camera_make text null,
  camera_model text null,
  labels text[] null default '{}'::text[],
  border_width integer null,
  border_color text null,
  owner_id uuid null,
  constraint photo_edits_pkey primary key (id),
  constraint photo_edits_storage_path_user_id_key unique (storage_path, user_id),
  constraint photo_edits_owner_id_fkey foreign KEY (owner_id) references auth.users (id) on delete CASCADE,
  constraint photo_edits_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_photo_edits_labels on public.photo_edits using gin (labels) TABLESPACE pg_default;

create index IF not exists idx_photo_edits_taken_at on public.photo_edits using btree (taken_at) TABLESPACE pg_default
where
  (taken_at is not null);

create index IF not exists idx_photo_edits_user_id on public.photo_edits using btree (user_id) TABLESPACE pg_default;

create index IF not exists idx_photo_edits_folder_user on public.photo_edits using btree (folder_id, user_id) TABLESPACE pg_default
where
  (folder_id is not null);

create index IF not exists idx_photo_edits_created_user on public.photo_edits using btree (created_at desc, user_id) TABLESPACE pg_default;

create index IF not exists idx_photo_edits_owner on public.photo_edits using btree (owner_id) TABLESPACE pg_default;
