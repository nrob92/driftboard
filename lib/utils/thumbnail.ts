/**
 * Shared thumbnail utilities.
 * Used by both /api/thumbnail and /api/thumbnail-batch endpoints.
 */

import sharp from 'sharp';

// Thumbnail version - increment when changing settings to force regeneration
export const THUMB_VERSION = 'v2';

// Grid thumbnails: smaller size for efficient canvas display
// 400px at 80% quality typically yields 30-60KB vs 200-400KB at 1200px/95%
export const THUMB_MAX_DIM = 400;
export const THUMB_QUALITY = 80;

export const RAW_EXTENSIONS = ['.dng', '.raw', '.cr2', '.nef', '.arw'];

export function isRawPath(path: string): boolean {
  const lower = path.toLowerCase();
  return RAW_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function getThumbPath(path: string): string {
  const lastSlash = path.lastIndexOf('/');
  // Include version in path to force regeneration when settings change
  // e.g., user_id/thumbs/v2/filename.jpg
  return lastSlash < 0
    ? `thumbs/${THUMB_VERSION}/${path}`
    : path.slice(0, lastSlash + 1) + `thumbs/${THUMB_VERSION}/` + path.slice(lastSlash + 1);
}

/**
 * Generate a thumbnail buffer from a source image buffer.
 */
export async function generateThumbnail(sourceBuffer: Buffer): Promise<Buffer> {
  return sharp(sourceBuffer)
    .resize(THUMB_MAX_DIM, THUMB_MAX_DIM, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: THUMB_QUALITY })
    .toBuffer();
}
