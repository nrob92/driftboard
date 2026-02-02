-- Create photo_edits table for storing image positions and adjustments
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
  constraint photo_edits_pkey primary key (id),
  constraint photo_edits_storage_path_user_id_key unique (storage_path, user_id),
  constraint photo_edits_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade
);

-- Create trigger to auto-update updated_at
create trigger photo_edits_updated_at before update on photo_edits
  for each row execute function update_updated_at();

-- Enable Row Level Security
alter table photo_edits enable row level security;

-- Create policy to allow users to read their own photo edits
create policy "Users can view their own photo edits"
  on photo_edits
  for select
  using (auth.uid() = user_id);

-- Create policy to allow users to insert their own photo edits
create policy "Users can insert their own photo edits"
  on photo_edits
  for insert
  with check (auth.uid() = user_id);

-- Create policy to allow users to update their own photo edits
create policy "Users can update their own photo edits"
  on photo_edits
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Create policy to allow users to delete their own photo edits
create policy "Users can delete their own photo edits"
  on photo_edits
  for delete
  using (auth.uid() = user_id);
