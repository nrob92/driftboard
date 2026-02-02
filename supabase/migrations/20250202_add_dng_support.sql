-- Add columns for DNG/RAW file support
-- Tracks original file path and dimensions for full-resolution export

ALTER TABLE public.photo_edits
  ADD COLUMN IF NOT EXISTS original_storage_path text null,
  ADD COLUMN IF NOT EXISTS is_raw boolean default false,
  ADD COLUMN IF NOT EXISTS original_width integer null,
  ADD COLUMN IF NOT EXISTS original_height integer null;

-- Add comment for documentation
COMMENT ON COLUMN public.photo_edits.original_storage_path IS 'Path to original DNG/RAW file in originals bucket';
COMMENT ON COLUMN public.photo_edits.is_raw IS 'True if this is a RAW/DNG file';
COMMENT ON COLUMN public.photo_edits.original_width IS 'Full resolution width of original file';
COMMENT ON COLUMN public.photo_edits.original_height IS 'Full resolution height of original file';
