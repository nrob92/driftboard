import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { storagePath, originalStoragePath, userId } = body as {
      storagePath?: string;
      originalStoragePath?: string;
      userId: string;
    };

    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
    }

    const canonicalPath = storagePath || originalStoragePath;
    if (!canonicalPath) {
      return NextResponse.json({ error: 'Missing storagePath or originalStoragePath' }, { status: 400 });
    }

    if (storagePath) {
      const { error: photosErr } = await supabase.storage.from('photos').remove([storagePath]);
      if (photosErr) {
        console.error('Failed to delete from photos:', photosErr);
        return NextResponse.json(
          { error: 'Failed to delete from photos', details: photosErr.message },
          { status: 500 }
        );
      }
    }

    if (originalStoragePath) {
      const { error: originalsErr } = await supabase.storage.from('originals').remove([originalStoragePath]);
      if (originalsErr) {
        console.error('Failed to delete from originals:', originalsErr);
        return NextResponse.json(
          { error: 'Failed to delete from originals', details: originalsErr.message },
          { status: 500 }
        );
      }
    }

    const { error: dbErr } = await supabase
      .from('photo_edits')
      .delete()
      .eq('storage_path', canonicalPath)
      .eq('user_id', userId);

    if (dbErr) {
      console.error('Failed to delete photo_edits row:', dbErr);
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
