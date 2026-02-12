import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';
import { applyEdits, EditValues } from '@/lib/serverFilters';

// Create Supabase client with service role for server-side operations
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface ExportRequest {
  storagePath?: string;          // Path in 'photos' bucket (for regular images / preview)
  originalStoragePath?: string;  // Path in 'originals' bucket (for DNG files)
  edits: EditValues;
  format: 'jpeg' | 'png' | 'tiff';
  quality?: number;
  sessionId?: string;            // If present, look in collab-photos
}

export async function POST(request: NextRequest) {
  try {
    const body: ExportRequest = await request.json();
    const { storagePath, originalStoragePath, edits, format, quality = 95, sessionId } = body;

    if (!storagePath && !originalStoragePath) {
      return NextResponse.json(
        { error: 'Missing storagePath or originalStoragePath' },
        { status: 400 }
      );
    }

    // Prefer photos bucket (JPEG preview) when available so Sharp can decode; use originals only when no preview
    // If sessionId is present and using storagePath (preview), use 'collab-photos'
    const bucket = storagePath 
      ? (sessionId ? 'collab-photos' : 'photos') 
      : 'originals';
      
    const path = storagePath || originalStoragePath!;

    // Sharp cannot decode DNG/RAW; reject so client can use client-side export
    const pathLower = path.toLowerCase();
    if (pathLower.endsWith('.dng') || pathLower.endsWith('.raw') || pathLower.endsWith('.cr2') || pathLower.endsWith('.nef') || pathLower.endsWith('.arw')) {
      return NextResponse.json(
        { error: 'Export from DNG/RAW is not supported on the server. Use Export in the editor to download the edited image.' },
        { status: 400 }
      );
    }

    // Download the source image
    const { data: fileData, error: downloadError } = await supabase.storage
      .from(bucket)
      .download(path);

    if (downloadError || !fileData) {
      console.error('Failed to download source image:', downloadError);
      return NextResponse.json(
        { error: 'Failed to download source image' },
        { status: 404 }
      );
    }

    // Convert to buffer
    const arrayBuffer = await fileData.arrayBuffer();
    const sourceBuffer = Buffer.from(arrayBuffer);

    // Get image as raw RGB pixels using Sharp
    let rawData: Buffer;
    let width: number;
    let height: number;

    try {
      const image = sharp(sourceBuffer);
      const metadata = await image.metadata();
      width = metadata.width || 0;
      height = metadata.height || 0;

      // Extract raw RGB pixels
      rawData = await image
        .removeAlpha()
        .raw()
        .toBuffer();

    } catch (sharpError) {
      console.error('Failed to process image with Sharp:', sharpError);
      return NextResponse.json(
        { error: 'Failed to process image. The file may be corrupted or in an unsupported format.' },
        { status: 400 }
      );
    }

    // Apply edits to the raw pixel data
    const editedData = applyEdits(rawData, width, height, edits);

    // Convert back to desired format using Sharp
    let outputBuffer: Buffer;
    let contentType: string;

    try {
      let outputImage = sharp(editedData, {
        raw: {
          width,
          height,
          channels: 3
        }
      });

      switch (format) {
        case 'png':
          outputBuffer = await outputImage.png().toBuffer();
          contentType = 'image/png';
          break;
        case 'tiff':
          outputBuffer = await outputImage.tiff({ compression: 'lzw' }).toBuffer();
          contentType = 'image/tiff';
          break;
        case 'jpeg':
        default:
          outputBuffer = await outputImage.jpeg({ quality }).toBuffer();
          contentType = 'image/jpeg';
          break;
      }
    } catch (outputError) {
      console.error('Failed to encode output image:', outputError);
      return NextResponse.json(
        { error: 'Failed to encode output image' },
        { status: 500 }
      );
    }

    // Generate filename
    const ext = format === 'jpeg' ? 'jpg' : format;
    const filename = `export-${Date.now()}.${ext}`;

    // Return the processed image (convert Buffer to Uint8Array for NextResponse)
    return new NextResponse(new Uint8Array(outputBuffer), {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': outputBuffer.length.toString(),
      },
    });

  } catch (error) {
    console.error('Export error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
