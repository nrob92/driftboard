import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// const GEMINI_API_KEY = process.env.GOOGLE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
// const GEMINI_MODEL = 'gemini-2.5-flash-lite';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { storagePath, userId, sessionId } = body as { storagePath?: string; userId?: string; sessionId?: string };

    if (!storagePath || !userId) {
      return NextResponse.json(
        { error: 'Missing storagePath or userId' },
        { status: 400 }
      );
    }

    // if (!GEMINI_API_KEY) {
    //   console.warn('label-photo: GOOGLE_GEMINI_API_KEY or GEMINI_API_KEY not set');
    //   return NextResponse.json(
    //     { error: 'Labeling not configured' },
    //     { status: 503 }
    //   );
    // }

    // Prefer photos bucket (preview); path usually is userId/filename or sessionId/filename
    const bucket = storagePath.toLowerCase().endsWith('.dng') 
      ? 'originals' 
      : (sessionId ? 'collab-photos' : 'photos');
      
    const { data: signed, error: signError } = await supabase.storage
      .from(bucket)
      .createSignedUrl(storagePath, 300);

    if (signError || !signed?.signedUrl) {
      console.error('label-photo signed URL failed:', signError);
      return NextResponse.json(
        { error: 'Failed to get image URL' },
        { status: 500 }
      );
    }

    const imageResponse = await fetch(signed.signedUrl);
    if (!imageResponse.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch image' },
        { status: 500 }
      );
    }

    // Gemini labeling commented out - will add back later
    // const arrayBuffer = await imageResponse.arrayBuffer();
    // const base64 = Buffer.from(arrayBuffer).toString('base64');
    // const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';
    // const mimeType = contentType.split(';')[0].trim() || 'image/jpeg';

    // const prompt = `Look at this image and list short, lowercase tags that describe its content (e.g. tree, sky, person, beach, dog, landscape). Return only a comma-separated list of tags, no other text.`;

    // const geminiRes = await fetch(
    //   `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    //   {
    //     method: 'POST',
    //     headers: { 'Content-Type': 'application/json' },
    //     body: JSON.stringify({
    //       contents: [
    //         {
    //           role: 'user',
    //           parts: [
    //             { text: prompt },
    //             {
    //               inlineData: {
    //                 mimeType,
    //                 data: base64,
    //               },
    //             },
    //           ],
    //         },
    //       ],
    //       generationConfig: {
    //         temperature: 0.2,
    //         maxOutputTokens: 256,
    //       },
    //     }),
    //   }
    // );

    // if (!geminiRes.ok) {
    //   const errText = await geminiRes.text();
    //   console.error('Gemini API error:', geminiRes.status, errText);
    //   return NextResponse.json(
    //     { error: 'Labeling failed' },
    //     { status: 502 }
    //   );
    // }

    // const geminiJson = await geminiRes.json();
    // const textPart = geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text;
    // const text = (textPart || '').trim();

    // const labels = text
    //   .split(',')
    //   .map((s: string) => s.trim().toLowerCase())
    //   .filter((s: string) => s.length > 0);

    // Return empty labels for now
    const labels: string[] = [];

    const table = sessionId ? 'collab_photos' : 'photo_edits';
    const query = supabase
      .from(table)
      .update({ labels })
      .eq('storage_path', storagePath);
      
    if (sessionId) {
      query.eq('session_id', sessionId);
    } else {
      query.eq('user_id', userId);
    }

    const { error: updateError } = await query;

    if (updateError) {
      console.error('label-photo update error:', updateError);
      return NextResponse.json(
        { error: 'Failed to save labels' },
        { status: 500 }
      );
    }

    return NextResponse.json({ labels });
  } catch (error) {
    console.error('label-photo error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
