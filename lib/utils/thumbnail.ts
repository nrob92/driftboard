/**
 * Shared thumbnail utilities.
 * Used by both /api/thumbnail and /api/thumbnail-batch endpoints.
 */

import sharp from "sharp";

// Thumbnail version - increment when changing settings to force regeneration
export const THUMB_VERSION = "v4";

// Grid thumbnails: WebP at 1200px for retina-sharp display at 360px cells
// 1200px WebP @ 85% ≈ 80-150KB per thumbnail (same or less than 800px JPEG @ 95%)
export const THUMB_MAX_DIM = 1200;
export const THUMB_QUALITY = 85;

export const RAW_EXTENSIONS = [".dng", ".raw", ".cr2", ".nef", ".arw"];

export function isRawPath(path: string): boolean {
  const lower = path.toLowerCase();
  return RAW_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function getThumbPath(path: string): string {
  const lastSlash = path.lastIndexOf("/");
  // Include version in path to force regeneration when settings change
  // e.g., user_id/thumbs/v2/filename.jpg
  return lastSlash < 0
    ? `thumbs/${THUMB_VERSION}/${path}`
    : path.slice(0, lastSlash + 1) +
        `thumbs/${THUMB_VERSION}/` +
        path.slice(lastSlash + 1);
}

/**
 * Generate a thumbnail buffer from a source image buffer.
 */
export async function generateThumbnail(sourceBuffer: Buffer): Promise<Buffer> {
  return sharp(sourceBuffer)
    .resize(THUMB_MAX_DIM, THUMB_MAX_DIM, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: THUMB_QUALITY })
    .toBuffer();
}
