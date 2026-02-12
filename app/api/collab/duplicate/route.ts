import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// POST /api/collab/duplicate - Duplicate a photo or folder
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      sessionId, 
      userId, 
      type, // 'photo' | 'folder'
      sourceId, 
      targetFolderId,
      offsetX = 50,
      offsetY = 50
    } = body;

    if (!sessionId || !userId || !type || !sourceId) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    if (!['photo', 'folder'].includes(type)) {
      return NextResponse.json(
        { error: 'Invalid type. Must be: photo or folder' },
        { status: 400 }
      );
    }

    // Verify user is a member of the session
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

    if (type === 'photo') {
      // Get the source photo
      const { data: sourcePhoto, error: sourceError } = await supabase
        .from('collab_photos')
        .select('*')
        .eq('id', sourceId)
        .single();

      if (sourceError || !sourcePhoto) {
        return NextResponse.json({ error: 'Source photo not found' }, { status: 404 });
      }

      // Check if source is in the same session
      if (sourcePhoto.session_id !== sessionId) {
        return NextResponse.json({ error: 'Source photo is not in this session' }, { status: 400 });
      }

      // Create a new photo as a copy
      const newPhotoId = generateId();
      const fileName = `${generateId()}.jpg`;
      const storagePath = `${sessionId}/${userId}/${fileName}`;

      // Copy the file in storage
      const { error: copyError } = await supabase.storage
        .from('collab-photos')
        .copy(sourcePhoto.storage_path, storagePath);

      if (copyError) {
        console.error('Error copying photo file:', copyError);
        return NextResponse.json(
          { error: 'Failed to copy photo file', details: copyError.message },
          { status: 500 }
        );
      }

      // Get public URL for the new file
      const { data: { publicUrl: newPhotoUrl } } = supabase.storage
        .from('collab-photos')
        .getPublicUrl(storagePath);

      // Insert the new photo
      const { data: newPhoto, error: insertError } = await supabase
        .from('collab_photos')
        .insert({
          id: newPhotoId,
          session_id: sessionId,
          user_id: userId,
          storage_path: storagePath,
          thumbnail_path: null, // Will be generated on-demand
          folder_id: targetFolderId || null,
          x: sourcePhoto.x + offsetX,
          y: sourcePhoto.y + offsetY,
          width: sourcePhoto.width,
          height: sourcePhoto.height,
          rotation: sourcePhoto.rotation,
          scale_x: sourcePhoto.scale_x,
          scale_y: sourcePhoto.scale_y,
          exposure: sourcePhoto.exposure,
          contrast: sourcePhoto.contrast,
          highlights: sourcePhoto.highlights,
          shadows: sourcePhoto.shadows,
          whites: sourcePhoto.whites,
          blacks: sourcePhoto.blacks,
          temperature: sourcePhoto.temperature,
          vibrance: sourcePhoto.vibrance,
          saturation: sourcePhoto.saturation,
          clarity: sourcePhoto.clarity,
          dehaze: sourcePhoto.dehaze,
          vignette: sourcePhoto.vignette,
          grain: sourcePhoto.grain,
          curves: sourcePhoto.curves,
          brightness: sourcePhoto.brightness,
          hue: sourcePhoto.hue,
          blur: sourcePhoto.blur,
          filters: sourcePhoto.filters,
          texture: sourcePhoto.texture,
          shadow_tint: sourcePhoto.shadow_tint,
          color_hsl: sourcePhoto.color_hsl,
          split_toning: sourcePhoto.split_toning,
          color_grading: sourcePhoto.color_grading,
          color_calibration: sourcePhoto.color_calibration,
          grain_size: sourcePhoto.grain_size,
          grain_roughness: sourcePhoto.grain_roughness,
          border_width: sourcePhoto.border_width,
          border_color: sourcePhoto.border_color,
          is_raw: sourcePhoto.is_raw,
          original_storage_path: sourcePhoto.original_storage_path,
          original_width: sourcePhoto.original_width,
          original_height: sourcePhoto.original_height,
          taken_at: sourcePhoto.taken_at,
          camera_make: sourcePhoto.camera_make,
          camera_model: sourcePhoto.camera_model,
          labels: sourcePhoto.labels,
          duplicated_from_id: sourceId
        })
        .select()
        .single();

      if (insertError) {
        console.error('Error inserting duplicated photo:', insertError);
        // Clean up the copied file
        await supabase.storage.from('collab-photos').remove([storagePath]);
        return NextResponse.json(
          { error: 'Failed to duplicate photo', details: insertError.message },
          { status: 500 }
        );
      }

      // Log activity
      await supabase.from('collab_activity').insert({
        session_id: sessionId,
        user_id: userId,
        action: 'photo_duplicated',
        target_type: 'photo',
        target_id: newPhotoId,
        metadata: { source_id: sourceId }
      });

      return NextResponse.json({ photo: newPhoto });
    } 
    
    if (type === 'folder') {
      // Get the source folder
      const { data: sourceFolder, error: sourceError } = await supabase
        .from('collab_folders')
        .select('*')
        .eq('id', sourceId)
        .single();

      if (sourceError || !sourceFolder) {
        return NextResponse.json({ error: 'Source folder not found' }, { status: 404 });
      }

      // Check if source is in the same session
      if (sourceFolder.session_id !== sessionId) {
        return NextResponse.json({ error: 'Source folder is not in this session' }, { status: 400 });
      }

      // Generate new folder ID
      const newFolderId = `${generateId()}`;

      // Insert the new folder
      const { data: newFolder, error: insertError } = await supabase
        .from('collab_folders')
        .insert({
          id: newFolderId,
          session_id: sessionId,
          user_id: userId,
          name: sourceFolder.name,
          x: sourceFolder.x + offsetX,
          y: sourceFolder.y + offsetY,
          width: sourceFolder.width,
          height: sourceFolder.height,
          color: sourceFolder.color,
          type: sourceFolder.type,
          page_count: sourceFolder.page_count,
          background_color: sourceFolder.background_color,
          duplicated_from_id: sourceId
        })
        .select()
        .single();

      if (insertError) {
        console.error('Error inserting duplicated folder:', insertError);
        return NextResponse.json(
          { error: 'Failed to duplicate folder', details: insertError.message },
          { status: 500 }
        );
      }

      // Log activity
      await supabase.from('collab_activity').insert({
        session_id: sessionId,
        user_id: userId,
        action: 'folder_duplicated',
        target_type: 'folder',
        target_id: newFolderId,
        metadata: { source_id: sourceId }
      });

      return NextResponse.json({ folder: newFolder });
    }

    return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
  } catch (error) {
    console.error('Duplicate error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}