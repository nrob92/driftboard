-- Storage RLS policies for 'originals' bucket
-- Paths are: {user_id}/{timestamp}-{id}-original.dng
-- Service role bypasses RLS; these policies apply when using anon key with user JWT.

-- Allow authenticated users to upload to their own folder (first path segment = auth.uid())
CREATE POLICY "Users can upload own originals"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'originals'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow authenticated users to read their own originals
CREATE POLICY "Users can read own originals"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'originals'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
