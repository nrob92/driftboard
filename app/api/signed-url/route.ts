import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Create Supabase client with service role for server-side operations
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const { bucket, path } = await request.json();

    if (!bucket || !path) {
      return NextResponse.json(
        { error: 'Missing bucket or path' },
        { status: 400 }
      );
    }

    // Only allow originals and photos buckets for security
    if (bucket !== 'originals' && bucket !== 'photos') {
      return NextResponse.json(
        { error: 'Invalid bucket' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(path, 3600); // 1 hour expiry (reduces API calls, longer cache)

    if (error) {
      console.error('Signed URL error:', error);
      return NextResponse.json(
        { error: 'Failed to create signed URL', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ signedUrl: data.signedUrl });

  } catch (error) {
    console.error('Signed URL error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
