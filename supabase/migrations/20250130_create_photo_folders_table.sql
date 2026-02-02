-- Create photo_folders table for organizing images into folders
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
  constraint photo_folders_pkey primary key (id),
  constraint photo_folders_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade
);

-- Enable Row Level Security
alter table photo_folders enable row level security;

-- Create policy to allow users to read their own folders
create policy "Users can view their own folders"
  on photo_folders
  for select
  using (auth.uid() = user_id);

-- Create policy to allow users to insert their own folders
create policy "Users can insert their own folders"
  on photo_folders
  for insert
  with check (auth.uid() = user_id);

-- Create policy to allow users to update their own folders
create policy "Users can update their own folders"
  on photo_folders
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Create policy to allow users to delete their own folders
create policy "Users can delete their own folders"
  on photo_folders
  for delete
  using (auth.uid() = user_id);
