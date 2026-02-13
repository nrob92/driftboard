import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  isRawPath,
  getThumbPath,
  generateThumbnail,
} from "@/lib/utils/thumbnail";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

/**
 * On-demand thumbnail generator.
 * - If a thumb already exists at the thumbs/ path, returns its signed URL.
 * - Otherwise, downloads the full image server-side, resizes with Sharp,
 *   uploads the thumb, and returns its signed URL.
 *
 * This avoids sending full-resolution images to the client for grid display.
 * Egress cost: ~30-60 KB per thumbnail vs 5-10 MB per full-res image.
 */
export async function POST(request: NextRequest) {
  try {
    const { bucket, path } = await request.json();

    if (!bucket || !path) {
      return NextResponse.json(
        { error: "Missing bucket or path" },
        { status: 400 },
      );
    }
    if (
      bucket !== "photos" &&
      bucket !== "originals" &&
      bucket !== "collab-photos"
    ) {
      return NextResponse.json({ error: "Invalid bucket" }, { status: 400 });
    }

    // DNG/RAW files can't be resized with Sharp — the client should use the
    // preview JPG in the photos bucket instead (uploaded during DNG upload flow)
    if (isRawPath(path)) {
      return NextResponse.json(
        { error: "RAW files not supported for thumbnails" },
        { status: 400 },
      );
    }

    const thumbPath = getThumbPath(path);

    // Check if thumb already exists by trying to create a signed URL
    const { data: existingUrl, error: existingError } = await supabase.storage
      .from(bucket)
      .createSignedUrl(thumbPath, 3600);

    if (!existingError && existingUrl?.signedUrl) {
      return NextResponse.json({
        signedUrl: existingUrl.signedUrl,
        cached: true,
      });
    }

    // Thumb doesn't exist — generate it server-side
    const { data: fileData, error: downloadError } = await supabase.storage
      .from(bucket)
      .download(path);

    if (downloadError || !fileData) {
      console.error("Thumbnail: failed to download source:", downloadError);
      return NextResponse.json(
        { error: "Failed to download source image" },
        { status: 404 },
      );
    }

    const arrayBuffer = await fileData.arrayBuffer();
    const sourceBuffer = Buffer.from(arrayBuffer);

    // Resize with Sharp using shared utility
    let thumbBuffer: Buffer;
    try {
      thumbBuffer = await generateThumbnail(sourceBuffer);
    } catch (sharpError) {
      console.error("Thumbnail: Sharp resize failed:", sharpError);
      return NextResponse.json(
        { error: "Failed to resize image" },
        { status: 500 },
      );
    }

    // Upload thumb to the same bucket at the thumbs/ path
    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(thumbPath, thumbBuffer, {
        contentType: "image/jpeg",
        cacheControl: "86400",
        upsert: true,
      });

    if (uploadError) {
      console.error("Thumbnail: upload failed:", uploadError);
      // Still serve the resized image directly even if storage upload fails
      return new NextResponse(new Uint8Array(thumbBuffer), {
        headers: {
          "Content-Type": "image/jpeg",
          "Cache-Control": "public, max-age=86400",
        },
      });
    }

    // Return signed URL for the newly created thumb
    const { data: newUrl, error: urlError } = await supabase.storage
      .from(bucket)
      .createSignedUrl(thumbPath, 3600);

    if (urlError || !newUrl?.signedUrl) {
      // Fallback: serve the buffer directly
      return new NextResponse(new Uint8Array(thumbBuffer), {
        headers: {
          "Content-Type": "image/jpeg",
          "Cache-Control": "public, max-age=86400",
        },
      });
    }

    return NextResponse.json({ signedUrl: newUrl.signedUrl, cached: false });
  } catch (error) {
    console.error("Thumbnail API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
