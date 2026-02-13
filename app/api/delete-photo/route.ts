import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getThumbPath } from '@/lib/utils/thumbnail';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { storagePath, originalStoragePath, userId, sessionId } = body as {
      storagePath?: string;
      originalStoragePath?: string;
      userId: string;
      sessionId?: string;
    };

    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
    }

    const canonicalPath = storagePath || originalStoragePath;
    if (!canonicalPath) {
      return NextResponse.json({ error: 'Missing storagePath or originalStoragePath' }, { status: 400 });
    }

    if (storagePath) {
      const bucket = sessionId ? 'collab-photos' : 'photos';
      const { error: photosErr } = await supabase.storage.from(bucket).remove([storagePath]);
      if (photosErr) {
        console.error(`Failed to delete from ${bucket}:`, photosErr);
        return NextResponse.json(
          { error: `Failed to delete from ${bucket}`, details: photosErr.message },
          { status: 500 }
        );
      }

      // Delete all thumbnail versions (v1, v2, etc.) to clean up old versions
      const lastSlash = storagePath.lastIndexOf('/');
      const basePath = lastSlash < 0 ? '' : storagePath.slice(0, lastSlash + 1);
      const fileName = lastSlash < 0 ? storagePath : storagePath.slice(lastSlash + 1);
      
      // Delete current version thumbnail
      const thumbPath = getThumbPath(storagePath);
      await supabase.storage.from(bucket).remove([thumbPath]).catch(() => {});
      
      // Also delete old v1 thumbnails if they exist
      const oldThumbPath = basePath + 'thumbs/' + fileName;
      await supabase.storage.from(bucket).remove([oldThumbPath]).catch(() => {});
    }

    // Delete original (DNG) from same bucket if it exists
    if (originalStoragePath) {
      const bucket = sessionId ? 'collab-photos' : 'photos';
      await supabase.storage.from(bucket).remove([originalStoragePath]).catch(() => {});
    }

    // Delete row from appropriate table
    const table = sessionId ? 'collab_photos' : 'photo_edits';
    const query = supabase
      .from(table)
      .delete()
      .eq('storage_path', canonicalPath);

    // For personal, we ensure user_id matches. For collab, we ensure user is session member (handled by RLS, but double check user_id if needed)
    // Actually for collab, we should check session_id too if possible, but storage_path is unique in bucket.
    // The key constraint in collab_photos is (storage_path, session_id), so we should use that.
    
    if (sessionId) {
      query.eq('session_id', sessionId);
    } else {
      query.eq('user_id', userId);
    }

    const { error: dbErr } = await query;

    if (dbErr) {
      console.error(`Failed to delete ${table} row:`, dbErr);
      return NextResponse.json(
        { error: 'Failed to delete photo record', details: dbErr.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete photo error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
