create table public.presets (
  id uuid not null default gen_random_uuid (),
  user_id uuid not null,
  name text not null,
  settings jsonb not null,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  constraint presets_pkey primary key (id),
  constraint presets_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_presets_user_id on public.presets using btree (user_id) TABLESPACE pg_default;

create index IF not exists idx_presets_created_at on public.presets using btree (created_at desc) TABLESPACE pg_default;

create index IF not exists idx_presets_name on public.presets using btree (name) TABLESPACE pg_default;

create trigger update_presets_updated_at BEFORE
update on presets for EACH row
execute FUNCTION update_updated_at_column ();
