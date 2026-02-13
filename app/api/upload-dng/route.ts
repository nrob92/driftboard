import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Create Supabase client with service role for server-side operations
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
if (
  process.env.NODE_ENV === "development" &&
  !process.env.SUPABASE_SERVICE_ROLE_KEY
) {
  console.warn(
    "[upload-dng] SUPABASE_SERVICE_ROLE_KEY is not set; using anon key (storage RLS may block uploads).",
  );
}
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  supabaseKey,
);

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const userId = formData.get("userId") as string;
    const sessionId = formData.get("sessionId") as string | null;

    if (!file || !userId) {
      return NextResponse.json(
        { error: "Missing file or userId" },
        { status: 400 },
      );
    }

    // Generate unique filenames and paths up front
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 8);
    const originalFilename = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");

    // If sessionId is present, store in session folder; otherwise user folder
    // Note: 'originals' bucket is private, but service role key bypasses RLS
    const basePath = sessionId ? sessionId : userId;
    const originalPath = `${basePath}/${timestamp}-${randomId}-original.dng`;

    // Read file and upload in background (don't await) - client already has File object for immediate display
    (async () => {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        // Use photos bucket for both sessions and personal (single bucket for all uploads)
        const bucket = sessionId ? "collab-photos" : "photos";

        const { error } = await supabase.storage
          .from(bucket)
          .upload(originalPath, buffer, {
            contentType: "image/x-adobe-dng",
            cacheControl: "31536000",
            upsert: false,
          });
        if (error) {
          console.error("[upload-dng] Background upload failed:", error);
        }
      } catch (err) {
        console.error("[upload-dng] Background upload error:", err);
      }
    })();

    // Return immediately - client will decode DNG from File object for fast display
    return NextResponse.json({
      success: true,
      previewUrl: null,
      previewPath: null,
      originalPath,
      width: 0,
      height: 0,
      originalWidth: 0,
      originalHeight: 0,
      originalFilename,
      noPreview: true,
    });
  } catch (error) {
    console.error("Upload DNG error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
