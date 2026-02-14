import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CanvasImage } from "@/lib/types";
import { supabase } from "@/lib/supabase";

type SaveStatus = "idle" | "saving" | "saved" | "error";

interface UseAutoSaveOptions {
  user: { id: string } | null;
  images: CanvasImage[];
  selectedIds: string[];
  debounceMs?: number;
  sessionId?: string;
}

interface UseAutoSaveReturn {
  saveStatus: SaveStatus;
  setSaveStatus: (status: SaveStatus) => void;
  handleSave: (silent?: boolean) => Promise<void>;
}

/** Edit signature for dirty tracking — matches fields we upsert to photo_edits or collab_photos */
function getEditSignature(img: CanvasImage): string {
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
    border_width: img.borderWidth,
    border_color: img.borderColor,
    original_storage_path: img.originalStoragePath ?? null,
    is_raw: img.isRaw ?? false,
    original_width: img.originalWidth ?? null,
    original_height: img.originalHeight ?? null,
    taken_at: img.takenAt ?? null,
    camera_make: img.cameraMake ?? null,
    camera_model: img.cameraModel ?? null,
    labels: img.labels || [],
  });
}

export function useAutoSave({
  user,
  images,
  selectedIds,
  debounceMs = 800,
  sessionId,
}: UseAutoSaveOptions): UseAutoSaveReturn {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const saveStatusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const autoSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<Map<string, string>>(new Map());
  const imagesRef = useRef<CanvasImage[]>(images);

  // Keep imagesRef in sync with the latest images
  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  // Save edits to Supabase database. silent = true for auto-save (no alerts, use saveStatus).
  // Dirty tracking: only upsert images whose edits differ from last save.
  const handleSave = useCallback(
    async (silent = false) => {
      // Add sessionId as a dependency (fix for lint/React Compiler warning)
      if (!user) {
        if (!silent) alert("Please sign in to save your edits");
        return;
      }

      setSaveStatus("saving");

      // Always operate on latest images state
      const imagesToSave = imagesRef.current.filter(
        (img) => img.storagePath || img.originalStoragePath,
      );
      if (imagesToSave.length === 0) {
        setSaveStatus("idle");
        if (!silent) alert("No photos to save. Upload some photos first!");
        return;
      }

      // Only save images that have changed since last save (dirty tracking)
      const dirtyImages = imagesToSave.filter((img) => {
        const path = img.storagePath || img.originalStoragePath;
        if (!path) return false;
        const sig = getEditSignature(img);
        return lastSavedRef.current.get(path) !== sig;
      });

      if (dirtyImages.length === 0) {
        setSaveStatus("idle");
        return;
      }

      try {
        // Canonical key: prefer photos path, else originals path (for DNG-only)
        const editsToSave = dirtyImages.map((img) => ({
          storage_path: img.storagePath || img.originalStoragePath!,
          user_id: user.id,
          ...(sessionId ? { session_id: sessionId } : {}),
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
          labels: img.labels || [],
          border_width: img.borderWidth,
          border_color: img.borderColor,
        }));

        // Deduplicate by conflict key to avoid "ON CONFLICT DO UPDATE cannot affect row a second time"
        const uniqueEditsMap = new Map<string, typeof editsToSave[0]>();
        for (const edit of editsToSave) {
          const key = sessionId 
            ? `${edit.storage_path}-${edit.session_id}` 
            : `${edit.storage_path}-${edit.user_id}`;
          // Keep the last occurrence (most recent edit)
          uniqueEditsMap.set(key, edit);
        }
        const uniqueEdits = Array.from(uniqueEditsMap.values());

        const tableName = sessionId ? "collab_photos" : "photo_edits";
        const conflictOn = sessionId
          ? "storage_path,session_id"
          : "storage_path,user_id";

        // Upsert edits (insert or update)
        const { error } = await supabase.from(tableName).upsert(uniqueEdits, {
          onConflict: conflictOn,
        });

        if (error) {
          console.error("Save error:", error);
          setSaveStatus("error");
          if (!silent) alert(`Failed to save edits: ${error.message}`);
          return;
        }

        // Update last-saved state for dirty tracking
        for (const img of dirtyImages) {
          const path = img.storagePath || img.originalStoragePath;
          if (!path) continue;
          lastSavedRef.current.set(path, getEditSignature(img));
        }

        setSaveStatus("saved");
        if (!silent)
          alert(
            "Edits saved successfully! Your original photos are preserved.",
          );

        // Reset to idle after a short delay (for auto-save feedback)
        if (saveStatusTimeoutRef.current)
          clearTimeout(saveStatusTimeoutRef.current);
        saveStatusTimeoutRef.current = setTimeout(() => {
          setSaveStatus("idle");
          saveStatusTimeoutRef.current = null;
        }, 2000);
      } catch (error) {
        console.error("Save error:", error);
        setSaveStatus("error");
        if (!silent) alert("Failed to save edits");
      }
    },
    [user, sessionId], // FIX: Include sessionId for correct memoization
  );

  // Clear lastSavedRef when user changes (e.g. logout or switch account)
  useEffect(() => {
    lastSavedRef.current.clear();
  }, [user?.id]);

  // Seed lastSavedRef when images first load from DB (so we don't save unchanged images on first edit)
  useEffect(() => {
    if (images.length > 0 && lastSavedRef.current.size === 0) {
      for (const img of images) {
        const path = img.storagePath || img.originalStoragePath;
        if (path) lastSavedRef.current.set(path, getEditSignature(img));
      }
    }
  }, [images]);

  // Auto-save: debounce save when the selected photo's edits change
  const selectedImageEditSignature = useMemo(() => {
    if (selectedIds.length !== 1) return null;
    const img = images.find((i) => i.id === selectedIds[0]);
    if (
      !img ||
      !("src" in img) ||
      !(img.storagePath || img.originalStoragePath)
    )
      return null;
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
