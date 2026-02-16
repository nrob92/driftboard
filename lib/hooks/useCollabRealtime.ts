import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useCanvasStore } from '@/lib/stores/canvasStore';
import { useQueryClient } from '@tanstack/react-query';
import type { CanvasImage, PhotoFolder } from '@/lib/types';
import { DEFAULT_CURVES } from '@/lib/types';
import { getCachedImage } from '@/lib/imageCache';
import { getThumbStoragePath } from '@/lib/utils/imageUtils';

/**
 * Hook for handling real-time collaboration on the canvas
 * Listens for database changes from other collaborators and broadcasts cursor positions
 */
export function useCollabRealtime({
  sessionId,
  userId,
}: {
  sessionId: string;
  userId?: string;
}) {
  const queryClient = useQueryClient();
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const subscribedRef = useRef(false);
  
  const images = useCanvasStore((s) => s.images);
  const setImages = useCanvasStore((s) => s.setImages);
  const updateImage = useCanvasStore((s) => s.updateImage);
  const folders = useCanvasStore((s) => s.folders);
  const setFolders = useCanvasStore((s) => s.setFolders);
  const updateFolder = useCanvasStore((s) => s.updateFolder);

  /**
   * Convert database record to CanvasImage
   */
  const parseDbPhotoToCanvasImage = useCallback(async (record: Record<string, unknown>): Promise<CanvasImage> => {
    // Get image URL based on available paths
    // Note: storage_path in DB already includes sessionId prefix (e.g., "sessionId/filename.jpg")
    // thumbnail_path is already the full thumbnail path (e.g., "sessionId/thumbs/v2/filename.jpg")
    const thumbnailPath = record.thumbnail_path as string | null;
    const storagePath = record.storage_path as string;
    
    let src = "";

    if (sessionId && storagePath) {
      // Use thumbnail to minimize egress — /api/thumbnail generates on-demand if not ready yet
      try {
        const res = await fetch("/api/thumbnail", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bucket: "collab-photos", path: storagePath }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.signedUrl) {
            // Cache thumbnail blob in IndexedDB for future loads
            const thumbPath = getThumbStoragePath(storagePath);
            const blob = await getCachedImage(thumbPath, async () => {
              const response = await fetch(data.signedUrl);
              if (!response.ok) throw new Error("Failed to fetch thumbnail");
              return response.blob();
            });
            src = URL.createObjectURL(blob);
          }
        }
      } catch {
        // Thumbnail failed — fall back to full-res public URL
      }
      if (!src) {
        const { data } = supabase.storage.from('collab-photos').getPublicUrl(storagePath);
        src = data.publicUrl;
      }
    }
    
    return {
      id: record.id as string,
      userId: record.user_id as string,
      src,
      storagePath: record.storage_path as string,
      thumbnailPath: record.thumbnail_path as string,
      folderId: record.folder_id as string | undefined,
      x: record.x as number,
      y: record.y as number,
      width: record.width as number,
      height: record.height as number,
      rotation: record.rotation as number,
      scaleX: record.scale_x as number,
      scaleY: record.scale_y as number,
      // Light adjustments
      exposure: record.exposure as number,
      contrast: record.contrast as number,
      highlights: record.highlights as number,
      shadows: record.shadows as number,
      whites: record.whites as number,
      blacks: record.blacks as number,
      texture: record.texture as number,
      // Color adjustments
      temperature: record.temperature as number,
      vibrance: record.vibrance as number,
      saturation: record.saturation as number,
      shadowTint: record.shadow_tint as number,
      colorHSL: record.color_hsl as CanvasImage['colorHSL'],
      splitToning: record.split_toning as CanvasImage['splitToning'],
      colorGrading: record.color_grading as CanvasImage['colorGrading'],
      colorCalibration: record.color_calibration as CanvasImage['colorCalibration'],
      // Effects
      clarity: record.clarity as number,
      dehaze: record.dehaze as number,
      vignette: record.vignette as number,
      grain: record.grain as number,
      grainSize: record.grain_size as number,
      grainRoughness: record.grain_roughness as number,
      // Curves
      curves: (record.curves as CanvasImage['curves']) || {
        rgb: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
        red: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
        green: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
        blue: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
      },
      // Legacy
      brightness: record.brightness as number,
      hue: record.hue as number,
      blur: record.blur as number,
      filters: (record.filters as string[]) || [],
      // DNG/RAW support
      originalStoragePath: record.original_storage_path as string | undefined,
      isRaw: record.is_raw as boolean,
      originalWidth: record.original_width as number,
      originalHeight: record.original_height as number,
      // Metadata
      takenAt: record.taken_at as string | undefined,
      cameraMake: record.camera_make as string | undefined,
      cameraModel: record.camera_model as string | undefined,
      labels: (record.labels as string[]) || [],
      // Border
      borderWidth: record.border_width as number | undefined,
      borderColor: record.border_color as string | undefined,
    };
  }, [sessionId, setImages]);

  /**
   * Convert database record to PhotoFolder
   */
  const parseDbFolderToPhotoFolder = useCallback((record: Record<string, unknown>): PhotoFolder => {
    return {
      id: record.id as string,
      userId: record.user_id as string,
      name: record.name as string,
      x: record.x as number,
      y: record.y as number,
      width: record.width as number,
      height: record.height as number,
      color: record.color as string,
      type: (record.type as 'folder' | 'social_layout') || 'folder',
      pageCount: record.page_count as number,
      backgroundColor: record.background_color as string | undefined,
      imageIds: [], // Will be populated from photos
    };
  }, []);

  /**
   * Set up realtime subscriptions
   */
  const setupRealtime = useCallback(() => {
    if (!sessionId || channelRef.current) return;

    const channel = supabase.channel(`collab-canvas:${sessionId}`, {
      config: { broadcast: { self: false } },
    });

    // Listen for folder changes
    channel.on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'collab_folders',
        filter: `session_id=eq.${sessionId}`,
      },
      (payload) => {
        const { eventType, new: newRecord, old: oldRecord } = payload;
        
        switch (eventType) {
          case 'INSERT':
            const newFolder = parseDbFolderToPhotoFolder(newRecord as Record<string, unknown>);
            // Check if folder already exists (avoid duplicates)
            setFolders((prev) => {
              if (prev.some((f) => f.id === newFolder.id)) return prev;
              return [...prev, newFolder];
            });
            break;
            
          case 'UPDATE':
            updateFolder((newRecord as Record<string, unknown>).id as string, {
              x: (newRecord as Record<string, unknown>).x as number,
              y: (newRecord as Record<string, unknown>).y as number,
              width: (newRecord as Record<string, unknown>).width as number,
              height: (newRecord as Record<string, unknown>).height as number,
              name: (newRecord as Record<string, unknown>).name as string,
              backgroundColor: (newRecord as Record<string, unknown>).background_color as string | undefined,
            });
            break;
            
          case 'DELETE': {
            const deletedFolderId = (oldRecord as Record<string, unknown>).id as string;
            // Remove images that belonged to this folder
            setImages((prev) => prev.filter((img) => img.folderId !== deletedFolderId));
            setFolders((prev) => prev.filter((f) => f.id !== deletedFolderId));
            break;
          }
        }
      }
    );

    // Listen for photo changes
    channel.on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'collab_photos',
        filter: `session_id=eq.${sessionId}`,
      },
      (payload) => {
        const { eventType, new: newRecord, old: oldRecord } = payload;

        switch (eventType) {
          case 'INSERT': {
            // Quick dedup: skip expensive API calls if image already exists locally
            // (uploader's local state has the image before the DB insert fires realtime)
            const record = newRecord as Record<string, unknown>;
            const recordStoragePath = record.storage_path as string;
            const recordId = record.id as string;
            const currentImages = useCanvasStore.getState().images;
            if (currentImages.some((img) =>
              img.id === recordId ||
              (img.storagePath && img.storagePath === recordStoragePath)
            )) {
              break;
            }

            // Image is from another collaborator - fetch URL and add to canvas
            parseDbPhotoToCanvasImage(record).then((newImage) => {
              let wasAdded = false;
              setImages((prev) => {
                if (prev.some((img) => img.id === newImage.id || (img.storagePath && img.storagePath === newImage.storagePath))) return prev;
                wasAdded = true;
                return [...prev, newImage];
              });
              // Update folder's imageIds so the image renders inside the folder
              if (wasAdded && newImage.folderId) {
                setFolders((prev) =>
                  prev.map((f) =>
                    f.id === newImage.folderId && !f.imageIds.includes(newImage.id)
                      ? { ...f, imageIds: [...f.imageIds, newImage.id] }
                      : f,
                  ),
                );
              }
            });
            break;
          }
            
          case 'UPDATE': {
            const updateRecord = newRecord as Record<string, unknown>;
            const dbId = updateRecord.id as string;
            const dbStoragePath = updateRecord.storage_path as string;
            // Uploader has a local ID (img-xxx), not the DB UUID — fall back to storagePath match
            const currentImages = useCanvasStore.getState().images;
            const targetImage =
              currentImages.find((img) => img.id === dbId) ||
              currentImages.find((img) => img.storagePath === dbStoragePath);
            if (!targetImage) break;
            updateImage(targetImage.id, {
              x: updateRecord.x as number,
              y: updateRecord.y as number,
              width: updateRecord.width as number,
              height: updateRecord.height as number,
              rotation: updateRecord.rotation as number,
              scaleX: updateRecord.scale_x as number,
              scaleY: updateRecord.scale_y as number,
              folderId: updateRecord.folder_id as string | undefined,
              // Light adjustments
              exposure: updateRecord.exposure as number,
              contrast: updateRecord.contrast as number,
              highlights: updateRecord.highlights as number,
              shadows: updateRecord.shadows as number,
              whites: updateRecord.whites as number,
              blacks: updateRecord.blacks as number,
              texture: updateRecord.texture as number,
              // Color adjustments
              temperature: updateRecord.temperature as number,
              vibrance: updateRecord.vibrance as number,
              saturation: updateRecord.saturation as number,
              shadowTint: updateRecord.shadow_tint as number,
              colorHSL: updateRecord.color_hsl as CanvasImage['colorHSL'],
              splitToning: updateRecord.split_toning as CanvasImage['splitToning'],
              colorGrading: updateRecord.color_grading as CanvasImage['colorGrading'],
              colorCalibration: updateRecord.color_calibration as CanvasImage['colorCalibration'],
              // Effects
              clarity: updateRecord.clarity as number,
              dehaze: updateRecord.dehaze as number,
              vignette: updateRecord.vignette as number,
              grain: updateRecord.grain as number,
              grainSize: updateRecord.grain_size as number,
              grainRoughness: updateRecord.grain_roughness as number,
              // Curves
              curves: updateRecord.curves as CanvasImage['curves'],
              // Legacy
              brightness: updateRecord.brightness as number,
              hue: updateRecord.hue as number,
              blur: updateRecord.blur as number,
              filters: updateRecord.filters as string[],
              // Border
              borderWidth: updateRecord.border_width as number | undefined,
              borderColor: updateRecord.border_color as string | undefined,
            });
            break;
          }
            
          case 'DELETE': {
            const deletedId = (oldRecord as Record<string, unknown>).id as string;
            setImages((prev) => prev.filter((img) => img.id !== deletedId));
            // Remove from folder's imageIds
            setFolders((prev) =>
              prev.map((f) =>
                f.imageIds.includes(deletedId)
                  ? { ...f, imageIds: f.imageIds.filter((id) => id !== deletedId) }
                  : f,
              ),
            );
            break;
          }
        }
      }
    );

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        subscribedRef.current = true;
      }
    });

    channelRef.current = channel;
  }, [
    queryClient,
    sessionId,
    userId,
    setImages,
    setFolders,
    updateImage,
    updateFolder,
    parseDbPhotoToCanvasImage,
    parseDbFolderToPhotoFolder,
  ]);

  /**
   * Clean up realtime subscriptions
   */
  const cleanup = useCallback(() => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
      subscribedRef.current = false;
    }
  }, []);

  /**
   * Broadcast cursor position to other collaborators
   */
  const broadcastCursor = useCallback((x: number, y: number) => {
    if (channelRef.current && userId && subscribedRef.current) {
      channelRef.current.send({
        type: 'broadcast',
        event: 'cursor',
        payload: { userId, x, y },
      });
    }
  }, [userId]);

  // Set up and clean up subscriptions
  useEffect(() => {
    setupRealtime();
    return cleanup;
  }, [setupRealtime, cleanup]);

  return {
    broadcastCursor,
  };
}
