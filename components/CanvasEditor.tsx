'use client';

import React, { useCallback, useEffect, useRef, useState, useMemo, startTransition } from 'react';
import { Stage, Layer, Image as KonvaImage, Text, Rect, Group, Shape } from 'react-konva';
import Konva from 'konva';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { TopBar } from './TopBar';
import { EditPanel } from './EditPanel';
import { snapToGrid, findNearestPhoto } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import {
  type ChannelCurves, type ColorHSL,
  type SplitToning, type ColorGrading, type ColorCalibration,
  type CanvasImage, type CanvasText, type PhotoFolder, type Preset,
  DEFAULT_CURVES, EDIT_KEYS, cloneEditValue,
} from '@/lib/types';
import { useCanvasStore, selectImages, selectSelectedIds, selectFolders, selectStageScale, selectStagePosition, selectDimensions } from '@/lib/stores/canvasStore';
import { useUIStore } from '@/lib/stores/uiStore';
import { useEditStore } from '@/lib/stores/editStore';
import { useInteractionStore } from '@/lib/stores/interactionStore';
import { useViewportCulling } from '@/lib/hooks/useViewportCulling';
import { useIsMobile } from '@/lib/hooks/useIsMobile';
import { getCachedImage } from '@/lib/imageCache';
import { useAutoSave } from '@/lib/hooks/useAutoSave';
import { useExport } from '@/lib/hooks/useExport';
import { buildExportFilterList, exportWithCanvasFilters } from '@/lib/filters/clientFilters';
import { ImageNode } from '@/components/canvas/ImageNode';
import { useUpload } from '@/lib/hooks/useUpload';
import { isDNG, decodeDNG, decodeDNGFromUrl, getThumbStoragePath } from '@/lib/utils/imageUtils';
import {
  SOCIAL_LAYOUT_ASPECT, SOCIAL_LAYOUT_PAGE_WIDTH, SOCIAL_LAYOUT_MAX_PAGES,
  DEFAULT_SOCIAL_LAYOUT_BG, FOLDER_COLORS, GRID_CONFIG, CELL_SIZE, CELL_HEIGHT,
  LAYOUT_IMPORT_MAX_WIDTH, LAYOUT_IMPORT_MAX_HEIGHT,
  isSocialLayout, getSocialLayoutDimensions, hexToRgba,
  calculateColsFromWidth, getFolderLayoutMode, reflowImagesInFolder,
  getFolderBounds, getFolderBorderHeight, distanceToRectBorder,
  getImageCellPositions, calculateMinimumFolderSize, smartRepackImages,
  positionImagesInCells, rectsOverlap, resolveFolderOverlaps,
  getFolderImagesSorted,
  type ImageCellPosition, type CellAssignment,
} from '@/lib/folders/folderLayout';


const GRID_SIZE = 50;

// Types imported from @/lib/types

// Build delete-photo API payload: storagePath = path in photos bucket, originalStoragePath = path in originals bucket
function getDeletePhotoPayload(img: CanvasImage): { storagePath?: string; originalStoragePath?: string } {
  if (img.originalStoragePath) {
    // DNG with preview: storagePath is preview (photos), originalStoragePath is originals
    return {
      storagePath: img.storagePath ?? undefined,
      originalStoragePath: img.originalStoragePath,
    };
  }
  if (img.storagePath?.toLowerCase().endsWith('.dng')) {
    // Originals-only DNG: only in originals bucket
    return { originalStoragePath: img.storagePath };
  }
  // JPG/PNG/WebP in photos bucket
  return { storagePath: img.storagePath ?? undefined };
}

// EDIT_KEYS and cloneEditValue imported from @/lib/types

function getEditSnapshot(img: CanvasImage): Partial<CanvasImage> {
  const out: Partial<CanvasImage> = {};
  for (const key of EDIT_KEYS) {
    const v = img[key as keyof CanvasImage];
    (out as Record<string, unknown>)[key] = cloneEditValue(key as keyof CanvasImage, v);
  }
  return out;
}

// Edit data that gets saved to Supabase
interface PhotoEdits {
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
  // DNG/RAW support
  original_storage_path?: string;
  is_raw?: boolean;
  original_width?: number;
  original_height?: number;
  // Filter search
  taken_at?: string | null;
  camera_make?: string | null;
  camera_model?: string | null;
  labels?: string[] | null;
}

// CanvasText imported from @/lib/types


type CanvasEditorProps = {
  onPhotosLoadStateChange?: (loading: boolean) => void;
};

export function CanvasEditor({ onPhotosLoadStateChange }: CanvasEditorProps = {}) {
  const stageRef = useRef<Konva.Stage>(null);
  const folderLabelRefs = useRef<Record<string, Konva.Text>>({});
  const [folderLabelWidths, setFolderLabelWidths] = useState<Record<string, number>>({});
  // Core data & viewport from Zustand (single source of truth)
  const images = useCanvasStore(selectImages);
  const texts = useCanvasStore((s) => s.texts);
  const folders = useCanvasStore(selectFolders);
  const selectedIds = useCanvasStore(selectSelectedIds);
  const stageScale = useCanvasStore(selectStageScale);
  const stagePosition = useCanvasStore(selectStagePosition);
  const dimensions = useCanvasStore(selectDimensions);
  const canvasActions = useCanvasStore.getState();
  const setImages = canvasActions.setImages;
  const setTexts = canvasActions.setTexts;
  const setFolders = canvasActions.setFolders;
  const setSelectedIds = canvasActions.setSelectedIds;
  const setStageScale = canvasActions.setStageScale;
  const setStagePosition = canvasActions.setStagePosition;
  const setDimensions = canvasActions.setDimensions;
  const lastSelectedIdRef = useRef<string | null>(null);
  const lastMultiSelectionRef = useRef<string[] | null>(null);
  const [, setHistory] = useState<{ images: CanvasImage[]; texts: CanvasText[]; folders: PhotoFolder[] }[]>([{ images: [], texts: [], folders: [] }]);
  const [historyIndex, setHistoryIndex] = useState(0);
  // Undo/redo only for photo edits (sliders, curves); does not touch structure, placement, or deleted photos
  // Edit store (undo/redo, bypass, copy)
  const editHistory = useEditStore((s) => s.editHistory);
  const editRedoStack = useEditStore((s) => s.editRedoStack);
  const bypassedTabs = useEditStore((s) => s.bypassedTabs);
  const copiedEdit = useEditStore((s) => s.copiedEdit);
  const editActions = useEditStore.getState();
  const setEditHistory = editActions.setEditHistory;
  const setEditRedoStack = editActions.setEditRedoStack;
  const setBypassedTabs = editActions.setBypassedTabs;
  const setCopiedEdit = editActions.setCopiedEdit;
  const lastEditHistoryPushRef = useRef(0);
  const EDIT_HISTORY_DEBOUNCE_MS = 400;

  // Interaction store (drag, touch, hover)
  const isDragging = useInteractionStore((s) => s.isDragging);
  const isAdjustingSliders = useInteractionStore((s) => s.isAdjustingSliders);
  const sliderSettledWhileDragging = useInteractionStore((s) => s.sliderSettledWhileDragging);
  const isSpacePressed = useInteractionStore((s) => s.isSpacePressed);
  const dragHoveredFolderId = useInteractionStore((s) => s.dragHoveredFolderId);
  const dragSourceFolderBorderHovered = useInteractionStore((s) => s.dragSourceFolderBorderHovered);
  const dragBorderBlink = useInteractionStore((s) => s.dragBorderBlink);
  const hoveredFolderBorder = useInteractionStore((s) => s.hoveredFolderBorder);
  const resizingFolderId = useInteractionStore((s) => s.resizingFolderId);
  const selectedFolderId = useInteractionStore((s) => s.selectedFolderId);
  const lastTouchDistance = useInteractionStore((s) => s.lastTouchDistance);
  const lastTouchCenter = useInteractionStore((s) => s.lastTouchCenter);
  const dragGhostPosition = useInteractionStore((s) => s.dragGhostPosition);
  const intActions = useInteractionStore.getState();
  const setIsDragging = intActions.setIsDragging;
  const setIsAdjustingSliders = intActions.setIsAdjustingSliders;
  const setSliderSettledWhileDragging = intActions.setSliderSettledWhileDragging;
  const setIsSpacePressed = intActions.setIsSpacePressed;
  const setDragHoveredFolderId = intActions.setDragHoveredFolderId;
  const setDragSourceFolderBorderHovered = intActions.setDragSourceFolderBorderHovered;
  const setDragBorderBlink = intActions.setDragBorderBlink;
  const setHoveredFolderBorder = intActions.setHoveredFolderBorder;
  const setResizingFolderId = intActions.setResizingFolderId;
  const setSelectedFolderId = intActions.setSelectedFolderId;
  const setLastTouchDistance = intActions.setLastTouchDistance;
  const setLastTouchCenter = intActions.setLastTouchCenter;
  const setDragGhostPosition = intActions.setDragGhostPosition;

  // UI store (modals, dialogs, menus, filters)
  const showFolderPrompt = useUIStore((s) => s.showFolderPrompt);
  const newFolderName = useUIStore((s) => s.newFolderName);
  const pendingFileCount = useUIStore((s) => s.pendingFileCount);
  const editingFolder = useUIStore((s) => s.editingFolder);
  const editingFolderName = useUIStore((s) => s.editingFolderName);
  const selectedExistingFolderId = useUIStore((s) => s.selectedExistingFolderId);
  const folderNameError = useUIStore((s) => s.folderNameError);
  const createFolderFromSelectionIds = useUIStore((s) => s.createFolderFromSelectionIds);
  const createFolderFromSelectionName = useUIStore((s) => s.createFolderFromSelectionName);
  const createFolderFromSelectionNameError = useUIStore((s) => s.createFolderFromSelectionNameError);
  const createEmptyFolderOpen = useUIStore((s) => s.createEmptyFolderOpen);
  const createEmptyFolderName = useUIStore((s) => s.createEmptyFolderName);
  const createEmptyFolderNameError = useUIStore((s) => s.createEmptyFolderNameError);
  const createSocialLayoutOpen = useUIStore((s) => s.createSocialLayoutOpen);
  const createSocialLayoutName = useUIStore((s) => s.createSocialLayoutName);
  const createSocialLayoutPages = useUIStore((s) => s.createSocialLayoutPages);
  const createSocialLayoutNameError = useUIStore((s) => s.createSocialLayoutNameError);
  const folderContextMenu = useUIStore((s) => s.folderContextMenu);
  const confirmDeleteFolderOpen = useUIStore((s) => s.confirmDeleteFolderOpen);
  const deleteFolderDontAskAgain = useUIStore((s) => s.deleteFolderDontAskAgain);
  const imageContextMenu = useUIStore((s) => s.imageContextMenu);
  const borderDialogImageId = useUIStore((s) => s.borderDialogImageId);
  const canvasContextMenu = useUIStore((s) => s.canvasContextMenu);
  const createPresetFromImageId = useUIStore((s) => s.createPresetFromImageId);
  const createPresetName = useUIStore((s) => s.createPresetName);
  const deletingPhotoId = useUIStore((s) => s.deletingPhotoId);
  const confirmDeletePhotoIds = useUIStore((s) => s.confirmDeletePhotoIds);
  const deletePhotoDontAskAgain = useUIStore((s) => s.deletePhotoDontAskAgain);
  const deleteFolderProgress = useUIStore((s) => s.deleteFolderProgress);
  const applyPresetToSelectionIds = useUIStore((s) => s.applyPresetToSelectionIds);
  const applyPresetProgress = useUIStore((s) => s.applyPresetProgress);
  const zoomedImageId = useUIStore((s) => s.zoomedImageId);
  const isUploading = useUIStore((s) => s.isUploading);
  const showHeader = useUIStore((s) => s.showHeader);
  const mobileEditFullscreen = useUIStore((s) => s.mobileEditFullscreen);
  const photoFilter = useUIStore((s) => s.photoFilter);
  const isMobile = useIsMobile();
  const uiActions = useUIStore.getState();
  const setShowFolderPrompt = uiActions.setShowFolderPrompt;
  const setNewFolderName = uiActions.setNewFolderName;
  const setPendingFileCount = uiActions.setPendingFileCount;
  const setEditingFolder = uiActions.setEditingFolder;
  const setEditingFolderName = uiActions.setEditingFolderName;
  const setSelectedExistingFolderId = uiActions.setSelectedExistingFolderId;
  const setFolderNameError = uiActions.setFolderNameError;
  const setCreateFolderFromSelectionIds = uiActions.setCreateFolderFromSelectionIds;
  const setCreateFolderFromSelectionName = uiActions.setCreateFolderFromSelectionName;
  const setCreateFolderFromSelectionNameError = uiActions.setCreateFolderFromSelectionNameError;
  const setCreateEmptyFolderOpen = uiActions.setCreateEmptyFolderOpen;
  const setCreateEmptyFolderName = uiActions.setCreateEmptyFolderName;
  const setCreateEmptyFolderNameError = uiActions.setCreateEmptyFolderNameError;
  const setCreateSocialLayoutOpen = uiActions.setCreateSocialLayoutOpen;
  const setCreateSocialLayoutName = uiActions.setCreateSocialLayoutName;
  const setCreateSocialLayoutPages = uiActions.setCreateSocialLayoutPages;
  const setCreateSocialLayoutNameError = uiActions.setCreateSocialLayoutNameError;
  const setFolderContextMenu = uiActions.setFolderContextMenu;
  const setConfirmDeleteFolderOpen = uiActions.setConfirmDeleteFolderOpen;
  const setDeleteFolderDontAskAgain = uiActions.setDeleteFolderDontAskAgain;
  const setImageContextMenu = uiActions.setImageContextMenu;
  const setBorderDialogImageId = uiActions.setBorderDialogImageId;
  const setCanvasContextMenu = uiActions.setCanvasContextMenu;
  const setCreatePresetFromImageId = uiActions.setCreatePresetFromImageId;
  const setCreatePresetName = uiActions.setCreatePresetName;
  const setDeletingPhotoId = uiActions.setDeletingPhotoId;
  const setConfirmDeletePhotoIds = uiActions.setConfirmDeletePhotoIds;
  const setDeletePhotoDontAskAgain = uiActions.setDeletePhotoDontAskAgain;
  const setDeleteFolderProgress = uiActions.setDeleteFolderProgress;
  const setApplyPresetToSelectionIds = uiActions.setApplyPresetToSelectionIds;
  const setApplyPresetProgress = uiActions.setApplyPresetProgress;
  const setZoomedImageId = uiActions.setZoomedImageId;
  const setIsUploading = uiActions.setIsUploading;
  const setShowHeader = uiActions.setShowHeader;
  const setPhotoFilter = uiActions.setPhotoFilter;

  const folderNameDragRef = useRef<boolean>(false);
  const folderDragRafRef = useRef<number | null>(null);
  const pendingFolderDragRef = useRef<{ updatedFolders: PhotoFolder[]; updatedImages: CanvasImage[] } | null>(null);
  const resizeDragRafRef = useRef<number | null>(null);
  const pendingResizeDragRef = useRef<{ updatedFolders: PhotoFolder[]; updatedImages: CanvasImage[] } | null>(null);
  const lastSwappedImageRef = useRef<{ id: string; x: number; y: number } | null>(null);
  const dragPrevCellRef = useRef<{ imageId: string; col: number; row: number; cellIndex: number } | null>(null);
  const dragMoveRafRef = useRef<number | null>(null);
  const dragMoveNodeRef = useRef<Konva.Image | null>(null);
  const latestFoldersRef = useRef<PhotoFolder[]>([]);
  const latestImagesRef = useRef<CanvasImage[]>([]);
  const folderContextMenuRef = useRef<HTMLDivElement>(null);
  const imageContextMenuRef = useRef<HTMLDivElement>(null);
  const borderDialogRef = useRef<HTMLDivElement>(null);
  const canvasContextMenuRef = useRef<HTMLDivElement>(null);
  const preZoomViewRef = useRef<{ scale: number; x: number; y: number } | null>(null);
  const zoomAnimationRef = useRef<number | null>(null);
  const lastMouseDownButtonRef = useRef<number>(0);
  const prevMouseDownButtonRef = useRef<number>(0);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggeredRef = useRef<boolean>(false);
  const longPressTouchPosRef = useRef<{ x: number; y: number } | null>(null);
  const queryClient = useQueryClient();
  const { user } = useAuth();

  // Auto-save hook (handles saveStatus, editSignature, debounced save)
  const { saveStatus, setSaveStatus, handleSave } = useAutoSave({ user, images, selectedIds });
  // Export hook (handles exportProgress, single/batch export)
  const { exportProgress, setExportProgress, exportImageToDownload, handleExport, handleExportSelection: handleExportSelectionBase } = useExport({ images, selectedIds, decodeDNG });

  // Bridge: saveStatus/exportProgress from hooks to uiStore (hooks own internal state)
  const uiStoreSync = useUIStore.getState();
  useEffect(() => { uiStoreSync.setSaveStatus(saveStatus); }, [saveStatus, uiStoreSync]);
  useEffect(() => { uiStoreSync.setExportProgress(exportProgress); }, [exportProgress, uiStoreSync]);

  // Keep refs in sync so drag-end always uses latest state (one image move only)
  useEffect(() => {
    latestFoldersRef.current = folders;
    latestImagesRef.current = images;
  }, [folders, images]);

  // Get window dimensions
  useEffect(() => {
    const updateDimensions = () => {
      setDimensions({ width: window.innerWidth, height: window.innerHeight });
    };
    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  // Blink folder border when image center is over the folder border (dragging out)
  useEffect(() => {
    if (!dragSourceFolderBorderHovered) {
      setDragBorderBlink(false);
      return;
    }
    const interval = setInterval(() => {
      setDragBorderBlink(!useInteractionStore.getState().dragBorderBlink);
    }, 110);
    return () => clearInterval(interval);
  }, [dragSourceFolderBorderHovered]);

  // Handle keyboard events for Spacebar and Escape (zoom out)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        setIsSpacePressed(true);
        // Force Konva to re-evaluate listening state for all elements
        stageRef.current?.getLayers().forEach((layer) => layer.batchDraw());
      }
      if (e.code === 'Escape' && zoomedImageId) {
        if (zoomAnimationRef.current != null) {
          cancelAnimationFrame(zoomAnimationRef.current);
          zoomAnimationRef.current = null;
        }
        const pre = preZoomViewRef.current;
        if (pre) {
          setStageScale(pre.scale);
          setStagePosition({ x: pre.x, y: pre.y });
        }
        setZoomedImageId(null);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        setIsSpacePressed(false);
        setIsDragging(false);
        // Force Konva to re-evaluate listening state for all elements
        stageRef.current?.getLayers().forEach((layer) => layer.batchDraw());
      }
    };

    // Also handle when Spacebar is released outside the window
    const handleBlur = () => {
      setIsSpacePressed(false);
      setIsDragging(false);
      // Force Konva to re-evaluate listening state for all elements
      stageRef.current?.getLayers().forEach((layer) => layer.batchDraw());
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [zoomedImageId]);

  // Show header when mouse is near top
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      // Show header when mouse is within 60px of top
      setShowHeader(e.clientY < 60);
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  // React Query for fetching photo metadata (cached for fast reloads). Fetch all data; filter is show/hide in UI only.
  const { data: photoData } = useQuery({
    queryKey: ['user-photos', user?.id],
    queryFn: async () => {
      if (!user) return null;

      const [editsResult, foldersResult, photosResult, originalsResult, thumbsResult] = await Promise.all([
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
        supabase.storage.from('photos').list(`${user.id}/thumbs`, {
          limit: 500,
          sortBy: { column: 'name', order: 'asc' },
        }),
      ]);

      return {
        savedEdits: editsResult.data,
        savedFolders: foldersResult.data,
        photosFiles: photosResult.data,
        originalsFiles: originalsResult.data,
        thumbsFiles: thumbsResult.data ?? [],
        photosError: photosResult.error,
      };
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000, // Cache 5 min to reduce refetches
  });

  const { data: presets = [] } = useQuery({
    queryKey: ['presets', user?.id] as const,
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase.from('presets').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
      if (error) {
        console.error('Error loading presets:', error);
        return [];
      }
      return (data ?? []).map((row) => ({ id: row.id, name: row.name, settings: row.settings as Partial<CanvasImage> })) as Preset[];
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  // Track load key (user + filter) to prevent duplicate processing
  const loadKeyRef = useRef<string | null>(null);
  // After upload or create-folder we invalidate; skip the next effect run so we don't overwrite canvas/positions

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

      const { savedEdits, savedFolders, photosFiles, originalsFiles, thumbsFiles, photosError } = photoData;
      const thumbNames = new Set((thumbsFiles ?? []).filter((f) => !f.name.startsWith('.')).map((f) => f.name));

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
        // No photos - still load folders (e.g. empty social layouts) so they appear on canvas
        const emptyFolders = buildFoldersFromSaved([]);
        loadKeyRef.current = loadKey;
        setImages([]);
        setFolders(emptyFolders);
        setHistory([{ images: [], texts: [], folders: emptyFolders }]);
        setHistoryIndex(0);
        if (emptyFolders.length > 0) {
          const { dimensions: dims } = useCanvasStore.getState();
          const padding = 48;
          const vw = Math.max(200, dims.width - padding * 2);
          const vh = Math.max(200, dims.height - padding * 2);
          let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
          for (const folder of emptyFolders) {
            const bounds = getFolderBounds(folder, 0);
            minX = Math.min(minX, bounds.x);
            maxX = Math.max(maxX, bounds.right);
            minY = Math.min(minY, bounds.y);
            maxY = Math.max(maxY, bounds.bottom);
          }
          const contentW = maxX - minX || 1;
          const contentH = maxY - minY || 1;
          const contentCenterX = (minX + maxX) / 2;
          const contentCenterY = (minY + maxY) / 2;
          const scaleX = vw / contentW;
          const scaleY = vh / contentH;
          const scale = Math.max(0.1, Math.min(2, Math.min(scaleX, scaleY)));
          setStageScale(scale);
          setStagePosition({
            x: dims.width / 2 - contentCenterX * scale,
            y: dims.height / 2 - contentCenterY * scale,
          });
        }
        onPhotosLoadStateChange?.(false);
        return;
      }

      onPhotosLoadStateChange?.(true);

      try {
        // Base names we already have from photos (preview) - don't duplicate from originals
        const photosBaseNames = new Set(photosList.map((f) => f.name.replace(/\.[^.]+$/, '').toLowerCase()));
        const originalsOnly = originalsList.filter(
          (f) => !photosBaseNames.has(f.name.replace(/\.[^.]+$/, '').toLowerCase())
        );

        // Combined list: all from photos, plus originals-only files (no preview)
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

        // Load all images; signed URLs cached 55 min (URLs valid 1 hr) to reduce API calls
        const SIGNED_URL_STALE_MS = 55 * 60 * 1000;
        const loadOne = async (file: FileEntry, i: number): Promise<CanvasImage | null> => {
          const storagePath = `${user.id}/${file.name}`;
          const bucket = file.bucket;
          // Use thumbnail for grid when available (reduces egress ~5–10x)
          const useThumb = bucket === 'photos' && thumbNames.has(file.name);
          const fetchPath = useThumb ? getThumbStoragePath(storagePath) : storagePath;
          let imageUrl: string;
          try {
            imageUrl = await queryClient.ensureQueryData({
              queryKey: ['signed-url', bucket, fetchPath],
              queryFn: async () => {
                const res = await fetch('/api/signed-url', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ bucket, path: fetchPath }),
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
          } catch (e) {
            console.warn(`Signed URL failed for ${file.name}:`, e);
            return null;
          }

          try {
            let imgSrc: string;
            let width: number;
            let height: number;

            if (isDNG(file.name) && file.bucket === 'originals') {
              const decoded = await decodeDNGFromUrl(imageUrl);
              imgSrc = decoded.dataUrl;
              width = decoded.width;
              height = decoded.height;
            } else {
              // Use IndexedDB cache: fetch blob, cache it, create object URL
              const blob = await getCachedImage(fetchPath, async () => {
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
              canvasImg.colorGrading = edit.color_grading ?? undefined;
              canvasImg.colorCalibration = edit.color_calibration ?? undefined;
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
              // Border
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
        // Apply any remaining edit fields to images we might have missed (e.g. originalStoragePath from storage_path key)
        // Use immutable updates — objects may be frozen when coming from store/React
        const newImages = savedEdits && savedEdits.length > 0
          ? loadedImages.map((img) => {
              const edit = savedEdits.find(
                (e: PhotoEdits) =>
                  e.storage_path === img.storagePath ||
                  e.storage_path === (img.originalStoragePath ?? '') ||
                  (e.original_storage_path != null && e.original_storage_path === img.storagePath)
              );
              if (!edit) return img;
              const hasValidPosition = edit.x != null && edit.y != null
                && Number.isFinite(Number(edit.x)) && Number.isFinite(Number(edit.y));
              let savedWidth = edit.width ?? img.width;
              let savedHeight = edit.height ?? img.height;
              const maxSize = GRID_CONFIG.imageMaxSize;
              if (savedWidth > maxSize || savedHeight > maxSize) {
                const ratio = Math.min(maxSize / savedWidth, maxSize / savedHeight);
                savedWidth = savedWidth * ratio;
                savedHeight = savedHeight * ratio;
              }
              return {
                ...img,
                x: hasValidPosition ? Number(edit.x) : img.x,
                y: hasValidPosition ? Number(edit.y) : img.y,
                ...(edit.original_storage_path != null && { originalStoragePath: edit.original_storage_path }),
                width: savedWidth,
                height: savedHeight,
                folderId: edit.folder_id != null ? String(edit.folder_id) : undefined,
                rotation: edit.rotation ?? 0,
                scaleX: edit.scale_x ?? 1,
                scaleY: edit.scale_y ?? 1,
                ...(edit.taken_at != null && { takenAt: edit.taken_at }),
                ...(edit.camera_make != null && { cameraMake: edit.camera_make }),
                ...(edit.camera_model != null && { cameraModel: edit.camera_model }),
                ...(edit.labels != null && Array.isArray(edit.labels) && { labels: edit.labels }),
                exposure: edit.exposure ?? 0,
                contrast: edit.contrast ?? 0,
                highlights: edit.highlights ?? 0,
                shadows: edit.shadows ?? 0,
                whites: edit.whites ?? 0,
                blacks: edit.blacks ?? 0,
                texture: edit.texture ?? 0,
                temperature: edit.temperature ?? 0,
                vibrance: edit.vibrance ?? 0,
                saturation: edit.saturation ?? 0,
                shadowTint: edit.shadow_tint ?? 0,
                colorHSL: edit.color_hsl ?? undefined,
                splitToning: edit.split_toning ?? undefined,
                colorGrading: edit.color_grading ?? undefined,
                colorCalibration: edit.color_calibration ?? undefined,
                clarity: edit.clarity ?? 0,
                dehaze: edit.dehaze ?? 0,
                vignette: edit.vignette ?? 0,
                grain: edit.grain ?? 0,
                grainSize: edit.grain_size ?? 0,
                grainRoughness: edit.grain_roughness ?? 0,
                curves: edit.curves ?? { ...DEFAULT_CURVES },
                brightness: edit.brightness ?? 0,
                hue: edit.hue ?? 0,
                blur: edit.blur ?? 0,
                filters: edit.filters ?? [],
              };
            })
          : loadedImages;

        const loadedFolders = buildFoldersFromSaved(newImages);

        loadKeyRef.current = loadKey;
        setImages(newImages);
        setFolders(loadedFolders);
        setHistory([{ images: newImages, texts: [], folders: loadedFolders }]);
        setHistoryIndex(0);

        // Fit viewport to show all folders on load
        if (loadedFolders.length > 0) {
          const { dimensions: dims } = useCanvasStore.getState();
          const padding = 48;
          const vw = Math.max(200, dims.width - padding * 2);
          const vh = Math.max(200, dims.height - padding * 2);

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

          const contentW = maxX - minX || 1;
          const contentH = maxY - minY || 1;
          const contentCenterX = (minX + maxX) / 2;
          const contentCenterY = (minY + maxY) / 2;

          const scaleX = vw / contentW;
          const scaleY = vh / contentH;
          const scale = Math.max(0.1, Math.min(2, Math.min(scaleX, scaleY)));

          setStageScale(scale);
          setStagePosition({
            x: dims.width / 2 - contentCenterX * scale,
            y: dims.height / 2 - contentCenterY * scale,
          });
        }
      } catch (err) {
        console.error('Error loading user photos:', err);
      } finally {
        // Delay hiding loader to allow React to render the images
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            onPhotosLoadStateChange?.(false);
          });
        });
      }
    };

    loadUserPhotos();
  }, [user, photoData, onPhotosLoadStateChange, queryClient]);

  // Filter is show/hide only: which image IDs pass the current filter (labels, date, camera). null = show all.
  const visibleImageIds = useMemo(() => {
    const hasFilter = !!(
      photoFilter.contentSearch?.trim() ||
      photoFilter.dateFrom ||
      photoFilter.dateTo ||
      photoFilter.cameraMake ||
      photoFilter.cameraModel
    );
    if (!hasFilter) return null;
    const set = new Set<string>();
    const term = photoFilter.contentSearch?.trim().toLowerCase();
    for (const img of images) {
      if (term && !img.labels?.some((l) => l.toLowerCase().includes(term))) continue;
      if (photoFilter.dateFrom && img.takenAt && img.takenAt < photoFilter.dateFrom) continue;
      if (photoFilter.dateTo && img.takenAt && img.takenAt > photoFilter.dateTo) continue;
      if (photoFilter.cameraMake && img.cameraMake !== photoFilter.cameraMake) continue;
      if (photoFilter.cameraModel && img.cameraModel !== photoFilter.cameraModel) continue;
      set.add(img.id);
    }
    return set;
  }, [images, photoFilter]);

  // Viewport culling: only mount ImageNode for images visible on screen + 200px padding
  const viewportVisibleIds = useViewportCulling(images, stagePosition, stageScale, dimensions.width, dimensions.height);

  // When label-photo API returns labels, update the image in state so filter search works without refresh

  // Save state to history
  const saveToHistory = useCallback(() => {
    setHistory((prevHistory) => {
      const newHistory = prevHistory.slice(0, historyIndex + 1);
      newHistory.push({ images: [...images], texts: [...texts], folders: [...folders] });
      setHistoryIndex(newHistory.length - 1);
      return newHistory;
    });
  }, [images, texts, folders, historyIndex]);

  // Resolve folder overlaps and reflow all affected images.
  // When addedImageId is set (single image just dropped into changedFolderId), only reflow existing images
  // in that folder; keep the dropped image's position + folder delta so only one image moves.
  const resolveOverlapsAndReflow = useCallback((
    currentFolders: PhotoFolder[],
    currentImages: CanvasImage[],
    changedFolderId?: string,
    addedImageId?: string
  ): { folders: PhotoFolder[]; images: CanvasImage[] } => {
    const resolvedFolders = resolveFolderOverlaps(currentFolders, currentImages, changedFolderId);

    let updatedImages = [...currentImages];
    const dx = (nf: PhotoFolder, of: PhotoFolder) => nf.x - of.x;
    const dy = (nf: PhotoFolder, of: PhotoFolder) => nf.y - of.y;

    for (let i = 0; i < resolvedFolders.length; i++) {
      const newFolder = resolvedFolders[i];
      const oldFolder = currentFolders.find(f => f.id === newFolder.id);
      if (!oldFolder || (oldFolder.x === newFolder.x && oldFolder.y === newFolder.y)) continue;

      const folderImgs = getFolderImagesSorted(updatedImages, newFolder.imageIds);
      if (folderImgs.length === 0) continue;

      const isChangedFolderWithAdd = newFolder.id === changedFolderId && addedImageId;
      const existingImgs = isChangedFolderWithAdd
        ? folderImgs.filter(img => img.id !== addedImageId)
        : folderImgs;

      if (existingImgs.length > 0) {
        const oldHeight = oldFolder.height ?? getFolderBorderHeight(oldFolder, oldFolder.imageIds.length);
        const newHeight = newFolder.height ?? getFolderBorderHeight(newFolder, newFolder.imageIds.length);
        const movedOnly = oldFolder.width === newFolder.width && oldHeight === newHeight;
        const shouldKeepPositions = movedOnly && !isChangedFolderWithAdd && !isSocialLayout(newFolder);

        const reflowed = shouldKeepPositions
          ? existingImgs.map((img) => ({ ...img, x: img.x + dx(newFolder, oldFolder), y: img.y + dy(newFolder, oldFolder) }))
          : isSocialLayout(newFolder)
            ? existingImgs.map((img) => ({ ...img, x: img.x + dx(newFolder, oldFolder), y: img.y + dy(newFolder, oldFolder) }))
            : reflowImagesInFolder(existingImgs, newFolder.x, newFolder.y, newFolder.width);

        const reflowedMap = new Map(reflowed.map(r => [r.id, r]));
        updatedImages = updatedImages.map(img => reflowedMap.get(img.id) ?? img);
      }

      // Dropped image: move with folder only (keep drop position + delta)
      if (isChangedFolderWithAdd) {
        const addedImg = currentImages.find(img => img.id === addedImageId);
        if (addedImg) {
          updatedImages = updatedImages.map(img =>
            img.id === addedImageId
              ? { ...img, x: addedImg.x + dx(newFolder, oldFolder), y: addedImg.y + dy(newFolder, oldFolder) }
              : img
          );
        }
      }
    }

    return { folders: resolvedFolders, images: updatedImages };
  }, []);

  // Upload hook (handles file upload, DNG processing, folder creation, Supabase storage)
  const {
    handleFileUpload, processFilesWithFolder, addFilesToExistingFolder,
    handleAddPhotosToFolder, handleFolderFileSelect, handleDrop, handleDragOver,
    pendingFilesRef, folderFileInputRef, skipNextPhotosLoadRef,
  } = useUpload({ user, saveToHistory, resolveOverlapsAndReflow });

  // Undo: only last photo edit (sliders, curves). Does not restore deleted photos or change placement.
  const handleUndo = useCallback(() => {
    if (editHistory.length === 0) return;
    const entry = editHistory[editHistory.length - 1];
    const currentImage = images.find((i) => i.id === entry.imageId);
    if (currentImage) {
      setEditRedoStack((prev) => [...prev, { imageId: entry.imageId, snapshot: getEditSnapshot(currentImage) }]);
    }
    setEditHistory((prev) => prev.slice(0, -1));
    setImages((prev) =>
      prev.map((i) => (i.id === entry.imageId ? { ...i, ...entry.snapshot } : i))
    );
  }, [editHistory, images]);

  // Redo: only last undone photo edit.
  const handleRedo = useCallback(() => {
    if (editRedoStack.length === 0) return;
    const entry = editRedoStack[editRedoStack.length - 1];
    const currentImage = images.find((i) => i.id === entry.imageId);
    if (currentImage) {
      setEditHistory((prev) => [...prev.slice(-49), { imageId: entry.imageId, snapshot: getEditSnapshot(currentImage) }]);
    }
    setEditRedoStack((prev) => prev.slice(0, -1));
    setImages((prev) =>
      prev.map((i) => (i.id === entry.imageId ? { ...i, ...entry.snapshot } : i))
    );
  }, [editRedoStack, images]);

  // Keyboard shortcuts: Ctrl+Z undo, Ctrl+Shift+Z redo (photo edits only; same as undo/redo buttons)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'z' && e.key !== 'Z') return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const target = e.target as HTMLElement | null;
      // Only skip when focus is in a *text* input (so Ctrl+Z works with slider/range focus)
      const inTextInput = target?.closest?.('textarea, [contenteditable="true"]')
        || (target instanceof HTMLInputElement && target.type !== 'range' && target.type !== 'checkbox' && target.type !== 'radio');
      if (inTextInput) return;
      if (e.shiftKey) {
        if (editRedoStack.length > 0) {
          e.preventDefault();
          handleRedo();
        }
      } else {
        if (editHistory.length > 0) {
          e.preventDefault();
          handleUndo();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editHistory.length, editRedoStack.length, handleUndo, handleRedo]);


  // Zoom with mouse wheel (only when Ctrl is held)
  const handleWheel = useCallback(
    (e: Konva.KonvaEventObject<WheelEvent>) => {
      // Only zoom if Ctrl (or Cmd on Mac) is pressed
      if (!e.evt.ctrlKey && !e.evt.metaKey) {
        return;
      }

      e.evt.preventDefault();
      if (zoomAnimationRef.current != null) {
        cancelAnimationFrame(zoomAnimationRef.current);
        zoomAnimationRef.current = null;
      }
      const stage = stageRef.current;
      if (!stage) return;

      const oldScale = stage.scaleX();
      const pointer = stage.getPointerPosition();
      if (!pointer) return;

      const mousePointTo = {
        x: (pointer.x - stage.x()) / oldScale,
        y: (pointer.y - stage.y()) / oldScale,
      };

      const scaleBy = 1.1;
      // Scroll up (deltaY < 0) zooms in, scroll down (deltaY > 0) zooms out
      const newScale = e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;
      const clampedScale = Math.max(0.1, Math.min(20, newScale));

      setStageScale(clampedScale);
      setStagePosition({
        x: pointer.x - mousePointTo.x * clampedScale,
        y: pointer.y - mousePointTo.y * clampedScale,
      });
      // Exit "zoomed in" mode so space+drag and background click don't trigger zoom-out
      setZoomedImageId(null);
    },
    []
  );

  // Touch handlers for pinch zoom
  const getDistance = (p1: Touch, p2: Touch) => {
    return Math.sqrt(Math.pow(p2.clientX - p1.clientX, 2) + Math.pow(p2.clientY - p1.clientY, 2));
  };

  const getCenter = (p1: Touch, p2: Touch) => {
    return {
      x: (p1.clientX + p2.clientX) / 2,
      y: (p1.clientY + p2.clientY) / 2,
    };
  };

  const handleTouchMove = useCallback(
    (e: Konva.KonvaEventObject<TouchEvent>) => {
      const stage = stageRef.current;
      if (!stage) return;

      const touch1 = e.evt.touches[0];
      const touch2 = e.evt.touches[1];

      if (touch1 && touch2) {
        // Pinch zoom
        e.evt.preventDefault();
        const distance = getDistance(touch1, touch2);
        const center = getCenter(touch1, touch2);

        if (lastTouchDistance !== null && lastTouchCenter !== null) {
          const scaleChange = distance / lastTouchDistance;
          const newScale = Math.max(0.1, Math.min(20, stageScale * scaleChange));

          const stageBox = stage.container().getBoundingClientRect();
          const pointTo = {
            x: (center.x - stageBox.left - stage.x()) / stageScale,
            y: (center.y - stageBox.top - stage.y()) / stageScale,
          };

          setStageScale(newScale);
          setStagePosition({
            x: center.x - stageBox.left - pointTo.x * newScale,
            y: center.y - stageBox.top - pointTo.y * newScale,
          });
        }

        setLastTouchDistance(distance);
        setLastTouchCenter(center);
      } else if (touch1 && !isDragging) {
        // Single touch pan
        const stageBox = stage.container().getBoundingClientRect();
        const newPos = {
          x: touch1.clientX - stageBox.left - (lastTouchCenter?.x || touch1.clientX - stageBox.left - stage.x()),
          y: touch1.clientY - stageBox.top - (lastTouchCenter?.y || touch1.clientY - stageBox.top - stage.y()),
        };
        setStagePosition(newPos);
      }
    },
    [stageScale, lastTouchDistance, lastTouchCenter, isDragging]
  );

  const handleTouchEnd = useCallback(() => {
    setLastTouchDistance(null);
    setLastTouchCenter(null);
    setIsDragging(false);
  }, []);

  // Handle stage drag — clear selection when left-clicking empty space or folder borders (not images/texts)
  const handleStageMouseDown = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.evt.button !== 0) return;
    const target = e.target;
    const stage = target.getStage();

    // Check if clicked on stage itself OR on a shape that isn't an image/text
    const clickedOnStage = target === stage;
    const parent = target.parent;
    const clickedOnImageOrText = parent?.attrs?.id && (
      images.some(img => img.id === parent.attrs.id) ||
      texts.some(txt => txt.id === parent.attrs.id)
    );

    if (clickedOnStage || !clickedOnImageOrText) {
      setSelectedIds([]);
      setSelectedFolderId(null);
      lastSelectedIdRef.current = null;
    }
  }, [images, texts]);

  // Remember last multi-selection so context menu can use it even if a spurious click overwrote selectedIds. Only clear when selection is empty, not when it becomes single.
  useEffect(() => {
    if (selectedIds.length > 1) lastMultiSelectionRef.current = selectedIds.slice();
    else if (selectedIds.length === 0) lastMultiSelectionRef.current = null;
  }, [selectedIds]);

  // Handle object selection: plain = single, Ctrl = toggle, Shift = range (photos only). Ignore right-click so range selection is kept for context menu.
  const handleObjectClick = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.evt.button !== 0) return; // only left-click changes selection; right-click keeps current selection for paste/create folder
    // After a long-press context menu, suppress the click that follows touchend
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      return;
    }
    e.cancelBubble = true;
    const id = e.target.id();
    const ctrl = e.evt.ctrlKey || e.evt.metaKey;
    const shift = e.evt.shiftKey;

    if (ctrl) {
      setSelectedIds((prev) => {
        const has = prev.includes(id);
        const next = has ? prev.filter((x) => x !== id) : [...prev, id];
        lastSelectedIdRef.current = id;
        return next;
      });
      return;
    }

    if (shift) {
      const lastId = lastSelectedIdRef.current;
      const clickedImg = images.find((img) => img.id === id);
      const lastImg = lastId != null ? images.find((img) => img.id === lastId) : null;

      if (clickedImg && lastImg) {
        const folderFor = (img: CanvasImage) => folders.find((f) => f.imageIds.includes(img.id));
        const folderClicked = folderFor(clickedImg);
        const folderLast = folderFor(lastImg);

        if (folderClicked && folderClicked.id === folderLast?.id) {
          const folderImages = images
            .filter((img) => folderClicked.imageIds.includes(img.id))
            .sort((a, b) => {
              const rowA = Math.round(a.y / CELL_HEIGHT);
              const rowB = Math.round(b.y / CELL_HEIGHT);
              if (rowA !== rowB) return rowA - rowB;
              return a.x - b.x;
            });
          const idxClicked = folderImages.findIndex((img) => img.id === id);
          const idxLast = folderImages.findIndex((img) => img.id === lastId);
          if (idxClicked >= 0 && idxLast >= 0) {
            const lo = Math.min(idxClicked, idxLast);
            const hi = Math.max(idxClicked, idxLast);
            const rangeIds = folderImages.slice(lo, hi + 1).map((img) => img.id);
            setSelectedIds(rangeIds);
            lastSelectedIdRef.current = id;
            return;
          }
        }
      }

      const imageIndex = images.findIndex((img) => img.id === id);
      const lastImageIndex = lastId != null ? images.findIndex((img) => img.id === lastId) : -1;
      if (imageIndex >= 0 && lastImageIndex >= 0) {
        const lo = Math.min(imageIndex, lastImageIndex);
        const hi = Math.max(imageIndex, lastImageIndex);
        const rangeIds = images.slice(lo, hi + 1).map((img) => img.id);
        setSelectedIds(rangeIds);
      } else {
        setSelectedIds([id]);
      }
      lastSelectedIdRef.current = id;
      return;
    }

    setSelectedIds([id]);
    lastSelectedIdRef.current = id;
  }, [images, folders]);

  // Right-click context menu for images: copy / paste edit; multi-select: paste to selection, create folder
  const handleImageContextMenu = useCallback((e: Konva.KonvaEventObject<PointerEvent>, imageId: string) => {
    e.evt.preventDefault();
    const imageIdsOnly = (ids: string[]) => ids.filter((id) => images.some((img) => img.id === id));
    const multi = selectedIds.length > 1
      ? imageIdsOnly(selectedIds)
      : (lastMultiSelectionRef.current && lastMultiSelectionRef.current.includes(imageId)
        ? imageIdsOnly(lastMultiSelectionRef.current)
        : null);
    const menuSelectedIds = multi && multi.length > 1 ? multi : [imageId];
    setImageContextMenu({ x: e.evt.clientX, y: e.evt.clientY, imageId, selectedIds: menuSelectedIds });
  }, [selectedIds, images]);

  // Long-press helpers for mobile context menus (500ms hold)
  const cancelLongPress = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handleImageTouchStart = useCallback((_e: Konva.KonvaEventObject<TouchEvent>, imageId: string) => {
    const touch = _e.evt.touches[0];
    if (!touch) return;
    longPressTriggeredRef.current = false;
    longPressTouchPosRef.current = { x: touch.clientX, y: touch.clientY };
    cancelLongPress();
    longPressTimerRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true;
      if (navigator.vibrate) navigator.vibrate(50);
      // Build context menu exactly like handleImageContextMenu
      const { selectedIds: sids, images: imgs } = useCanvasStore.getState();
      const imageIdsOnly = (ids: string[]) => ids.filter((id) => imgs.some((img) => img.id === id));
      const multi = sids.length > 1
        ? imageIdsOnly(sids)
        : (lastMultiSelectionRef.current && lastMultiSelectionRef.current.includes(imageId)
          ? imageIdsOnly(lastMultiSelectionRef.current)
          : null);
      const menuSelectedIds = multi && multi.length > 1 ? multi : [imageId];
      setImageContextMenu({ x: touch.clientX, y: touch.clientY, imageId, selectedIds: menuSelectedIds });
    }, 500);
  }, [cancelLongPress]);

  const handleImageTouchMove = useCallback((_e: Konva.KonvaEventObject<TouchEvent>, _imageId: string) => {
    const touch = _e.evt.touches[0];
    if (!touch || !longPressTouchPosRef.current) return;
    const dx = touch.clientX - longPressTouchPosRef.current.x;
    const dy = touch.clientY - longPressTouchPosRef.current.y;
    // Cancel if finger moves more than 10px (user is dragging, not long-pressing)
    if (Math.sqrt(dx * dx + dy * dy) > 10) {
      cancelLongPress();
    }
  }, [cancelLongPress]);

  const handleImageTouchEnd = useCallback(() => {
    cancelLongPress();
  }, [cancelLongPress]);

  const handleCopyEdit = useCallback(() => {
    if (!imageContextMenu) return;
    const img = images.find((i) => i.id === imageContextMenu.imageId);
    if (img) {
      const snapshot = getEditSnapshot(img);
      setCopiedEdit(JSON.parse(JSON.stringify(snapshot)) as Partial<CanvasImage>);
    }
    setImageContextMenu(null);
  }, [imageContextMenu, images]);

  const handlePasteEdit = useCallback(async () => {
    if (!imageContextMenu || !copiedEdit) return;
    const idsArr = imageContextMenu.selectedIds;
    const ids = new Set(idsArr);
    const total = ids.size;
    setImageContextMenu(null);
    for (let i = 0; i < total; i++) {
      useUIStore.getState().setApplyPresetProgress({ current: i + 1, total });
      const doneIds = new Set(idsArr.slice(0, i + 1));
      setImages((prev) =>
        prev.map((img) => (doneIds.has(img.id) ? { ...img, ...copiedEdit } : img))
      );
      await new Promise((r) => setTimeout(r, 16));
    }
    setTimeout(() => useUIStore.getState().setApplyPresetProgress(null), 400);
    saveToHistory();
    if (total > 1) {
      setSelectedIds([]);
      lastSelectedIdRef.current = null;
    }
  }, [imageContextMenu, copiedEdit, saveToHistory]);

  const handleCreatePresetClick = useCallback(() => {
    if (!imageContextMenu) return;
    setCreatePresetFromImageId(imageContextMenu.imageId);
    setCreatePresetName('');
    setImageContextMenu(null);
  }, [imageContextMenu]);

  const handleCreatePresetSave = useCallback(async () => {
    const name = createPresetName.trim();
    if (!name || !createPresetFromImageId || !user) return;
    const img = images.find((i) => i.id === createPresetFromImageId);
    if (!img) return;
    const settings = JSON.parse(JSON.stringify(getEditSnapshot(img))) as Partial<CanvasImage>;
    const { error } = await supabase
      .from('presets')
      .insert({
        user_id: user.id,
        name,
        settings,
      });
    if (error) {
      console.error('Error saving preset:', error);
    } else {
      queryClient.invalidateQueries({ queryKey: ['presets', user.id] });
    }
    setCreatePresetFromImageId(null);
    setCreatePresetName('');
  }, [createPresetFromImageId, createPresetName, images, user, queryClient]);

  const handleCreatePresetCancel = useCallback(() => {
    setCreatePresetFromImageId(null);
    setCreatePresetName('');
  }, []);

  const handleApplyPresetToSelection = useCallback(async (preset: Preset) => {
    const ids = applyPresetToSelectionIds;
    if (!ids || ids.length === 0) return;
    useUIStore.getState().setApplyPresetProgress({ current: 1, total: ids.length });
    setApplyPresetToSelectionIds(null);
    const resetSettings: Partial<CanvasImage> = {
      exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, texture: 0,
      temperature: 0, vibrance: 0, saturation: 0, hue: 0, shadowTint: 0,
      colorHSL: undefined, splitToning: undefined, colorGrading: undefined, colorCalibration: undefined,
      clarity: 0, dehaze: 0, vignette: 0, grain: 0, grainSize: 0, grainRoughness: 0,
      curves: { ...DEFAULT_CURVES }, filters: [], brightness: 0, blur: 0,
      ...preset.settings,
    };
    const total = ids.length;
    for (let i = 0; i < total; i++) {
      useUIStore.getState().setApplyPresetProgress({ current: i + 1, total });
      const doneIds = new Set(ids.slice(0, i + 1));
      setImages((prev) =>
        prev.map((img) => (doneIds.has(img.id) ? { ...img, ...resetSettings } : img))
      );
      await new Promise((r) => setTimeout(r, 16));
    }
    setTimeout(() => useUIStore.getState().setApplyPresetProgress(null), 400);
    saveToHistory();
  }, [applyPresetToSelectionIds, setApplyPresetToSelectionIds, saveToHistory]);

  // Open modal to name folder when creating from multi-select
  const handleCreateFolderFromSelection = useCallback(() => {
    if (!imageContextMenu || imageContextMenu.selectedIds.length === 0) return;
    const ids = imageContextMenu.selectedIds.filter((id) => images.some((img) => img.id === id));
    if (ids.length === 0) return;
    setCreateFolderFromSelectionIds(ids);
    setCreateFolderFromSelectionName('New Folder');
    setCreateFolderFromSelectionNameError('');
    setImageContextMenu(null);
  }, [imageContextMenu, images]);

  // Create folder from selection after user enters name and saves; resolve overlaps so it doesn't sit on others
  const handleCreateFolderFromSelectionSave = useCallback(async () => {
    if (!createFolderFromSelectionIds || createFolderFromSelectionIds.length === 0) return;
    const name = createFolderFromSelectionName.trim();
    if (!name) {
      setCreateFolderFromSelectionNameError('Enter a folder name');
      return;
    }
    const isDuplicate = folders.some(
      (f) => f.name.toLowerCase() === name.toLowerCase()
    );
    if (isDuplicate) {
      setCreateFolderFromSelectionNameError('A folder with this name already exists');
      return;
    }

    const ids = createFolderFromSelectionIds;
    const selectedImages = images.filter((img) => ids.includes(img.id));
    if (selectedImages.length === 0) {
      setCreateFolderFromSelectionIds(null);
      setCreateFolderFromSelectionName('');
      return;
    }

    const centerX = (dimensions.width / 2 - stagePosition.x) / stageScale;
    const centerY = (dimensions.height / 2 - stagePosition.y) / stageScale;
    const folderId = `folder-${Date.now()}`;
    const colorIndex = folders.length % FOLDER_COLORS.length;

    const newFolder: PhotoFolder = {
      id: folderId,
      name,
      x: centerX,
      y: centerY,
      width: GRID_CONFIG.defaultFolderWidth,
      imageIds: ids,
      color: FOLDER_COLORS[colorIndex],
    };

    const foldersWithoutOld = folders.map((f) => ({
      ...f,
      imageIds: f.imageIds.filter((id) => !ids.includes(id)),
    }));
    const foldersWithNewFolder = [...foldersWithoutOld, newFolder];

    const reflowed = reflowImagesInFolder(selectedImages, newFolder.x, newFolder.y, newFolder.width);
    const imagesWithReflow = images.map((img) => {
      if (!ids.includes(img.id)) return img;
      const r = reflowed.find((ri) => ri.id === img.id);
      return r ? { ...r, folderId } : { ...img, folderId };
    });

    const { folders: resolvedFolders, images: resolvedImages } = resolveOverlapsAndReflow(
      foldersWithNewFolder,
      imagesWithReflow,
      folderId
    );

    setFolders(resolvedFolders);
    setImages(resolvedImages);
    setCreateFolderFromSelectionIds(null);
    setCreateFolderFromSelectionName('');
    setCreateFolderFromSelectionNameError('');

    if (user) {
      try {
        await supabase.from('photo_folders').insert({
          id: folderId,
          user_id: user.id,
          name,
          x: Math.round(newFolder.x),
          y: Math.round(newFolder.y),
          width: GRID_CONFIG.defaultFolderWidth,
          color: FOLDER_COLORS[colorIndex],
        });
        const finalReflowed = resolvedImages.filter((img) => img.folderId === folderId);
        for (const img of finalReflowed) {
          const path = img.storagePath || img.originalStoragePath;
          if (path) {
            await supabase
              .from('photo_edits')
              .update({ folder_id: folderId, x: Math.round(img.x), y: Math.round(img.y) })
              .eq('storage_path', path)
              .eq('user_id', user.id);
          }
        }
        const movedFolders = resolvedFolders.filter((f) => {
          if (f.id === folderId) return false;
          const prev = foldersWithNewFolder.find((of) => of.id === f.id);
          return prev && (prev.x !== f.x || prev.y !== f.y);
        });
        for (const f of movedFolders) {
          await supabase
            .from('photo_folders')
            .update({ x: Math.round(f.x), y: Math.round(f.y) })
            .eq('id', f.id)
            .eq('user_id', user.id);
          const movedFolderImgIds = new Set(f.imageIds);
          for (const img of resolvedImages) {
            if (!movedFolderImgIds.has(img.id)) continue;
            const path = img.storagePath || img.originalStoragePath;
            if (path) {
              await supabase
                .from('photo_edits')
                .update({ x: Math.round(img.x), y: Math.round(img.y) })
                .eq('storage_path', path)
                .eq('user_id', user.id);
            }
          }
        }
      } catch (err) {
        console.error('Failed to create folder / update edits:', err);
      }
      if (user) {
        skipNextPhotosLoadRef.current = true;
        queryClient.invalidateQueries({ queryKey: ['user-photos', user.id] });
      }
    }

    saveToHistory();
  }, [
    createFolderFromSelectionIds,
    createFolderFromSelectionName,
    images,
    folders,
    dimensions,
    stagePosition,
    stageScale,
    user,
    resolveOverlapsAndReflow,
    saveToHistory,
    queryClient,
  ]);

  const handleCreateFolderFromSelectionCancel = useCallback(() => {
    setCreateFolderFromSelectionIds(null);
    setCreateFolderFromSelectionName('');
    setCreateFolderFromSelectionNameError('');
  }, []);

  // Create empty folder from canvas context menu: name in modal first, then create with overlap resolution
  const handleCreateEmptyFolderSave = useCallback(async () => {
    const name = createEmptyFolderName.trim();
    if (!name) {
      setCreateEmptyFolderNameError('Enter a folder name');
      return;
    }
    const isDuplicate = folders.some(
      (f) => f.name.toLowerCase() === name.toLowerCase()
    );
    if (isDuplicate) {
      setCreateEmptyFolderNameError('A folder with this name already exists');
      return;
    }

    const centerX = (dimensions.width / 2 - stagePosition.x) / stageScale;
    const centerY = (dimensions.height / 2 - stagePosition.y) / stageScale;
    const folderId = `folder-${Date.now()}`;
    const colorIndex = folders.length % FOLDER_COLORS.length;

    const newFolder: PhotoFolder = {
      id: folderId,
      name,
      x: centerX,
      y: centerY,
      width: GRID_CONFIG.defaultFolderWidth,
      imageIds: [],
      color: FOLDER_COLORS[colorIndex],
    };

    const foldersWithNew = [...folders, newFolder];
    const { folders: resolvedFolders, images: resolvedImages } = resolveOverlapsAndReflow(
      foldersWithNew,
      images,
      folderId
    );

    setFolders(resolvedFolders);
    setImages(resolvedImages);
    setCreateEmptyFolderOpen(false);
    setCreateEmptyFolderName('');
    setCreateEmptyFolderNameError('');

    if (user) {
      const finalFolder = resolvedFolders.find((f) => f.id === folderId);
      if (finalFolder) {
        try {
          await supabase.from('photo_folders').insert({
            id: folderId,
            user_id: user.id,
            name,
            x: Math.round(finalFolder.x),
            y: Math.round(finalFolder.y),
            width: GRID_CONFIG.defaultFolderWidth,
            color: FOLDER_COLORS[colorIndex],
          });
          const movedFolders = resolvedFolders.filter((f) => {
            if (f.id === folderId) return false;
            const prev = foldersWithNew.find((of) => of.id === f.id);
            return prev && (prev.x !== f.x || prev.y !== f.y);
          });
          for (const f of movedFolders) {
            await supabase
              .from('photo_folders')
              .update({ x: Math.round(f.x), y: Math.round(f.y) })
              .eq('id', f.id)
              .eq('user_id', user.id);
          }
        } catch (err) {
          console.error('Failed to create folder', err);
        }
      }
    }

    saveToHistory();
  }, [
    createEmptyFolderName,
    folders,
    images,
    dimensions,
    stagePosition,
    stageScale,
    user,
    resolveOverlapsAndReflow,
    saveToHistory,
  ]);

  const handleCreateEmptyFolderCancel = useCallback(() => {
    setCreateEmptyFolderOpen(false);
    setCreateEmptyFolderName('');
    setCreateEmptyFolderNameError('');
  }, []);

  // Create social media layout from canvas context menu
  const handleCreateSocialLayoutSave = useCallback(async () => {
    const name = createSocialLayoutName.trim();
    if (!name) {
      setCreateSocialLayoutNameError('Enter a layout name');
      return;
    }
    const isDuplicate = folders.some(
      (f) => f.name.toLowerCase() === name.toLowerCase()
    );
    if (isDuplicate) {
      setCreateSocialLayoutNameError('A folder or layout with this name already exists');
      return;
    }

    const pages = Math.max(1, Math.min(SOCIAL_LAYOUT_MAX_PAGES, createSocialLayoutPages));
    const centerX = (dimensions.width / 2 - stagePosition.x) / stageScale;
    const centerY = (dimensions.height / 2 - stagePosition.y) / stageScale;
    const folderId = `folder-${Date.now()}`;
    const colorIndex = folders.length % FOLDER_COLORS.length;
    const width = pages * SOCIAL_LAYOUT_PAGE_WIDTH;
    const pageHeight = (SOCIAL_LAYOUT_PAGE_WIDTH * SOCIAL_LAYOUT_ASPECT.h) / SOCIAL_LAYOUT_ASPECT.w;
    const height = 30 + pageHeight;

    const newFolder: PhotoFolder = {
      id: folderId,
      name,
      x: centerX,
      y: centerY,
      width,
      height,
      imageIds: [],
      color: FOLDER_COLORS[colorIndex],
      type: 'social_layout',
      pageCount: pages,
      backgroundColor: DEFAULT_SOCIAL_LAYOUT_BG,
    };

    const foldersWithNew = [...folders, newFolder];
    const { folders: resolvedFolders, images: resolvedImages } = resolveOverlapsAndReflow(
      foldersWithNew,
      images,
      folderId
    );

    setFolders(resolvedFolders);
    setImages(resolvedImages);
    setCreateSocialLayoutOpen(false);
    setCreateSocialLayoutName('');
    setCreateSocialLayoutPages(3);
    setCreateSocialLayoutNameError('');

    if (user) {
      const finalFolder = resolvedFolders.find((f) => f.id === folderId);
      if (finalFolder) {
        try {
          await supabase.from('photo_folders').insert({
            id: folderId,
            user_id: user.id,
            name,
            x: Math.round(finalFolder.x),
            y: Math.round(finalFolder.y),
            width: Math.round(width),
            height: Math.round(height),
            color: FOLDER_COLORS[colorIndex],
            type: 'social_layout',
            page_count: pages,
            background_color: DEFAULT_SOCIAL_LAYOUT_BG,
          });
          const movedFolders = resolvedFolders.filter((f) => {
            if (f.id === folderId) return false;
            const prev = foldersWithNew.find((of) => of.id === f.id);
            return prev && (prev.x !== f.x || prev.y !== f.y);
          });
          for (const f of movedFolders) {
            await supabase
              .from('photo_folders')
              .update({
                x: Math.round(f.x),
                y: Math.round(f.y),
                ...(f.type === 'social_layout' && f.pageCount != null
                  ? { width: Math.round(f.pageCount * SOCIAL_LAYOUT_PAGE_WIDTH), page_count: f.pageCount, background_color: f.backgroundColor ?? undefined }
                  : {}),
              })
              .eq('id', f.id)
              .eq('user_id', user.id);
          }
        } catch (err) {
          console.error('Failed to create social layout', err);
        }
      }
    }

    saveToHistory();
  }, [
    createSocialLayoutName,
    createSocialLayoutPages,
    folders,
    images,
    dimensions,
    stagePosition,
    stageScale,
    user,
    resolveOverlapsAndReflow,
    saveToHistory,
  ]);

  const handleCreateSocialLayoutCancel = useCallback(() => {
    setCreateSocialLayoutOpen(false);
    setCreateSocialLayoutName('');
    setCreateSocialLayoutPages(3);
    setCreateSocialLayoutNameError('');
  }, []);

  const handleLayoutAddPage = useCallback((folderId: string) => {
    const folder = folders.find((f) => f.id === folderId);
    if (!folder || !isSocialLayout(folder)) return;
    const n = Math.min(SOCIAL_LAYOUT_MAX_PAGES, (folder.pageCount ?? 1) + 1);
    if (n === (folder.pageCount ?? 1)) return;
    const width = n * SOCIAL_LAYOUT_PAGE_WIDTH;
    const updated = folders.map((f) =>
      f.id === folderId ? { ...f, pageCount: n, width } : f
    );
    setFolders(updated);
    setFolderContextMenu(null);
    setSelectedFolderId(null);
    saveToHistory();
    if (user) {
      supabase.from('photo_folders').update({ page_count: n, width: Math.round(width) }).eq('id', folderId).eq('user_id', user.id).then(({ error }) => { if (error) console.error('Failed to update layout pages:', error); });
    }
  }, [folders, user, saveToHistory]);

  const handleLayoutRemovePage = useCallback((folderId: string) => {
    const folder = folders.find((f) => f.id === folderId);
    if (!folder || !isSocialLayout(folder)) return;
    const n = Math.max(1, (folder.pageCount ?? 1) - 1);
    if (n === (folder.pageCount ?? 1)) return;
    const width = n * SOCIAL_LAYOUT_PAGE_WIDTH;
    const updated = folders.map((f) =>
      f.id === folderId ? { ...f, pageCount: n, width } : f
    );
    setFolders(updated);
    setFolderContextMenu(null);
    setSelectedFolderId(null);
    saveToHistory();
    if (user) {
      supabase.from('photo_folders').update({ page_count: n, width: Math.round(width) }).eq('id', folderId).eq('user_id', user.id).then(({ error }) => { if (error) console.error('Failed to update layout pages:', error); });
    }
  }, [folders, user, saveToHistory]);

  const handleLayoutBackgroundColor = useCallback((folderId: string, color: string) => {
    const updated = folders.map((f) =>
      f.id === folderId ? { ...f, backgroundColor: color } : f
    );
    setFolders(updated);
    setFolderContextMenu(null);
    saveToHistory();
    if (user) {
      supabase.from('photo_folders').update({ background_color: color }).eq('id', folderId).eq('user_id', user.id).then(({ error }) => { if (error) console.error('Failed to update layout background:', error); });
    }
  }, [folders, user, saveToHistory]);

  // Close image/canvas/folder context menu and border dialog on click outside or escape
  useEffect(() => {
    if (!imageContextMenu && !canvasContextMenu && !folderContextMenu && !borderDialogImageId) return;
    const close = (e?: MouseEvent) => {
      if (e?.target && imageContextMenuRef.current?.contains(e.target as Node)) return;
      if (e?.target && canvasContextMenuRef.current?.contains(e.target as Node)) return;
      if (e?.target && folderContextMenuRef.current?.contains(e.target as Node)) return;
      if (e?.target && borderDialogRef.current?.contains(e.target as Node)) return;
      setImageContextMenu(null);
      setCanvasContextMenu(null);
      setFolderContextMenu(null);
      setBorderDialogImageId(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setImageContextMenu(null);
        setCanvasContextMenu(null);
        setFolderContextMenu(null);
        setBorderDialogImageId(null);
      }
    };
    window.addEventListener('click', close, true);
    window.addEventListener('contextmenu', close, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close, true);
      window.removeEventListener('contextmenu', close, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [imageContextMenu, canvasContextMenu, folderContextMenu, borderDialogImageId]);

  // Handle object drag end with smart snapping (only if near another photo)
  // Handle real-time grid snapping and shuffling during drag
  const handleImageDragMove = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      const node = e.target as Konva.Image;
      dragMoveNodeRef.current = node;
      if (dragMoveRafRef.current != null) return;
      dragMoveRafRef.current = requestAnimationFrame(() => {
        dragMoveRafRef.current = null;
        const node = dragMoveNodeRef.current;
        if (!node) return;
        // Redraw once per frame (Konva.autoDrawEnabled is false)
        stageRef.current?.getLayers().forEach((l) => l.batchDraw());

        const currentX = node.x();
        const currentY = node.y();
        const currentImg = images.find((i) => i.id === node.id());
        if (!currentImg) return;

        const currentCenterX = currentX + currentImg.width / 2;
        const currentCenterY = currentY + currentImg.height / 2;

        // Blink source folder border only when image center is over the border line
        const BORDER_BLINK_THRESHOLD = 28;
        if (currentImg.folderId) {
          const sourceFolder = folders.find((f) => f.id === currentImg.folderId);
          if (sourceFolder) {
            const folderImageCount = images.filter((img) => sourceFolder.imageIds.includes(img.id)).length;
            const borderH = getFolderBorderHeight(sourceFolder, folderImageCount);
            const left = sourceFolder.x;
            const top = sourceFolder.y + 30;
            const dist = distanceToRectBorder(currentCenterX, currentCenterY, left, top, sourceFolder.width, borderH);
            setDragSourceFolderBorderHovered(dist <= BORDER_BLINK_THRESHOLD ? currentImg.folderId : null);
          } else {
            setDragSourceFolderBorderHovered(null);
          }
        } else {
          setDragSourceFolderBorderHovered(null);
        }

        // Detect which folder is being hovered
        let targetFolderId: string | undefined = currentImg.folderId;
        let targetFolder: PhotoFolder | undefined = folders.find(f => f.id === currentImg.folderId);

        for (const folder of folders) {
          const bounds = getFolderBounds(folder, folder.imageIds.length);
          const boundTop = folder.y + 30;
          const boundBottom = bounds.bottom;

          if (currentCenterX >= bounds.x && currentCenterX <= bounds.right &&
            currentCenterY >= boundTop && currentCenterY <= boundBottom) {
            targetFolderId = folder.id;
            targetFolder = folder;
            break;
          }
        }

        // If image is in a folder, calculate grid position and shuffle in real-time (grid only; social layout = free placement, images can stack)
        if (targetFolderId && targetFolder) {
          if (isSocialLayout(targetFolder)) {
            setDragHoveredFolderId(targetFolderId);
            return; // Social layout: no snap, no swap — free placement, images can stack
          }
          setDragHoveredFolderId(targetFolderId);
          const cols = calculateColsFromWidth(targetFolder.width);
          const { folderPadding, imageMaxSize } = GRID_CONFIG;
          const contentStartX = targetFolder.x + folderPadding;
          const contentStartY = targetFolder.y + 30 + folderPadding;

          // Calculate which cell the drag position corresponds to
          const relativeX = currentX - contentStartX;
          const relativeY = currentY - contentStartY;
          const targetCol = Math.max(0, Math.floor(relativeX / CELL_SIZE));
          const targetRow = Math.max(0, Math.floor(relativeY / CELL_HEIGHT));
          const clampedCol = Math.min(targetCol, cols - 1);
          const { imageMaxHeight } = GRID_CONFIG;
          const targetCellCenterX = contentStartX + clampedCol * CELL_SIZE + imageMaxSize / 2;
          const targetCellCenterY = contentStartY + targetRow * CELL_HEIGHT + imageMaxHeight / 2;

          // Snap threshold - only snap when within 40px of cell center
          const snapThreshold = 40;
          const distanceToCellCenter = Math.sqrt(
            Math.pow(currentX + currentImg.width / 2 - targetCellCenterX, 2) +
            Math.pow(currentY + currentImg.height / 2 - targetCellCenterY, 2)
          );

          // Update folder hover state
          setDragHoveredFolderId(targetFolderId || null);

          // Only snap if close enough to cell center
          if (distanceToCellCenter > snapThreshold) {
            // Too far from cell center - clear ghost and allow free dragging
            setDragGhostPosition(null);
            return;
          }

          // Get other images in folder
          const otherFolderImages = images.filter(img =>
            targetFolder!.imageIds.includes(img.id) && img.id !== currentImg.id
          );

          // Calculate current cell positions for other images
          const imageCellMap = new Map<string, number>();
          otherFolderImages.forEach((img) => {
            const imgRelativeX = img.x - contentStartX;
            const imgRelativeY = img.y - contentStartY;
            const imgCol = Math.floor(imgRelativeX / CELL_SIZE);
            const imgRow = Math.floor(imgRelativeY / CELL_HEIGHT);
            const cellIndex = imgRow * cols + imgCol;
            imageCellMap.set(img.id, cellIndex);
          });

          // Track the dragged image's previous cell (before this move) for reliable swaps
          if (!dragPrevCellRef.current || dragPrevCellRef.current.imageId !== currentImg.id) {
            const currentImgRelativeX = currentImg.x - contentStartX;
            const currentImgRelativeY = currentImg.y - contentStartY;
            const currentImgCol = Math.max(0, Math.min(cols - 1, Math.floor(currentImgRelativeX / CELL_SIZE)));
            const currentImgRow = Math.max(0, Math.floor(currentImgRelativeY / CELL_HEIGHT));
            const currentImgCell = currentImgRow * cols + currentImgCol;
            dragPrevCellRef.current = { imageId: currentImg.id, col: currentImgCol, row: currentImgRow, cellIndex: currentImgCell };
          }

          // Don't mutate image positions during drag; resolve swaps on drag end only
          setDragGhostPosition(null);
        }

        // Update folder hover state for visual feedback
        setDragHoveredFolderId(targetFolderId || null);
      });
    },
    [folders]
  );

  const handleObjectDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>, type: 'image' | 'text') => {
      // Ignore drag end if spacebar is pressed (shouldn't happen, but just in case)
      if (isSpacePressed) return;

      if (dragMoveRafRef.current != null) {
        cancelAnimationFrame(dragMoveRafRef.current);
        dragMoveRafRef.current = null;
      }
      dragMoveNodeRef.current = null;

      const node = e.target;
      const currentX = node.x();
      const currentY = node.y();

      setDragGhostPosition(null);

      let newX = currentX;
      let newY = currentY;

      // Only snap if it's an image
      if (type === 'image') {
        // Use latest state so we never move the wrong image or use stale folder membership
        const latestFolders = latestFoldersRef.current;
        const latestImages = latestImagesRef.current;
        const currentImg = latestImages.find((img) => img.id === node.id());
        if (currentImg) {
          newX = currentX;
          newY = currentY;

          setImages((prev) =>
            prev.map((img) =>
              img.id === node.id() ? { ...img, x: newX, y: newY } : img
            )
          );

          // Calculate current center position
          const currentCenterX = currentX + currentImg.width / 2;
          const currentCenterY = currentY + currentImg.height / 2;

          // Check which folder the image was dropped into (if any).
          // When multiple folders contain the point (e.g. layout and a smaller folder inside it), pick the smallest one so the intended target wins.
          let targetFolderId: string | undefined = undefined;
          let targetFolder: PhotoFolder | undefined = undefined;
          let smallestArea = Infinity;

          for (const folder of latestFolders) {
            const folderHeight = folder.height ?? getFolderBorderHeight(folder, folder.imageIds.length);
            const boundLeft = folder.x;
            const boundRight = folder.x + folder.width;
            const boundTop = folder.y + 30;
            const boundBottom = folder.y + 30 + folderHeight;

            if (currentCenterX >= boundLeft && currentCenterX <= boundRight &&
              currentCenterY >= boundTop && currentCenterY <= boundBottom) {
              const area = (boundRight - boundLeft) * (boundBottom - boundTop);
              if (area < smallestArea) {
                smallestArea = area;
                targetFolderId = folder.id;
                targetFolder = folder;
              }
            }
          }

          // If image is IN a folder, snap to grid (social layout: no snap — keep position)
          // Ensure targetFolder is set (fallback if detection loop didn't find it)
          if (!targetFolder && targetFolderId) {
            targetFolder = latestFolders.find(f => f.id === targetFolderId);
          }
          if (targetFolderId && targetFolder) {
            if (isSocialLayout(targetFolder)) {
              // Social layout: no snap — newX/newY already = currentX/currentY
            } else {
              const { folderPadding, imageMaxSize, imageMaxHeight } = GRID_CONFIG;
              const cols = calculateColsFromWidth(targetFolder.width);
              const contentStartX = targetFolder.x + folderPadding;
              const contentStartY = targetFolder.y + 30 + folderPadding;
              const folderHeight = targetFolder.height ?? getFolderBorderHeight(targetFolder, targetFolder.imageIds.length);
              const contentHeight = folderHeight - (2 * folderPadding);
              const maxRows = Math.max(1, Math.floor(contentHeight / CELL_HEIGHT));
              const relativeX = currentX - contentStartX;
              const relativeY = currentY - contentStartY;
              const targetCol = Math.max(0, Math.min(cols - 1, Math.round(relativeX / CELL_SIZE)));
              const targetRow = Math.max(0, Math.min(maxRows - 1, Math.round(relativeY / CELL_HEIGHT)));
              const imgWidth = Math.min(currentImg.width * currentImg.scaleX, imageMaxSize);
              const imgHeight = Math.min(currentImg.height * currentImg.scaleY, imageMaxHeight);
              const cellOffsetX = (imageMaxSize - imgWidth) / 2;
              const cellOffsetY = (imageMaxHeight - imgHeight) / 2;
              newX = contentStartX + targetCol * CELL_SIZE + cellOffsetX;
              newY = contentStartY + targetRow * CELL_HEIGHT + cellOffsetY;

              node.position({ x: newX, y: newY });
            }
          }
          // If image is outside folders, use snapping logic
          else if (!targetFolderId) {
            const nearest = findNearestPhoto(currentCenterX, currentCenterY, latestImages, node.id(), 100);
            if (nearest) {
              newX = nearest.x - currentImg.width / 2;
              newY = nearest.y - currentImg.height / 2;
              newX = snapToGrid(newX, GRID_SIZE);
              newY = snapToGrid(newY, GRID_SIZE);
              node.position({ x: newX, y: newY });
            }
          }

          // Update image's folder assignment
          const oldFolderId = currentImg.folderId;

          if (targetFolderId !== oldFolderId) {
            // If dropped outside all folders AND image was in a folder, create a new "Untitled" folder
            if (!targetFolderId && oldFolderId) {
              // Generate unique "Untitled" name
              const existingUntitledNames = latestFolders
                .filter(f => f.name.toLowerCase().startsWith('untitled'))
                .map(f => f.name.toLowerCase());

              let untitledName = 'Untitled';
              if (existingUntitledNames.includes('untitled')) {
                let counter = 2;
                while (existingUntitledNames.includes(`untitled-${counter}`)) {
                  counter++;
                }
                untitledName = `Untitled-${counter}`;
              }

              const newFolderId = `folder-${Date.now()}`;
              const colorIndex = latestFolders.length % FOLDER_COLORS.length;
              const newFolderX = newX;
              const newFolderY = newY - 50;
              const newFolderWidth = GRID_CONFIG.defaultFolderWidth;
              const contentStartX = newFolderX + GRID_CONFIG.folderPadding;
              const contentStartY = newFolderY + 30 + GRID_CONFIG.folderPadding;
              const imgW = currentImg.width * (currentImg.scaleX ?? 1);
              const imgH = currentImg.height * (currentImg.scaleY ?? 1);
              const { imageMaxSize, imageMaxHeight } = GRID_CONFIG;
              const cellOffsetX = Math.max(0, (imageMaxSize - imgW) / 2);
              const cellOffsetY = Math.max(0, (imageMaxHeight - imgH) / 2);
              const centeredX = contentStartX + cellOffsetX;
              const centeredY = contentStartY + cellOffsetY;

              const updatedFolders = latestFolders
                .map((f) =>
                  f.id === oldFolderId
                    ? { ...f, imageIds: f.imageIds.filter((id) => id !== currentImg.id) }
                    : f
                )
                .concat({
                  id: newFolderId,
                  name: untitledName,
                  x: newFolderX,
                  y: newFolderY,
                  width: newFolderWidth,
                  imageIds: [currentImg.id],
                  color: FOLDER_COLORS[colorIndex],
                });
              const updatedImages = latestImages.map((img) =>
                img.id === currentImg.id
                  ? { ...img, x: centeredX, y: centeredY, folderId: newFolderId, width: imgW, height: imgH, scaleX: 1, scaleY: 1 }
                  : img
              );

              // Resolve overlaps so the new folder pushes others out of the way
              const { folders: resolvedFolders, images: resolvedImages } = resolveOverlapsAndReflow(
                updatedFolders,
                updatedImages,
                newFolderId
              );

              setFolders(resolvedFolders);
              setImages(resolvedImages);

              const finalImg = resolvedImages.find((img) => img.id === currentImg.id);
              if (finalImg) {
                node.position({ x: finalImg.x, y: finalImg.y });
              } else {
                node.position({ x: centeredX, y: centeredY });
              }

              saveToHistory();

              // Save new folder and any moved folders to Supabase
              if (user) {
                const resolvedNewFolder = resolvedFolders.find((f) => f.id === newFolderId);
                const newF = resolvedNewFolder || { x: newFolderX, y: newFolderY };
                supabase.from('photo_folders').insert({
                  id: newFolderId,
                  user_id: user.id,
                  name: untitledName,
                  x: Math.round(newF.x),
                  y: Math.round(newF.y),
                  width: Math.round(newFolderWidth),
                  color: FOLDER_COLORS[colorIndex],
                }).then(({ error }) => {
                  if (error) console.error('Failed to save new folder:', error);
                });

                // Update any existing folders that were pushed
                for (const f of resolvedFolders) {
                  if (f.id === newFolderId) continue;
                  const prev = latestFolders.find((of) => of.id === f.id);
                  if (prev && (prev.x !== f.x || prev.y !== f.y)) {
                    supabase.from('photo_folders')
                      .update({ x: Math.round(f.x), y: Math.round(f.y) })
                      .eq('id', f.id)
                      .eq('user_id', user.id)
                      .then(({ error }) => {
                        if (error) console.error('Failed to update folder position:', error);
                      });
                  }
                }

                const currentCanonical = currentImg.storagePath || currentImg.originalStoragePath;
                if (currentCanonical && finalImg) {
                  supabase.from('photo_edits')
                    .update({
                      folder_id: newFolderId,
                      x: Math.round(finalImg.x),
                      y: Math.round(finalImg.y),
                      width: Math.round(finalImg.width),
                      height: Math.round(finalImg.height),
                      scale_x: finalImg.scaleX ?? 1,
                      scale_y: finalImg.scaleY ?? 1,
                    })
                    .eq('storage_path', currentCanonical)
                    .eq('user_id', user.id)
                    .then(({ error }) => {
                      if (error) console.error('Failed to update photo folder:', error);
                    });
                }
              }

              return; // Exit early since we already updated images
            }

            // Moving between existing folders or into a folder — use snapped drop position (newX, newY from above)
            if (targetFolderId) {
              let gridX = newX;
              let gridY = newY;
              let finalWidth = currentImg.width;
              let finalHeight = currentImg.height;
              let finalScaleX = currentImg.scaleX ?? 1;
              let finalScaleY = currentImg.scaleY ?? 1;

              // No scaling: use current dimensions. Layout: free placement (no snap); grid: snap to cell.
              if (targetFolder && isSocialLayout(targetFolder) && targetFolderId !== oldFolderId) {
                finalWidth = currentImg.width * (currentImg.scaleX ?? 1);
                finalHeight = currentImg.height * (currentImg.scaleY ?? 1);
                finalScaleX = 1;
                finalScaleY = 1;
                gridX = currentCenterX - finalWidth / 2;
                gridY = currentCenterY - finalHeight / 2;
              } else if (targetFolder && !isSocialLayout(targetFolder) && targetFolderId !== oldFolderId) {
                const { folderPadding, imageMaxSize, imageMaxHeight } = GRID_CONFIG;
                const contentStartX = targetFolder.x + folderPadding;
                const contentStartY = targetFolder.y + 30 + folderPadding;
                const cols = calculateColsFromWidth(targetFolder.width);
                const folderHeight = targetFolder.height ?? getFolderBorderHeight(targetFolder, targetFolder.imageIds.length);
                const maxRows = Math.max(1, Math.floor((folderHeight - 30 - 2 * folderPadding + GRID_CONFIG.imageGap) / CELL_HEIGHT));
                const relativeX = currentCenterX - contentStartX;
                const relativeY = currentCenterY - contentStartY;
                const targetCol = Math.max(0, Math.min(cols - 1, Math.floor(relativeX / CELL_SIZE)));
                const targetRow = Math.max(0, Math.min(maxRows - 1, Math.floor(relativeY / CELL_HEIGHT)));
                const cellOffsetX = (imageMaxSize - finalWidth) / 2;
                const cellOffsetY = (imageMaxHeight - finalHeight) / 2;
                gridX = contentStartX + targetCol * CELL_SIZE + cellOffsetX;
                gridY = contentStartY + targetRow * CELL_HEIGHT + cellOffsetY;
              }

              // Update folders: only move the single dragged image (remove from source, add to target). Use latest state.
              const updatedFolders = latestFolders.map((f) => {
                if (f.id === oldFolderId) {
                  return { ...f, imageIds: f.imageIds.filter((id) => id !== currentImg.id) };
                }
                if (f.id === targetFolderId) {
                  // Only add the dragged image; avoid duplicates or accidentally pulling in other images
                  const hasAlready = f.imageIds.includes(currentImg.id);
                  return { ...f, imageIds: hasAlready ? f.imageIds : [...f.imageIds, currentImg.id] };
                }
                return f;
              });

              // Update images: only the dragged image changes position and folderId
              const updatedImages = latestImages.map((img) =>
                img.id === currentImg.id
                  ? { ...img, x: gridX, y: gridY, folderId: targetFolderId, width: finalWidth, height: finalHeight, scaleX: finalScaleX, scaleY: finalScaleY }
                  : img
              );

              // Resolve any folder overlaps (target folder may have grown). Pass dragged image id so only it moves.
              const { folders: resolvedFolders, images: resolvedImages } = resolveOverlapsAndReflow(
                updatedFolders,
                updatedImages,
                targetFolderId,
                currentImg.id
              );

              setFolders(resolvedFolders);
              setImages(resolvedImages);

              // Update the node position visually
              const finalImg = resolvedImages.find(img => img.id === currentImg.id);
              if (finalImg) {
                node.position({ x: finalImg.x, y: finalImg.y });
              }

              // Persist folder changes and image positions to Supabase
              if (user) {
                // Save moved folders
                for (const f of resolvedFolders) {
                  const oldF = latestFolders.find(of => of.id === f.id);
                  if (oldF && (oldF.x !== f.x || oldF.y !== f.y)) {
                    supabase.from('photo_folders')
                      .update({ x: Math.round(f.x), y: Math.round(f.y) })
                      .eq('id', f.id)
                      .eq('user_id', user.id)
                      .then(({ error }) => {
                        if (error) console.error('Failed to update folder:', error);
                      });
                  }
                }

                // Save the dragged image (canonical key), including dimensions when scaled on drop into layout
                const currentCanonical = currentImg.storagePath || currentImg.originalStoragePath;
                if (currentCanonical && finalImg) {
                  supabase.from('photo_edits')
                    .update({
                      folder_id: targetFolderId,
                      x: Math.round(finalImg.x),
                      y: Math.round(finalImg.y),
                      width: Math.round(finalImg.width),
                      height: Math.round(finalImg.height),
                      scale_x: finalImg.scaleX ?? 1,
                      scale_y: finalImg.scaleY ?? 1,
                    })
                    .eq('storage_path', currentCanonical)
                    .eq('user_id', user.id)
                    .then(({ error }) => {
                      if (error) console.error('Failed to update photo folder:', error);
                    });
                }

                // Save swapped image if there was a swap (when moving within same folder before folder change)
                if (lastSwappedImageRef.current) {
                  const swappedImg = resolvedImages.find(img => img.id === lastSwappedImageRef.current!.id);
                  if (swappedImg?.storagePath) {
                    supabase.from('photo_edits')
                      .update({
                        x: Math.round(swappedImg.x),
                        y: Math.round(swappedImg.y),
                        folder_id: swappedImg.folderId || null
                      })
                      .eq('storage_path', swappedImg.storagePath)
                      .eq('user_id', user.id)
                      .then(({ error }) => {
                        if (error) console.error('Failed to update swapped photo position:', error);
                      });
                  }
                  // Clear swap tracking
                  lastSwappedImageRef.current = null;
                }
              }

              return; // Exit early since we already updated images
            }
          }

          // If image is in a folder (same folder move), snap to grid for regular folders
          if (targetFolderId && targetFolderId === oldFolderId) {
            // Ensure we have the target folder (fallback if not found in detection loop)
            if (!targetFolder && targetFolderId) {
              targetFolder = latestFolders.find(f => f.id === targetFolderId);
            }
            if (!targetFolder) {
              // Folder not found, skip snapping
              return;
            }

            let finalX = node.x();
            let finalY = node.y();
            let swapImgId: string | undefined;
            let swapX: number | undefined;
            let swapY: number | undefined;

            // Snap to grid for regular folders (social layout: keep free position)
            if (!isSocialLayout(targetFolder)) {
              const { folderPadding, imageMaxSize, imageMaxHeight } = GRID_CONFIG;
              const cols = calculateColsFromWidth(targetFolder.width);
              const contentStartX = targetFolder.x + folderPadding;
              const contentStartY = targetFolder.y + 30 + folderPadding;
              const folderHeight = targetFolder.height ?? getFolderBorderHeight(targetFolder, targetFolder.imageIds.length);
              const contentHeight = folderHeight - (2 * folderPadding);
              const maxRows = Math.max(1, Math.floor(contentHeight / CELL_HEIGHT));
              const relativeX = currentX - contentStartX;
              const relativeY = currentY - contentStartY;
              const targetCol = Math.max(0, Math.min(cols - 1, Math.round(relativeX / CELL_SIZE)));
              const targetRow = Math.max(0, Math.min(maxRows - 1, Math.round(relativeY / CELL_HEIGHT)));

              // Build occupied cell map from latest state (excluding current image)
              const otherFolderImages = latestImages.filter(img =>
                targetFolder!.imageIds.includes(img.id) && img.id !== currentImg.id
              );
              const occupiedCells = new Set<number>();
              let occupiedById: string | undefined;
              otherFolderImages.forEach((img) => {
                const imgRelativeX = img.x - contentStartX;
                const imgRelativeY = img.y - contentStartY;
                const imgCol = Math.floor(imgRelativeX / CELL_SIZE);
                const imgRow = Math.floor(imgRelativeY / CELL_HEIGHT);
                const cellIndex = imgRow * cols + imgCol;
                occupiedCells.add(cellIndex);
                if (cellIndex === targetRow * cols + targetCol) {
                  occupiedById = img.id;
                }
              });

              let finalCol = targetCol;
              let finalRow = targetRow;
              const targetCellIndex = targetRow * cols + targetCol;

              if (occupiedById) {
                const prevCell = dragPrevCellRef.current;
                if (prevCell && prevCell.imageId === currentImg.id && prevCell.cellIndex !== targetCellIndex) {
                  // Swap into the previous cell
                  const occupiedImg = otherFolderImages.find(img => img.id === occupiedById);
                  if (occupiedImg) {
                    swapImgId = occupiedById;
                    const swapImgWidth = Math.min(occupiedImg.width * occupiedImg.scaleX, imageMaxSize);
                    const swapImgHeight = Math.min(occupiedImg.height * occupiedImg.scaleY, imageMaxHeight);
                    const swapOffsetX = (imageMaxSize - swapImgWidth) / 2;
                    const swapOffsetY = (imageMaxHeight - swapImgHeight) / 2;
                    swapX = contentStartX + prevCell.col * CELL_SIZE + swapOffsetX;
                    swapY = contentStartY + prevCell.row * CELL_HEIGHT + swapOffsetY;
                  }
                } else {
                  // Find nearest empty cell
                  for (let radius = 0; radius < maxRows * cols; radius++) {
                    let foundEmpty = false;
                    for (let dr = -radius; dr <= radius && !foundEmpty; dr++) {
                      for (let dc = -radius; dc <= radius && !foundEmpty; dc++) {
                        if (Math.abs(dr) !== radius && Math.abs(dc) !== radius) continue;
                        const checkRow = targetRow + dr;
                        const checkCol = targetCol + dc;
                        if (checkRow >= 0 && checkRow < maxRows && checkCol >= 0 && checkCol < cols) {
                          const checkCellIndex = checkRow * cols + checkCol;
                          if (!occupiedCells.has(checkCellIndex)) {
                            finalRow = checkRow;
                            finalCol = checkCol;
                            foundEmpty = true;
                          }
                        }
                      }
                    }
                    if (foundEmpty) break;
                  }
                }
              }

              const imgWidth = Math.min(currentImg.width * currentImg.scaleX, imageMaxSize);
              const imgHeight = Math.min(currentImg.height * currentImg.scaleY, imageMaxHeight);
              const cellOffsetX = (imageMaxSize - imgWidth) / 2;
              const cellOffsetY = (imageMaxHeight - imgHeight) / 2;
              finalX = contentStartX + finalCol * CELL_SIZE + cellOffsetX;
              finalY = contentStartY + finalRow * CELL_HEIGHT + cellOffsetY;
              node.position({ x: finalX, y: finalY });

              if (swapImgId && swapX !== undefined && swapY !== undefined) {
                lastSwappedImageRef.current = { id: swapImgId, x: swapX, y: swapY };
              }

              dragPrevCellRef.current = { imageId: currentImg.id, col: finalCol, row: finalRow, cellIndex: finalRow * cols + finalCol };
            } else {
              // Social layout: use current position (no snap)
              finalX = newX;
              finalY = newY;
            }

            // Update folder assignment if needed (should already be set)
            setImages((prev) =>
              prev.map((img) => {
                if (img.id === currentImg.id) {
                  return { ...img, folderId: targetFolderId, x: finalX, y: finalY };
                }
                if (swapImgId && img.id === swapImgId && swapX !== undefined && swapY !== undefined) {
                  return { ...img, x: swapX, y: swapY };
                }
                return img;
              })
            );

            // Save to Supabase if user is logged in
            if (user) {
              // Save dragged image using state position (canonical key)
              const currentCanonical = currentImg.storagePath || currentImg.originalStoragePath;
              if (currentCanonical) {
                supabase.from('photo_edits')
                  .update({ x: Math.round(finalX), y: Math.round(finalY), folder_id: targetFolderId })
                  .eq('storage_path', currentCanonical)
                  .eq('user_id', user.id)
                  .then(({ error }) => {
                    if (error) console.error('Failed to update photo position:', error);
                  });
              }

              // Save swapped image if there was a swap - use the position from ref (calculated during drag)
              if (lastSwappedImageRef.current) {
                const swappedRef = lastSwappedImageRef.current;
                const swappedImg = latestImages.find(img => img.id === swappedRef.id);
                const swappedCanonical = swappedImg?.storagePath || swappedImg?.originalStoragePath;
                if (swappedImg && swappedCanonical) {
                  const swappedX = swappedRef.x;
                  const swappedY = swappedRef.y;

                  // Use swappedRef (captured) - the ref may be cleared before the callback runs
                  setImages((prev) =>
                    prev.map((img) =>
                      img.id === swappedRef.id
                        ? { ...img, x: swappedX, y: swappedY }
                        : img
                    )
                  );

                  supabase.from('photo_edits')
                    .update({
                      x: Math.round(swappedX),
                      y: Math.round(swappedY)
                    })
                    .eq('storage_path', swappedCanonical)
                    .eq('user_id', user.id)
                    .then(({ error }) => {
                      if (error) console.error('Failed to update swapped photo position:', error);
                    });
                }
                // Clear swap tracking
                lastSwappedImageRef.current = null;
              }
            }

            // Update node position to match state (in case there's any drift)
            node.position({ x: finalX, y: finalY });
            return; // Exit early since we already updated images
          }
        }
      }

      node.position({ x: newX, y: newY });

      if (type === 'image') {
        const currentImg = images.find((img) => img.id === node.id());
        setImages((prev) =>
          prev.map((img) => (img.id === node.id() ? { ...img, x: newX, y: newY } : img))
        );
        // Auto-save position to backend so refresh shows correct position
        if (user && currentImg && (currentImg.storagePath || currentImg.originalStoragePath)) {
          const canonical = currentImg.storagePath || currentImg.originalStoragePath;
          supabase.from('photo_edits')
            .update({ x: Math.round(newX), y: Math.round(newY) })
            .eq('storage_path', canonical)
            .eq('user_id', user.id)
            .then(({ error }) => {
              if (error) console.error('Failed to save photo position:', error);
            });
        }
      } else {
        setTexts((prev) =>
          prev.map((txt) => (txt.id === node.id() ? { ...txt, x: newX, y: newY } : txt))
        );
      }
    },
    [images, user, resolveOverlapsAndReflow, saveToHistory, isSpacePressed]
  );


  // Wrapper: export selection from context menu
  const handleExportSelection = useCallback(() => {
    if (!imageContextMenu) return;
    setImageContextMenu(null);
    handleExportSelectionBase(imageContextMenu.selectedIds);
  }, [imageContextMenu, handleExportSelectionBase]);

  // Handle folder click to edit
  const handleFolderDoubleClick = useCallback((folder: PhotoFolder) => {
    // Only edit if we didn't just drag the folder name
    if (!folderNameDragRef.current) {
      setEditingFolder(folder);
      setEditingFolderName(folder.name);
    }
  }, []);

  // Rename folder
  const handleRenameFolder = useCallback(async () => {
    if (!editingFolder || !editingFolderName.trim()) return;

    const newName = editingFolderName.trim();

    // Check for duplicate name
    const isDuplicate = folders.some(
      f => f.id !== editingFolder.id && f.name.toLowerCase() === newName.toLowerCase()
    );

    if (isDuplicate) {
      setFolderNameError('A folder with this name already exists');
      return;
    }

    setFolderNameError('');

    // Update local state
    setFolders((prev) =>
      prev.map((f) => f.id === editingFolder.id ? { ...f, name: newName } : f)
    );

    // Update in Supabase if user is logged in
    if (user) {
      try {
        await supabase
          .from('photo_folders')
          .update({ name: newName })
          .eq('id', editingFolder.id)
          .eq('user_id', user.id);
      } catch (error) {
        console.error('Failed to update folder name:', error);
      }
    }

    setEditingFolder(null);
    setEditingFolderName('');
    setFolderNameError('');
    saveToHistory();
  }, [editingFolder, editingFolderName, folders, user, saveToHistory]);

  // Delete folder and all its photos (no ungroup option). Closes modals and shows "Deleting 1 of N" banner.
  const handleDeleteFolder = useCallback(async () => {
    if (!editingFolder) return;

    const folder = editingFolder;
    const folderImageIds = [...folder.imageIds];
    const total = folderImageIds.length;

    // Close modals immediately so user isn't stuck on loading in modal
    setConfirmDeleteFolderOpen(false);
    setEditingFolder(null);
    setEditingFolderName('');
    setFolderNameError('');
    setDeleteFolderProgress(total > 0 ? { current: 0, total } : { current: 0, total: 0 });

    try {
      // Delete images via API (service role) so photos + originals buckets are removed
      if (user) {
        for (let i = 0; i < folderImageIds.length; i++) {
          setDeleteFolderProgress({ current: i + 1, total });
          const imgId = folderImageIds[i];
          const img = images.find(im => im.id === imgId);
          if (!img) continue;
          const payload = getDeletePhotoPayload(img);
          if (!payload.storagePath && !payload.originalStoragePath) continue;
          try {
            const res = await fetch('/api/delete-photo', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ...payload,
                userId: user.id,
              }),
            });
            if (!res.ok) {
              const data = await res.json();
              console.error('Failed to delete image:', data);
            }
          } catch (error) {
            console.error('Failed to delete image:', error);
          }
        }
      }

      if (total === 0) setDeleteFolderProgress({ current: 0, total: 0 });

      // Remove images from canvas
      setImages((prev) => prev.filter(img => !folderImageIds.includes(img.id)));

      // Delete folder from Supabase
      if (user) {
        try {
          await supabase
            .from('photo_folders')
            .delete()
            .eq('id', folder.id)
            .eq('user_id', user.id);
        } catch (error) {
          console.error('Failed to delete folder:', error);
        }
      }

      setFolders((prev) => prev.filter(f => f.id !== folder.id));
      if (user) queryClient.invalidateQueries({ queryKey: ['user-photos', user.id] });
      saveToHistory();
    } finally {
      setDeleteFolderProgress(null);
    }
  }, [editingFolder, images, user, saveToHistory, queryClient]);

  // Delete photos by id (used for single from EditPanel or multi from context menu; after confirm or when skip-confirm)
  const handleDeletePhotos = useCallback(async (ids: string[]) => {
    const photoIds = ids.filter((id) => {
      const img = images.find((i) => i.id === id);
      return img && 'src' in img;
    });
    if (photoIds.length === 0) return;

    setDeletingPhotoId(photoIds[0]);
    try {
      if (user) {
        for (const photoId of photoIds) {
          const img = images.find((i) => i.id === photoId);
          if (!img || !('src' in img)) continue;
          const payload = getDeletePhotoPayload(img);
          if (!payload.storagePath && !payload.originalStoragePath) continue;
          try {
            const res = await fetch('/api/delete-photo', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...payload, userId: user.id }),
            });
            if (!res.ok) {
              const data = await res.json();
              console.error('Delete photo failed:', data);
            }
          } catch (err) {
            console.error('Error deleting photo:', err);
          }
        }
        queryClient.invalidateQueries({ queryKey: ['user-photos', user.id] });
      }
      setImages((prev) => prev.filter((img) => !photoIds.includes(img.id)));
      setSelectedIds((prev) => prev.filter((id) => !photoIds.includes(id)));
      saveToHistory();
    } finally {
      setDeletingPhotoId(null);
    }
  }, [images, user, queryClient, saveToHistory]);

  // Recenter all folders horizontally in the middle of the canvas
  const handleRecenterFolders = useCallback(async () => {
    if (folders.length === 0) return;

    const { folderGap } = GRID_CONFIG;

    // Calculate total width needed for all folders
    let totalWidth = 0;
    const folderWidths: number[] = [];

    for (const folder of folders) {
      folderWidths.push(folder.width);
      totalWidth += folder.width;
    }

    // Add gaps between folders
    totalWidth += (folders.length - 1) * folderGap;

    // Calculate center of viewport in stage coordinates
    const viewportCenterX = (dimensions.width / 2 - stagePosition.x) / stageScale;
    const viewportCenterY = (dimensions.height / 2 - stagePosition.y) / stageScale;

    // Calculate starting X position (left edge of first folder)
    let currentX = viewportCenterX - totalWidth / 2;

    // Sort folders by current x position to preserve user's left-to-right arrangement
    const sortedFolders = [...folders].sort((a, b) => a.x - b.x);

    // Position all folders horizontally
    const recenteredFolders: PhotoFolder[] = [];
    let recenteredImages = [...images];

    for (let i = 0; i < sortedFolders.length; i++) {
      const folder = sortedFolders[i];
      const newFolder = {
        ...folder,
        x: currentX,
        y: viewportCenterY - 100, // Slightly above center
      };
      recenteredFolders.push(newFolder);

      // Translate images with their folder (preserve layout and order, don't reflow)
      const deltaX = newFolder.x - folder.x;
      const deltaY = newFolder.y - folder.y;
      const folderImgIds = new Set(folder.imageIds);
      recenteredImages = recenteredImages.map((img) => {
        if (folderImgIds.has(img.id)) {
          return { ...img, x: img.x + deltaX, y: img.y + deltaY };
        }
        return img;
      });

      currentX += folder.width + folderGap;
    }

    setFolders(recenteredFolders);
    setImages(recenteredImages);
    saveToHistory();

    // Persist to Supabase
    if (user) {
      for (const f of recenteredFolders) {
        supabase.from('photo_folders')
          .update({ x: Math.round(f.x), y: Math.round(f.y) })
          .eq('id', f.id)
          .eq('user_id', user.id)
          .then(({ error }) => {
            if (error) console.error('Failed to update folder position:', error);
          });
      }

      const folderImages = recenteredImages.filter(img => (img.storagePath || img.originalStoragePath) && img.folderId);
      for (const img of folderImages) {
        const canonicalPath = img.storagePath || img.originalStoragePath!;
        supabase.from('photo_edits')
          .update({ x: Math.round(img.x), y: Math.round(img.y) })
          .eq('storage_path', canonicalPath)
          .eq('user_id', user.id)
          .then(({ error }) => {
            if (error) console.error('Failed to update image position:', error);
          });
      }
    }
  }, [folders, images, dimensions, stagePosition, stageScale, user, saveToHistory]);

  // Recenter folders horizontally (stack in a row, centered — same as main Recenter button)
  const handleRecenterHorizontally = useCallback(async () => {
    if (folders.length === 0) return;
    const { folderGap } = GRID_CONFIG;
    let totalWidth = 0;
    for (const folder of folders) totalWidth += folder.width;
    totalWidth += (folders.length - 1) * folderGap;
    const viewportCenterX = (dimensions.width / 2 - stagePosition.x) / stageScale;
    const viewportCenterY = (dimensions.height / 2 - stagePosition.y) / stageScale;
    let currentX = viewportCenterX - totalWidth / 2;
    const sortedFolders = [...folders].sort((a, b) => a.x - b.x);
    const recenteredFolders: PhotoFolder[] = [];
    let recenteredImages = [...images];
    for (const folder of sortedFolders) {
      const newFolder = { ...folder, x: currentX, y: viewportCenterY - 100 };
      recenteredFolders.push(newFolder);
      const deltaX = newFolder.x - folder.x;
      const deltaY = newFolder.y - folder.y;
      const folderImgIds = new Set(folder.imageIds);
      recenteredImages = recenteredImages.map((img) =>
        folderImgIds.has(img.id) ? { ...img, x: img.x + deltaX, y: img.y + deltaY } : img
      );
      currentX += folder.width + folderGap;
    }
    setFolders(recenteredFolders);
    setImages(recenteredImages);
    saveToHistory();
    if (user) {
      for (const f of recenteredFolders) {
        supabase.from('photo_folders').update({ x: Math.round(f.x), y: Math.round(f.y) }).eq('id', f.id).eq('user_id', user.id).then(({ error }) => { if (error) console.error(error); });
      }
      for (const img of recenteredImages.filter(i => (i.storagePath || i.originalStoragePath) && i.folderId)) {
        supabase.from('photo_edits').update({ x: Math.round(img.x), y: Math.round(img.y) }).eq('storage_path', img.storagePath || img.originalStoragePath!).eq('user_id', user.id).then(({ error }) => { if (error) console.error(error); });
      }
    }
  }, [folders, images, dimensions, stagePosition, stageScale, user, saveToHistory]);

  // Recenter folders vertically (stack in a column, centered — same as main Recenter but vertical)
  const handleRecenterVertically = useCallback(async () => {
    if (folders.length === 0) return;
    const { folderGap } = GRID_CONFIG;
    const labelFontSize = Math.max(6, Math.min(96, 24 / stageScale));
    const labelYOffset = Math.max(0, labelFontSize - 28) + 10;
    const LABEL_BAR = 30;
    let totalHeight = 0;
    for (const folder of folders) {
      const h = folder.height ?? getFolderBorderHeight(folder, folder.imageIds.length);
      totalHeight += LABEL_BAR + h + labelYOffset;
    }
    totalHeight += (folders.length - 1) * folderGap;
    const viewportCenterX = (dimensions.width / 2 - stagePosition.x) / stageScale;
    const viewportCenterY = (dimensions.height / 2 - stagePosition.y) / stageScale;
    let currentY = viewportCenterY - totalHeight / 2;
    const sortedFolders = [...folders].sort((a, b) => a.y - b.y);
    const recenteredFolders: PhotoFolder[] = [];
    let recenteredImages = [...images];
    for (const folder of sortedFolders) {
      const folderHeight = folder.height ?? getFolderBorderHeight(folder, folder.imageIds.length);
      const newFolder = { ...folder, x: viewportCenterX - folder.width / 2, y: currentY };
      recenteredFolders.push(newFolder);
      const deltaX = newFolder.x - folder.x;
      const deltaY = newFolder.y - folder.y;
      const folderImgIds = new Set(folder.imageIds);
      recenteredImages = recenteredImages.map((img) =>
        folderImgIds.has(img.id) ? { ...img, x: img.x + deltaX, y: img.y + deltaY } : img
      );
      currentY += LABEL_BAR + folderHeight + folderGap + labelYOffset;
    }
    setFolders(recenteredFolders);
    setImages(recenteredImages);
    saveToHistory();
    if (user) {
      for (const f of recenteredFolders) {
        supabase.from('photo_folders').update({ x: Math.round(f.x), y: Math.round(f.y) }).eq('id', f.id).eq('user_id', user.id).then(({ error }) => { if (error) console.error(error); });
      }
      for (const img of recenteredImages.filter(i => (i.storagePath || i.originalStoragePath) && i.folderId)) {
        supabase.from('photo_edits').update({ x: Math.round(img.x), y: Math.round(img.y) }).eq('storage_path', img.storagePath || img.originalStoragePath!).eq('user_id', user.id).then(({ error }) => { if (error) console.error(error); });
      }
    }
  }, [folders, images, dimensions, stagePosition, stageScale, user, saveToHistory]);

  // Add text at double-click position (left button only)
  const handleStageDoubleClick = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.evt.button !== 0) return;
    // Don't add text if clicking on an object
    const clickedOnEmpty = e.target === e.target.getStage();
    if (!clickedOnEmpty) return;

    const stage = stageRef.current;
    if (!stage) return;

    // Get pointer position in stage coordinates
    const pointerPos = stage.getPointerPosition();
    if (!pointerPos) return;

    // Convert screen coordinates to stage coordinates
    const x = (pointerPos.x - stagePosition.x) / stageScale;
    const y = (pointerPos.y - stagePosition.y) / stageScale;

    const newText: CanvasText = {
      id: `text-${Date.now()}-${Math.random()}`,
      x,
      y,
      text: 'Click to edit',
      fontSize: 24,
      fill: '#ffffff',
      rotation: 0,
    };

    setTexts((prev) => {
      const updated = [...prev, newText];
      saveToHistory();
      return updated;
    });
    setSelectedIds([newText.id]);
  }, [stagePosition, stageScale, saveToHistory]);

  // Zoom animation: single RAF loop, update Stage directly (no React re-renders per frame)
  const animateView = useCallback((
    from: { scale: number; x: number; y: number },
    to: { scale: number; x: number; y: number },
    onComplete?: () => void
  ) => {
    if (zoomAnimationRef.current != null) {
      cancelAnimationFrame(zoomAnimationRef.current);
    }
    const duration = 380;
    const startTime = performance.now();
    const stage = stageRef.current;
    const tick = (now: number) => {
      const t = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 4);
      const scale = from.scale + (to.scale - from.scale) * eased;
      const x = from.x + (to.x - from.x) * eased;
      const y = from.y + (to.y - from.y) * eased;
      if (stage) {
        stage.scaleX(scale);
        stage.scaleY(scale);
        stage.position({ x, y });
        stage.getLayers().forEach((layer) => layer.batchDraw());
      } else {
        setStageScale(scale);
        setStagePosition({ x, y });
      }
      if (t < 1) {
        zoomAnimationRef.current = requestAnimationFrame(tick);
      } else {
        zoomAnimationRef.current = null;
        setStageScale(to.scale);
        setStagePosition({ x: to.x, y: to.y });
        onComplete?.();
      }
    };
    zoomAnimationRef.current = requestAnimationFrame(tick);
  }, []);

  const handleImageDoubleClick = useCallback((image: CanvasImage, e?: Konva.KonvaEventObject<MouseEvent>) => {
    if (e != null && e.evt.button !== 0) return;
    if (prevMouseDownButtonRef.current !== 0 || lastMouseDownButtonRef.current !== 0) return;

    // Mobile: open fullscreen edit mode instead of zoom-to-fit
    if (isMobile) {
      setSelectedIds([image.id]);
      useUIStore.getState().setMobileEditFullscreen(true);
      useUIStore.getState().setMobileMenuOpen(false);
      return;
    }
    const imgW = image.width * image.scaleX;
    const imgH = image.height * image.scaleY;
    const centerX = image.x + imgW / 2;
    const centerY = image.y + imgH / 2;

    if (zoomedImageId === image.id) {
      // Zoom back out
      const pre = preZoomViewRef.current;
      if (pre) {
        animateView(
          { scale: stageScale, x: stagePosition.x, y: stagePosition.y },
          { scale: pre.scale, x: pre.x, y: pre.y },
          () => setZoomedImageId(null)
        );
      } else {
        setZoomedImageId(null);
      }
      return;
    }

    // Zoom in: fit image to ~90% of viewport with padding
    const padding = 0.9;
    const targetScale = Math.min(
      (dimensions.width * padding) / imgW,
      (dimensions.height * padding) / imgH,
      20
    );
    const targetX = dimensions.width / 2 - centerX * targetScale;
    const targetY = dimensions.height / 2 - centerY * targetScale;

    preZoomViewRef.current = { scale: stageScale, x: stagePosition.x, y: stagePosition.y };
    animateView(
      { scale: stageScale, x: stagePosition.x, y: stagePosition.y },
      { scale: targetScale, x: targetX, y: targetY },
      () => setZoomedImageId(image.id)
    );
  }, [zoomedImageId, stageScale, stagePosition, dimensions.width, dimensions.height, animateView, isMobile]);

  // Clicking stage background when zoomed: just deselect, don't unzoom
  const handleStageMouseDownWithZoom = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    prevMouseDownButtonRef.current = lastMouseDownButtonRef.current;
    lastMouseDownButtonRef.current = e.evt.button;
    // When zoomed, clicking empty space just clears selection (doesn't unzoom)
    handleStageMouseDown(e);
  }, [handleStageMouseDown]);

  // Get selected object (only when exactly one selected, for edit panel)
  const selectedObject = selectedIds.length === 1
    ? [...images, ...texts].find((obj) => obj.id === selectedIds[0]) ?? null
    : null;

  // Clean up long-press timer on unmount
  useEffect(() => {
    return () => { cancelLongPress(); };
  }, [cancelLongPress]);

  // Disable Konva auto-draw and use manual batchDraw for controlled redraws (optimizes slider editing)
  useEffect(() => {
    const prev = Konva.autoDrawEnabled;
    Konva.autoDrawEnabled = false;
    return () => {
      Konva.autoDrawEnabled = prev;
    };
  }, []);

  // Schedule batchDraw when canvas state changes (pan, zoom, selection, images, etc.)
  const batchDrawRafRef = useRef<number | null>(null);
  useEffect(() => {
    if (batchDrawRafRef.current != null) {
      cancelAnimationFrame(batchDrawRafRef.current);
    }
    batchDrawRafRef.current = requestAnimationFrame(() => {
      batchDrawRafRef.current = null;
      stageRef.current?.getLayers().forEach((l) => l.batchDraw());
    });
  }, [stagePosition, stageScale, images, texts, selectedIds, zoomedImageId, dimensions, folders, bypassedTabs, isAdjustingSliders, sliderSettledWhileDragging, visibleImageIds, viewportVisibleIds]);

  return (
    <div className="relative h-full w-full bg-[#0d0d0d]">
      <TopBar
        onUpload={handleFileUpload}
        onRecenterHorizontally={handleRecenterHorizontally}
        onRecenterVertically={handleRecenterVertically}
        onUndo={handleUndo}
        onRedo={handleRedo}
        canUndo={editHistory.length > 0}
        canRedo={editRedoStack.length > 0}
        visible={isMobile || showHeader || folders.length === 0}
        isMobile={isMobile}
        photoFilter={photoFilter}
        onPhotoFilterChange={setPhotoFilter}
      />

      {/* Upload loading indicator */}
      {isUploading && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 bg-[#171717] border border-[#2a2a2a] rounded-xl px-4 py-3 shadow-2xl shadow-black/50">
          <div className="w-5 h-5 border-2 border-[#3ECF8E] border-t-transparent rounded-full animate-spin" />
          <span className="text-white text-sm font-medium">Uploading...</span>
        </div>
      )}

      {/* Delete folder progress (same style as upload – modal closes, banner shows) */}
      {deleteFolderProgress && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 bg-[#171717] border border-[#2a2a2a] rounded-xl px-4 py-3 shadow-2xl shadow-black/50">
          <div className="w-5 h-5 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
          <span className="text-white text-sm font-medium">
            {deleteFolderProgress.total > 0
              ? `Deleting ${deleteFolderProgress.current} of ${deleteFolderProgress.total}`
              : 'Deleting folder...'}
          </span>
        </div>
      )}

      {/* Export progress indicator (background export – you can keep editing) */}
      {exportProgress && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 bg-[#171717] border border-[#2a2a2a] rounded-xl px-4 py-3 shadow-2xl shadow-black/50">
          <div className="w-5 h-5 border-2 border-[#3ECF8E] border-t-transparent rounded-full animate-spin" />
          <span className="text-white text-sm font-medium">
            Exporting {exportProgress.current} of {exportProgress.total}
          </span>
          <span className="text-[#888] text-xs">You can keep editing</span>
        </div>
      )}

      {/* Apply preset progress - fixed + z-[60] so it shows above Apply preset modal (z-50) */}
      {applyPresetProgress && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-3 bg-[#171717] border border-[#2a2a2a] rounded-xl px-4 py-3 shadow-2xl shadow-black/50">
          <div className="w-5 h-5 border-2 border-[#3ECF8E] border-t-transparent rounded-full animate-spin" />
          <span className="text-white text-sm font-medium">
            Applying preset {applyPresetProgress.current} of {applyPresetProgress.total}
          </span>
        </div>
      )}

      {/* Folder Name Prompt Modal */}
      {showFolderPrompt && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-[#171717] border border-[#2a2a2a] rounded-2xl shadow-2xl shadow-black/50 p-6 w-96">
            <h2 className="text-lg font-semibold text-white mb-1">Add {pendingFileCount} photo{pendingFileCount > 1 ? 's' : ''}</h2>
            <p className="text-sm text-[#888] mb-4">
              Choose an existing folder or create a new one
            </p>

            {/* Existing Folders */}
            {folders.length > 0 && (
              <div className="mb-4">
                <label className="block text-xs uppercase tracking-wide text-[#666] mb-2">Existing Folders</label>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {folders.map((folder) => (
                    <button
                      key={folder.id}
                      onClick={() => {
                        setSelectedExistingFolderId(folder.id);
                        setNewFolderName('');
                        setFolderNameError('');
                      }}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors text-left cursor-pointer ${selectedExistingFolderId === folder.id
                          ? 'bg-[#3ECF8E]/20 border border-[#3ECF8E]'
                          : 'bg-[#252525] border border-[#333] hover:border-[#444]'
                        }`}
                    >
                      <div
                        className="w-3 h-3 rounded-full flex-shrink-0"
                        style={{ backgroundColor: folder.color }}
                      />
                      <span className="text-sm text-white truncate">{folder.name}</span>
                      <span className="text-xs text-[#666] ml-auto">{folder.imageIds.length} photos</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Divider */}
            {folders.length > 0 && (
              <div className="flex items-center gap-3 mb-4">
                <div className="flex-1 h-px bg-[#333]" />
                <span className="text-xs text-[#666]">OR</span>
                <div className="flex-1 h-px bg-[#333]" />
              </div>
            )}

            {/* New Folder Name */}
            <label className="block text-xs uppercase tracking-wide text-[#666] mb-2">Create New Folder</label>
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => {
                setNewFolderName(e.target.value);
                setSelectedExistingFolderId(null);
                setFolderNameError('');
              }}
              placeholder="e.g., Beach Trip 2024"
              className={`w-full px-4 py-3 text-white bg-[#252525] border rounded-xl focus:outline-none transition-colors mb-1 ${folderNameError ? 'border-red-500 focus:border-red-500' : 'border-[#333] focus:border-[#3ECF8E] focus:ring-1 focus:ring-[#3ECF8E]/20'
                }`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newFolderName.trim()) {
                  processFilesWithFolder(newFolderName.trim());
                }
              }}
            />
            {folderNameError && (
              <p className="text-xs text-red-400 mb-3">{folderNameError}</p>
            )}
            {!folderNameError && <div className="mb-4" />}

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowFolderPrompt(false);
                  setNewFolderName('');
                  setSelectedExistingFolderId(null);
                  setFolderNameError('');
                  pendingFilesRef.current = [];
                }}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-[#999] bg-[#252525] hover:bg-[#333] rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              {selectedExistingFolderId ? (
                <button
                  onClick={() => addFilesToExistingFolder(selectedExistingFolderId)}
                  className="flex-1 px-4 py-2.5 text-sm font-medium text-[#0d0d0d] bg-[#3ECF8E] hover:bg-[#35b87d] rounded-xl transition-colors cursor-pointer"
                >
                  Add to Folder
                </button>
              ) : (
                <button
                  onClick={() => {
                    if (newFolderName.trim()) {
                      processFilesWithFolder(newFolderName.trim());
                    }
                  }}
                  disabled={!newFolderName.trim()}
                  className="flex-1 px-4 py-2.5 text-sm font-medium text-[#0d0d0d] bg-[#3ECF8E] hover:bg-[#35b87d] disabled:bg-[#333] disabled:text-[#666] disabled:cursor-not-allowed rounded-xl transition-colors cursor-pointer"
                >
                  Create Folder
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Folder Edit Modal */}
      {editingFolder && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-[#171717] border border-[#2a2a2a] rounded-2xl shadow-2xl shadow-black/50 p-6 w-96">
            <h2 className="text-lg font-semibold text-white mb-4">Edit Folder</h2>

            {/* Rename Section */}
            <div className="mb-4">
              <label className="block text-sm text-[#888] mb-2">Folder Name</label>
              <input
                type="text"
                value={editingFolderName}
                onChange={(e) => {
                  setEditingFolderName(e.target.value);
                  setFolderNameError('');
                }}
                placeholder="Folder name"
                className={`w-full px-4 py-3 text-white bg-[#252525] border rounded-xl focus:outline-none transition-colors ${folderNameError ? 'border-red-500 focus:border-red-500' : 'border-[#333] focus:border-[#3ECF8E] focus:ring-1 focus:ring-[#3ECF8E]/20'
                  }`}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && editingFolderName.trim()) {
                    handleRenameFolder();
                  }
                }}
              />
              {folderNameError && (
                <p className="text-xs text-red-400 mt-1">{folderNameError}</p>
              )}
            </div>

            {/* Info */}
            <p className="text-sm text-[#666] mb-4">
              {editingFolder.imageIds.length} photo{editingFolder.imageIds.length !== 1 ? 's' : ''} in this folder
            </p>

            {/* Action Buttons */}
            <div className="flex flex-col gap-3">
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setEditingFolder(null);
                    setEditingFolderName('');
                    setFolderNameError('');
                  }}
                  className="flex-1 px-4 py-2.5 text-sm font-medium text-[#999] bg-[#252525] hover:bg-[#333] rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRenameFolder}
                  disabled={!editingFolderName.trim() || editingFolderName === editingFolder.name}
                  className="flex-1 px-4 py-2.5 text-sm font-medium text-[#0d0d0d] bg-[#3ECF8E] hover:bg-[#35b87d] disabled:bg-[#333] disabled:text-[#666] disabled:cursor-not-allowed rounded-xl transition-colors cursor-pointer"
                >
                  Save Name
                </button>
              </div>

              {/* Delete Section */}
              <div className="pt-3 border-t border-[#333]">
                <button
                  onClick={() => {
                    const hasPhotos = editingFolder.imageIds.length > 0;
                    if (!hasPhotos) {
                      handleDeleteFolder();
                      return;
                    }
                    if (typeof window !== 'undefined' && window.localStorage.getItem('driftboard-delete-folder-skip-confirm') === 'true') {
                      handleDeleteFolder();
                    } else {
                      setDeleteFolderDontAskAgain(false);
                      setConfirmDeleteFolderOpen(true);
                    }
                  }}
                  disabled={!!deleteFolderProgress}
                  className="w-full px-4 py-2.5 text-sm font-medium text-red-400 bg-red-400/10 hover:bg-red-400/20 disabled:opacity-60 disabled:cursor-not-allowed rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-2"
                >
                  {editingFolder.imageIds.length > 0 ? 'Delete folder + photos' : 'Delete folder'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirm delete photo(s) */}
      {confirmDeletePhotoIds && confirmDeletePhotoIds.length > 0 && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-[#171717] border border-[#2a2a2a] rounded-2xl shadow-2xl shadow-black/50 p-6 w-96">
            <h2 className="text-lg font-semibold text-white mb-2">
              {confirmDeletePhotoIds.length === 1 ? 'Delete photo' : `Delete ${confirmDeletePhotoIds.length} photos`}
            </h2>
            <p className="text-sm text-[#888] mb-4">
              Are you sure? This will permanently delete {confirmDeletePhotoIds.length === 1 ? 'this photo' : `these ${confirmDeletePhotoIds.length} photos`}.
            </p>
            <label className="flex items-center gap-2 mb-4 cursor-pointer">
              <input
                type="checkbox"
                checked={deletePhotoDontAskAgain}
                onChange={(e) => setDeletePhotoDontAskAgain(e.target.checked)}
                className="rounded border-[#333] bg-[#252525] text-[#3ECF8E] focus:ring-[#3ECF8E]/20"
              />
              <span className="text-sm text-[#888]">Don&apos;t ask again</span>
            </label>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmDeletePhotoIds(null)}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-[#999] bg-[#252525] hover:bg-[#333] rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (deletePhotoDontAskAgain && typeof window !== 'undefined') {
                    window.localStorage.setItem('driftboard-delete-photo-skip-confirm', 'true');
                  }
                  const ids = [...confirmDeletePhotoIds];
                  setConfirmDeletePhotoIds(null);
                  await handleDeletePhotos(ids);
                }}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-xl transition-colors cursor-pointer"
              >
                {confirmDeletePhotoIds.length === 1 ? 'Delete photo' : `Delete ${confirmDeletePhotoIds.length} photos`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm delete folder + photos */}
      {confirmDeleteFolderOpen && editingFolder && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-[#171717] border border-[#2a2a2a] rounded-2xl shadow-2xl shadow-black/50 p-6 w-96">
            <h2 className="text-lg font-semibold text-white mb-2">Delete folder + photos</h2>
            <p className="text-sm text-[#888] mb-4">
              Are you sure? This will permanently delete the folder &quot;{editingFolder.name}&quot; and all {editingFolder.imageIds.length} photo{editingFolder.imageIds.length !== 1 ? 's' : ''} inside it.
            </p>
            <label className="flex items-center gap-2 mb-4 cursor-pointer">
              <input
                type="checkbox"
                checked={deleteFolderDontAskAgain}
                onChange={(e) => setDeleteFolderDontAskAgain(e.target.checked)}
                className="rounded border-[#333] bg-[#252525] text-[#3ECF8E] focus:ring-[#3ECF8E]/20"
              />
              <span className="text-sm text-[#888]">Don&apos;t ask again</span>
            </label>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmDeleteFolderOpen(false)}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-[#999] bg-[#252525] hover:bg-[#333] rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (deleteFolderDontAskAgain && typeof window !== 'undefined') {
                    window.localStorage.setItem('driftboard-delete-folder-skip-confirm', 'true');
                  }
                  setConfirmDeleteFolderOpen(false);
                  handleDeleteFolder();
                }}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-xl transition-colors cursor-pointer"
              >
                Delete folder + photos
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create empty folder from canvas right-click: name modal first, then create with overlap resolution */}
      {createEmptyFolderOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-[#171717] border border-[#2a2a2a] rounded-2xl shadow-2xl shadow-black/50 p-6 w-96">
            <h2 className="text-lg font-semibold text-white mb-1">Create folder</h2>
            <p className="text-sm text-[#888] mb-4">
              Name your folder. Existing folders will be pushed aside if nearby.
            </p>
            <label className="block text-xs uppercase tracking-wide text-[#666] mb-2">Folder name</label>
            <input
              type="text"
              value={createEmptyFolderName}
              onChange={(e) => {
                setCreateEmptyFolderName(e.target.value);
                setCreateEmptyFolderNameError('');
              }}
              placeholder="e.g., Beach Trip 2024"
              className={`w-full px-4 py-3 text-white bg-[#252525] border rounded-xl focus:outline-none transition-colors mb-1 ${createEmptyFolderNameError ? 'border-red-500 focus:border-red-500' : 'border-[#333] focus:border-[#3ECF8E] focus:ring-1 focus:ring-[#3ECF8E]/20'
                }`}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateEmptyFolderSave();
                if (e.key === 'Escape') handleCreateEmptyFolderCancel();
              }}
            />
            {createEmptyFolderNameError && (
              <p className="text-xs text-red-400 mb-3">{createEmptyFolderNameError}</p>
            )}
            {!createEmptyFolderNameError && <div className="mb-4" />}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleCreateEmptyFolderCancel}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-[#999] bg-[#252525] hover:bg-[#333] rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateEmptyFolderSave}
                disabled={!createEmptyFolderName.trim()}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-[#0d0d0d] bg-[#3ECF8E] hover:bg-[#35b87d] disabled:bg-[#333] disabled:text-[#666] disabled:cursor-not-allowed rounded-xl transition-colors cursor-pointer"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create social media layout from canvas right-click */}
      {createSocialLayoutOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-[#171717] border border-[#2a2a2a] rounded-2xl shadow-2xl shadow-black/50 p-6 w-96">
            <h2 className="text-lg font-semibold text-white mb-1">Create social media layout</h2>
            <p className="text-sm text-[#888] mb-4">
              Add a 4:5 layout. You can drag photos in and place them anywhere; add or remove pages later.
            </p>
            <label className="block text-xs uppercase tracking-wide text-[#666] mb-2">Layout name</label>
            <input
              type="text"
              value={createSocialLayoutName}
              onChange={(e) => {
                setCreateSocialLayoutName(e.target.value);
                setCreateSocialLayoutNameError('');
              }}
              placeholder="e.g., Instagram carousel"
              className={`w-full px-4 py-3 text-white bg-[#252525] border rounded-xl focus:outline-none transition-colors mb-1 ${createSocialLayoutNameError ? 'border-red-500 focus:border-red-500' : 'border-[#333] focus:border-[#3ECF8E] focus:ring-1 focus:ring-[#3ECF8E]/20'
                }`}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateSocialLayoutSave();
                if (e.key === 'Escape') handleCreateSocialLayoutCancel();
              }}
            />
            {createSocialLayoutNameError && (
              <p className="text-xs text-red-400 mb-3">{createSocialLayoutNameError}</p>
            )}
            <label className="block text-xs uppercase tracking-wide text-[#666] mt-4 mb-2">Number of pages (1–10)</label>
            <select
              value={createSocialLayoutPages}
              onChange={(e) => setCreateSocialLayoutPages(Number(e.target.value))}
              className="w-full px-4 py-3 text-white bg-[#252525] border border-[#333] rounded-xl focus:outline-none focus:border-[#3ECF8E] focus:ring-1 focus:ring-[#3ECF8E]/20"
            >
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                <option key={n} value={n} className="bg-[#252525] text-white">
                  {n} page{n !== 1 ? 's' : ''}
                </option>
              ))}
            </select>
            <div className="flex gap-3 mt-4">
              <button
                type="button"
                onClick={handleCreateSocialLayoutCancel}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-[#999] bg-[#252525] hover:bg-[#333] rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateSocialLayoutSave}
                disabled={!createSocialLayoutName.trim()}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-[#0d0d0d] bg-[#3ECF8E] hover:bg-[#35b87d] disabled:bg-[#333] disabled:text-[#666] disabled:cursor-not-allowed rounded-xl transition-colors cursor-pointer"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create folder from selection: name modal, then create and push others out of the way */}
      {createFolderFromSelectionIds && createFolderFromSelectionIds.length > 0 && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-[#171717] border border-[#2a2a2a] rounded-2xl shadow-2xl shadow-black/50 p-6 w-96">
            <h2 className="text-lg font-semibold text-white mb-1">Create folder</h2>
            <p className="text-sm text-[#888] mb-4">
              Name your folder ({createFolderFromSelectionIds.length} photo{createFolderFromSelectionIds.length !== 1 ? 's' : ''} selected). Existing folders will be pushed aside if needed.
            </p>
            <label className="block text-xs uppercase tracking-wide text-[#666] mb-2">Folder name</label>
            <input
              type="text"
              value={createFolderFromSelectionName}
              onChange={(e) => {
                setCreateFolderFromSelectionName(e.target.value);
                setCreateFolderFromSelectionNameError('');
              }}
              placeholder="e.g., Beach Trip 2024"
              className={`w-full px-4 py-3 text-white bg-[#252525] border rounded-xl focus:outline-none transition-colors mb-1 ${createFolderFromSelectionNameError ? 'border-red-500 focus:border-red-500' : 'border-[#333] focus:border-[#3ECF8E] focus:ring-1 focus:ring-[#3ECF8E]/20'
                }`}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateFolderFromSelectionSave();
                if (e.key === 'Escape') handleCreateFolderFromSelectionCancel();
              }}
            />
            {createFolderFromSelectionNameError && (
              <p className="text-xs text-red-400 mb-3">{createFolderFromSelectionNameError}</p>
            )}
            {!createFolderFromSelectionNameError && <div className="mb-4" />}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleCreateFolderFromSelectionCancel}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-[#999] bg-[#252525] hover:bg-[#333] rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateFolderFromSelectionSave}
                disabled={!createFolderFromSelectionName.trim()}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-[#0d0d0d] bg-[#3ECF8E] hover:bg-[#35b87d] disabled:bg-[#333] disabled:text-[#666] disabled:cursor-not-allowed rounded-xl transition-colors cursor-pointer"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      <div
        className={`h-full w-full ${isSpacePressed ? 'cursor-grab' : ''} ${isDragging && isSpacePressed ? 'cursor-grabbing' : ''}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        {/* Hidden file input for folder plus button */}
        <input
          ref={folderFileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/x-adobe-dng,.dng"
          multiple
          onChange={handleFolderFileSelect}
          className="hidden"
        />


        <Stage
          ref={stageRef}
          width={dimensions.width}
          height={dimensions.height}
          scaleX={stageScale}
          scaleY={stageScale}
          x={stagePosition.x}
          y={stagePosition.y}
          pixelRatio={Math.max(window.devicePixelRatio || 2, 2)}
          onWheel={handleWheel}
          onTouchStart={isMobile ? (e) => {
            // Long-press on empty canvas background → canvas context menu
            const stage = e.target.getStage();
            if (stage && e.target === stage && e.evt.touches.length === 1) {
              const touch = e.evt.touches[0];
              longPressTriggeredRef.current = false;
              longPressTouchPosRef.current = { x: touch.clientX, y: touch.clientY };
              cancelLongPress();
              longPressTimerRef.current = setTimeout(() => {
                longPressTriggeredRef.current = true;
                if (navigator.vibrate) navigator.vibrate(50);
                setImageContextMenu(null);
                setCanvasContextMenu({ x: touch.clientX, y: touch.clientY });
              }, 500);
            }
          } : undefined}
          onTouchMove={(e) => {
            // Cancel any pending long-press on touch move
            cancelLongPress();
            handleTouchMove(e);
          }}
          onTouchEnd={() => {
            cancelLongPress();
            handleTouchEnd();
          }}
          onMouseDown={handleStageMouseDownWithZoom}
          onContextMenu={(e) => {
            e.evt.preventDefault();
            const stage = e.target.getStage();
            if (stage && e.target === stage) {
              setImageContextMenu(null);
              setCanvasContextMenu({ x: e.evt.clientX, y: e.evt.clientY });
            }
          }}
          onDblClick={handleStageDoubleClick}
          draggable={isSpacePressed}
          onDragStart={() => {
            if (isSpacePressed) {
              if (zoomAnimationRef.current != null) {
                cancelAnimationFrame(zoomAnimationRef.current);
                zoomAnimationRef.current = null;
              }
              setIsDragging(true);
              setZoomedImageId(null);
            }
          }}
          onDragMove={(e) => {
            if (isSpacePressed) {
              // Update stage position during drag so plus buttons move in real-time
              setStagePosition({ x: e.target.x(), y: e.target.y() });
            }
          }}
          onDragEnd={(e) => {
            if (isSpacePressed) {
              setStagePosition({ x: e.target.x(), y: e.target.y() });
              setIsDragging(false);
            }
          }}
        >
          <Layer>
            {/* Canvas background: first in layer so it draws behind folders/images and stays visible on redraw */}
            <Group listening={false}>
              <Rect x={-100000} y={-100000} width={200000} height={200000} fill="#0d0d0d" listening={false} />
              <Shape
                listening={false}
                sceneFunc={(context, shape) => {
                  const step = 48;
                  const min = -100000;
                  const max = 100000;
                  context.beginPath();
                  for (let x = min; x <= max; x += step) {
                    context.moveTo(x, min);
                    context.lineTo(x, max);
                  }
                  for (let y = min; y <= max; y += step) {
                    context.moveTo(min, y);
                    context.lineTo(max, y);
                  }
                  context.fillStrokeShape(shape);
                }}
                stroke="rgba(62, 207, 142, 0.03)"
                strokeWidth={1}
              />
            </Group>
            {/* Folder Borders and Labels — only show folders that have at least one visible image when filter is on */}
            {!zoomedImageId && folders
              .filter((folder) => visibleImageIds === null || folder.imageIds.some((id) => visibleImageIds.has(id)))
              .map((folder) => {
                // Calculate folder dimensions
                const folderImages = images.filter(img => folder.imageIds.includes(img.id));

                // Get current folder from state to ensure we have latest width
                const currentFolder = folders.find(f => f.id === folder.id) || folder;

                // Border starts at folder.x aligned with the label
                const borderX = currentFolder.x;
                const borderY = currentFolder.y + 30; // Start below the label
                const borderWidth = currentFolder.width;
                const borderHeight = getFolderBorderHeight(currentFolder, folderImages.length);

                const isHovered = hoveredFolderBorder === currentFolder.id;
                const isResizing = resizingFolderId === currentFolder.id;
                const labelFontSize = Math.max(6, Math.min(96, 24 / stageScale));
                const labelYOffset = Math.max(0, labelFontSize - 28) + 10;

                return (
                  <Group
                    key={folder.id}
                    onContextMenu={(e) => {
                      e.evt.preventDefault();
                      e.cancelBubble = true;
                      setCanvasContextMenu(null);
                      setFolderContextMenu({ x: e.evt.clientX, y: e.evt.clientY, folderId: currentFolder.id });
                    }}
                    onTouchStart={isMobile ? (e) => {
                      const touch = e.evt.touches[0];
                      if (!touch) return;
                      longPressTriggeredRef.current = false;
                      longPressTouchPosRef.current = { x: touch.clientX, y: touch.clientY };
                      cancelLongPress();
                      const folderId = currentFolder.id;
                      longPressTimerRef.current = setTimeout(() => {
                        longPressTriggeredRef.current = true;
                        if (navigator.vibrate) navigator.vibrate(50);
                        setCanvasContextMenu(null);
                        setFolderContextMenu({ x: touch.clientX, y: touch.clientY, folderId });
                      }, 500);
                    } : undefined}
                    onTouchMove={isMobile ? (e) => {
                      const touch = e.evt.touches[0];
                      if (!touch || !longPressTouchPosRef.current) return;
                      const dx = touch.clientX - longPressTouchPosRef.current.x;
                      const dy = touch.clientY - longPressTouchPosRef.current.y;
                      if (Math.sqrt(dx * dx + dy * dy) > 10) cancelLongPress();
                    } : undefined}
                    onTouchEnd={isMobile ? () => cancelLongPress() : undefined}
                  >
                    {/* Folder Label (name + plus) - rendered last so it draws on top during drag */}
                    <Group
                      x={currentFolder.x}
                      y={currentFolder.y - labelYOffset}
                      draggable={!isSpacePressed}
                      listening={!isSpacePressed}
                      onMouseEnter={(e) => {
                        const container = e.target.getStage()?.container();
                        if (container && !isSpacePressed) container.style.cursor = 'pointer';
                      }}
                      onMouseLeave={(e) => {
                        const container = e.target.getStage()?.container();
                        if (container && !isDragging) container.style.cursor = 'default';
                      }}
                      onDragStart={(e) => {
                        folderNameDragRef.current = true;
                        e.target.moveToTop(); // Keep label on top during drag so it doesn't hide behind folder
                      }}
                      onDragMove={(e) => {
                        const newX = e.target.x();
                        const newY = e.target.y();
                        const anchorY = newY + labelYOffset;
                        const latestFolders = useCanvasStore.getState().folders;
                        const latestImages = useCanvasStore.getState().images;
                        const cur = latestFolders.find((f) => f.id === currentFolder.id) || currentFolder;

                        const updatedFolders = latestFolders.map((f) =>
                          f.id === currentFolder.id ? { ...f, x: newX, y: anchorY } : f
                        );

                        const folderImgs = latestImages.filter(img => currentFolder.imageIds.includes(img.id));
                        let updatedImages = [...latestImages];
                        if (folderImgs.length > 0) {
                          const dx = newX - cur.x;
                          const dy = anchorY - cur.y;
                          const reflowedImages = folderImgs.map((img) => ({
                            ...img,
                            x: img.x + dx,
                            y: img.y + dy,
                          }));
                          updatedImages = latestImages.map((img) => {
                            const reflowed = reflowedImages.find(r => r.id === img.id);
                            return reflowed ? reflowed : img;
                          });
                        }

                        pendingFolderDragRef.current = { updatedFolders, updatedImages };
                        if (folderDragRafRef.current == null) {
                          folderDragRafRef.current = requestAnimationFrame(() => {
                            folderDragRafRef.current = null;
                            const pending = pendingFolderDragRef.current;
                            if (pending) {
                              setFolders(pending.updatedFolders);
                              setImages(pending.updatedImages);
                              pendingFolderDragRef.current = null;
                            }
                          });
                        }
                      }}
                      onDragEnd={async () => {
                        if (folderDragRafRef.current != null) {
                          cancelAnimationFrame(folderDragRafRef.current);
                          folderDragRafRef.current = null;
                        }
                        const pending = pendingFolderDragRef.current;
                        if (pending) {
                          setFolders(pending.updatedFolders);
                          setImages(pending.updatedImages);
                          pendingFolderDragRef.current = null;
                        }
                        setTimeout(() => {
                          folderNameDragRef.current = false;
                        }, 100);

                        const latestFolders = useCanvasStore.getState().folders;
                        const latestImages = useCanvasStore.getState().images;
                        const { folders: finalFolders, images: finalImages } = resolveOverlapsAndReflow(
                          latestFolders,
                          latestImages,
                          currentFolder.id
                        );
                        setFolders(finalFolders);
                        setImages(finalImages);
                        saveToHistory();

                        if (user) {
                          for (const f of finalFolders) {
                            supabase.from('photo_folders')
                              .update({ x: Math.round(f.x), y: Math.round(f.y) })
                              .eq('id', f.id)
                              .eq('user_id', user.id)
                              .then(({ error }) => {
                                if (error) console.error('Failed to update folder position:', error);
                              });
                          }

                          const allFolderImages = finalImages.filter((img: CanvasImage) => (img.storagePath || img.originalStoragePath) && img.folderId);
                          for (const img of allFolderImages) {
                            const canonicalPath = img.storagePath || img.originalStoragePath!;
                            supabase.from('photo_edits')
                              .update({ x: Math.round(img.x), y: Math.round(img.y) })
                              .eq('storage_path', canonicalPath)
                              .eq('user_id', user.id)
                              .then(({ error }) => {
                                if (error) console.error('Failed to update image position:', error);
                              });
                          }
                        }
                      }}
                    >
                      <Text
                        ref={(el) => {
                          if (el) {
                            folderLabelRefs.current[currentFolder.id] = el;
                            requestAnimationFrame(() => {
                              const w = el.width();
                              setFolderLabelWidths(prev => prev[currentFolder.id] === w ? prev : { ...prev, [currentFolder.id]: w });
                            });
                          }
                        }}
                        x={0}
                        y={0}
                        text={currentFolder.name.toUpperCase()}
                        fontFamily="PP Fraktion Mono"
                        fontSize={labelFontSize}
                        fontStyle="600"
                        letterSpacing={Math.max(1, labelFontSize * 0.12)}
                        fill={currentFolder.color}
                        listening={true}
                        onClick={() => handleFolderDoubleClick(currentFolder)}
                        onTap={() => handleFolderDoubleClick(currentFolder)}
                      />
                      <Text
                        x={folderLabelWidths[currentFolder.id] ?? 0}
                        y={2}
                        text=" +"
                        fontFamily="PP Fraktion Mono"
                        fontSize={labelFontSize}
                        fontStyle="600"
                        fill={currentFolder.color}
                        listening={true}
                        onClick={(e) => {
                          e.cancelBubble = true;
                          handleAddPhotosToFolder(currentFolder.id);
                        }}
                        onTap={(e) => {
                          e.cancelBubble = true;
                          handleAddPhotosToFolder(currentFolder.id);
                        }}
                      />
                    </Group>

                    {/* Folder fill - solid background (not transparent); social layout: N pages with backgroundColor */}
                    {isSocialLayout(currentFolder) ? (() => {
                      const n = Math.max(1, Math.min(SOCIAL_LAYOUT_MAX_PAGES, currentFolder.pageCount ?? 1));
                      const pageW = SOCIAL_LAYOUT_PAGE_WIDTH;
                      const bg = currentFolder.backgroundColor ?? DEFAULT_SOCIAL_LAYOUT_BG;
                      const h = Math.max(borderHeight, 80);
                      return (
                        <>
                          {Array.from({ length: n }, (_, i) => (
                            <Rect
                              key={i}
                              x={borderX + i * pageW}
                              y={borderY}
                              width={pageW}
                              height={h}
                              fill={bg}
                              cornerRadius={0}
                              listening={false}
                            />
                          ))}
                          {n > 1 && Array.from({ length: n - 1 }, (_, i) => (
                            <Rect
                              key={`div-${i}`}
                              x={borderX + (i + 1) * pageW - 1}
                              y={borderY}
                              width={2}
                              height={h}
                              fill="rgba(255,255,255,0.06)"
                              listening={false}
                            />
                          ))}
                        </>
                      );
                    })() : (
                      <Rect
                        x={borderX}
                        y={borderY}
                        width={borderWidth}
                        height={Math.max(borderHeight, 80)}
                        fill="#0d0d0d"
                        cornerRadius={12}
                        listening={false}
                      />
                    )}
                    {/* Folder Border - blinks when image center is over this folder's border (dragging out); solid on hover or when dragging over to drop */}
                    <Rect
                      x={borderX}
                      y={borderY}
                      width={borderWidth}
                      height={Math.max(borderHeight, 80)}
                      stroke={currentFolder.color}
                      strokeWidth={dragSourceFolderBorderHovered === currentFolder.id ? (dragBorderBlink ? 3 : 2) : (dragHoveredFolderId === currentFolder.id || isHovered ? 3 : 1)}
                      cornerRadius={12}
                      dash={dragSourceFolderBorderHovered === currentFolder.id ? (dragBorderBlink ? undefined : [8, 4]) : (dragHoveredFolderId === currentFolder.id || isHovered ? undefined : [8, 4])}
                      opacity={dragSourceFolderBorderHovered === currentFolder.id ? (dragBorderBlink ? 0.36 : 0.9) : (dragHoveredFolderId === currentFolder.id || isHovered ? 0.9 : 0.4)}
                      shadowColor={currentFolder.color}
                      shadowBlur={dragSourceFolderBorderHovered === currentFolder.id ? (dragBorderBlink ? 20 : 0) : (dragHoveredFolderId === currentFolder.id || isHovered ? 20 : 0)}
                      shadowOpacity={dragSourceFolderBorderHovered === currentFolder.id ? (dragBorderBlink ? 0.2 : 0) : (dragHoveredFolderId === currentFolder.id || isHovered ? 0.6 : 0)}
                      listening={!isSpacePressed}
                      onMouseEnter={() => setHoveredFolderBorder(currentFolder.id)}
                      onMouseLeave={() => {
                        if (!resizingFolderId) setHoveredFolderBorder(null);
                      }}
                      onClick={(e) => {
                        e.cancelBubble = true;
                        if (isSocialLayout(currentFolder)) setSelectedFolderId(currentFolder.id);
                      }}
                    />

                    {/* Resize Handle - Bottom-right corner (hidden for social layout) */}
                    {!isSocialLayout(currentFolder) && (
                      <Rect
                        x={borderX + borderWidth - 20}
                        y={borderY + borderHeight - 20}
                        width={20}
                        height={20}
                        fill={isHovered || isResizing ? currentFolder.color : 'transparent'}
                        opacity={isHovered || isResizing ? 0.6 : 0}
                        cornerRadius={4}
                        draggable={!isSpacePressed}
                        listening={!isSpacePressed}
                        dragBoundFunc={(pos) => pos}
                        onMouseEnter={(e) => {
                          const container = e.target.getStage()?.container();
                          if (container) container.style.cursor = 'nwse-resize';
                          setHoveredFolderBorder(currentFolder.id);
                        }}
                        onMouseLeave={(e) => {
                          const container = e.target.getStage()?.container();
                          if (container && !resizingFolderId) container.style.cursor = 'default';
                          if (!resizingFolderId) setHoveredFolderBorder(null);
                        }}
                        onDragStart={() => {
                          setResizingFolderId(currentFolder.id);
                        }}
                        onDragMove={(e) => {
                          const handleSize = 20;
                          const proposedWidth = Math.max(GRID_CONFIG.minFolderWidth, e.target.x() - borderX + handleSize);
                          const proposedContentHeight = Math.max(100, e.target.y() - borderY + handleSize);
                          const proposedHeight = 30 + proposedContentHeight;

                          // Get folder images
                          const folderImgs = images.filter(img => currentFolder.imageIds.includes(img.id));

                          // Calculate minimum size to fit all images
                          const minSize = calculateMinimumFolderSize(folderImgs.length, proposedWidth);

                          // Enforce minimum size (user cannot resize smaller than needed)
                          const newWidth = Math.max(proposedWidth, minSize.width);
                          const newHeight = Math.max(proposedHeight, minSize.height);
                          const newContentHeight = newHeight - 30;

                          // Get current cell positions for images
                          const oldCols = calculateColsFromWidth(currentFolder.width);
                          const newCols = calculateColsFromWidth(newWidth);
                          const dimensionsChanged = newWidth !== currentFolder.width || newHeight !== currentFolder.height;
                          const needsRepack = newCols !== oldCols || newHeight < (currentFolder.height ?? Infinity);

                          // Get current positions
                          const currentPositions = folderImgs.length > 0
                            ? getImageCellPositions(folderImgs, currentFolder.x, currentFolder.y, currentFolder.width)
                            : [];

                          // Calculate cell assignments - preserve positions unless collision
                          let cellAssignments: CellAssignment[] = [];
                          if (folderImgs.length > 0) {
                            if (dimensionsChanged && needsRepack) {
                              // Need to repack - some images may need to move
                              cellAssignments = smartRepackImages(
                                folderImgs,
                                currentPositions,
                                currentFolder.width,
                                newWidth,
                                newHeight
                              );
                            } else {
                              // No repack needed - keep images in their current cells
                              cellAssignments = currentPositions.map(pos => ({
                                imageId: pos.imageId,
                                col: pos.col,
                                row: pos.row,
                              }));
                            }
                          }

                          // Update folder with new dimensions (keep same imageIds order)
                          const updatedFolders = folders.map((f) =>
                            f.id === currentFolder.id
                              ? { ...f, width: newWidth, height: newHeight }
                              : f
                          );

                          // Keep handle at bottom-right corner
                          e.target.x(borderX + newWidth - handleSize);
                          e.target.y(borderY + newContentHeight - handleSize);

                          // Position images at their specific cells (preserving positions)
                          let updatedImages = [...images];
                          if (folderImgs.length > 0 && cellAssignments.length > 0) {
                            const positionedImages = positionImagesInCells(
                              folderImgs,
                              cellAssignments,
                              currentFolder.x,
                              currentFolder.y,
                              newWidth
                            );

                            updatedImages = images.map((img) => {
                              const positioned = positionedImages.find(p => p.id === img.id);
                              return positioned ? positioned : img;
                            });
                          }

                          pendingResizeDragRef.current = { updatedFolders, updatedImages };
                          if (resizeDragRafRef.current == null) {
                            resizeDragRafRef.current = requestAnimationFrame(() => {
                              resizeDragRafRef.current = null;
                              const pending = pendingResizeDragRef.current;
                              if (pending) {
                                setFolders(pending.updatedFolders);
                                setImages(pending.updatedImages);
                                pendingResizeDragRef.current = null;
                              }
                            });
                          }
                        }}
                        onDragEnd={async (e) => {
                          const container = e.target.getStage()?.container();
                          if (container) container.style.cursor = 'default';
                          setResizingFolderId(null);
                          setHoveredFolderBorder(null);
                          if (resizeDragRafRef.current != null) {
                            cancelAnimationFrame(resizeDragRafRef.current);
                            resizeDragRafRef.current = null;
                          }
                          const pendingResize = pendingResizeDragRef.current;
                          if (pendingResize) {
                            setFolders(pendingResize.updatedFolders);
                            setImages(pendingResize.updatedImages);
                            pendingResizeDragRef.current = null;
                          }

                          // Use latest state (from store after flush) for final snap and reflow
                          const stateAfterFlush = useCanvasStore.getState();
                          const resizedFolder = stateAfterFlush.folders.find(f => f.id === currentFolder.id);
                          if (!resizedFolder) return;

                          // Get folder images and their current positions
                          const folderImgs = stateAfterFlush.images.filter(img => resizedFolder.imageIds.includes(img.id));
                          const imageCount = folderImgs.length;

                          if (imageCount === 0) {
                            // No images - just finalize
                            const { folders: finalFolders, images: finalImages } = resolveOverlapsAndReflow(
                              stateAfterFlush.folders,
                              stateAfterFlush.images,
                              currentFolder.id
                            );
                            setFolders(finalFolders);
                            setImages(finalImages);
                            saveToHistory();
                            return;
                          }

                          // Get current cell positions of images
                          const currentPositions = getImageCellPositions(
                            folderImgs,
                            resizedFolder.x,
                            resizedFolder.y,
                            resizedFolder.width
                          );

                          // Calculate snapped dimensions based on USER'S resize (not image count)
                          // This allows empty cells for dragging photos into
                          const cols = calculateColsFromWidth(resizedFolder.width);

                          // Calculate rows based on the height the user dragged to
                          const currentContentHeight = (resizedFolder.height ?? 130) - 30; // Subtract label
                          const availableForCells = currentContentHeight - (2 * GRID_CONFIG.folderPadding) + GRID_CONFIG.imageGap;
                          const rowsFromHeight = Math.max(1, Math.floor(availableForCells / CELL_HEIGHT));

                          // But ensure we have enough rows for all images (minimum needed)
                          const maxRowWithImage = imageCount > 0 ? Math.max(0, ...currentPositions.map(p => p.row)) : 0;
                          const minRowsNeeded = maxRowWithImage + 1;
                          const rows = Math.max(rowsFromHeight, minRowsNeeded);

                          // Calculate snapped width: exact fit for columns with proper padding
                          const snappedWidth = (2 * GRID_CONFIG.folderPadding) + (cols * CELL_SIZE) - GRID_CONFIG.imageGap;

                          // Calculate snapped height: based on rows the user wants (with minimum for images)
                          const snappedContentHeight = (2 * GRID_CONFIG.folderPadding) + (rows * CELL_HEIGHT) - GRID_CONFIG.imageGap;
                          const snappedHeight = 30 + Math.max(snappedContentHeight, 100);

                          // Check if snapped dimensions would cut off any images
                          const snappedCols = calculateColsFromWidth(snappedWidth);
                          const snappedMaxRows = Math.max(1, Math.floor((snappedHeight - 30 - 2 * GRID_CONFIG.folderPadding + GRID_CONFIG.imageGap) / CELL_HEIGHT));

                          // Determine cell assignments - preserve positions if possible
                          let cellAssignments: CellAssignment[];
                          const needsRepack = currentPositions.some(p => p.col >= snappedCols || p.row >= snappedMaxRows);

                          if (needsRepack) {
                            // Some images would be cut off - need to repack
                            cellAssignments = smartRepackImages(
                              folderImgs,
                              currentPositions,
                              resizedFolder.width,
                              snappedWidth,
                              snappedHeight
                            );
                          } else {
                            // No images cut off - keep them in their current cells (PRESERVE POSITIONS)
                            cellAssignments = currentPositions.map(pos => ({
                              imageId: pos.imageId,
                              col: pos.col,
                              row: pos.row,
                            }));
                          }

                          // Update folder with snapped dimensions
                          const snappedFolders = stateAfterFlush.folders.map(f =>
                            f.id === resizedFolder.id
                              ? { ...f, width: snappedWidth, height: snappedHeight }
                              : f
                          );

                          // Position images at their cells (preserving positions when expanding)
                          const positionedImages = positionImagesInCells(
                            folderImgs,
                            cellAssignments,
                            resizedFolder.x,
                            resizedFolder.y,
                            snappedWidth
                          );

                          const snappedImages = stateAfterFlush.images.map(img => {
                            const positioned = positionedImages.find(p => p.id === img.id);
                            return positioned ? positioned : img;
                          });

                          // Final overlap resolution to ensure clean state
                          const { folders: finalFolders, images: finalImages } = resolveOverlapsAndReflow(
                            snappedFolders,
                            snappedImages,
                            currentFolder.id
                          );
                          setFolders(finalFolders);
                          setImages(finalImages);
                          saveToHistory();

                          // Persist folder positions/widths and image positions to Supabase
                          if (user) {
                            // Save all folder positions (some may have been pushed)
                            for (const f of finalFolders) {
                              supabase.from('photo_folders')
                                .update({
                                  x: Math.round(f.x),
                                  y: Math.round(f.y),
                                  width: Math.round(f.width),
                                  ...(f.height != null && { height: Math.round(f.height) }),
                                })
                                .eq('id', f.id)
                                .eq('user_id', user.id)
                                .then(({ error }) => {
                                  if (error) console.error('Failed to update folder:', error);
                                });
                            }

                            // Save all images positions (canonical key)
                            const allFolderImages = finalImages.filter((img: CanvasImage) => (img.storagePath || img.originalStoragePath) && img.folderId);
                            for (const img of allFolderImages) {
                              const canonicalPath = img.storagePath || img.originalStoragePath!;
                              supabase.from('photo_edits')
                                .update({ x: Math.round(img.x), y: Math.round(img.y) })
                                .eq('storage_path', canonicalPath)
                                .eq('user_id', user.id)
                                .then(({ error }) => {
                                  if (error) console.error('Failed to update image position:', error);
                                });
                            }
                          }
                        }}
                      />
                    )}

                    {/* Ghost/placeholder for drag target */}
                    {dragGhostPosition && dragGhostPosition.folderId === currentFolder.id && (
                      <Rect
                        x={dragGhostPosition.x}
                        y={dragGhostPosition.y}
                        width={dragGhostPosition.width}
                        height={dragGhostPosition.height}
                        fill="rgba(62, 207, 142, 0.2)"
                        stroke="#3ECF8E"
                        strokeWidth={2}
                        dash={[5, 5]}
                        cornerRadius={8}
                        listening={false}
                      />
                    )}
                  </Group>
                );
              })}

            {(visibleImageIds === null ? images : images.filter((img) => visibleImageIds.has(img.id)))
              .filter((img) => viewportVisibleIds.has(img.id) || selectedIds.includes(img.id))
              .map((img) => (
              <ImageNode
                key={img.id}
                image={img}
                bypassedTabs={bypassedTabs}
                useLowResPreview={isAdjustingSliders && !sliderSettledWhileDragging && selectedIds[0] === img.id}
                isSelected={selectedIds.includes(img.id)}
                draggable={!isSpacePressed}
                onClick={handleObjectClick}
                onDblClick={(e) => handleImageDoubleClick(img, e)}
                onContextMenu={handleImageContextMenu}
                onTouchStart={isMobile ? handleImageTouchStart : undefined}
                onTouchEnd={isMobile ? handleImageTouchEnd : undefined}
                onTouchMove={isMobile ? handleImageTouchMove : undefined}
                onDragEnd={(e) => {
                  setDragHoveredFolderId(null);
                  setDragSourceFolderBorderHovered(null);
                  handleObjectDragEnd(e, 'image');
                }}
                onDragMove={handleImageDragMove}
                onUpdate={(updates) => {
                  setImages((prev) =>
                    prev.map((i) => (i.id === img.id ? { ...i, ...updates } : i))
                  );
                }}
              />
            ))}
            {/* Selection outlines at parent level so they don't affect image cache/edits */}
            {images
              .filter((img) => selectedIds.includes(img.id) && (visibleImageIds === null || visibleImageIds.has(img.id)))
              .map((img) => {
                const folder = folders.find(f => f.id === img.folderId || f.imageIds.includes(img.id));
                const strokeColor = folder ? hexToRgba(folder.color, 0.4) : hexToRgba('#3ECF8E', 0.4);
                return (
                  <Rect
                    key={`outline-${img.id}`}
                    x={img.x}
                    y={img.y}
                    width={img.width * img.scaleX}
                    height={img.height * img.scaleY}
                    rotation={img.rotation}
                    stroke={strokeColor}
                    strokeWidth={2}
                    listening={false}
                  />
                );
              })}
            {texts.map((txt) => (
              <TextNode
                key={txt.id}
                text={txt}
                isSelected={selectedIds.includes(txt.id)}
                draggable={!isSpacePressed}
                onClick={handleObjectClick}
                onDragEnd={(e) => handleObjectDragEnd(e, 'text')}
                onUpdate={(updates) => {
                  setTexts((prev) =>
                    prev.map((t) => (t.id === txt.id ? { ...t, ...updates } : t))
                  );
                }}
              />
            ))}

            {/* Transformer disabled - no selection handles */}
            {/* <Transformer
              ref={transformerRef}
              boundBoxFunc={(oldBox, newBox) => {
                // Limit resize
                if (Math.abs(newBox.width) < 5 || Math.abs(newBox.height) < 5) {
                  return oldBox;
                }
                return newBox;
              }}
            /> */}
          </Layer>
        </Stage>

      </div>

      {/* Right-click context menu on empty canvas: Create folder / Create social media layout */}
      {canvasContextMenu && (
        <div
          ref={canvasContextMenuRef}
          className="fixed z-50 min-w-[200px] py-1 bg-[#171717] border border-[#2a2a2a] rounded-xl shadow-2xl shadow-black/50"
          style={{ left: canvasContextMenu.x, top: canvasContextMenu.y }}
        >
          <button
            type="button"
            onClick={() => {
              setCanvasContextMenu(null);
              setCreateEmptyFolderOpen(true);
              setCreateEmptyFolderName('New Folder');
              setCreateEmptyFolderNameError('');
            }}
            className="w-full px-4 py-2.5 text-left text-sm text-white hover:bg-[#252525] transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
            </svg>
            Create folder
          </button>
          <button
            type="button"
            onClick={() => {
              setCanvasContextMenu(null);
              setCreateSocialLayoutOpen(true);
              setCreateSocialLayoutName('Social layout 1');
              setCreateSocialLayoutPages(3);
              setCreateSocialLayoutNameError('');
            }}
            className="w-full px-4 py-2.5 text-left text-sm text-white hover:bg-[#252525] transition-colors flex items-center gap-2 border-t border-[#2a2a2a]"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            Create social media layout
          </button>
        </div>
      )}

      {/* Layout toolbar when a social layout is selected (click on layout) */}
      {selectedFolderId && (() => {
        const selectedFolder = folders.find((f) => f.id === selectedFolderId);
        if (!selectedFolder || !isSocialLayout(selectedFolder)) return null;
        const pageCount = Math.max(1, Math.min(SOCIAL_LAYOUT_MAX_PAGES, selectedFolder.pageCount ?? 1));
        const bg = selectedFolder.backgroundColor ?? DEFAULT_SOCIAL_LAYOUT_BG;
        const canAdd = pageCount < SOCIAL_LAYOUT_MAX_PAGES;
        const canRemove = pageCount > 1;
        return (
          <div className="fixed z-40 left-1/2 -translate-x-1/2 top-20 flex items-center gap-3 px-4 py-2.5 bg-[#171717] border border-[#2a2a2a] rounded-xl shadow-2xl shadow-black/50">
            <span className="text-sm text-[#888] whitespace-nowrap">Layout: {selectedFolder.name}</span>
            <div className="w-px h-6 bg-[#333]" />
            <label className="flex items-center gap-2 text-sm text-white">
              <span className="text-[#666]">Bg</span>
              <input
                type="color"
                value={bg}
                onChange={(e) => handleLayoutBackgroundColor(selectedFolder.id, e.target.value)}
                className="w-8 h-8 rounded cursor-pointer border border-[#333] bg-transparent"
              />
            </label>
            <button
              type="button"
              onClick={() => handleLayoutAddPage(selectedFolder.id)}
              disabled={!canAdd}
              className="px-3 py-1.5 text-sm font-medium text-white bg-[#252525] hover:bg-[#333] disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
            >
              + Page
            </button>
            <button
              type="button"
              onClick={() => handleLayoutRemovePage(selectedFolder.id)}
              disabled={!canRemove}
              className="px-3 py-1.5 text-sm font-medium text-white bg-[#252525] hover:bg-[#333] disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
            >
              − Page
            </button>
          </div>
        );
      })()}

      {/* Right-click context menu for folder (social layout: background color, add/remove page) */}
      {folderContextMenu && (() => {
        const folder = folders.find((f) => f.id === folderContextMenu.folderId);
        if (!folder) return null;
        const isLayout = isSocialLayout(folder);
        const pageCount = Math.max(1, Math.min(SOCIAL_LAYOUT_MAX_PAGES, folder.pageCount ?? 1));
        const canAdd = pageCount < SOCIAL_LAYOUT_MAX_PAGES;
        const canRemove = pageCount > 1;
        return (
          <div
            ref={folderContextMenuRef}
            className="fixed z-50 min-w-[180px] py-1 bg-[#171717] border border-[#2a2a2a] rounded-xl shadow-2xl shadow-black/50"
            style={{ left: folderContextMenu.x, top: folderContextMenu.y }}
          >
            {isLayout && (
              <>
                <div className="px-4 py-2 text-xs text-[#666] uppercase tracking-wide">Layout</div>
                <label className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-white hover:bg-[#252525] cursor-pointer">
                  <span>Background color</span>
                  <input
                    type="color"
                    value={folder.backgroundColor ?? DEFAULT_SOCIAL_LAYOUT_BG}
                    onChange={(e) => handleLayoutBackgroundColor(folder.id, e.target.value)}
                    className="w-6 h-6 rounded cursor-pointer border border-[#333] bg-transparent"
                    onClick={(e) => e.stopPropagation()}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => handleLayoutAddPage(folder.id)}
                  disabled={!canAdd}
                  className="w-full px-4 py-2.5 text-left text-sm text-white hover:bg-[#252525] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Add page
                </button>
                <button
                  type="button"
                  onClick={() => handleLayoutRemovePage(folder.id)}
                  disabled={!canRemove}
                  className="w-full px-4 py-2.5 text-left text-sm text-white hover:bg-[#252525] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Remove page
                </button>
                <div className="my-1 border-t border-[#2a2a2a]" />
              </>
            )}
            <button
              type="button"
              onClick={() => {
                setFolderContextMenu(null);
                setEditingFolder(folder);
                setEditingFolderName(folder.name);
                setFolderNameError('');
              }}
              className="w-full px-4 py-2.5 text-left text-sm text-white hover:bg-[#252525] transition-colors"
            >
              Rename
            </button>
            <button
              type="button"
              onClick={() => {
                setFolderContextMenu(null);
                setConfirmDeleteFolderOpen(true);
                setEditingFolder(folder);
              }}
              className="w-full px-4 py-2.5 text-left text-sm text-red-400 hover:bg-red-400/10 transition-colors border-t border-[#2a2a2a]"
            >
              Delete folder
            </button>
          </div>
        );
      })()}

      {/* Right-click context menu for images: single = copy/paste/preset; multi = paste to selection, create folder */}
      {imageContextMenu && (
        <div
          ref={imageContextMenuRef}
          className="fixed z-50 min-w-[180px] py-1 bg-[#171717] border border-[#2a2a2a] rounded-xl shadow-2xl shadow-black/50"
          style={{ left: imageContextMenu.x, top: imageContextMenu.y }}
        >
          {imageContextMenu.selectedIds.length > 1 ? (
            <>
              <button
                type="button"
                onClick={handlePasteEdit}
                disabled={!copiedEdit}
                className="w-full px-4 py-2.5 text-left text-sm text-white hover:bg-[#252525] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Paste edit to selection ({imageContextMenu.selectedIds.length} photos)
              </button>
              {user && (
                <button
                  type="button"
                  onClick={() => {
                    setApplyPresetToSelectionIds(imageContextMenu.selectedIds);
                    setImageContextMenu(null);
                  }}
                  className="w-full px-4 py-2.5 text-left text-sm text-white hover:bg-[#252525] transition-colors"
                >
                  Apply preset… ({imageContextMenu.selectedIds.length} photos)
                </button>
              )}
              <button
                type="button"
                onClick={handleExportSelection}
                className="w-full px-4 py-2.5 text-left text-sm text-white hover:bg-[#252525] transition-colors"
              >
                Export selection ({imageContextMenu.selectedIds.length} photos)
              </button>
              <button
                type="button"
                onClick={handleCreateFolderFromSelection}
                className="w-full px-4 py-2.5 text-left text-sm text-white hover:bg-[#252525] transition-colors"
              >
                Create folder
              </button>
              <button
                type="button"
                onClick={() => {
                  const ids = imageContextMenu.selectedIds;
                  setImageContextMenu(null);
                  if (typeof window !== 'undefined' && window.localStorage.getItem('driftboard-delete-photo-skip-confirm') === 'true') {
                    handleDeletePhotos(ids);
                  } else {
                    setDeletePhotoDontAskAgain(false);
                    setConfirmDeletePhotoIds(ids);
                  }
                }}
                className="w-full px-4 py-2.5 text-left text-sm text-red-400 hover:bg-red-400/10 transition-colors border-t border-[#2a2a2a]"
              >
                Delete selection ({imageContextMenu.selectedIds.length} photos)
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={handleCopyEdit}
                className="w-full px-4 py-2.5 text-left text-sm text-white hover:bg-[#252525] transition-colors"
              >
                Copy edit
              </button>
              <button
                type="button"
                onClick={handlePasteEdit}
                disabled={!copiedEdit}
                className="w-full px-4 py-2.5 text-left text-sm text-white hover:bg-[#252525] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Paste edit
              </button>
              <div className="my-1 border-t border-[#2a2a2a]" />
              <button
                type="button"
                onClick={() => {
                  setBorderDialogImageId(imageContextMenu.imageId);
                  setImageContextMenu(null);
                }}
                className="w-full px-4 py-2.5 text-left text-sm text-white hover:bg-[#252525] transition-colors"
              >
                Border…
              </button>
              {user && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setApplyPresetToSelectionIds([imageContextMenu.imageId]);
                      setImageContextMenu(null);
                    }}
                    className="w-full px-4 py-2.5 text-left text-sm text-white hover:bg-[#252525] transition-colors border-t border-[#2a2a2a]"
                  >
                    Apply preset…
                  </button>
                  <button
                    type="button"
                    onClick={handleCreatePresetClick}
                    className="w-full px-4 py-2.5 text-left text-sm text-white hover:bg-[#252525] transition-colors"
                  >
                    Create preset…
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* Border dialog */}
      {borderDialogImageId && (() => {
        const img = images.find((i) => i.id === borderDialogImageId);
        if (!img) return null;
        const borderWidth = img.borderWidth ?? 0;
        const borderColor = img.borderColor ?? '#ffffff';
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div
              ref={borderDialogRef}
              className="bg-[#171717] border border-[#2a2a2a] rounded-2xl shadow-2xl shadow-black/50 p-6 w-96"
            >
              <h3 className="text-lg font-semibold text-white mb-4">Border</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-[#888] mb-2">
                    Thickness: {borderWidth}px
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="50"
                    value={borderWidth}
                    onChange={(e) => {
                      const width = parseInt(e.target.value, 10);
                      setImages((prev) =>
                        prev.map((i) =>
                          i.id === borderDialogImageId
                            ? { ...i, borderWidth: width }
                            : i
                        )
                      );
                    }}
                    className="w-full h-2 bg-[#252525] rounded-lg appearance-none cursor-pointer accent-[#3ECF8E]"
                  />
                </div>
                <div>
                  <label className="block text-sm text-[#888] mb-2">Color</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={borderColor}
                      onChange={(e) => {
                        setImages((prev) =>
                          prev.map((i) =>
                            i.id === borderDialogImageId
                              ? { ...i, borderColor: e.target.value }
                              : i
                          )
                        );
                      }}
                      className="w-12 h-12 rounded cursor-pointer border border-[#333] bg-transparent"
                    />
                    <input
                      type="text"
                      value={borderColor}
                      onChange={(e) => {
                        const color = e.target.value;
                        if (/^#[0-9A-Fa-f]{6}$/.test(color) || color === '') {
                          setImages((prev) =>
                            prev.map((i) =>
                              i.id === borderDialogImageId
                                ? { ...i, borderColor: color || '#ffffff' }
                                : i
                            )
                          );
                        }
                      }}
                      placeholder="#ffffff"
                      className="flex-1 px-4 py-2 bg-[#252525] border border-[#333] rounded-xl text-white placeholder-[#666] focus:outline-none focus:border-[#3ECF8E] focus:ring-1 focus:ring-[#3ECF8E]/20"
                    />
                  </div>
                </div>
              </div>
              <div className="flex gap-2 justify-end mt-6">
                <button
                  type="button"
                  onClick={() => {
                    setBorderDialogImageId(null);
                  }}
                  className="px-4 py-2.5 text-sm text-[#888] hover:text-white transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Create preset modal: name the preset from current image edits */}
      {createPresetFromImageId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-[#171717] border border-[#2a2a2a] rounded-2xl shadow-2xl shadow-black/50 p-6 w-96">
            <h3 className="text-lg font-semibold text-white mb-2">Create preset</h3>
            <p className="text-sm text-[#888] mb-4">Save this image’s edits as a preset you can apply to other photos.</p>
            <input
              type="text"
              value={createPresetName}
              onChange={(e) => setCreatePresetName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreatePresetSave();
                if (e.key === 'Escape') handleCreatePresetCancel();
              }}
              placeholder="Preset name"
              className="w-full px-4 py-3 bg-[#252525] border border-[#333] rounded-xl text-white placeholder-[#666] focus:outline-none focus:border-[#3ECF8E] focus:ring-1 focus:ring-[#3ECF8E]/20 mb-4"
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={handleCreatePresetCancel}
                className="px-4 py-2.5 text-sm text-[#888] hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreatePresetSave}
                disabled={!createPresetName.trim()}
                className="px-4 py-2.5 text-sm font-medium text-[#0d0d0d] bg-[#3ECF8E] hover:bg-[#35b87d] rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Save preset
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Apply preset to selection modal */}
      {applyPresetToSelectionIds && applyPresetToSelectionIds.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setApplyPresetToSelectionIds(null)}>
          <div className="bg-[#171717] border border-[#2a2a2a] rounded-2xl shadow-2xl shadow-black/50 p-6 w-96 max-h-[80vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-white mb-2">Apply preset</h3>
            <p className="text-sm text-[#888] mb-4">Choose a preset to apply to {applyPresetToSelectionIds.length} photo{applyPresetToSelectionIds.length !== 1 ? 's' : ''}</p>
            <div className="space-y-2 overflow-y-auto flex-1 min-h-0">
              {presets.length === 0 ? (
                <p className="text-sm text-[#666] py-4">No presets yet</p>
              ) : (
                presets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleApplyPresetToSelection(preset)}
                    className="w-full px-4 py-2.5 text-left text-sm text-white hover:bg-[#252525] rounded-xl transition-colors"
                  >
                    {preset.name}
                  </button>
                ))
              )}
            </div>
            <button
              type="button"
              onClick={() => setApplyPresetToSelectionIds(null)}
              className="mt-4 w-full px-4 py-2.5 text-sm text-[#888] hover:text-white border border-[#333] rounded-xl hover:bg-[#252525] transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {selectedObject && (!isMobile || mobileEditFullscreen) && (
        <EditPanel
          object={selectedObject}
          isMobile={isMobile}
          onCloseMobileEdit={() => {
            useUIStore.getState().setMobileEditFullscreen(false);
          }}
          imagePreviewUrl={isMobile && 'src' in selectedObject ? (selectedObject as CanvasImage).src : undefined}
          onUpdate={(updates) => {
            if ('src' in selectedObject) {
              const imageId = selectedIds[0];
              if (imageId) {
                const now = Date.now();
                const isBulkUpdate = Object.keys(updates).length > 5; // e.g. preset apply
                const debounceOk = now - lastEditHistoryPushRef.current >= EDIT_HISTORY_DEBOUNCE_MS;
                if (isBulkUpdate || debounceOk) {
                  lastEditHistoryPushRef.current = now;
                  setEditHistory((prev) => [...prev.slice(-49), { imageId, snapshot: getEditSnapshot(selectedObject as CanvasImage) }]);
                  setEditRedoStack([]);
                }
              }
              // Mark state update as non-urgent so React can keep slider/UI responsive (React 18)
              startTransition(() => {
                setImages((prev) =>
                  prev.map((img) => (img.id === selectedIds[0] ? { ...img, ...updates } : img))
                );
              });
            } else {
              setTexts((prev) =>
                prev.map((txt) => (txt.id === selectedIds[0] ? { ...txt, ...updates } : txt))
              );
            }
          }}
          onDelete={async () => {
            if ('src' in selectedObject) {
              if (typeof window !== 'undefined' && window.localStorage.getItem('driftboard-delete-photo-skip-confirm') === 'true') {
                await handleDeletePhotos([selectedIds[0]]);
              } else {
                setDeletePhotoDontAskAgain(false);
                setConfirmDeletePhotoIds([selectedIds[0]]);
              }
            } else {
              setTexts((prev) => prev.filter((txt) => txt.id !== selectedIds[0]));
              setSelectedIds([]);
              saveToHistory();
            }
          }}
          isDeleting={selectedIds[0] != null && deletingPhotoId === selectedIds[0] && 'src' in selectedObject}
          onResetToOriginal={'src' in selectedObject ? () => {
            setEditHistory([]);
            setEditRedoStack([]);
            // Reset ALL edits to default values
            setImages((prev) =>
              prev.map((img) => img.id === selectedIds[0] ? {
                ...img,
                rotation: 0,
                scaleX: 1,
                scaleY: 1,
                // Light
                exposure: 0,
                contrast: 0,
                highlights: 0,
                shadows: 0,
                whites: 0,
                blacks: 0,
                texture: 0,
                // Color
                temperature: 0,
                vibrance: 0,
                saturation: 0,
                shadowTint: 0,
                colorHSL: undefined,
                splitToning: undefined,
                colorGrading: undefined,
                colorCalibration: undefined,
                // Effects
                clarity: 0,
                dehaze: 0,
                vignette: 0,
                grain: 0,
                grainSize: 0,
                grainRoughness: 0,
                // Curves
                curves: { ...DEFAULT_CURVES },
                // Legacy
                brightness: 0,
                hue: 0,
                blur: 0,
                filters: [],
              } : img)
            );
            saveToHistory();
          } : undefined}
          onSave={'src' in selectedObject ? () => handleSave(false) : undefined}
          saveStatus={'src' in selectedObject ? saveStatus : 'idle'}
          onRetrySave={'src' in selectedObject ? () => handleSave(false) : undefined}
          onExport={'src' in selectedObject ? handleExport : undefined}
          bypassedTabs={bypassedTabs}
          onToggleBypass={(tab) => {
            useEditStore.getState().toggleBypass(tab);
          }}
          onSliderDraggingChange={(dragging) => {
            setIsAdjustingSliders(dragging);
            if (!dragging) setSliderSettledWhileDragging(false);
          }}
          onSliderSettled={() => setSliderSettledWhileDragging(true)}
          onSliderUnsettled={() => setSliderSettledWhileDragging(false)}
          onApplyPresetProgress={'src' in selectedObject ? (current, total) => {
            if (current === 0 && total === 0) {
              setApplyPresetProgress(null);
            } else {
              setApplyPresetProgress({ current, total });
            }
          } : undefined}
        />
      )}

    </div>
  );
}

// Filter creators, buildExportFilterList, and exportWithCanvasFilters imported from @/lib/filters/clientFilters

// ImageNode imported from @/components/canvas/ImageNode

// Text node component
function TextNode({
  text,
  onClick,
  onDragEnd,
  onUpdate,
  draggable = true,
}: {
  text: CanvasText;
  isSelected: boolean;
  onClick: (e: Konva.KonvaEventObject<MouseEvent>) => void;
  onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onUpdate: (updates: Partial<CanvasText>) => void;
  draggable?: boolean;
}) {
  const textRef = useRef<Konva.Text>(null);

  useEffect(() => {
    if (textRef.current) {
      const node = textRef.current;
      node.x(text.x);
      node.y(text.y);
      node.text(text.text);
      node.fontSize(text.fontSize);
      node.fill(text.fill);
      node.rotation(text.rotation);
    }
  }, [text.x, text.y, text.text, text.fontSize, text.fill, text.rotation]);

  return (
    <Text
      ref={textRef}
      id={text.id}
      x={text.x}
      y={text.y}
      text={text.text}
      fontFamily="PP Fraktion Mono"
      fontSize={text.fontSize}
      fill={text.fill}
      rotation={text.rotation}
      draggable={draggable}
      listening={draggable}
      onClick={onClick}
      onDragEnd={onDragEnd}
      onTransformEnd={() => {
        const node = textRef.current;
        if (!node) return;
        const rotation = node.rotation();
        onUpdate({ rotation, x: node.x(), y: node.y() });
      }}
    />
  );
}
