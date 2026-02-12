import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// GET /api/collab/photos - Get all photos in a session
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');
    const userId = searchParams.get('userId');

    if (!sessionId || !userId) {
      return NextResponse.json(
        { error: 'Missing required fields: sessionId, userId' },
        { status: 400 }
      );
    }

    // Verify membership
    const { data: membership, error: membershipError } = await supabase
      .from('collab_members')
      .select('status')
      .eq('session_id', sessionId)
      .eq('user_id', userId)
      .single();

    if (membershipError || !membership) {
      return NextResponse.json({ error: 'Not a member of this session' }, { status: 403 });
    }

    const { data: photos, error } = await supabase
      .from('collab_photos')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching photos:', error);
      return NextResponse.json(
        { error: 'Failed to fetch photos' },
        { status: 500 }
      );
    }

    // Get public URLs for all photos
    const photosWithUrls = await Promise.all((photos || []).map(async (photo) => {
      const { data: { publicUrl } } = supabase.storage
        .from('collab-photos')
        .getPublicUrl(photo.storage_path);
      
      let thumbnailUrl = null;
      if (photo.thumbnail_path) {
        const { data: { publicUrl: url } } = supabase.storage
          .from('collab-photos')
          .getPublicUrl(photo.thumbnail_path);
        thumbnailUrl = url;
      }

      return { ...photo, url: publicUrl, thumbnailUrl };
    }));

    return NextResponse.json({ photos: photosWithUrls });
  } catch (error) {
    console.error('Get photos error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST /api/collab/photos - Create a new photo
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      sessionId, 
      userId, 
      storagePath,
      folderId,
      x = 0,
      y = 0,
      width = 400,
      height = 400
    } = body;

    if (!sessionId || !userId || !storagePath) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Verify membership
    const { data: membership, error: membershipError } = await supabase
      .from('collab_members')
      .select('status')
      .eq('session_id', sessionId)
      .eq('user_id', userId)
      .single();

    if (membershipError || !membership) {
      return NextResponse.json({ error: 'Not a member of this session' }, { status: 403 });
    }

    if (membership.status !== 'approved') {
      return NextResponse.json({ error: 'Your membership is not approved' }, { status: 403 });
    }

    const { data: photo, error } = await supabase
      .from('collab_photos')
      .insert({
        session_id: sessionId,
        user_id: userId,
        storage_path: storagePath,
        folder_id: folderId || null,
        x,
        y,
        width,
        height
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating photo:', error);
      return NextResponse.json(
        { error: 'Failed to create photo', details: error.message },
        { status: 500 }
      );
    }

    // Log activity
    await supabase.from('collab_activity').insert({
      session_id: sessionId,
      user_id: userId,
      action: 'photo_added',
      target_type: 'photo',
      target_id: photo.id
    });

    return NextResponse.json({ photo });
  } catch (error) {
    console.error('Create photo error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// PATCH /api/collab/photos - Update a photo (position, edits, etc.)
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { sessionId, userId, photoId, updates } = body;

    if (!sessionId || !userId || !photoId || !updates) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Verify ownership - can only update own photos
    const { data: photo, error: photoError } = await supabase
      .from('collab_photos')
      .select('user_id')
      .eq('id', photoId)
      .single();

    if (photoError || !photo) {
      return NextResponse.json({ error: 'Photo not found' }, { status: 404 });
    }

    if (photo.user_id !== userId) {
      return NextResponse.json(
        { error: 'You can only update your own photos' },
        { status: 403 }
      );
    }

    const { data: updatedPhoto, error } = await supabase
      .from('collab_photos')
      .update(updates)
      .eq('id', photoId)
      .select()
      .single();

    if (error) {
      console.error('Error updating photo:', error);
      return NextResponse.json(
        { error: 'Failed to update photo', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ photo: updatedPhoto });
  } catch (error) {
    console.error('Update photo error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE /api/collab/photos - Delete a photo
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');
    const userId = searchParams.get('userId');
    const photoId = searchParams.get('photoId');

    if (!sessionId || !userId || !photoId) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Verify ownership - can only delete own photos
    const { data: photo, error: photoError } = await supabase
      .from('collab_photos')
      .select('id, storage_path, user_id')
      .eq('id', photoId)
      .single();

    if (photoError || !photo) {
      return NextResponse.json({ error: 'Photo not found' }, { status: 404 });
    }

    if (photo.user_id !== userId) {
      return NextResponse.json(
        { error: 'You can only delete your own photos' },
        { status: 403 }
      );
    }

    // Delete from storage
    await supabase.storage
      .from('collab-photos')
      .remove([photo.storage_path]);

    // Delete thumbnail if exists
    if (photo.storage_path.includes('/')) {
      const parts = photo.storage_path.split('/');
      const thumbPath = `${parts.slice(0, -1).join('/')}/thumbs/${parts[parts.length - 1].replace(/\.[^.]+$/, '.jpg')}`;
      await supabase.storage.from('collab-photos').remove([thumbPath]).catch(() => {});
    }

    // Delete from database
    const { error } = await supabase
      .from('collab_photos')
      .delete()
      .eq('id', photoId);

    if (error) {
      console.error('Error deleting photo:', error);
      return NextResponse.json(
        { error: 'Failed to delete photo', details: error.message },
        { status: 500 }
      );
    }

    // Log activity
    await supabase.from('collab_activity').insert({
      session_id: sessionId,
      user_id: userId,
      action: 'photo_deleted',
      target_type: 'photo',
      target_id: photoId
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete photo error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}