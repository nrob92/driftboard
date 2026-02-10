import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { CanvasImage, CanvasText, PhotoFolder, ChannelCurves, ColorHSL, SplitToning } from '@/lib/types';
import { DEFAULT_CURVES } from '@/lib/types';
import { useCanvasStore } from '@/lib/stores/canvasStore';
import {
  FOLDER_COLORS, GRID_CONFIG, SOCIAL_LAYOUT_PAGE_WIDTH, SOCIAL_LAYOUT_MAX_PAGES,
  getFolderBounds,
} from '@/lib/folders/folderLayout';
import { isDNG, decodeDNGFromUrl, getThumbStoragePath } from '@/lib/utils/imageUtils';
import { getCachedImage } from '@/lib/imageCache';

// Edit data that gets saved to Supabase
export interface PhotoEdits {
  storage_path: string;
  user_id: string;
  folder_id?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  scale_x: number;
  scale_y: number;
  exposure: number;
  contrast: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  texture?: number;
  temperature: number;
  vibrance: number;
  saturation: number;
  shadow_tint?: number;
  color_hsl?: ColorHSL;
  split_toning?: SplitToning;
  clarity: number;
  dehaze: number;
  vignette: number;
  grain: number;
  grain_size?: number;
  grain_roughness?: number;
  curves: ChannelCurves;
  brightness: number;
  hue: number;
  blur: number;
  filters: string[];
  original_storage_path?: string;
  is_raw?: boolean;
  original_width?: number;
  original_height?: number;
  taken_at?: string | null;
  camera_make?: string | null;
  camera_model?: string | null;
  labels?: string[] | null;
  // Border
  border_width?: number | null;
  border_color?: string | null;
  // Color grading
  color_grading?: unknown;
  color_calibration?: unknown;
}

interface UsePhotoLoaderOptions {
  user: User | null;
  skipNextPhotosLoadRef: React.MutableRefObject<boolean>;
  onPhotosLoadStateChange?: (loading: boolean) => void;
  setHistory: React.Dispatch<React.SetStateAction<{ images: CanvasImage[]; texts: CanvasText[]; folders: PhotoFolder[] }[]>>;
  setHistoryIndex: React.Dispatch<React.SetStateAction<number>>;
}

export function usePhotoLoader({
  user,
  skipNextPhotosLoadRef,
  onPhotosLoadStateChange,
  setHistory,
  setHistoryIndex,
}: UsePhotoLoaderOptions) {
  const queryClient = useQueryClient();

  // React Query for fetching photo metadata (cached for fast reloads). Fetch all data; filter is show/hide in UI only.
  const { data: photoData } = useQuery({
    queryKey: ['user-photos', user?.id],
    queryFn: async () => {
      if (!user) return null;

      const [editsResult, foldersResult, photosResult, originalsResult] = await Promise.all([
        supabase.from('photo_edits').select('*').eq('user_id', user.id),
        supabase.from('photo_folders').select('*').eq('user_id', user.id),
        supabase.storage.from('photos').list(user.id, {
          limit: 500,
          sortBy: { column: 'created_at', order: 'asc' },
        }),
        supabase.storage.from('originals').list(user.id, {
          limit: 500,
          sortBy: { column: 'created_at', order: 'asc' },
        }),
      ]);

      return {
        savedEdits: editsResult.data,
        savedFolders: foldersResult.data,
        photosFiles: photosResult.data,
        originalsFiles: originalsResult.data,
        photosError: photosResult.error,
      };
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  // Track load key (user + filter) to prevent duplicate processing
  const loadKeyRef = useRef<string | null>(null);

  // Process photos from cached query data (load all; filter is show/hide in UI only)
  useEffect(() => {
    const loadUserPhotos = async () => {
      if (!user || !photoData) return;
      if (skipNextPhotosLoadRef.current) {
        skipNextPhotosLoadRef.current = false;
        onPhotosLoadStateChange?.(false);
        return;
      }
      const loadKey = user.id;
      if (loadKeyRef.current === loadKey) {
        onPhotosLoadStateChange?.(false);
        return;
      }

      const { setImages, setFolders, setStagePosition } = useCanvasStore.getState();
      const { savedEdits, savedFolders, photosFiles, originalsFiles, photosError } = photoData;

      const defaultFolderX = 100;
      const defaultFolderY = 100;
      const buildFoldersFromSaved = (imagesList: CanvasImage[]): PhotoFolder[] => {
        const out: PhotoFolder[] = [];
        if (!savedFolders?.length) return out;
        for (const sf of savedFolders) {
          const folderId = String(sf.id);
          const folderImageIds = imagesList.filter((img) => img.folderId === folderId).map((img) => img.id);
          const sfX = sf.x != null && Number.isFinite(Number(sf.x)) ? Number(sf.x) : defaultFolderX;
          const sfY = sf.y != null && Number.isFinite(Number(sf.y)) ? Number(sf.y) : defaultFolderY;
          const isLayout = sf.type === 'social_layout';
          const pageCount = isLayout && sf.page_count != null ? Math.max(1, Math.min(SOCIAL_LAYOUT_MAX_PAGES, Number(sf.page_count))) : undefined;
          const layoutWidth = isLayout && pageCount ? pageCount * SOCIAL_LAYOUT_PAGE_WIDTH : undefined;
          const sfWidth = layoutWidth ?? (sf.width != null && Number.isFinite(Number(sf.width)) ? Number(sf.width) : GRID_CONFIG.defaultFolderWidth);
          const sfHeight = sf.height != null && Number.isFinite(Number(sf.height)) ? Number(sf.height) : undefined;
          out.push({
            id: folderId,
            name: String(sf.name ?? 'Untitled'),
            x: sfX,
            y: sfY,
            width: sfWidth,
            height: sfHeight,
            color: String(sf.color ?? FOLDER_COLORS[0]),
            imageIds: folderImageIds,
            type: isLayout ? 'social_layout' : 'folder',
            pageCount,
            backgroundColor: isLayout && sf.background_color ? String(sf.background_color) : undefined,
          });
        }
        return out;
      };

      // Check if there are any files to load
      const photosList = (photosFiles ?? []).filter((f) => !f.name.startsWith('.'));
      const originalsList = (originalsFiles ?? []).filter((f) => !f.name.startsWith('.'));
      if (photosList.length === 0 && originalsList.length === 0) {
        loadKeyRef.current = loadKey;
        setImages([]);
        setFolders(buildFoldersFromSaved([]));
        setHistory([{ images: [], texts: [], folders: buildFoldersFromSaved([]) }]);
        setHistoryIndex(0);
        onPhotosLoadStateChange?.(false);
        return;
      }

      onPhotosLoadStateChange?.(true);

      try {
        const photosBaseNames = new Set(photosList.map((f) => f.name.replace(/\.[^.]+$/, '').toLowerCase()));
        const originalsOnly = originalsList.filter(
          (f) => !photosBaseNames.has(f.name.replace(/\.[^.]+$/, '').toLowerCase())
        );

        type FileEntry = { name: string; bucket: 'photos' | 'originals' };
        const validFiles: FileEntry[] = [
          ...photosList.map((f) => ({ name: f.name, bucket: 'photos' as const })),
          ...originalsOnly.map((f) => ({ name: f.name, bucket: 'originals' as const })),
        ];

        if (photosError) return;

        if (validFiles.length === 0) {
          loadKeyRef.current = loadKey;
          setImages([]);
          setFolders([]);
          setHistory([{ images: [], texts: [], folders: [] }]);
          setHistoryIndex(0);
          onPhotosLoadStateChange?.(false);
          return;
        }

        const cols = 3;
        const spacing = 420;
        const maxSize = GRID_CONFIG.imageMaxSize;

        const SIGNED_URL_STALE_MS = 55 * 60 * 1000;
        const loadOne = async (file: FileEntry, i: number): Promise<CanvasImage | null> => {
          const storagePath = `${user.id}/${file.name}`;
          const bucket = file.bucket;

          // Always use thumbnail for grid display to minimize egress.
          // The /api/thumbnail endpoint generates + caches thumbs on-demand server-side.
          // DNG files in originals bucket: they should have a preview JPG in photos bucket
          // (uploaded during DNG upload flow), so they won't appear as originals-only here.
          // If they do, fall back to signed URL for the original.
          const isRawFile = isDNG(file.name) && file.bucket === 'originals';

          let imageUrl: string;
          try {
            if (isRawFile) {
              // RAW files can't be thumbnailed server-side — use signed URL directly
              imageUrl = await queryClient.ensureQueryData({
                queryKey: ['signed-url', bucket, storagePath],
                queryFn: async () => {
                  const res = await fetch('/api/signed-url', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ bucket, path: storagePath }),
                  });
                  if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    throw new Error(err?.error ?? 'Signed URL failed');
                  }
                  const { signedUrl } = await res.json();
                  return signedUrl as string;
                },
                staleTime: SIGNED_URL_STALE_MS,
              });
            } else {
              // Use thumbnail API — generates thumb server-side if missing,
              // returns cached thumb signed URL if it already exists.
              // This downloads ~50-100KB instead of 5-10MB per image.
              imageUrl = await queryClient.ensureQueryData({
                queryKey: ['thumbnail-url', bucket, storagePath],
                queryFn: async () => {
                  const res = await fetch('/api/thumbnail', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ bucket, path: storagePath }),
                  });
                  if (!res.ok) {
                    // Fallback to full-res signed URL if thumbnail API fails
                    const fallbackRes = await fetch('/api/signed-url', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ bucket, path: storagePath }),
                    });
                    if (!fallbackRes.ok) {
                      const err = await fallbackRes.json().catch(() => ({}));
                      throw new Error(err?.error ?? 'Signed URL failed');
                    }
                    const { signedUrl } = await fallbackRes.json();
                    return signedUrl as string;
                  }
                  const data = await res.json();
                  // If the API returned a signed URL
                  if (data.signedUrl) return data.signedUrl as string;
                  // Shouldn't happen, but fallback
                  throw new Error('No signed URL in thumbnail response');
                },
                staleTime: SIGNED_URL_STALE_MS,
              });
            }
          } catch (e) {
            console.warn(`Image URL failed for ${file.name}:`, e);
            return null;
          }

          try {
            let imgSrc: string;
            let width: number;
            let height: number;

            if (isRawFile) {
              const decoded = await decodeDNGFromUrl(imageUrl);
              imgSrc = decoded.dataUrl;
              width = decoded.width;
              height = decoded.height;
            } else {
              const thumbPath = getThumbStoragePath(storagePath);
              const blob = await getCachedImage(thumbPath, async () => {
                const response = await fetch(imageUrl);
                if (!response.ok) throw new Error('Failed to fetch image');
                return response.blob();
              });
              const objectUrl = URL.createObjectURL(blob);
              const img = new window.Image();
              img.crossOrigin = 'anonymous';
              await new Promise<void>((resolve, reject) => {
                img.onload = () => resolve();
                img.onerror = () => reject(new Error('Failed to load'));
                img.src = objectUrl;
              });
              imgSrc = objectUrl;
              width = img.width;
              height = img.height;
            }

            if (width > maxSize || height > maxSize) {
              const ratio = Math.min(maxSize / width, maxSize / height);
              width = width * ratio;
              height = height * ratio;
            }

            const col = i % cols;
            const row = Math.floor(i / cols);
            const gridX = 100 + col * spacing;
            const gridY = 100 + row * spacing;

            const edit = savedEdits?.find(
              (e: PhotoEdits) =>
                e.storage_path === storagePath ||
                (e.original_storage_path != null && e.original_storage_path === storagePath)
            );

            const hasValidPosition = edit != null
              && edit.x != null
              && edit.y != null
              && Number.isFinite(Number(edit.x))
              && Number.isFinite(Number(edit.y));
            const x = hasValidPosition ? Number(edit.x) : gridX;
            const y = hasValidPosition ? Number(edit.y) : gridY;

            const canvasImg: CanvasImage = {
              id: `img-${Date.now()}-${i}-${Math.random()}`,
              x,
              y,
              width,
              height,
              src: imgSrc,
              storagePath,
              rotation: 0,
              scaleX: 1,
              scaleY: 1,
              exposure: 0,
              contrast: 0,
              highlights: 0,
              shadows: 0,
              whites: 0,
              blacks: 0,
              temperature: 0,
              vibrance: 0,
              saturation: 0,
              clarity: 0,
              dehaze: 0,
              vignette: 0,
              grain: 0,
              curves: { ...DEFAULT_CURVES },
              brightness: 0,
              hue: 0,
              blur: 0,
              filters: [],
            };

            if (edit) {
              if (edit.original_storage_path != null) canvasImg.originalStoragePath = edit.original_storage_path;
              let savedWidth = edit.width ?? width;
              let savedHeight = edit.height ?? height;
              if (savedWidth > maxSize || savedHeight > maxSize) {
                const ratio = Math.min(maxSize / savedWidth, maxSize / savedHeight);
                savedWidth = savedWidth * ratio;
                savedHeight = savedHeight * ratio;
              }
              canvasImg.width = savedWidth;
              canvasImg.height = savedHeight;
              canvasImg.folderId = edit.folder_id != null ? String(edit.folder_id) : undefined;
              canvasImg.rotation = edit.rotation ?? 0;
              canvasImg.scaleX = edit.scale_x ?? 1;
              if (edit.taken_at != null) canvasImg.takenAt = edit.taken_at;
              if (edit.camera_make != null) canvasImg.cameraMake = edit.camera_make;
              if (edit.camera_model != null) canvasImg.cameraModel = edit.camera_model;
              if (edit.labels != null && Array.isArray(edit.labels)) canvasImg.labels = edit.labels;
              canvasImg.scaleY = edit.scale_y ?? 1;
              canvasImg.exposure = edit.exposure ?? 0;
              canvasImg.contrast = edit.contrast ?? 0;
              canvasImg.highlights = edit.highlights ?? 0;
              canvasImg.shadows = edit.shadows ?? 0;
              canvasImg.whites = edit.whites ?? 0;
              canvasImg.blacks = edit.blacks ?? 0;
              canvasImg.texture = edit.texture ?? 0;
              canvasImg.temperature = edit.temperature ?? 0;
              canvasImg.vibrance = edit.vibrance ?? 0;
              canvasImg.saturation = edit.saturation ?? 0;
              canvasImg.shadowTint = edit.shadow_tint ?? 0;
              canvasImg.colorHSL = edit.color_hsl ?? undefined;
              canvasImg.splitToning = edit.split_toning ?? undefined;
              canvasImg.colorGrading = edit.color_grading as CanvasImage['colorGrading'];
              canvasImg.colorCalibration = edit.color_calibration as CanvasImage['colorCalibration'];
              canvasImg.clarity = edit.clarity ?? 0;
              canvasImg.dehaze = edit.dehaze ?? 0;
              canvasImg.vignette = edit.vignette ?? 0;
              canvasImg.grain = edit.grain ?? 0;
              canvasImg.grainSize = edit.grain_size ?? 0;
              canvasImg.grainRoughness = edit.grain_roughness ?? 0;
              canvasImg.curves = edit.curves ?? { ...DEFAULT_CURVES };
              canvasImg.brightness = edit.brightness ?? 0;
              canvasImg.hue = edit.hue ?? 0;
              canvasImg.blur = edit.blur ?? 0;
              canvasImg.filters = edit.filters ?? [];
              canvasImg.borderWidth = edit.border_width ?? undefined;
              canvasImg.borderColor = edit.border_color ?? undefined;
            }

            return canvasImg;
          } catch (e) {
            console.warn(`Failed to load image: ${file.name}`, e);
            return null;
          }
        };

        // Lazy load: prioritize visible images (top rows), load rest in chunks to reduce initial egress
        const INITIAL_BATCH = 12;
        const CHUNK_SIZE = 6;
        const CHUNK_DELAY_MS = 150;
        const loadedImages: CanvasImage[] = [];
        const loadBatch = async (start: number, end: number) => {
          for (let i = start; i < end && i < validFiles.length; i++) {
            const image = await loadOne(validFiles[i], i);
            if (image) {
              loadedImages.push(image);
              setImages([...loadedImages]);
              setFolders(buildFoldersFromSaved(loadedImages));
            }
          }
        };
        await loadBatch(0, INITIAL_BATCH);
        for (let start = INITIAL_BATCH; start < validFiles.length; start += CHUNK_SIZE) {
          await new Promise((r) => setTimeout(r, CHUNK_DELAY_MS));
          await loadBatch(start, start + CHUNK_SIZE);
        }
        const newImages = loadedImages;

        // Apply any remaining edit fields to images
        // Objects may be frozen by immer (from incremental setImages calls above),
        // so shallow-copy before mutating
        if (savedEdits && savedEdits.length > 0) {
          for (let i = 0; i < newImages.length; i++) {
            const edit = savedEdits.find(
              (e: PhotoEdits) =>
                e.storage_path === newImages[i].storagePath ||
                e.storage_path === (newImages[i].originalStoragePath ?? '') ||
                (e.original_storage_path != null && e.original_storage_path === newImages[i].storagePath)
            );
            if (edit) {
              const img = { ...newImages[i] }; // unfreeze: shallow copy
              newImages[i] = img;
              const hasValidPosition = edit.x != null && edit.y != null
                && Number.isFinite(Number(edit.x)) && Number.isFinite(Number(edit.y));
              if (hasValidPosition) {
                img.x = Number(edit.x);
                img.y = Number(edit.y);
              }
              if (edit.original_storage_path != null) img.originalStoragePath = edit.original_storage_path;
              let savedWidth = edit.width ?? img.width;
              let savedHeight = edit.height ?? img.height;
              const mSize = GRID_CONFIG.imageMaxSize;
              if (savedWidth > mSize || savedHeight > mSize) {
                const ratio = Math.min(mSize / savedWidth, mSize / savedHeight);
                savedWidth = savedWidth * ratio;
                savedHeight = savedHeight * ratio;
              }
              img.width = savedWidth;
              img.height = savedHeight;
              img.folderId = edit.folder_id != null ? String(edit.folder_id) : undefined;
              img.rotation = edit.rotation ?? 0;
              img.scaleX = edit.scale_x ?? 1;
              img.scaleY = edit.scale_y ?? 1;
              if (edit.taken_at != null) img.takenAt = edit.taken_at;
              if (edit.camera_make != null) img.cameraMake = edit.camera_make;
              if (edit.camera_model != null) img.cameraModel = edit.camera_model;
              if (edit.labels != null && Array.isArray(edit.labels)) img.labels = edit.labels;
              img.exposure = edit.exposure ?? 0;
              img.contrast = edit.contrast ?? 0;
              img.highlights = edit.highlights ?? 0;
              img.shadows = edit.shadows ?? 0;
              img.whites = edit.whites ?? 0;
              img.blacks = edit.blacks ?? 0;
              img.texture = edit.texture ?? 0;
              img.temperature = edit.temperature ?? 0;
              img.vibrance = edit.vibrance ?? 0;
              img.saturation = edit.saturation ?? 0;
              img.shadowTint = edit.shadow_tint ?? 0;
              img.colorHSL = edit.color_hsl ?? undefined;
              img.splitToning = edit.split_toning ?? undefined;
              img.colorGrading = edit.color_grading as CanvasImage['colorGrading'];
              img.colorCalibration = edit.color_calibration as CanvasImage['colorCalibration'];
              img.clarity = edit.clarity ?? 0;
              img.dehaze = edit.dehaze ?? 0;
              img.vignette = edit.vignette ?? 0;
              img.grain = edit.grain ?? 0;
              img.grainSize = edit.grain_size ?? 0;
              img.grainRoughness = edit.grain_roughness ?? 0;
              img.curves = edit.curves ?? { ...DEFAULT_CURVES };
              img.brightness = edit.brightness ?? 0;
              img.hue = edit.hue ?? 0;
              img.blur = edit.blur ?? 0;
              img.filters = edit.filters ?? [];
            }
          }
        }

        const loadedFolders = buildFoldersFromSaved(newImages);

        loadKeyRef.current = loadKey;
        setImages(newImages);
        setFolders(loadedFolders);
        setHistory([{ images: newImages, texts: [], folders: loadedFolders }]);
        setHistoryIndex(0);

        if (newImages.length > 0) {
          if (loadedFolders.length > 0) {
            let minX = Infinity, maxX = -Infinity;
            let minY = Infinity, maxY = -Infinity;

            for (const folder of loadedFolders) {
              const folderImgCount = newImages.filter(img => folder.imageIds.includes(img.id)).length;
              const bounds = getFolderBounds(folder, folderImgCount);
              minX = Math.min(minX, bounds.x);
              maxX = Math.max(maxX, bounds.right);
              minY = Math.min(minY, bounds.y);
              maxY = Math.max(maxY, bounds.bottom);
            }

            const contentCenterX = (minX + maxX) / 2;
            const contentCenterY = (minY + maxY) / 2;
            const viewportCenterX = window.innerWidth / 2;
            const viewportCenterY = window.innerHeight / 2;

            setStagePosition({
              x: viewportCenterX - contentCenterX,
              y: viewportCenterY - contentCenterY,
            });
          }
        }
      } catch (err) {
        console.error('Error loading user photos:', err);
      } finally {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            onPhotosLoadStateChange?.(false);
          });
        });
      }
    };

    loadUserPhotos();
  }, [user, photoData, onPhotosLoadStateChange, queryClient, skipNextPhotosLoadRef, setHistory, setHistoryIndex]);

  return { photoData };
}
