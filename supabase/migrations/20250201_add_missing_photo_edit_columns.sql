-- Add missing columns to photo_edits table for new editing features

-- Texture adjustment
ALTER TABLE public.photo_edits ADD COLUMN IF NOT EXISTS texture double precision null default 0;

-- Shadow tint (green/magenta tint in shadows)
ALTER TABLE public.photo_edits ADD COLUMN IF NOT EXISTS shadow_tint double precision null default 0;

-- HSL per-color adjustments (stored as JSONB)
ALTER TABLE public.photo_edits ADD COLUMN IF NOT EXISTS color_hsl jsonb null;

-- Split toning settings
ALTER TABLE public.photo_edits ADD COLUMN IF NOT EXISTS split_toning jsonb null;

-- Color grading settings
ALTER TABLE public.photo_edits ADD COLUMN IF NOT EXISTS color_grading jsonb null;

-- Color calibration settings
ALTER TABLE public.photo_edits ADD COLUMN IF NOT EXISTS color_calibration jsonb null;

-- Grain size and roughness
ALTER TABLE public.photo_edits ADD COLUMN IF NOT EXISTS grain_size double precision null default 0;
ALTER TABLE public.photo_edits ADD COLUMN IF NOT EXISTS grain_roughness double precision null default 0;
