import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CanvasImage } from '@/lib/types';
import { supabase } from '@/lib/supabase';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface UseAutoSaveOptions {
  user: { id: string } | null;
  images: CanvasImage[];
  selectedIds: string[];
  debounceMs?: number;
}

interface UseAutoSaveReturn {
  saveStatus: SaveStatus;
  setSaveStatus: (status: SaveStatus) => void;
  handleSave: (silent?: boolean) => Promise<void>;
}

export function useAutoSave({ user, images, selectedIds, debounceMs = 800 }: UseAutoSaveOptions): UseAutoSaveReturn {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const saveStatusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Save edits to Supabase database. silent = true for auto-save (no alerts, use saveStatus).
  const handleSave = useCallback(async (silent = false) => {
    if (!user) {
      if (!silent) alert('Please sign in to save your edits');
      return;
    }

    setSaveStatus('saving');

    const imagesToSave = images.filter(img => img.storagePath || img.originalStoragePath);
    if (imagesToSave.length === 0) {
      setSaveStatus('idle');
      if (!silent) alert('No photos to save. Upload some photos first!');
      return;
    }

    try {
      // Canonical key: prefer photos path, else originals path (for DNG-only)
      const editsToSave = imagesToSave.map(img => ({
        storage_path: img.storagePath || img.originalStoragePath!,
        user_id: user.id,
        folder_id: img.folderId || null,
        x: Math.round(img.x),
        y: Math.round(img.y),
        width: Math.round(img.width),
        height: Math.round(img.height),
        rotation: img.rotation,
        scale_x: img.scaleX,
        scale_y: img.scaleY,
        // Light
        exposure: img.exposure,
        contrast: img.contrast,
        highlights: img.highlights,
        shadows: img.shadows,
        whites: img.whites,
        blacks: img.blacks,
        texture: img.texture ?? 0,
        // Color
        temperature: img.temperature,
        vibrance: img.vibrance,
        saturation: img.saturation,
        shadow_tint: img.shadowTint ?? 0,
        color_hsl: img.colorHSL ?? null,
        split_toning: img.splitToning ?? null,
        color_grading: img.colorGrading ?? null,
        color_calibration: img.colorCalibration ?? null,
        // Effects
        clarity: img.clarity,
        dehaze: img.dehaze,
        vignette: img.vignette,
        grain: img.grain,
        grain_size: img.grainSize ?? 0,
        grain_roughness: img.grainRoughness ?? 0,
        // Curves
        curves: img.curves,
        // Legacy
        brightness: img.brightness,
        hue: img.hue,
        blur: img.blur,
        filters: img.filters,
        // DNG/RAW support
        original_storage_path: img.originalStoragePath ?? null,
        is_raw: img.isRaw ?? false,
        original_width: img.originalWidth ?? null,
        original_height: img.originalHeight ?? null,
        taken_at: img.takenAt ?? null,
        camera_make: img.cameraMake ?? null,
        camera_model: img.cameraModel ?? null,
        labels: img.labels ?? null,
      }));

      // Upsert edits (insert or update)
      const { error } = await supabase
        .from('photo_edits')
        .upsert(editsToSave, {
          onConflict: 'storage_path,user_id',
        });

      if (error) {
        console.error('Save error:', error);
        setSaveStatus('error');
        if (!silent) alert(`Failed to save edits: ${error.message}`);
        return;
      }

      setSaveStatus('saved');
      if (!silent) alert('Edits saved successfully! Your original photos are preserved.');

      // Reset to idle after a short delay (for auto-save feedback)
      if (saveStatusTimeoutRef.current) clearTimeout(saveStatusTimeoutRef.current);
      saveStatusTimeoutRef.current = setTimeout(() => {
        setSaveStatus('idle');
        saveStatusTimeoutRef.current = null;
      }, 2000);
    } catch (error) {
      console.error('Save error:', error);
      setSaveStatus('error');
      if (!silent) alert('Failed to save edits');
    }
  }, [user, images]);

  // Auto-save: debounce save when the selected photo's edits change
  const selectedImageEditSignature = useMemo(() => {
    if (selectedIds.length !== 1) return null;
    const img = images.find((i) => i.id === selectedIds[0]);
    if (!img || !('src' in img) || !(img.storagePath || img.originalStoragePath)) return null;
    return JSON.stringify({
      folder_id: img.folderId || null,
      x: Math.round(img.x),
      y: Math.round(img.y),
      width: Math.round(img.width),
      height: Math.round(img.height),
      rotation: img.rotation,
      scale_x: img.scaleX,
      scale_y: img.scaleY,
      exposure: img.exposure,
      contrast: img.contrast,
      highlights: img.highlights,
      shadows: img.shadows,
      whites: img.whites,
      blacks: img.blacks,
      texture: img.texture ?? 0,
      temperature: img.temperature,
      vibrance: img.vibrance,
      saturation: img.saturation,
      shadow_tint: img.shadowTint ?? 0,
      color_hsl: img.colorHSL ?? null,
      split_toning: img.splitToning ?? null,
      color_grading: img.colorGrading ?? null,
      color_calibration: img.colorCalibration ?? null,
      clarity: img.clarity,
      dehaze: img.dehaze,
      vignette: img.vignette,
      grain: img.grain,
      grain_size: img.grainSize ?? 0,
      grain_roughness: img.grainRoughness ?? 0,
      curves: img.curves,
      brightness: img.brightness,
      hue: img.hue,
      blur: img.blur,
      filters: img.filters,
      borderWidth: img.borderWidth,
      borderColor: img.borderColor,
    });
  }, [images, selectedIds]);

  useEffect(() => {
    if (!selectedImageEditSignature || !user) return;
    if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current);
    autoSaveTimeoutRef.current = setTimeout(() => {
      handleSave(true);
      autoSaveTimeoutRef.current = null;
    }, debounceMs);
    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
        autoSaveTimeoutRef.current = null;
      }
    };
  }, [selectedImageEditSignature, user, handleSave, debounceMs]);

  return { saveStatus, setSaveStatus, handleSave };
}
