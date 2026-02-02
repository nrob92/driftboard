import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';
import * as exifr from 'exifr';

// Create Supabase client with service role for server-side operations
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
if (process.env.NODE_ENV === 'development' && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('[upload-dng] SUPABASE_SERVICE_ROLE_KEY is not set; using anon key (storage RLS may block uploads).');
}
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, supabaseKey);

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const userId = formData.get('userId') as string;

    if (!file || !userId) {
      return NextResponse.json(
        { error: 'Missing file or userId' },
        { status: 400 }
      );
    }

    // Read file buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Generate unique filenames and paths up front
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 8);
    const originalFilename = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const originalPath = `${userId}/${timestamp}-${randomId}-original.dng`;
    const previewPath = `${userId}/${timestamp}-${randomId}-preview.jpg`;

    // Store original DNG in 'originals' bucket first (before preview extraction)
    let originalUploadError = (
      await supabase.storage.from('originals').upload(originalPath, buffer, {
        contentType: 'image/x-adobe-dng',
        cacheControl: '31536000', // 1 year cache for originals
        upsert: false,
      })
    ).error;

    // If bucket might not exist, try to create it (service role required) and retry
    if (originalUploadError) {
      const msg = String(originalUploadError.message ?? '').toLowerCase();
      const maybeNoBucket =
        msg.includes('not found') ||
        msg.includes('bucket') ||
        msg.includes('does not exist');
      if (maybeNoBucket) {
        const { error: createErr } = await supabase.storage.createBucket('originals', {
          public: false,
          fileSizeLimit: 100 * 1024 * 1024, // 100MB for DNG/RAW
        });
        if (!createErr) {
          originalUploadError = (
            await supabase.storage.from('originals').upload(originalPath, buffer, {
              contentType: 'image/x-adobe-dng',
              cacheControl: '31536000',
              upsert: false,
            })
          ).error;
        }
      }
    }

    if (originalUploadError) {
      console.error('Failed to upload original:', originalUploadError);
      return NextResponse.json(
        {
          error: 'Failed to upload original DNG',
          details: originalUploadError.message,
        },
        { status: 500 }
      );
    }

    // Try to extract embedded preview from DNG using exifr (optional; original is already saved)
    let previewBuffer: Buffer | null = null;
    let previewWidth = 0;
    let previewHeight = 0;
    let originalWidth = 0;
    let originalHeight = 0;

    try {
      let preview: Uint8Array | Buffer | undefined;

      // Method 1: Try exifr.thumbnail() (some DNGs throw RangeError / have no standard thumbnail)
      try {
        preview = await exifr.thumbnail(buffer);
        if (preview) console.log('exifr.thumbnail result:', `${preview.length} bytes`);
      } catch {
        // Expected for many DNGs; we fall back to client-side decode
      }

      // Method 2: If thumbnail failed, try parsing with different options
      if (!preview) {
        try {
          const parsed = await exifr.parse(buffer, {
            tiff: true,
            ifd0: {},
            ifd1: true,
            exif: true,
            translateValues: false,
            reviveValues: false,
          });
          if (parsed?.thumbnail) {
            preview = parsed.thumbnail;
            console.log('Got preview from parsed.thumbnail');
          }
        } catch {
          // No embedded preview; client will decode
        }
      }

      if (preview) {
        // Get EXIF data for original dimensions
        const exif = await exifr.parse(buffer, {
          tiff: true,
          ifd0: {},
          exif: true,
        });
        if (exif) {
          originalWidth = exif.ImageWidth || exif.ExifImageWidth || 0;
          originalHeight = exif.ImageHeight || exif.ExifImageHeight || 0;
        }

        const processed = await sharp(Buffer.from(preview))
          .resize(2000, 2000, {
            fit: 'inside',
            withoutEnlargement: true,
          })
          .jpeg({ quality: 92 })
          .toBuffer({ resolveWithObject: true });

        previewBuffer = processed.data;
        previewWidth = processed.info.width ?? 0;
        previewHeight = processed.info.height ?? 0;
        if (!originalWidth || !originalHeight) {
          originalWidth = previewWidth;
          originalHeight = previewHeight;
        }
      } else {
        console.log('No embedded preview found in DNG; client-side decoding can be used.');
      }
    } catch (extractError) {
      console.error('Failed to extract DNG preview:', extractError);
      // Original is already saved; continue without server preview
    }

    // If we got a preview, upload it to 'photos' and return full response
    if (previewBuffer) {
      const { error: previewUploadError } = await supabase.storage
        .from('photos')
        .upload(previewPath, previewBuffer, {
          contentType: 'image/jpeg',
          cacheControl: '3600',
          upsert: false,
        });

      if (previewUploadError) {
        console.error('Failed to upload preview:', previewUploadError);
        // Original is saved; return success with originalPath only
        return NextResponse.json({
          success: true,
          previewUrl: null,
          previewPath: null,
          originalPath,
          width: 0,
          height: 0,
          originalWidth,
          originalHeight,
          originalFilename,
          noPreview: true,
        });
      }

      const { data: urlData } = supabase.storage
        .from('photos')
        .getPublicUrl(previewPath);

      return NextResponse.json({
        success: true,
        previewUrl: urlData.publicUrl,
        previewPath,
        originalPath,
        width: previewWidth,
        height: previewHeight,
        originalWidth,
        originalHeight,
        originalFilename,
      });
    }

    // No server preview; original DNG is in originals, client can decode for display
    return NextResponse.json({
      success: true,
      previewUrl: null,
      previewPath: null,
      originalPath,
      width: 0,
      height: 0,
      originalWidth,
      originalHeight,
      originalFilename,
      noPreview: true,
    });

  } catch (error) {
    console.error('Upload DNG error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
