import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const THUMB_MAX_DIM = 1200;
const BATCH_CONCURRENCY = 4;

const RAW_EXTENSIONS = ['.dng', '.raw', '.cr2', '.nef', '.arw'];
function isRawPath(path: string): boolean {
  const lower = path.toLowerCase();
  return RAW_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function getThumbPath(path: string): string {
  const lastSlash = path.lastIndexOf('/');
  return lastSlash < 0
    ? `thumbs/${path}`
    : path.slice(0, lastSlash + 1) + 'thumbs/' + path.slice(lastSlash + 1);
}

async function processOneThumb(
  bucket: string,
  path: string
): Promise<{ bucket: string; path: string; signedUrl?: string; cached?: boolean; error?: string }> {
  const thumbPath = getThumbPath(path);

  try {
    // Check if thumb already exists
    const { data: existingUrl, error: existingError } = await supabase.storage
      .from('photos')
      .createSignedUrl(thumbPath, 3600);

    if (!existingError && existingUrl?.signedUrl) {
      return { bucket, path, signedUrl: existingUrl.signedUrl, cached: true };
    }

    // Thumb doesn't exist — generate it
    const { data: fileData, error: downloadError } = await supabase.storage
      .from(bucket)
      .download(path);

    if (downloadError || !fileData) {
      return { bucket, path, error: downloadError?.message ?? 'Failed to download' };
    }

    const arrayBuffer = await fileData.arrayBuffer();
    const sourceBuffer = Buffer.from(arrayBuffer);

    let thumbBuffer: Buffer;
    try {
      thumbBuffer = await sharp(sourceBuffer)
        .resize(THUMB_MAX_DIM, THUMB_MAX_DIM, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 95 })
        .toBuffer();
    } catch {
      return { bucket, path, error: 'Failed to resize' };
    }

    const { error: uploadError } = await supabase.storage
      .from('photos')
      .upload(thumbPath, thumbBuffer, {
        contentType: 'image/jpeg',
        cacheControl: '86400',
        upsert: true,
      });

    if (uploadError) {
      return { bucket, path, error: uploadError.message };
    }

    const { data: newUrl, error: urlError } = await supabase.storage
      .from('photos')
      .createSignedUrl(thumbPath, 3600);

    if (urlError || !newUrl?.signedUrl) {
      return { bucket, path, error: 'Failed to create signed URL' };
    }

    return { bucket, path, signedUrl: newUrl.signedUrl, cached: false };
  } catch (err) {
    return {
      bucket,
      path,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, i: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  );
  return results;
}

/**
 * Batch thumbnail API: process multiple images in one request.
 * Reduces HTTP round-trips and controls server-side concurrency.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const items = body?.items as Array<{ bucket: string; path: string }> | undefined;

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'Missing or empty items array' }, { status: 400 });
    }
    if (items.length > 20) {
      return NextResponse.json({ error: 'Max 20 items per batch' }, { status: 400 });
    }

    // Filter out RAW files (client uses signed-url for those)
    const toProcess = items.filter(
      (item) =>
        item.bucket &&
        item.path &&
        (item.bucket === 'photos' || item.bucket === 'originals') &&
        !isRawPath(item.path)
    );

    const results = await runWithConcurrency(
      toProcess,
      BATCH_CONCURRENCY,
      (item, i) => processOneThumb(item.bucket, item.path)
    );

    return NextResponse.json({ items: results });
  } catch (error) {
    console.error('Thumbnail batch API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
