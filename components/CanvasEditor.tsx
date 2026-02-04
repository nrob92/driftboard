'use client';

import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { Stage, Layer, Image as KonvaImage, Text, Transformer, Rect, Group } from 'react-konva';
import useImage from 'use-image';
import Konva from 'konva';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { TopBar } from './TopBar';
import { EditPanel } from './EditPanel';
import { snapToGrid, findNearestPhoto } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';

// DNG support - runtime script loading to avoid bundler issues
const isDNG = (name: string) => name.toLowerCase().endsWith('.dng');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let LibRawClass: any = null;
let librawLoading: Promise<void> | null = null;

async function loadLibRaw(): Promise<void> {
  if (LibRawClass) return;
  if (librawLoading) return librawLoading;

  librawLoading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.type = 'module';
    script.textContent = `
      import LibRaw from '/libraw/index.js';
      window.__LibRaw = LibRaw;
      window.dispatchEvent(new Event('libraw-loaded'));
    `;

    const handler = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      LibRawClass = (window as any).__LibRaw;
      window.removeEventListener('libraw-loaded', handler);
      resolve();
    };

    window.addEventListener('libraw-loaded', handler);
    document.head.appendChild(script);

    // Timeout after 10 seconds
    setTimeout(() => reject(new Error('LibRaw load timeout')), 10000);
  });

  return librawLoading;
}

// Preview max dimension for DNG files (best preview: no downscale; use large cap so we keep full res)
const DNG_PREVIEW_MAX_SIZE = 99999;

// Decode DNG using runtime-loaded LibRaw (bypasses bundler)
const decodeDNG = async (buffer: ArrayBuffer, forPreview = true): Promise<{ dataUrl: string; width: number; height: number }> => {
  await loadLibRaw();

  const raw = new LibRawClass();
  await raw.open(new Uint8Array(buffer), {
    useCameraWb: true,
    outputColor: 1,
    outputBps: 8,
    userQual: 3,
    halfSize: false,
    noAutoBright: false,
  });

  const imageData = await raw.imageData();
  const { data, width, height } = imageData;

  // Convert RGB to RGBA
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = data[i * 3];
    rgba[i * 4 + 1] = data[i * 3 + 1];
    rgba[i * 4 + 2] = data[i * 3 + 2];
    rgba[i * 4 + 3] = 255;
  }

  let canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.putImageData(new ImageData(rgba, width, height), 0, 0);

  let finalWidth = width;
  let finalHeight = height;

  if (forPreview && (width > DNG_PREVIEW_MAX_SIZE || height > DNG_PREVIEW_MAX_SIZE)) {
    const scale = Math.min(DNG_PREVIEW_MAX_SIZE / width, DNG_PREVIEW_MAX_SIZE / height);
    finalWidth = Math.round(width * scale);
    finalHeight = Math.round(height * scale);

    const resizedCanvas = document.createElement('canvas');
    resizedCanvas.width = finalWidth;
    resizedCanvas.height = finalHeight;
    const resizedCtx = resizedCanvas.getContext('2d', { willReadFrequently: true })!;
    resizedCtx.imageSmoothingEnabled = true;
    resizedCtx.imageSmoothingQuality = 'high';
    resizedCtx.drawImage(canvas, 0, 0, finalWidth, finalHeight);
    canvas = resizedCanvas;
  }

  return { dataUrl: canvas.toDataURL('image/jpeg', 0.98), width: finalWidth, height: finalHeight };
};

const decodeDNGFromUrl = async (url: string): Promise<{ dataUrl: string; width: number; height: number }> => {
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  return decodeDNG(buffer);
};

const GRID_SIZE = 50;

interface CurvePoint {
  x: number; // 0-255 input
  y: number; // 0-255 output
}

interface ChannelCurves {
  rgb: CurvePoint[];
  red: CurvePoint[];
  green: CurvePoint[];
  blue: CurvePoint[];
}

const DEFAULT_CURVES: ChannelCurves = {
  rgb: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
  red: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
  green: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
  blue: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
};

interface HSLAdjustments {
  hue: number; // -100 to +100
  saturation: number; // -100 to +100
  luminance: number; // -100 to +100
}

interface ColorHSL {
  red: HSLAdjustments;
  orange: HSLAdjustments;
  yellow: HSLAdjustments;
  green: HSLAdjustments;
  aqua: HSLAdjustments;
  blue: HSLAdjustments;
  purple: HSLAdjustments;
  magenta: HSLAdjustments;
}

interface SplitToning {
  shadowHue: number; // 0-360
  shadowSaturation: number; // 0-100
  highlightHue: number; // 0-360
  highlightSaturation: number; // 0-100
  balance: number; // -100 to +100
}

interface ColorGrading {
  shadowLum: number;     // -100 to +100
  midtoneLum: number;    // -100 to +100
  highlightLum: number;  // -100 to +100
  midtoneHue: number;    // 0-360
  midtoneSat: number;    // 0-100
  globalHue: number;     // 0-360
  globalSat: number;     // 0-100
  globalLum: number;     // -100 to +100
  blending: number;      // 0-100
}

interface ColorCalibration {
  redHue: number;        // -100 to +100
  redSaturation: number; // -100 to +100
  greenHue: number;      // -100 to +100
  greenSaturation: number; // -100 to +100
  blueHue: number;       // -100 to +100
  blueSaturation: number; // -100 to +100
}

interface CanvasImage {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  src: string;
  storagePath?: string; // Path in Supabase storage (e.g., "user_id/filename.jpg")
  folderId?: string; // ID of the folder this image belongs to
  rotation: number;
  scaleX: number;
  scaleY: number;
  // Light adjustments
  exposure: number;
  contrast: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  texture?: number;
  // Color adjustments
  temperature: number; // warm/cool
  vibrance: number;
  saturation: number;
  shadowTint?: number; // -100 to +100
  // HSL per color
  colorHSL?: ColorHSL;
  // Split Toning
  splitToning?: SplitToning;
  // Color Grading
  colorGrading?: ColorGrading;
  // Color Calibration
  colorCalibration?: ColorCalibration;
  // Effects
  clarity: number;
  dehaze: number;
  vignette: number;
  grain: number;
  grainSize?: number; // 0-100
  grainRoughness?: number; // 0-100
  // Curves
  curves: ChannelCurves;
  // Legacy (keeping for compatibility)
  brightness: number;
  hue: number;
  blur: number;
  filters: string[];
  // DNG/RAW support (server-side processing)
  originalStoragePath?: string; // Path in 'originals' bucket for full-res export
  isRaw?: boolean;              // True if this is a RAW/DNG file
  originalWidth?: number;       // Full resolution width
  originalHeight?: number;      // Full resolution height
  // Legacy: DNG original buffer (deprecated - now stored in Supabase)
  originalDngBuffer?: ArrayBuffer;
}

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

// Keys that define "edit" (appearance) - copied/pasted between images, excluding id/position/source
const EDIT_KEYS: (keyof CanvasImage)[] = [
  'rotation', 'scaleX', 'scaleY',
  'exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'texture',
  'temperature', 'vibrance', 'saturation', 'shadowTint', 'colorHSL', 'splitToning', 'colorGrading', 'colorCalibration',
  'clarity', 'dehaze', 'vignette', 'grain', 'grainSize', 'grainRoughness',
  'curves', 'brightness', 'hue', 'blur', 'filters',
];

function getEditSnapshot(img: CanvasImage): Partial<CanvasImage> {
  const out: Partial<CanvasImage> = {};
  for (const key of EDIT_KEYS) {
    if (key in img) {
      const v = img[key as keyof CanvasImage];
      if (v !== undefined) (out as Record<string, unknown>)[key] = v;
    }
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
}

interface CanvasText {
  id: string;
  x: number;
  y: number;
  text: string;
  fontSize: number;
  fill: string;
  rotation: number;
}

interface PhotoFolder {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number; // Folder width - controls how many columns fit
  height?: number; // Explicit height (label + content). When set, overrides content-based calculation.
  imageIds: string[]; // IDs of images in this folder
  color: string; // Accent color for the folder
}

const FOLDER_COLORS = [
  '#3ECF8E', // Green
  '#74c0fc', // Blue
  '#ff9f43', // Orange
  '#ff6b6b', // Red
  '#a78bfa', // Purple
  '#f472b6', // Pink
  '#fbbf24', // Yellow
  '#34d399', // Teal
];

function hexToRgba(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

// Centralized grid configuration - used everywhere for consistency
const GRID_CONFIG = {
  imageMaxSize: 140,  // Max width/height for images in grid
  imageGap: 12,       // Gap between images (same for horizontal and vertical)
  folderPadding: 15,  // Padding inside folder border
  defaultFolderWidth: 500, // Default folder width
  minFolderWidth: 180, // Minimum folder width (at least 1 image + padding)
  minFolderHeight: 130, // Minimum total height (30 label + 100 content)
  folderGap: 40,      // Minimum gap between folders
};
const CELL_SIZE = GRID_CONFIG.imageMaxSize + GRID_CONFIG.imageGap;

// Calculate columns based on folder width
const calculateColsFromWidth = (folderWidth: number): number => {
  const availableWidth = folderWidth - (GRID_CONFIG.folderPadding * 2);
  const cols = Math.floor((availableWidth + GRID_CONFIG.imageGap) / CELL_SIZE);
  return Math.max(1, cols);
};

// Determine layout mode based on folder width
const getFolderLayoutMode = (folderWidth: number): 'grid' | 'stack' => {
  const cols = calculateColsFromWidth(folderWidth);
  return cols === 1 ? 'stack' : 'grid';
};

// Reflow images within a folder based on its width
const reflowImagesInFolder = (
  folderImages: CanvasImage[],
  folderX: number,
  folderY: number,
  folderWidth: number
): CanvasImage[] => {
  const layoutMode = getFolderLayoutMode(folderWidth);
  const { folderPadding, imageMaxSize, imageGap } = GRID_CONFIG;

  // Border starts at folderX, so images start at folderX + folderPadding
  // Border is 30px below label (folderY), add padding for top of content area
  const contentStartX = folderX + folderPadding;
  const contentStartY = folderY + 30 + folderPadding; // 30px for label gap + padding

  if (layoutMode === 'stack') {
    // Vertical stacking mode - images in single column with vertical gaps
    return folderImages.map((img, index) => {
      const imgWidth = Math.min(img.width * img.scaleX, imageMaxSize);
      const imgHeight = Math.min(img.height * img.scaleY, imageMaxSize);

      // Center horizontally in folder
      const availableWidth = folderWidth - (2 * folderPadding);
      const cellOffsetX = (availableWidth - imgWidth) / 2;

      // Stack vertically with gaps
      const yOffset = index * (imageMaxSize + imageGap);

      return {
        ...img,
        x: contentStartX + cellOffsetX,
        y: contentStartY + yOffset,
      };
    });
  }

  // Grid mode - original multi-column layout
  const cols = calculateColsFromWidth(folderWidth);
  return folderImages.map((img, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);

    // Center images in their cells
    const imgWidth = Math.min(img.width * img.scaleX, imageMaxSize);
    const imgHeight = Math.min(img.height * img.scaleY, imageMaxSize);
    const cellOffsetX = (imageMaxSize - imgWidth) / 2;
    const cellOffsetY = (imageMaxSize - imgHeight) / 2;

    return {
      ...img,
      x: contentStartX + col * CELL_SIZE + cellOffsetX,
      y: contentStartY + row * CELL_SIZE + cellOffsetY,
    };
  });
};

// Calculate folder bounding box (including label)
const getFolderBounds = (folder: PhotoFolder, imageCount: number) => {
  const layoutMode = getFolderLayoutMode(folder.width);
  let contentHeight;

  if (layoutMode === 'stack') {
    // Stack mode: height based on number of images vertically
    contentHeight = imageCount * CELL_SIZE + (GRID_CONFIG.folderPadding * 2);
  } else {
    // Grid mode: existing calculation
    const cols = calculateColsFromWidth(folder.width);
    const rows = Math.ceil(imageCount / cols) || 1;
    contentHeight = rows * CELL_SIZE + (GRID_CONFIG.folderPadding * 2);
  }

  const calculatedHeight = 30 + Math.max(contentHeight, 100); // 30px for label gap
  const height = folder.height ?? calculatedHeight;

  return {
    x: folder.x,
    y: folder.y,
    width: folder.width,
    height,
    right: folder.x + folder.width,
    bottom: folder.y + height,
  };
};

// Get folder border/content height (below label) for rendering
const getFolderBorderHeight = (folder: PhotoFolder, imageCount: number): number => {
  if (folder.height != null) {
    return Math.max(folder.height - 30, 100); // 30px for label
  }

  const layoutMode = getFolderLayoutMode(folder.width);
  let contentHeight;

  if (layoutMode === 'stack') {
    // Stack mode: height based on number of images vertically
    contentHeight = imageCount * CELL_SIZE + (GRID_CONFIG.folderPadding * 2);
  } else {
    // Grid mode: existing calculation
    const cols = calculateColsFromWidth(folder.width);
    const rows = Math.ceil(imageCount / cols) || 1;
    contentHeight = rows * CELL_SIZE + (GRID_CONFIG.folderPadding * 2);
  }

  return Math.max(contentHeight, 100);
};

// Distance from point to a rectangle's border (perimeter)
function distanceToRectBorder(
  px: number,
  py: number,
  left: number,
  top: number,
  width: number,
  height: number
): number {
  const right = left + width;
  const bottom = top + height;
  const distToLeft = py >= top && py <= bottom ? Math.abs(px - left) : Math.min(Math.hypot(px - left, py - top), Math.hypot(px - left, py - bottom));
  const distToRight = py >= top && py <= bottom ? Math.abs(px - right) : Math.min(Math.hypot(px - right, py - top), Math.hypot(px - right, py - bottom));
  const distToTop = px >= left && px <= right ? Math.abs(py - top) : Math.min(Math.hypot(px - left, py - top), Math.hypot(px - right, py - top));
  const distToBottom = px >= left && px <= right ? Math.abs(py - bottom) : Math.min(Math.hypot(px - left, py - bottom), Math.hypot(px - right, py - bottom));
  return Math.min(distToLeft, distToRight, distToTop, distToBottom);
}

// Interface for image cell positions
interface ImageCellPosition {
  imageId: string;
  col: number;
  row: number;
  cellIndex: number;
}

// Get current grid cell positions for all images in a folder
const getImageCellPositions = (
  folderImages: CanvasImage[],
  folderX: number,
  folderY: number,
  currentWidth: number
): ImageCellPosition[] => {
  const cols = calculateColsFromWidth(currentWidth);
  const contentStartX = folderX + GRID_CONFIG.folderPadding;
  const contentStartY = folderY + 30 + GRID_CONFIG.folderPadding;

  return folderImages.map((img) => {
    const relativeX = img.x - contentStartX;
    const relativeY = img.y - contentStartY;
    const col = Math.max(0, Math.floor(relativeX / CELL_SIZE));
    const row = Math.max(0, Math.floor(relativeY / CELL_SIZE));

    return {
      imageId: img.id,
      col,
      row,
      cellIndex: row * cols + col,
    };
  });
};

// Interface for minimum folder size
interface MinimumSize {
  width: number;
  height: number;
}

// Calculate minimum folder size to fit all images
const calculateMinimumFolderSize = (
  imageCount: number,
  proposedWidth: number
): MinimumSize => {
  if (imageCount === 0) {
    return {
      width: GRID_CONFIG.minFolderWidth,
      height: GRID_CONFIG.minFolderHeight,
    };
  }

  const layoutMode = getFolderLayoutMode(proposedWidth);

  if (layoutMode === 'stack') {
    // Stack mode: needs height for all images vertically
    const contentHeight = imageCount * CELL_SIZE + (2 * GRID_CONFIG.folderPadding);
    return {
      width: GRID_CONFIG.minFolderWidth,
      height: 30 + Math.max(contentHeight, 100),
    };
  }

  // Grid mode: calculate minimum based on proposed width
  const cols = calculateColsFromWidth(proposedWidth);
  const rows = Math.ceil(imageCount / cols) || 1;
  const contentHeight = rows * CELL_SIZE + (2 * GRID_CONFIG.folderPadding);

  return {
    width: proposedWidth,
    height: 30 + Math.max(contentHeight, 100),
  };
};

// Cell assignment for smart positioning
interface CellAssignment {
  imageId: string;
  col: number;
  row: number;
}

// Intelligently reposition images only when borders would cut them off
// Returns cell assignments (row/col) for each image, NOT just sorted IDs
const smartRepackImages = (
  folderImages: CanvasImage[],
  currentPositions: ImageCellPosition[],
  oldWidth: number,
  newWidth: number,
  newHeight?: number
): CellAssignment[] => {
  const newCols = calculateColsFromWidth(newWidth);

  // Calculate max rows based on new height (if provided)
  let newMaxRows = Infinity;
  if (newHeight != null) {
    const contentHeight = newHeight - 30; // Subtract label height
    const availableContentHeight = contentHeight - (2 * GRID_CONFIG.folderPadding);
    newMaxRows = Math.max(1, Math.floor(availableContentHeight / CELL_SIZE));
  }

  // Build a map of current cell assignments
  const imageIdToCell = new Map<string, ImageCellPosition>();
  currentPositions.forEach((pos) => {
    imageIdToCell.set(pos.imageId, pos);
  });

  // Track which images need to be relocated and which can stay
  const imagesToRelocate: string[] = [];
  const keptImages: CellAssignment[] = [];

  // First pass: Determine which images can stay in their current cells
  currentPositions.forEach((pos) => {
    const isColumnValid = pos.col < newCols;
    const isRowValid = pos.row < newMaxRows;

    if (isColumnValid && isRowValid) {
      // Image can stay in its current position
      keptImages.push({ imageId: pos.imageId, col: pos.col, row: pos.row });
    } else {
      // Image needs to be relocated
      imagesToRelocate.push(pos.imageId);
    }
  });

  // Build set of occupied cells (using "row,col" string keys)
  const occupiedCells = new Set(keptImages.map(img => `${img.row},${img.col}`));

  // Second pass: Find new positions for relocated images
  const relocatedImages: CellAssignment[] = [];

  for (const imageId of imagesToRelocate) {
    const originalPos = imageIdToCell.get(imageId)!;
    let foundCol = -1;
    let foundRow = -1;

    // Strategy 1: Try to stay in same row (move left)
    if (originalPos.row < newMaxRows) {
      for (let col = newCols - 1; col >= 0; col--) {
        const key = `${originalPos.row},${col}`;
        if (!occupiedCells.has(key)) {
          foundRow = originalPos.row;
          foundCol = col;
          break;
        }
      }
    }

    // Strategy 2: Find any available cell (spiral search from original position)
    if (foundCol === -1) {
      const startRow = Math.min(originalPos.row, newMaxRows - 1);
      const startCol = Math.min(originalPos.col, newCols - 1);

      // Spiral outward from starting position
      outerLoop:
      for (let radius = 0; radius < Math.max(newMaxRows, newCols) * 2; radius++) {
        for (let dr = -radius; dr <= radius; dr++) {
          for (let dc = -radius; dc <= radius; dc++) {
            if (Math.abs(dr) !== radius && Math.abs(dc) !== radius) continue;

            const checkRow = startRow + dr;
            const checkCol = startCol + dc;

            if (checkRow >= 0 && checkRow < newMaxRows && checkCol >= 0 && checkCol < newCols) {
              const key = `${checkRow},${checkCol}`;
              if (!occupiedCells.has(key)) {
                foundRow = checkRow;
                foundCol = checkCol;
                break outerLoop;
              }
            }
          }
        }
      }
    }

    if (foundCol !== -1 && foundRow !== -1) {
      relocatedImages.push({ imageId, col: foundCol, row: foundRow });
      occupiedCells.add(`${foundRow},${foundCol}`);
    }
  }

  // Combine kept and relocated images
  return [...keptImages, ...relocatedImages];
};

// Position images at specific cells (not sequential like reflowImagesInFolder)
const positionImagesInCells = (
  folderImages: CanvasImage[],
  cellAssignments: CellAssignment[],
  folderX: number,
  folderY: number,
  folderWidth: number
): CanvasImage[] => {
  const { folderPadding, imageMaxSize } = GRID_CONFIG;
  const layoutMode = getFolderLayoutMode(folderWidth);

  const contentStartX = folderX + folderPadding;
  const contentStartY = folderY + 30 + folderPadding;

  // Create a map of image ID to cell assignment
  const assignmentMap = new Map<string, CellAssignment>();
  cellAssignments.forEach((a) => assignmentMap.set(a.imageId, a));

  return folderImages.map((img) => {
    const assignment = assignmentMap.get(img.id);
    if (!assignment) return img; // No assignment, keep as is

    const imgWidth = Math.min(img.width * img.scaleX, imageMaxSize);
    const imgHeight = Math.min(img.height * img.scaleY, imageMaxSize);

    if (layoutMode === 'stack') {
      // Stack mode: single column, position based on row index
      const availableWidth = folderWidth - (2 * folderPadding);
      const cellOffsetX = (availableWidth - imgWidth) / 2;
      const yOffset = assignment.row * CELL_SIZE;

      return {
        ...img,
        x: contentStartX + cellOffsetX,
        y: contentStartY + yOffset,
      };
    }

    // Grid mode: position at specific col/row
    const cellOffsetX = (imageMaxSize - imgWidth) / 2;
    const cellOffsetY = (imageMaxSize - imgHeight) / 2;

    return {
      ...img,
      x: contentStartX + assignment.col * CELL_SIZE + cellOffsetX,
      y: contentStartY + assignment.row * CELL_SIZE + cellOffsetY,
    };
  });
};

// Check if two rectangles overlap
const rectsOverlap = (
  a: { x: number; y: number; right: number; bottom: number },
  b: { x: number; y: number; right: number; bottom: number },
  gap: number
): boolean => {
  return !(
    a.right + gap <= b.x ||
    b.right + gap <= a.x ||
    a.bottom + gap <= b.y ||
    b.bottom + gap <= a.y
  );
};

// Resolve folder overlaps by pushing folders apart in all directions
const resolveFolderOverlaps = (
  folders: PhotoFolder[],
  images: CanvasImage[],
  changedFolderId?: string
): PhotoFolder[] => {
  if (folders.length < 2) return folders;

  const { folderGap } = GRID_CONFIG;
  const updated = [...folders];
  let hasOverlap = true;
  let iterations = 0;
  const maxIterations = 20;

  while (hasOverlap && iterations < maxIterations) {
    hasOverlap = false;
    iterations++;

    for (let i = 0; i < updated.length; i++) {
      const folderA = updated[i];
      const imageCountA = images.filter((img) => folderA.imageIds.includes(img.id)).length;
      const boundsA = getFolderBounds(folderA, imageCountA);

      for (let j = i + 1; j < updated.length; j++) {
        const folderB = updated[j];
        const imageCountB = images.filter((img) => folderB.imageIds.includes(img.id)).length;
        const boundsB = getFolderBounds(folderB, imageCountB);
        
        if (rectsOverlap(boundsA, boundsB, folderGap)) {
          hasOverlap = true;
          
          // Calculate centers
          const centerAX = boundsA.x + boundsA.width / 2;
          const centerAY = boundsA.y + boundsA.height / 2;
          const centerBX = boundsB.x + boundsB.width / 2;
          const centerBY = boundsB.y + boundsB.height / 2;
          
          // Determine which folder to move (prefer moving the one that wasn't changed)
          const moveB = changedFolderId === folderA.id || !changedFolderId;
          const mover = moveB ? folderB : folderA;
          const moverBounds = moveB ? boundsB : boundsA;
          const staticBounds = moveB ? boundsA : boundsB;
          const staticCenterX = moveB ? centerAX : centerBX;
          const staticCenterY = moveB ? centerAY : centerBY;
          const moverCenterX = moveB ? centerBX : centerAX;
          const moverCenterY = moveB ? centerBY : centerAY;
          
          // Calculate push direction based on relative position
          const dx = moverCenterX - staticCenterX;
          const dy = moverCenterY - staticCenterY;
          
          // Calculate the minimum push needed in each direction
          const pushRight = staticBounds.right + folderGap - moverBounds.x;
          const pushLeft = moverBounds.right + folderGap - staticBounds.x;
          const pushDown = staticBounds.bottom + folderGap - moverBounds.y;
          const pushUp = moverBounds.bottom + folderGap - staticBounds.y;
          
          // Choose direction based on where mover is relative to static
          // and which push distance is smallest
          let newX = mover.x;
          let newY = mover.y;
          
          if (Math.abs(dx) > Math.abs(dy)) {
            // More horizontal separation - push left or right
            if (dx > 0) {
              // Mover is to the right, push right
              newX = mover.x + pushRight;
            } else {
              // Mover is to the left, push left
              newX = mover.x - pushLeft;
            }
          } else {
            // More vertical separation - push up or down
            if (dy > 0) {
              // Mover is below, push down
              newY = mover.y + pushDown;
            } else {
              // Mover is above, push up
              newY = mover.y - pushUp;
            }
          }
          
          if (moveB) {
            updated[j] = { ...folderB, x: newX, y: newY };
          } else {
            updated[i] = { ...folderA, x: newX, y: newY };
          }
        }
      }
    }
  }
  
  return updated;
};

type CanvasEditorProps = {
  onPhotosLoadStateChange?: (loading: boolean) => void;
};

export function CanvasEditor({ onPhotosLoadStateChange }: CanvasEditorProps = {}) {
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const folderLabelRefs = useRef<Record<string, Konva.Text>>({});
  const [folderLabelWidths, setFolderLabelWidths] = useState<Record<string, number>>({});
  const [images, setImages] = useState<CanvasImage[]>([]);
  const [texts, setTexts] = useState<CanvasText[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const lastSelectedIdRef = useRef<string | null>(null);
  const lastMultiSelectionRef = useRef<string[] | null>(null);
  const [stageScale, setStageScale] = useState(1);
  const [stagePosition, setStagePosition] = useState({ x: 0, y: 0 });
  const [history, setHistory] = useState<{ images: CanvasImage[]; texts: CanvasText[]; folders: PhotoFolder[] }[]>([{ images: [], texts: [], folders: [] }]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const lastOverlapCheckRef = useRef<number>(0);
  const folderNameDragRef = useRef<boolean>(false);
  const lastSwappedImageRef = useRef<{ id: string; x: number; y: number } | null>(null);
  const overlapThrottleMs = 32; // ~30fps for smooth updates
  const [lastTouchDistance, setLastTouchDistance] = useState<number | null>(null);
  const [lastTouchCenter, setLastTouchCenter] = useState<{ x: number; y: number } | null>(null);
  const [dimensions, setDimensions] = useState({ width: 1920, height: 1080 });
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [showHeader, setShowHeader] = useState(false);
  const [folders, setFolders] = useState<PhotoFolder[]>([]);
  const [showFolderPrompt, setShowFolderPrompt] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [pendingFileCount, setPendingFileCount] = useState(0);
  const pendingFilesRef = useRef<File[]>([]);
  const [editingFolder, setEditingFolder] = useState<PhotoFolder | null>(null);
  const [editingFolderName, setEditingFolderName] = useState('');
  const [selectedExistingFolderId, setSelectedExistingFolderId] = useState<string | null>(null);
  const [folderNameError, setFolderNameError] = useState('');
  const [createFolderFromSelectionIds, setCreateFolderFromSelectionIds] = useState<string[] | null>(null);
  const [createFolderFromSelectionName, setCreateFolderFromSelectionName] = useState('');
  const [createFolderFromSelectionNameError, setCreateFolderFromSelectionNameError] = useState('');
  const [createEmptyFolderOpen, setCreateEmptyFolderOpen] = useState(false);
  const [createEmptyFolderName, setCreateEmptyFolderName] = useState('');
  const [createEmptyFolderNameError, setCreateEmptyFolderNameError] = useState('');
  const [confirmDeleteFolderOpen, setConfirmDeleteFolderOpen] = useState(false);
  const [deleteFolderDontAskAgain, setDeleteFolderDontAskAgain] = useState(false);
  const [bypassedTabs, setBypassedTabs] = useState<Set<'curves' | 'light' | 'color' | 'effects'>>(new Set());
  const [dragHoveredFolderId, setDragHoveredFolderId] = useState<string | null>(null);
  const [dragSourceFolderBorderHovered, setDragSourceFolderBorderHovered] = useState<string | null>(null);
  const [dragBorderBlink, setDragBorderBlink] = useState(false);
  const [resizingFolderId, setResizingFolderId] = useState<string | null>(null);
  const [copiedEdit, setCopiedEdit] = useState<Partial<CanvasImage> | null>(null);
  const [imageContextMenu, setImageContextMenu] = useState<{ x: number; y: number; imageId: string; selectedIds: string[] } | null>(null);
  const imageContextMenuRef = useRef<HTMLDivElement>(null);
  const [canvasContextMenu, setCanvasContextMenu] = useState<{ x: number; y: number } | null>(null);
  const canvasContextMenuRef = useRef<HTMLDivElement>(null);
  const [createPresetFromImageId, setCreatePresetFromImageId] = useState<string | null>(null);
  const [createPresetName, setCreatePresetName] = useState('');
  const [deletingPhotoId, setDeletingPhotoId] = useState<string | null>(null);
  const [confirmDeletePhotoIds, setConfirmDeletePhotoIds] = useState<string[] | null>(null);
  const [deletePhotoDontAskAgain, setDeletePhotoDontAskAgain] = useState(false);
  const [isDeletingFolder, setIsDeletingFolder] = useState(false);
  const [exportProgress, setExportProgress] = useState<{ current: number; total: number } | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const saveStatusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [zoomedImageId, setZoomedImageId] = useState<string | null>(null);
  const preZoomViewRef = useRef<{ scale: number; x: number; y: number } | null>(null);
  const zoomAnimationRef = useRef<number | null>(null);
  const lastMouseDownButtonRef = useRef<number>(0);
  const prevMouseDownButtonRef = useRef<number>(0);
  const queryClient = useQueryClient();
  const [hoveredFolderBorder, setHoveredFolderBorder] = useState<string | null>(null);
  const [dragGhostPosition, setDragGhostPosition] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
    folderId: string;
  } | null>(null);
  const folderFileInputRef = useRef<HTMLInputElement>(null);
  const { user } = useAuth();

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
      setDragBorderBlink((prev) => !prev);
    }, 110);
    return () => clearInterval(interval);
  }, [dragSourceFolderBorderHovered]);

  // Handle keyboard events for Spacebar and Escape (zoom out)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        setIsSpacePressed(true);
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
      }
    };

    // Also handle when Spacebar is released outside the window
    const handleBlur = () => {
      setIsSpacePressed(false);
      setIsDragging(false);
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

  // React Query for fetching photo metadata (cached for fast reloads)
  const { data: photoData } = useQuery({
    queryKey: ['user-photos', user?.id],
    queryFn: async () => {
      if (!user) return null;

      // Fetch all data in parallel for speed
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
    staleTime: 60 * 1000, // Cache for 60 seconds
  });

  // Track if images have been loaded to prevent re-processing
  const imagesLoadedRef = useRef<string | null>(null);

  // Process photos from cached query data
  useEffect(() => {
    const loadUserPhotos = async () => {
      if (!user || !photoData) return;
      // Skip if images already loaded for this user (prevents duplicate processing)
      if (imagesLoadedRef.current === user.id) {
        onPhotosLoadStateChange?.(false);
        return;
      }

      const { savedEdits, savedFolders, photosFiles, originalsFiles, photosError } = photoData;

      // Check if there are any files to load
      const photosList = (photosFiles ?? []).filter((f) => !f.name.startsWith('.'));
      const originalsList = (originalsFiles ?? []).filter((f) => !f.name.startsWith('.'));
      if (photosList.length === 0 && originalsList.length === 0) {
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
        if (validFiles.length === 0) return;

        const cols = 3;
        const spacing = 420;
        const maxSize = GRID_CONFIG.imageMaxSize;

        // Load all images in parallel; signed URLs cached by React Query (4 min) to avoid repeat API calls
        const SIGNED_URL_STALE_MS = 4 * 60 * 1000; // signed URLs last 5 min
        const loadOne = async (file: FileEntry, i: number): Promise<CanvasImage | null> => {
          const storagePath = `${user.id}/${file.name}`;
          const bucket = file.bucket;
          let imageUrl: string;
          try {
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
              const img = new window.Image();
              img.crossOrigin = 'anonymous';
              await new Promise<void>((resolve, reject) => {
                img.onload = () => resolve();
                img.onerror = () => reject(new Error('Failed to load'));
                img.src = imageUrl;
              });
              imgSrc = imageUrl;
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
            }

            return canvasImg;
          } catch (e) {
            console.warn(`Failed to load image: ${file.name}`, e);
            return null;
          }
        };

        const results = await Promise.all(validFiles.map((file, i) => loadOne(file, i)));
        const newImages: CanvasImage[] = results.filter((img): img is CanvasImage => img != null);

        // Apply any remaining edit fields to images we might have missed (e.g. originalStoragePath from storage_path key)
        if (savedEdits && savedEdits.length > 0) {
          for (const img of newImages) {
            const edit = savedEdits.find(
              (e: PhotoEdits) =>
                e.storage_path === img.storagePath ||
                e.storage_path === (img.originalStoragePath ?? '') ||
                (e.original_storage_path != null && e.original_storage_path === img.storagePath)
            );
            if (edit) {
              // Only use backend position when both x and y exist and are valid numbers
              const hasValidPosition = edit.x != null && edit.y != null
                && Number.isFinite(Number(edit.x)) && Number.isFinite(Number(edit.y));
              if (hasValidPosition) {
                img.x = Number(edit.x);
                img.y = Number(edit.y);
              }
              if (edit.original_storage_path != null) img.originalStoragePath = edit.original_storage_path;
              // Clamp dimensions to max size (in case old data has larger values)
              let savedWidth = edit.width ?? img.width;
              let savedHeight = edit.height ?? img.height;
              const maxSize = GRID_CONFIG.imageMaxSize;
              if (savedWidth > maxSize || savedHeight > maxSize) {
                const ratio = Math.min(maxSize / savedWidth, maxSize / savedHeight);
                savedWidth = savedWidth * ratio;
                savedHeight = savedHeight * ratio;
              }
              img.width = savedWidth;
              img.height = savedHeight;
              img.folderId = edit.folder_id != null ? String(edit.folder_id) : undefined;
              img.rotation = edit.rotation ?? 0;
              img.scaleX = edit.scale_x ?? 1;
              img.scaleY = edit.scale_y ?? 1;
              // Light
              img.exposure = edit.exposure ?? 0;
              img.contrast = edit.contrast ?? 0;
              img.highlights = edit.highlights ?? 0;
              img.shadows = edit.shadows ?? 0;
              img.whites = edit.whites ?? 0;
              img.blacks = edit.blacks ?? 0;
              img.texture = edit.texture ?? 0;
              // Color
              img.temperature = edit.temperature ?? 0;
              img.vibrance = edit.vibrance ?? 0;
              img.saturation = edit.saturation ?? 0;
              img.shadowTint = edit.shadow_tint ?? 0;
              img.colorHSL = edit.color_hsl ?? undefined;
              img.splitToning = edit.split_toning ?? undefined;
              img.colorGrading = edit.color_grading ?? undefined;
              img.colorCalibration = edit.color_calibration ?? undefined;
              // Effects
              img.clarity = edit.clarity ?? 0;
              img.dehaze = edit.dehaze ?? 0;
              img.vignette = edit.vignette ?? 0;
              img.grain = edit.grain ?? 0;
              img.grainSize = edit.grain_size ?? 0;
              img.grainRoughness = edit.grain_roughness ?? 0;
              // Curves
              img.curves = edit.curves ?? { ...DEFAULT_CURVES };
              // Legacy
              img.brightness = edit.brightness ?? 0;
              img.hue = edit.hue ?? 0;
              img.blur = edit.blur ?? 0;
              img.filters = edit.filters ?? [];
            }
          }
        }

        // Reconstruct folders from saved data; coerce position/dimensions so folder is tracked correctly
        const loadedFolders: PhotoFolder[] = [];
        const defaultFolderX = 100;
        const defaultFolderY = 100;
        if (savedFolders && savedFolders.length > 0) {
          for (const sf of savedFolders) {
            const folderId = String(sf.id);
            // Find all images that belong to this folder (match by folder_id from photo_edits)
            const folderImageIds = newImages
              .filter(img => img.folderId === folderId)
              .map(img => img.id);

            const sfX = sf.x != null && Number.isFinite(Number(sf.x)) ? Number(sf.x) : defaultFolderX;
            const sfY = sf.y != null && Number.isFinite(Number(sf.y)) ? Number(sf.y) : defaultFolderY;
            const sfWidth = sf.width != null && Number.isFinite(Number(sf.width)) ? Number(sf.width) : GRID_CONFIG.defaultFolderWidth;
            const sfHeight = sf.height != null && Number.isFinite(Number(sf.height)) ? Number(sf.height) : undefined;

            loadedFolders.push({
              id: folderId,
              name: String(sf.name ?? 'Untitled'),
              x: sfX,
              y: sfY,
              width: sfWidth,
              height: sfHeight,
              color: String(sf.color ?? FOLDER_COLORS[0]),
              imageIds: folderImageIds,
            });
          }
        }

        console.log('Final loaded folders:', loadedFolders);
        console.log('Images with folderIds:', newImages.map(img => ({ id: img.id, folderId: img.folderId })));

        if (newImages.length > 0) {
          imagesLoadedRef.current = user.id;
          setImages(newImages);
          setFolders(loadedFolders);
          // Update history with loaded state
          setHistory([{ images: newImages, texts: [], folders: loadedFolders }]);
          setHistoryIndex(0);
          
          // Center the viewport on the loaded content
          if (loadedFolders.length > 0) {
            // Calculate bounding box of all folders
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
            
            // Calculate center of all content
            const contentCenterX = (minX + maxX) / 2;
            const contentCenterY = (minY + maxY) / 2;
            
            // Pan so content is centered in viewport
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

  // Save state to history
  const saveToHistory = useCallback(() => {
    setHistory((prevHistory) => {
      const newHistory = prevHistory.slice(0, historyIndex + 1);
      newHistory.push({ images: [...images], texts: [...texts], folders: [...folders] });
      setHistoryIndex(newHistory.length - 1);
      return newHistory;
    });
  }, [images, texts, folders, historyIndex]);

  // Resolve folder overlaps and reflow all affected images
  const resolveOverlapsAndReflow = useCallback((
    currentFolders: PhotoFolder[],
    currentImages: CanvasImage[],
    changedFolderId?: string
  ): { folders: PhotoFolder[]; images: CanvasImage[] } => {
    // First resolve overlaps
    const resolvedFolders = resolveFolderOverlaps(currentFolders, currentImages, changedFolderId);
    
    // Then reflow images in folders that moved
    let updatedImages = [...currentImages];
    for (let i = 0; i < resolvedFolders.length; i++) {
      const newFolder = resolvedFolders[i];
      const oldFolder = currentFolders.find(f => f.id === newFolder.id);
      
      // If folder position changed, reflow its images
      if (oldFolder && (oldFolder.x !== newFolder.x || oldFolder.y !== newFolder.y)) {
        const folderImgs = updatedImages.filter(img => newFolder.imageIds.includes(img.id));
        if (folderImgs.length > 0) {
          const reflowed = reflowImagesInFolder(folderImgs, newFolder.x, newFolder.y, newFolder.width);
          updatedImages = updatedImages.map(img => {
            const r = reflowed.find(ri => ri.id === img.id);
            return r || img;
          });
        }
      }
    }
    
    return { folders: resolvedFolders, images: updatedImages };
  }, []);

  // Undo
  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      const prevState = history[historyIndex - 1];
      setImages([...prevState.images]);
      setTexts([...prevState.texts]);
      setFolders([...(prevState.folders || [])]);
      setHistoryIndex(historyIndex - 1);
      setSelectedIds([]);
    }
  }, [history, historyIndex]);

  // Redo
  const handleRedo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const nextState = history[historyIndex + 1];
      setImages([...nextState.images]);
      setTexts([...nextState.texts]);
      setFolders([...(nextState.folders || [])]);
      setHistoryIndex(historyIndex + 1);
      setSelectedIds([]);
    }
  }, [history, historyIndex]);

  // Handle file upload - uploads to Supabase Storage
  // Show folder name prompt when uploading
  const handleFileUpload = useCallback(
    (files: FileList | null) => {
      console.log('handleFileUpload called with files:', files, 'length:', files?.length);
      
      if (!files || files.length === 0) {
        console.log('No files provided');
        return;
      }
      
      // Validate and COPY files into an array (FileList becomes empty when input is reset)
      const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/x-adobe-dng'];
      const validFiles = Array.from(files).filter(f => validTypes.includes(f.type) || f.name.toLowerCase().endsWith('.dng'));

      console.log('Valid files:', validFiles.length);

      if (validFiles.length === 0) {
        alert('Please upload JPEG, PNG, WebP, or DNG files only.');
        return;
      }
      
      // Store COPY of files in ref (not the live FileList reference)
      pendingFilesRef.current = validFiles;
      console.log('Stored in ref:', pendingFilesRef.current);
      setPendingFileCount(validFiles.length);
      setNewFolderName('');
      setShowFolderPrompt(true);
    },
    []
  );

  // Process files after folder name is entered
  const processFilesWithFolder = useCallback(
    async (folderName: string) => {
      const files = pendingFilesRef.current;
      if (!files || files.length === 0) {
        console.log('No pending files in ref');
        return;
      }

      // Check for duplicate folder name
      const isDuplicate = folders.some(
        f => f.name.toLowerCase() === folderName.toLowerCase()
      );
      
      if (isDuplicate) {
        setFolderNameError('A folder with this name already exists');
        return;
      }

      console.log('Processing files with folder:', folderName, 'Files:', files.length, files);

      setFolderNameError('');
      setShowFolderPrompt(false);
      setIsUploading(true);

      // Calculate folder position - use simple fixed position for reliability
      // Position at top-left with some padding, accounting for existing folders
      const existingFolderCount = folders.length;
      const folderX = 100;
      const folderY = 100 + existingFolderCount * 500; // Stack folders vertically

      console.log('Folder position:', folderX, folderY);

      // Create the folder (we'll add images to state as each is ready so the UI updates progressively)
      const folderId = `folder-${Date.now()}`;
      const folderColor = FOLDER_COLORS[existingFolderCount % FOLDER_COLORS.length];
      const newImages: CanvasImage[] = [];
      let accumulatedImages: CanvasImage[] = [...images];

      // Grid layout for images within folder - using centralized config
      const { imageMaxSize } = GRID_CONFIG;
      let imageIndex = 0;

      // files is already an array of validated files
      console.log('Files to process:', files.length);

      for (const file of files) {
        // Files are already validated, no need to check again

        try {
          console.log('Processing file:', file.name);
          
          // Generate unique filename with user folder
          const fileExt = file.name.split('.').pop();
          const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
          const filePath = user ? `${user.id}/${fileName}` : `anonymous/${fileName}`;

          const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
          let imageSrc = '';
          let photosUploadSucceeded = false;

          // Skip direct upload for DNG files - they go through the API which creates JPG previews
          if (!isDNG(file.name) && supabaseUrl && user) {
            console.log('Uploading to Supabase:', filePath);
            const { data: uploadData, error: uploadError } = await supabase.storage
              .from('photos')
              .upload(filePath, file, {
                cacheControl: '3600',
                upsert: false,
              });

            if (uploadError) {
              console.error('Upload error:', uploadError.message);
              // Fallback to base64
              const reader = new FileReader();
              imageSrc = await new Promise<string>((resolve) => {
                reader.onload = (e) => resolve(e.target?.result as string);
                reader.readAsDataURL(file);
              });
            } else {
              photosUploadSucceeded = true;
              console.log('Upload successful:', uploadData);
              const { data: urlData } = supabase.storage
                .from('photos')
                .getPublicUrl(filePath);
              imageSrc = urlData.publicUrl;
              console.log('Public URL:', imageSrc);
            }
          } else if (!isDNG(file.name)) {
            console.log('Using base64 (no Supabase or not logged in)');
            const reader = new FileReader();
            imageSrc = await new Promise<string>((resolve) => {
              reader.onload = (e) => resolve(e.target?.result as string);
              reader.readAsDataURL(file);
            });
          }

          // Load image to get dimensions
          console.log('Loading image to get dimensions...');
          let width: number;
          let height: number;
          let dngBuffer: ArrayBuffer | undefined;

          // DNG/RAW support variables
          let originalStoragePath: string | undefined;
          let previewStoragePath: string | undefined;
          let isRaw = false;
          let originalWidth: number | undefined;
          let originalHeight: number | undefined;

          // Check if file is DNG - use server-side processing for better performance
          if (isDNG(file.name) && user) {
            console.log('Processing DNG file via server:', file.name);
            isRaw = true;

            try {
              // Upload to server API for processing
              const formData = new FormData();
              formData.append('file', file);
              formData.append('userId', user.id);

              const response = await fetch('/api/upload-dng', {
                method: 'POST',
                body: formData,
              });

              if (response.ok) {
                const result = await response.json();
                originalStoragePath = result.originalPath;
                previewStoragePath = result.previewPath ?? undefined;
                originalWidth = result.originalWidth;
                originalHeight = result.originalHeight;
                if (result.previewUrl) {
                  imageSrc = result.previewUrl;
                  width = result.width;
                  height = result.height;
                  console.log('DNG processed via server:', width, 'x', height, 'original:', originalWidth, 'x', originalHeight);
                } else {
                  // Original saved to originals; no server preview — decode client-side and upload preview
                  console.log('DNG saved to originals, decoding preview client-side');
                  const buffer = await file.arrayBuffer();
                  dngBuffer = buffer;
                  const decoded = await decodeDNG(buffer, true);
                  imageSrc = decoded.dataUrl;
                  width = decoded.width;
                  height = decoded.height;

                  // Upload client-decoded preview to photos bucket
                  const previewFileName = `${Date.now()}-${Math.random().toString(36).substring(7)}-preview.jpg`;
                  const previewFilePath = `${user.id}/${previewFileName}`;
                  const previewBlob = await fetch(decoded.dataUrl).then(r => r.blob());
                  const { error: previewUploadError } = await supabase.storage
                    .from('photos')
                    .upload(previewFilePath, previewBlob, {
                      contentType: 'image/jpeg',
                      cacheControl: '3600',
                    });
                  if (!previewUploadError) {
                    previewStoragePath = previewFilePath;
                    console.log('Uploaded client-decoded preview:', previewFilePath);
                  } else {
                    console.error('Failed to upload preview:', previewUploadError);
                  }
                }
              } else {
                // Fallback to client-side decoding
                console.warn('Server DNG processing failed, falling back to client-side');
                const buffer = await file.arrayBuffer();
                dngBuffer = buffer;
                const decoded = await decodeDNG(buffer, true);
                imageSrc = decoded.dataUrl;
                width = decoded.width;
                height = decoded.height;

                // Upload client-decoded preview to photos bucket
                const previewFileName = `${Date.now()}-${Math.random().toString(36).substring(7)}-preview.jpg`;
                const previewFilePath = `${user.id}/${previewFileName}`;
                const previewBlob = await fetch(decoded.dataUrl).then(r => r.blob());
                const { error: previewUploadError } = await supabase.storage
                  .from('photos')
                  .upload(previewFilePath, previewBlob, {
                    contentType: 'image/jpeg',
                    cacheControl: '3600',
                  });
                if (!previewUploadError) {
                  previewStoragePath = previewFilePath;
                  console.log('Uploaded client-decoded preview:', previewFilePath);
                }
              }
            } catch (apiError) {
              // Fallback to client-side decoding
              console.warn('Server DNG API error, falling back to client-side:', apiError);
              const buffer = await file.arrayBuffer();
              dngBuffer = buffer;
              const decoded = await decodeDNG(buffer, true);
              imageSrc = decoded.dataUrl;
              width = decoded.width;
              height = decoded.height;

              // Upload client-decoded preview to photos bucket
              const previewFileName = `${Date.now()}-${Math.random().toString(36).substring(7)}-preview.jpg`;
              const previewFilePath = `${user.id}/${previewFileName}`;
              const previewBlob = await fetch(decoded.dataUrl).then(r => r.blob());
              const { error: previewUploadError } = await supabase.storage
                .from('photos')
                .upload(previewFilePath, previewBlob, {
                  contentType: 'image/jpeg',
                  cacheControl: '3600',
                });
              if (!previewUploadError) {
                previewStoragePath = previewFilePath;
                console.log('Uploaded client-decoded preview:', previewFilePath);
              }
            }
          } else if (isDNG(file.name)) {
            // Client-side fallback for DNG when not logged in
            console.log('Decoding DNG file (client-side preview):', file.name);
            const buffer = await file.arrayBuffer();
            dngBuffer = buffer;
            const decoded = await decodeDNG(buffer, true);
            imageSrc = decoded.dataUrl;
            width = decoded.width;
            height = decoded.height;
            console.log('DNG preview decoded:', width, 'x', height);
          } else {
            // Regular image - load normally
            const img = new window.Image();
            img.crossOrigin = 'anonymous';

            await new Promise<void>((resolve, reject) => {
              img.onload = () => {
                console.log('Image loaded:', img.width, 'x', img.height);
                resolve();
              };
              img.onerror = (e) => {
                console.error('Image load error:', e);
                reject(new Error('Failed to load image'));
              };
              img.src = imageSrc;
            });
            width = img.width;
            height = img.height;
          }

          if (width > imageMaxSize || height > imageMaxSize) {
            const ratio = Math.min(imageMaxSize / width, imageMaxSize / height);
            width = width * ratio;
            height = height * ratio;
          }

          // Position within folder grid (below the folder label) - using folder width
          const cols = calculateColsFromWidth(GRID_CONFIG.defaultFolderWidth);
          const col = imageIndex % cols;
          const row = Math.floor(imageIndex / cols);
          
          // Center images in their cells for consistent spacing
          // Border starts at folderX, content starts at folderX + padding
          // Border is 30px below label, add padding for content area
          const contentStartX = folderX + GRID_CONFIG.folderPadding;
          const contentStartY = folderY + 30 + GRID_CONFIG.folderPadding;
          const cellOffsetX = (GRID_CONFIG.imageMaxSize - width) / 2;
          const cellOffsetY = (GRID_CONFIG.imageMaxSize - height) / 2;
          const x = contentStartX + col * CELL_SIZE + Math.max(0, cellOffsetX);
          const y = contentStartY + row * CELL_SIZE + Math.max(0, cellOffsetY);

          console.log('Image position:', x, y, 'Size:', width, height);

          // Use actual photos upload success so DNG with client-side preview still gets photos path (load matches by listing photos)
          const imageId = `img-${Date.now()}-${Math.random()}`;

          const newImage: CanvasImage = {
            id: imageId,
            x,
            y,
            width,
            height,
            src: imageSrc,
            storagePath: previewStoragePath || (photosUploadSucceeded ? filePath : undefined),
            folderId: folderId, // Link to folder
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
            // DNG/RAW support
            originalStoragePath,
            isRaw,
            originalWidth,
            originalHeight,
            originalDngBuffer: dngBuffer, // Legacy: client-side fallback
          };

          newImages.push(newImage);
          accumulatedImages = [...accumulatedImages, newImage];
          imageIndex++;

          // Show this image in the UI immediately (progressive display)
          const folderWithImages: PhotoFolder = {
            id: folderId,
            name: folderName,
            x: folderX,
            y: folderY,
            width: GRID_CONFIG.defaultFolderWidth,
            imageIds: newImages.map(img => img.id),
            color: folderColor,
            height: 30 + getFolderBorderHeight(
              { id: folderId, name: folderName, x: folderX, y: folderY, width: GRID_CONFIG.defaultFolderWidth, imageIds: newImages.map(img => img.id), color: folderColor },
              newImages.length
            ),
          };
          setImages(accumulatedImages);
          setFolders((prev) => {
            const without = prev.filter((f) => f.id !== folderId);
            return [...without, folderWithImages];
          });
        } catch (error) {
          console.error('Error processing file:', file.name, error);
        }
      }

      console.log('Processed images:', newImages.length);

      // Final overlap resolution and save (folder already in state with all images)
      if (newImages.length > 0) {
        const newFolder: PhotoFolder = {
          id: folderId,
          name: folderName,
          x: folderX,
          y: folderY,
          width: GRID_CONFIG.defaultFolderWidth,
          imageIds: newImages.map(img => img.id),
          color: folderColor,
        };

        const allImages = [...images, ...newImages];
        const allFolders = [...folders.filter((f) => f.id !== folderId), newFolder];
        const { folders: resolvedFolders, images: resolvedImages } = resolveOverlapsAndReflow(
          allFolders,
          allImages,
          folderId
        );

        setImages(resolvedImages);
        setFolders(resolvedFolders);
        
        // Save folder and photo_edits to Supabase after reflow (so x,y match what's on canvas)
        if (user) {
          const resolvedFolder = resolvedFolders.find(f => f.id === folderId);
          if (resolvedFolder) {
            const { error: folderError } = await supabase
              .from('photo_folders')
              .upsert({
                id: folderId,
                user_id: user.id,
                name: folderName,
                x: Math.round(resolvedFolder.x),
                y: Math.round(resolvedFolder.y),
                width: Math.round(resolvedFolder.width ?? GRID_CONFIG.defaultFolderWidth),
                height: resolvedFolder.height != null ? Math.round(resolvedFolder.height) : undefined,
                color: folderColor,
              });
            if (folderError) console.error('Error saving folder:', folderError);
          }

          const imagesToSave = resolvedImages.filter(
            img => (img.storagePath || img.originalStoragePath) && newImages.some(n => n.id === img.id)
          );
          if (imagesToSave.length > 0) {
            const editsToSave = imagesToSave.map(img => ({
              storage_path: img.storagePath || img.originalStoragePath!,
              user_id: user.id,
              folder_id: folderId,
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
              original_storage_path: img.originalStoragePath ?? null,
              is_raw: img.isRaw ?? false,
              original_width: img.originalWidth ?? null,
              original_height: img.originalHeight ?? null,
            }));
            const { error: editsError } = await supabase
              .from('photo_edits')
              .upsert(editsToSave, { onConflict: 'storage_path,user_id' });
            if (editsError) console.error('Error saving photo edits:', editsError);
          }
        }
        
        if (user) queryClient.invalidateQueries({ queryKey: ['user-photos', user.id] });
        setTimeout(() => saveToHistory(), 100);
      } else {
        console.log('No images were processed successfully');
      }
      
      pendingFilesRef.current = [];
      setIsUploading(false);
    },
    [folders, images, saveToHistory, user, resolveOverlapsAndReflow, queryClient]
  );

  // Add files to an existing folder
  const addFilesToExistingFolder = useCallback(
    async (folderId: string) => {
      const files = pendingFilesRef.current;
      if (!files || files.length === 0) return;

      const targetFolder = folders.find(f => f.id === folderId);
      if (!targetFolder) return;

      setShowFolderPrompt(false);
      setSelectedExistingFolderId(null);
      setIsUploading(true);

      const newImages: CanvasImage[] = [];
      const { imageMaxSize } = GRID_CONFIG;

      // Find how many images already exist in folder to continue grid layout
      let imageIndex = targetFolder.imageIds.length;
      const folderX = targetFolder.x;
      const folderY = targetFolder.y;

      for (const file of files) {
        try {
          const fileExt = file.name.split('.').pop();
          const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
          const filePath = user ? `${user.id}/${fileName}` : `anonymous/${fileName}`;

          const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
          let imageSrc = '';
          let photosUploadSucceeded = false;
          let storagePath: string | undefined;
          let originalStoragePath: string | undefined;
          let isRaw = false;
          let originalWidth: number | undefined;
          let originalHeight: number | undefined;
          let dngBuffer: ArrayBuffer | undefined;

          // DNG: use upload-dng API so raw goes to originals, preview to photos (never put raw DNG in photos)
          if (isDNG(file.name) && user) {
            try {
              const formData = new FormData();
              formData.append('file', file);
              formData.append('userId', user.id);
              const response = await fetch('/api/upload-dng', {
                method: 'POST',
                body: formData,
              });
              if (response.ok) {
                const result = await response.json();
                originalStoragePath = result.originalPath;
                storagePath = result.previewPath ?? undefined;
                originalWidth = result.originalWidth;
                originalHeight = result.originalHeight;
                isRaw = true;
                if (result.previewUrl) {
                  imageSrc = result.previewUrl;
                  photosUploadSucceeded = !!result.previewPath;
                } else {
                  const buffer = await file.arrayBuffer();
                  dngBuffer = buffer;
                  const decoded = await decodeDNG(buffer, true);
                  imageSrc = decoded.dataUrl;
                  const previewFileName = `${Date.now()}-${Math.random().toString(36).substring(7)}-preview.jpg`;
                  const previewFilePath = `${user.id}/${previewFileName}`;
                  const previewBlob = await fetch(decoded.dataUrl).then(r => r.blob());
                  const { error: previewUploadError } = await supabase.storage
                    .from('photos')
                    .upload(previewFilePath, previewBlob, {
                      contentType: 'image/jpeg',
                      cacheControl: '3600',
                    });
                  if (!previewUploadError) {
                    storagePath = previewFilePath;
                    photosUploadSucceeded = true;
                  }
                }
              }
            } catch {
              // Fallback: decode client-side, upload preview only; original stays only in memory (no originals bucket)
              const buffer = await file.arrayBuffer();
              dngBuffer = buffer;
              const decoded = await decodeDNG(buffer, true);
              imageSrc = decoded.dataUrl;
              const previewFileName = `${Date.now()}-${Math.random().toString(36).substring(7)}-preview.jpg`;
              const previewFilePath = `${user.id}/${previewFileName}`;
              const previewBlob = await fetch(decoded.dataUrl).then(r => r.blob());
              const { error: previewUploadError } = await supabase.storage
                .from('photos')
                .upload(previewFilePath, previewBlob, {
                  contentType: 'image/jpeg',
                  cacheControl: '3600',
                });
              if (!previewUploadError) {
                storagePath = previewFilePath;
                photosUploadSucceeded = true;
              }
              isRaw = true;
            }
          } else if (supabaseUrl && user && !isDNG(file.name)) {
            const { error: uploadError } = await supabase.storage
              .from('photos')
              .upload(filePath, file, {
                cacheControl: '3600',
                upsert: false,
              });

            if (uploadError) {
              const reader = new FileReader();
              imageSrc = await new Promise<string>((resolve) => {
                reader.onload = (e) => resolve(e.target?.result as string);
                reader.readAsDataURL(file);
              });
            } else {
              photosUploadSucceeded = true;
              storagePath = filePath;
              const { data: urlData } = supabase.storage
                .from('photos')
                .getPublicUrl(filePath);
              imageSrc = urlData.publicUrl;
            }
          } else {
            const reader = new FileReader();
            imageSrc = await new Promise<string>((resolve) => {
              reader.onload = (e) => resolve(e.target?.result as string);
              reader.readAsDataURL(file);
            });
          }

          let width: number;
          let height: number;

          if (isDNG(file.name)) {
            const dims = await new Promise<{ w: number; h: number }>((resolve) => {
              const img = new window.Image();
              img.onload = () => resolve({ w: img.width, h: img.height });
              img.onerror = () => resolve({ w: 0, h: 0 });
              img.src = imageSrc;
            });
            width = dims.w;
            height = dims.h;
          } else {
            const img = new window.Image();
            img.crossOrigin = 'anonymous';

            await new Promise<void>((resolve, reject) => {
              img.onload = () => resolve();
              img.onerror = () => reject(new Error('Failed to load image'));
              img.src = imageSrc;
            });
            width = img.width;
            height = img.height;
          }

          if (width > imageMaxSize || height > imageMaxSize) {
            const ratio = Math.min(imageMaxSize / width, imageMaxSize / height);
            width = width * ratio;
            height = height * ratio;
          }

          // Dynamic columns based on folder width
          const cols = calculateColsFromWidth(targetFolder.width);
          const col = imageIndex % cols;
          const row = Math.floor(imageIndex / cols);
          
          // Center images in their cells for consistent spacing
          // Border starts at folderX, content starts at folderX + padding
          const contentStartX = folderX + GRID_CONFIG.folderPadding;
          const contentStartY = folderY + 30 + GRID_CONFIG.folderPadding;
          const cellOffsetX = (GRID_CONFIG.imageMaxSize - width) / 2;
          const cellOffsetY = (GRID_CONFIG.imageMaxSize - height) / 2;
          const x = contentStartX + col * CELL_SIZE + Math.max(0, cellOffsetX);
          const y = contentStartY + row * CELL_SIZE + Math.max(0, cellOffsetY);

          const imageId = `img-${Date.now()}-${Math.random()}`;

          const newImage: CanvasImage = {
            id: imageId,
            x,
            y,
            width,
            height,
            src: imageSrc,
            storagePath: storagePath ?? (photosUploadSucceeded ? filePath : undefined),
            folderId: folderId,
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
            originalStoragePath: originalStoragePath ?? undefined,
            isRaw: isRaw || undefined,
            originalWidth,
            originalHeight,
            originalDngBuffer: dngBuffer,
          };

          newImages.push(newImage);
          imageIndex++;
        } catch (error) {
          console.error('Error processing file:', file.name, error);
        }
      }

      if (newImages.length > 0) {
        // Calculate total image count in folder
        const totalImageCount = targetFolder.imageIds.length + newImages.length;

        // Calculate minimum required size for all images
        const minSize = calculateMinimumFolderSize(totalImageCount, targetFolder.width);

        // Determine if folder needs to grow
        const currentHeight = targetFolder.height ?? getFolderBorderHeight(targetFolder, targetFolder.imageIds.length);
        const needsResize = minSize.width > targetFolder.width || minSize.height > currentHeight;

        // Update folder with new image IDs and potentially new dimensions
        const updatedFolders = folders.map((f) => {
          if (f.id === folderId) {
            return {
              ...f,
              imageIds: [...f.imageIds, ...newImages.map(img => img.id)],
              width: needsResize ? Math.max(f.width, minSize.width) : f.width,
              height: needsResize ? Math.max(currentHeight, minSize.height) : f.height,
            };
          }
          return f;
        });

        const allImages = [...images, ...newImages];

        // If folder was resized, reflow all images in the folder
        let finalImages = allImages;
        if (needsResize) {
          const updatedFolder = updatedFolders.find(f => f.id === folderId)!;
          const allFolderImages = allImages.filter(img => updatedFolder.imageIds.includes(img.id));
          const reflowedImages = reflowImagesInFolder(
            allFolderImages,
            updatedFolder.x,
            updatedFolder.y,
            updatedFolder.width
          );
          finalImages = allImages.map(img => {
            const reflowed = reflowedImages.find(r => r.id === img.id);
            return reflowed ? reflowed : img;
          });
        }

        // Resolve any folder overlaps (folder got bigger)
        const { folders: resolvedFolders, images: resolvedImages } = resolveOverlapsAndReflow(
          updatedFolders,
          finalImages,
          folderId
        );

        setFolders(resolvedFolders);
        setImages(resolvedImages);

        // Save photo edits and folder dimensions to Supabase (includes ALL editable fields)
        if (user) {
          // Save new images (canonical key: photos path or originals path)
          const imagesToSave = newImages.filter(img => img.storagePath || img.originalStoragePath);
          if (imagesToSave.length > 0) {
            const editsToSave = imagesToSave.map(img => ({
              storage_path: img.storagePath || img.originalStoragePath!,
              user_id: user.id,
              folder_id: folderId,
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
            }));

            await supabase
              .from('photo_edits')
              .upsert(editsToSave, { onConflict: 'storage_path,user_id' });
          }

          // Update folder dimensions if they changed
          if (needsResize) {
            const updatedFolder = resolvedFolders.find(f => f.id === folderId);
            if (updatedFolder) {
              await supabase
                .from('photo_folders')
                .update({
                  width: Math.round(updatedFolder.width),
                  ...(updatedFolder.height != null && { height: Math.round(updatedFolder.height) }),
                })
                .eq('id', folderId)
                .eq('user_id', user.id);
            }
          }

          // Update positions of existing images if folder was reflowed (canonical key)
          if (needsResize) {
            const existingFolderImages = resolvedImages.filter(
              img => img.folderId === folderId && (img.storagePath || img.originalStoragePath) && !newImages.find(n => n.id === img.id)
            );
            for (const img of existingFolderImages) {
              const canonicalPath = img.storagePath || img.originalStoragePath!;
              await supabase
                .from('photo_edits')
                .update({ x: Math.round(img.x), y: Math.round(img.y) })
                .eq('storage_path', canonicalPath)
                .eq('user_id', user.id);
            }
          }
        }
        
        if (user) queryClient.invalidateQueries({ queryKey: ['user-photos', user.id] });
        setTimeout(() => saveToHistory(), 100);
      }
      
      pendingFilesRef.current = [];
      setIsUploading(false);
    },
    [folders, images, saveToHistory, user, resolveOverlapsAndReflow, queryClient]
  );

  // Handle adding photos to a specific folder via plus button
  const handleAddPhotosToFolder = useCallback((folderId: string) => {
    console.log('handleAddPhotosToFolder called with folderId:', folderId);
    if (folderFileInputRef.current) {
      folderFileInputRef.current.setAttribute('data-folder-id', folderId);
      folderFileInputRef.current.click();
      console.log('File input clicked');
    } else {
      console.error('folderFileInputRef.current is null');
    }
  }, []);

  // Handle file selection for folder plus button
  const handleFolderFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const folderId = e.target.getAttribute('data-folder-id');
      if (!folderId || !e.target.files || e.target.files.length === 0) {
        if (folderFileInputRef.current) {
          folderFileInputRef.current.value = '';
        }
        return;
      }

      // Validate files
      const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/x-adobe-dng'];
      const validFiles = Array.from(e.target.files).filter(f => validTypes.includes(f.type) || f.name.toLowerCase().endsWith('.dng'));

      if (validFiles.length === 0) {
        alert('Please upload JPEG, PNG, WebP, or DNG files only.');
        if (folderFileInputRef.current) {
          folderFileInputRef.current.value = '';
        }
        return;
      }

      // Store files in ref and call addFilesToExistingFolder
      pendingFilesRef.current = validFiles;
      await addFilesToExistingFolder(folderId);

      // Reset input
      if (folderFileInputRef.current) {
        folderFileInputRef.current.value = '';
      }
    },
    [addFilesToExistingFolder]
  );

  // Handle drag and drop
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const files = e.dataTransfer.files;
      handleFileUpload(files);
    },
    [handleFileUpload]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

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

  // Handle stage drag — clear selection when left-clicking empty (Stage only). Right-click must not clear so paste-to-selection sees full selection.
  const handleStageMouseDown = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.evt.button !== 0) return;
    const clickedOnEmpty = e.target === e.target.getStage();
    if (clickedOnEmpty) {
      setSelectedIds([]);
      lastSelectedIdRef.current = null;
    }
  }, []);

  // Update transformer when selection changes (single selection only)
  useEffect(() => {
    if (!transformerRef.current) return;

    const transformer = transformerRef.current;
    const stage = transformer.getStage();
    if (!stage) return;

    const singleId = selectedIds.length === 1 ? selectedIds[0] : null;
    const selectedNode = singleId ? stage.findOne(`#${singleId}`) : null;
    if (selectedNode) {
      transformer.nodes([selectedNode]);
      transformer.getLayer()?.batchDraw();
    } else {
      transformer.nodes([]);
    }
  }, [selectedIds]);

  // Remember last multi-selection so context menu can use it even if a spurious click overwrote selectedIds. Only clear when selection is empty, not when it becomes single.
  useEffect(() => {
    if (selectedIds.length > 1) lastMultiSelectionRef.current = selectedIds.slice();
    else if (selectedIds.length === 0) lastMultiSelectionRef.current = null;
  }, [selectedIds]);

  // Handle object selection: plain = single, Ctrl = toggle, Shift = range (photos only). Ignore right-click so range selection is kept for context menu.
  const handleObjectClick = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.evt.button !== 0) return; // only left-click changes selection; right-click keeps current selection for paste/create folder
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
              const rowA = Math.round(a.y / CELL_SIZE);
              const rowB = Math.round(b.y / CELL_SIZE);
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

  const handleCopyEdit = useCallback(() => {
    if (!imageContextMenu) return;
    const img = images.find((i) => i.id === imageContextMenu.imageId);
    if (img) {
      const snapshot = getEditSnapshot(img);
      setCopiedEdit(JSON.parse(JSON.stringify(snapshot)) as Partial<CanvasImage>);
    }
    setImageContextMenu(null);
  }, [imageContextMenu, images]);

  const handlePasteEdit = useCallback(() => {
    if (!imageContextMenu || !copiedEdit) return;
    const ids = new Set(imageContextMenu.selectedIds);
    setImages((prev) =>
      prev.map((img) => (ids.has(img.id) ? { ...img, ...copiedEdit } : img))
    );
    saveToHistory();
    setImageContextMenu(null);
    if (ids.size > 1) {
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
      queryClient.invalidateQueries({ queryKey: ['user-photos', user.id] });
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

  // Close image/canvas context menu on click outside or escape
  useEffect(() => {
    if (!imageContextMenu && !canvasContextMenu) return;
    const close = (e?: MouseEvent) => {
      if (e?.target && imageContextMenuRef.current?.contains(e.target as Node)) return;
      if (e?.target && canvasContextMenuRef.current?.contains(e.target as Node)) return;
      setImageContextMenu(null);
      setCanvasContextMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setImageContextMenu(null);
        setCanvasContextMenu(null);
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
  }, [imageContextMenu, canvasContextMenu]);

  // Handle object drag end with smart snapping (only if near another photo)
  // Handle real-time grid snapping and shuffling during drag
  const handleImageDragMove = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      const node = e.target;
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

      // If image is in a folder, calculate grid position and shuffle in real-time
      if (targetFolderId && targetFolder) {
        const cols = calculateColsFromWidth(targetFolder.width);
        const { folderPadding, imageMaxSize } = GRID_CONFIG;
        const contentStartX = targetFolder.x + folderPadding;
        const contentStartY = targetFolder.y + 30 + folderPadding;
        
        // Calculate which cell the drag position corresponds to
        const relativeX = currentX - contentStartX;
        const relativeY = currentY - contentStartY;
        const targetCol = Math.max(0, Math.floor(relativeX / CELL_SIZE));
        const targetRow = Math.max(0, Math.floor(relativeY / CELL_SIZE));
        const clampedCol = Math.min(targetCol, cols - 1);
        
        // Calculate the center of the target cell
        const targetCellCenterX = contentStartX + clampedCol * CELL_SIZE + imageMaxSize / 2;
        const targetCellCenterY = contentStartY + targetRow * CELL_SIZE + imageMaxSize / 2;
        
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
        
        const targetCellIndex = targetRow * cols + clampedCol;
        
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
          const imgRow = Math.floor(imgRelativeY / CELL_SIZE);
          const cellIndex = imgRow * cols + imgCol;
          imageCellMap.set(img.id, cellIndex);
        });
        
        // Calculate current image's cell
        const currentImgRelativeX = currentImg.x - contentStartX;
        const currentImgRelativeY = currentImg.y - contentStartY;
        const currentImgCol = Math.floor(currentImgRelativeX / CELL_SIZE);
        const currentImgRow = Math.floor(currentImgRelativeY / CELL_SIZE);
        const currentImgCell = currentImgRow * cols + currentImgCol;
        
        // Check if target cell is occupied
        const occupiedBy = Array.from(imageCellMap.entries()).find(([, cellIndex]) => cellIndex === targetCellIndex);
        
        let swapX: number | undefined;
        let swapY: number | undefined;
        let swapImgId: string | undefined;
        let finalCol = clampedCol;
        let finalRow = targetRow;
        
        if (occupiedBy) {
          const [occupiedImgId] = occupiedBy;
          
          // Swap if current image has a valid cell position
          if (currentImgCell >= 0 && currentImgCell < cols * 1000 && 
              currentImg.folderId === targetFolderId) {
            const occupiedImg = otherFolderImages.find(img => img.id === occupiedImgId);
            if (occupiedImg) {
              const swapCol = currentImgCell % cols;
              const swapRow = Math.floor(currentImgCell / cols);
              const swapImgWidth = Math.min(occupiedImg.width * occupiedImg.scaleX, imageMaxSize);
              const swapImgHeight = Math.min(occupiedImg.height * occupiedImg.scaleY, imageMaxSize);
              const swapOffsetX = (imageMaxSize - swapImgWidth) / 2;
              const swapOffsetY = (imageMaxSize - swapImgHeight) / 2;
              
              swapX = contentStartX + swapCol * CELL_SIZE + swapOffsetX;
              swapY = contentStartY + swapRow * CELL_SIZE + swapOffsetY;
              swapImgId = occupiedImgId;
            }
          } else {
            // Find nearest empty cell
            const occupiedCells = new Set(Array.from(imageCellMap.values()));
            const maxRows = Math.max(10, Math.ceil((otherFolderImages.length + 1) / cols));
            
            for (let radius = 0; radius < maxRows * cols; radius++) {
              let foundEmpty = false;
              for (let dr = -radius; dr <= radius && !foundEmpty; dr++) {
                for (let dc = -radius; dc <= radius && !foundEmpty; dc++) {
                  if (Math.abs(dr) !== radius && Math.abs(dc) !== radius) continue;
                  
                  const checkRow = targetRow + dr;
                  const checkCol = clampedCol + dc;
                  
                  if (checkRow >= 0 && checkCol >= 0 && checkCol < cols) {
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
        
        // Calculate final position for dragged image
        const imgWidth = Math.min(currentImg.width * currentImg.scaleX, imageMaxSize);
        const imgHeight = Math.min(currentImg.height * currentImg.scaleY, imageMaxSize);
        const cellOffsetX = (imageMaxSize - imgWidth) / 2;
        const cellOffsetY = (imageMaxSize - imgHeight) / 2;

        const finalX = contentStartX + finalCol * CELL_SIZE + cellOffsetX;
        const finalY = contentStartY + finalRow * CELL_SIZE + cellOffsetY;

        // Don't show ghost at all when snapping in folder — no green dashed border
        setDragGhostPosition(null);

        // Update positions in real-time
        setImages((prev) =>
          prev.map((img) => {
            if (img.id === currentImg.id) {
              return { ...img, x: finalX, y: finalY };
            }
            if (swapImgId && img.id === swapImgId && swapX !== undefined && swapY !== undefined) {
              return { ...img, x: swapX, y: swapY };
            }
            return img;
          })
        );

        // Track swapped image for saving later
        if (swapImgId && swapX !== undefined && swapY !== undefined) {
          lastSwappedImageRef.current = { id: swapImgId, x: swapX, y: swapY };
        }

        // Update dragged image position using setAttrs
        node.setAttrs({ x: finalX, y: finalY });
      }

      // Update folder hover state for visual feedback
      setDragHoveredFolderId(targetFolderId || null);
    },
    [images, folders]
  );

  const handleObjectDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>, type: 'image' | 'text') => {
      const node = e.target;
      const currentX = node.x();
      const currentY = node.y();

      // Clear ghost placeholder when drag ends
      setDragGhostPosition(null);

      let newX = currentX;
      let newY = currentY;

      // Only snap if it's an image
      if (type === 'image') {
        const currentImg = images.find((img) => img.id === node.id());
        if (currentImg) {
          // Get the current position (already updated by handleImageDragMove if in folder)
          newX = currentX;
          newY = currentY;
          
          // Calculate current center position
          const currentCenterX = currentX + currentImg.width / 2;
          const currentCenterY = currentY + currentImg.height / 2;

          // Check which folder the image was dropped into (if any)
          let targetFolderId: string | undefined = undefined;
          let targetFolder: PhotoFolder | undefined = undefined;

          // Check all folders to see if image center is inside any of them
          for (const folder of folders) {
            // Use folder's actual height (or calculated height) for bounds
            const folderHeight = folder.height ?? getFolderBorderHeight(folder, folder.imageIds.length);
            const boundLeft = folder.x;
            const boundRight = folder.x + folder.width;
            const boundTop = folder.y + 30; // Below label
            const boundBottom = folder.y + 30 + folderHeight;

            if (currentCenterX >= boundLeft && currentCenterX <= boundRight &&
                currentCenterY >= boundTop && currentCenterY <= boundBottom) {
              targetFolderId = folder.id;
              targetFolder = folder;
              break;
            }
          }

          // If image is IN a folder, snap to nearest grid cell
          if (targetFolderId && targetFolder) {
            const { folderPadding, imageMaxSize } = GRID_CONFIG;
            const cols = calculateColsFromWidth(targetFolder.width);
            const contentStartX = targetFolder.x + folderPadding;
            const contentStartY = targetFolder.y + 30 + folderPadding;

            // Calculate max rows based on folder's actual height
            const folderHeight = targetFolder.height ?? getFolderBorderHeight(targetFolder, targetFolder.imageIds.length);
            const contentHeight = folderHeight - (2 * folderPadding);
            const maxRows = Math.max(1, Math.floor(contentHeight / CELL_SIZE));

            // Calculate which cell the image should snap to based on current position
            const relativeX = currentX - contentStartX;
            const relativeY = currentY - contentStartY;
            const targetCol = Math.max(0, Math.min(cols - 1, Math.round(relativeX / CELL_SIZE)));
            const targetRow = Math.max(0, Math.min(maxRows - 1, Math.round(relativeY / CELL_SIZE)));

            // Calculate snapped position
            const imgWidth = Math.min(currentImg.width * currentImg.scaleX, imageMaxSize);
            const imgHeight = Math.min(currentImg.height * currentImg.scaleY, imageMaxSize);
            const cellOffsetX = (imageMaxSize - imgWidth) / 2;
            const cellOffsetY = (imageMaxSize - imgHeight) / 2;

            newX = contentStartX + targetCol * CELL_SIZE + cellOffsetX;
            newY = contentStartY + targetRow * CELL_SIZE + cellOffsetY;

            // Update node position to snapped position
            node.position({ x: newX, y: newY });
          }
          // If image is outside folders, use snapping logic
          else if (!targetFolderId) {
            const nearest = findNearestPhoto(currentCenterX, currentCenterY, images, node.id(), 100);
            if (nearest) {
              newX = nearest.x - currentImg.width / 2;
              newY = nearest.y - currentImg.height / 2;
              newX = snapToGrid(newX, GRID_SIZE);
              newY = snapToGrid(newY, GRID_SIZE);
            }
          }

          // Update image's folder assignment
          const oldFolderId = currentImg.folderId;
          
          if (targetFolderId !== oldFolderId) {
            // If dropped outside all folders AND image was in a folder, create a new "Untitled" folder
            if (!targetFolderId && oldFolderId) {
              // Generate unique "Untitled" name
              const existingUntitledNames = folders
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

              // Create new folder at the image's position
              const newFolderId = `folder-${Date.now()}`;
              const colorIndex = folders.length % FOLDER_COLORS.length;
              
              // New folder position - use drop position for folder label
              const newFolderX = newX;
              const newFolderY = newY - 50; // Position label above where image was dropped
              const newFolderWidth = GRID_CONFIG.defaultFolderWidth;
              
              // Calculate proper centered position for image inside the new folder
              const contentStartX = newFolderX + GRID_CONFIG.folderPadding;
              const contentStartY = newFolderY + 30 + GRID_CONFIG.folderPadding;
              const imgWidth = currentImg.width * currentImg.scaleX;
              const imgHeight = currentImg.height * currentImg.scaleY;
              const cellOffsetX = Math.max(0, (GRID_CONFIG.imageMaxSize - imgWidth) / 2);
              const cellOffsetY = Math.max(0, (GRID_CONFIG.imageMaxSize - imgHeight) / 2);
              const centeredX = contentStartX + cellOffsetX;
              const centeredY = contentStartY + cellOffsetY;
              
              // Build updated state: remove from old folder, add new folder, update image
              const updatedFolders = folders
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
              const updatedImages = images.map((img) =>
                img.id === currentImg.id
                  ? { ...img, x: centeredX, y: centeredY, folderId: newFolderId }
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
                  const prev = folders.find((of) => of.id === f.id);
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
                    .update({ folder_id: newFolderId, x: Math.round(finalImg.x), y: Math.round(finalImg.y) })
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
              const gridX = newX;
              const gridY = newY;

              // Update folders
              const updatedFolders = folders.map((f) => {
                if (f.id === oldFolderId) {
                  return { ...f, imageIds: f.imageIds.filter((id) => id !== currentImg.id) };
                }
                if (f.id === targetFolderId) {
                  return { ...f, imageIds: [...f.imageIds, currentImg.id] };
                }
                return f;
              });

              // Update images
              const updatedImages = images.map((img) =>
                img.id === currentImg.id
                  ? { ...img, x: gridX, y: gridY, folderId: targetFolderId }
                  : img
              );

              // Resolve any folder overlaps (target folder may have grown)
              const { folders: resolvedFolders, images: resolvedImages } = resolveOverlapsAndReflow(
                updatedFolders,
                updatedImages,
                targetFolderId
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
                  const oldF = folders.find(of => of.id === f.id);
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
                
                // Save the dragged image (canonical key)
                const currentCanonical = currentImg.storagePath || currentImg.originalStoragePath;
                if (currentCanonical && finalImg) {
                  supabase.from('photo_edits')
                    .update({ folder_id: targetFolderId, x: Math.round(finalImg.x), y: Math.round(finalImg.y) })
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

          // If image is in a folder (same folder move), positions are already updated in real-time
          // Just save to Supabase and ensure folder assignment is correct
          if (targetFolderId && targetFolderId === oldFolderId) {
            // Use node position directly - it was updated synchronously by handleImageDragMove
            const finalX = node.x();
            const finalY = node.y();
            
            // Update folder assignment if needed (should already be set)
            setImages((prev) =>
              prev.map((img) =>
                img.id === currentImg.id
                  ? { ...img, folderId: targetFolderId, x: finalX, y: finalY }
                  : img
              )
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
                const swappedImg = images.find(img => img.id === swappedRef.id);
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
    [images, folders, user, resolveOverlapsAndReflow]
  );

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
    });
  }, [images, selectedIds]);

  useEffect(() => {
    if (!selectedImageEditSignature || !user) return;
    if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current);
    autoSaveTimeoutRef.current = setTimeout(() => {
      handleSave(true);
      autoSaveTimeoutRef.current = null;
    }, 800);
    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
        autoSaveTimeoutRef.current = null;
      }
    };
  }, [selectedImageEditSignature, user, handleSave]);

  // Export a single image with edits (DNG full-res or server). silent = true for multi-export (no per-image alerts).
  const exportImageToDownload = useCallback(async (image: CanvasImage, silent = false): Promise<boolean> => {
    const hasCloudPath = image.storagePath || image.originalStoragePath;
    if (!hasCloudPath) return false;

    try {
      const pathIsDng = (p: string | undefined) => p?.toLowerCase().endsWith('.dng') ?? false;
      const isDngSource = image.originalStoragePath && pathIsDng(image.originalStoragePath);

      if (isDngSource && image.originalStoragePath) {
        if (!silent) alert('Decoding DNG at full resolution... This may take 10-20 seconds.');
        try {
          const signedUrlResponse = await fetch('/api/signed-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bucket: 'originals', path: image.originalStoragePath }),
          });
          if (!signedUrlResponse.ok) {
            const err = await signedUrlResponse.json();
            console.error('Failed to get signed URL:', err);
            if (!silent) alert('Failed to access original DNG. Falling back to preview quality.');
          } else {
            const { signedUrl } = await signedUrlResponse.json();
            const response = await fetch(signedUrl);
            if (!response.ok) throw new Error(`Failed to download DNG: ${response.status}`);
            const dngBlob = await response.blob();
            const arrayBuffer = await dngBlob.arrayBuffer();
            const decoded = await decodeDNG(arrayBuffer, false);
            // Use same canvas filter pipeline as UI so DNG export matches what you see (WYSIWYG)
            const blob = await exportWithCanvasFilters(image, decoded.dataUrl);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${image.id || 'export'}-fullres-${Date.now()}.jpg`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            if (!silent) alert(`Exported at full resolution: ${decoded.width}x${decoded.height}px`);
            return true;
          }
        } catch (dngError) {
          console.error('DNG export error:', dngError);
          if (!silent) alert(`DNG export failed: ${dngError instanceof Error ? dngError.message : 'Unknown error'}. Falling back to preview quality.`);
        }
      }

      // Use client-side canvas filters so export matches the UI (WYSIWYG). Get signed URL and run same pipeline as display.
      const pathToFetch = image.storagePath || image.originalStoragePath;
      const bucket = image.storagePath ? 'photos' : 'originals';
      const signedRes = await fetch('/api/signed-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bucket, path: pathToFetch }),
      });
      if (!signedRes.ok) {
        const err = await signedRes.json();
        throw new Error(err.error || 'Failed to get image URL');
      }
      const { signedUrl } = await signedRes.json();
      const blob = await exportWithCanvasFilters(image, signedUrl);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${image.id || 'export'}-${Date.now()}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return true;
    } catch (error) {
      console.error('Export error:', error);
      if (!silent) alert(`Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return false;
    }
  }, []);

  // Handle export with edits applied (single selected image). Runs in background with progress overlay.
  const handleExport = useCallback(() => {
    const singleId = selectedIds.length === 1 ? selectedIds[0] : null;
    if (!singleId) return;
    const image = images.find(img => img.id === singleId);
    if (!image || !(image.storagePath || image.originalStoragePath)) {
      alert('Cannot export: Image not saved to cloud');
      return;
    }
    setExportProgress({ current: 1, total: 1 });
    (async () => {
      try {
        await exportImageToDownload(image, false);
      } finally {
        setExportProgress(null);
      }
    })();
  }, [selectedIds, images, exportImageToDownload]);

  // Export multiple selected photos with edits (context menu). Runs in background with "Exporting 1 of N" overlay.
  const handleExportSelection = useCallback(() => {
    if (!imageContextMenu) return;
    const ids = imageContextMenu.selectedIds;
    const toExport = ids
      .map((id) => images.find((img) => img.id === id))
      .filter((img): img is CanvasImage => !!img && 'src' in img && !!(img.storagePath || img.originalStoragePath));
    setImageContextMenu(null);
    if (toExport.length === 0) {
      alert('No photos to export. Selected items must be saved to cloud.');
      return;
    }
    const total = toExport.length;
    setExportProgress({ current: 1, total });
    (async () => {
      const delayMs = 400;
      let ok = 0;
      let fail = 0;
      for (let i = 0; i < toExport.length; i++) {
        const success = await exportImageToDownload(toExport[i], true);
        if (success) ok++;
        else fail++;
        if (i < toExport.length - 1) {
          setExportProgress({ current: i + 2, total });
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
      setExportProgress(null);
      if (total > 1 && (ok > 0 || fail > 0)) {
        if (fail === 0) alert(`Exported ${ok} photo${ok === 1 ? '' : 's'}.`);
        else alert(`Exported ${ok} photo${ok === 1 ? '' : 's'}. ${fail} failed.`);
      }
    })();
  }, [imageContextMenu, images, exportImageToDownload]);

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

  // Delete folder and all its photos (no ungroup option)
  const handleDeleteFolder = useCallback(async () => {
    if (!editingFolder) return;

    setIsDeletingFolder(true);
    const folderImageIds = editingFolder.imageIds;

    try {
      // Delete images via API (service role) so photos + originals buckets are removed
      if (user) {
        for (const imgId of folderImageIds) {
          const img = images.find(i => i.id === imgId);
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

      // Remove images from canvas
      setImages((prev) => prev.filter(img => !folderImageIds.includes(img.id)));

      // Delete folder from Supabase
      if (user) {
        try {
          await supabase
            .from('photo_folders')
            .delete()
            .eq('id', editingFolder.id)
            .eq('user_id', user.id);
        } catch (error) {
          console.error('Failed to delete folder:', error);
        }
      }

      setFolders((prev) => prev.filter(f => f.id !== editingFolder.id));
      setEditingFolder(null);
      setEditingFolderName('');
      setFolderNameError('');
      if (user) queryClient.invalidateQueries({ queryKey: ['user-photos', user.id] });
      saveToHistory();
    } finally {
      setIsDeletingFolder(false);
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
  }, [images, user, getDeletePhotoPayload, queryClient, saveToHistory]);

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
  }, [zoomedImageId, stageScale, stagePosition, dimensions.width, dimensions.height, animateView]);

  // Clicking stage background when zoomed: zoom back out (left button only)
  const handleStageMouseDownWithZoom = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    prevMouseDownButtonRef.current = lastMouseDownButtonRef.current;
    lastMouseDownButtonRef.current = e.evt.button;
    const clickedOnEmpty = e.target === e.target.getStage();
    if (zoomedImageId && clickedOnEmpty && e.evt.button === 0) {
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
    handleStageMouseDown(e);
  }, [zoomedImageId, stageScale, stagePosition, animateView, handleStageMouseDown]);

  // Get selected object (only when exactly one selected, for edit panel)
  const selectedObject = selectedIds.length === 1
    ? [...images, ...texts].find((obj) => obj.id === selectedIds[0]) ?? null
    : null;

  return (
    <div className="relative h-full w-full bg-[#0d0d0d]">
      <TopBar
        onUpload={handleFileUpload}
        onRecenter={handleRecenterFolders}
        onUndo={handleUndo}
        onRedo={handleRedo}
        canUndo={historyIndex > 0}
        canRedo={historyIndex < history.length - 1}
        visible={showHeader || folders.length === 0}
      />

      {/* Upload loading indicator */}
      {isUploading && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 bg-[#171717] border border-[#2a2a2a] rounded-xl px-4 py-3 shadow-2xl shadow-black/50">
          <div className="w-5 h-5 border-2 border-[#3ECF8E] border-t-transparent rounded-full animate-spin" />
          <span className="text-white text-sm font-medium">Uploading...</span>
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
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors text-left cursor-pointer ${
                        selectedExistingFolderId === folder.id
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
              className={`w-full px-4 py-3 text-white bg-[#252525] border rounded-xl focus:outline-none transition-colors mb-1 ${
                folderNameError ? 'border-red-500 focus:border-red-500' : 'border-[#333] focus:border-[#3ECF8E] focus:ring-1 focus:ring-[#3ECF8E]/20'
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
                className={`w-full px-4 py-3 text-white bg-[#252525] border rounded-xl focus:outline-none transition-colors ${
                  folderNameError ? 'border-red-500 focus:border-red-500' : 'border-[#333] focus:border-[#3ECF8E] focus:ring-1 focus:ring-[#3ECF8E]/20'
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
                  disabled={isDeletingFolder}
                  className="w-full px-4 py-2.5 text-sm font-medium text-red-400 bg-red-400/10 hover:bg-red-400/20 disabled:opacity-60 disabled:cursor-not-allowed rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-2"
                >
                  {isDeletingFolder ? (
                    <>
                      <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Deleting…
                    </>
                  ) : (
                    editingFolder.imageIds.length > 0 ? 'Delete folder + photos' : 'Delete folder'
                  )}
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
              className={`w-full px-4 py-3 text-white bg-[#252525] border rounded-xl focus:outline-none transition-colors mb-1 ${
                createEmptyFolderNameError ? 'border-red-500 focus:border-red-500' : 'border-[#333] focus:border-[#3ECF8E] focus:ring-1 focus:ring-[#3ECF8E]/20'
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
              className={`w-full px-4 py-3 text-white bg-[#252525] border rounded-xl focus:outline-none transition-colors mb-1 ${
                createFolderFromSelectionNameError ? 'border-red-500 focus:border-red-500' : 'border-[#333] focus:border-[#3ECF8E] focus:ring-1 focus:ring-[#3ECF8E]/20'
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
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
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
            {/* Folder Borders and Labels */}
            {folders.map((folder) => {
              // Calculate folder dimensions
              const folderImages = images.filter(img => folder.imageIds.includes(img.id));
              const { folderPadding } = GRID_CONFIG;
              
              // Get current folder from state to ensure we have latest width
              const currentFolder = folders.find(f => f.id === folder.id) || folder;
              
              // Border starts at folder.x aligned with the label
              const borderX = currentFolder.x;
              const borderY = currentFolder.y + 30; // Start below the label
              const borderWidth = currentFolder.width;
              const borderHeight = getFolderBorderHeight(currentFolder, folderImages.length);
              
              const isHovered = hoveredFolderBorder === currentFolder.id;
              const isResizing = resizingFolderId === currentFolder.id;

              return (
                <Group key={folder.id}>
                  {/* Folder Label (name + plus) - one Group so they scale and move together */}
                  <Group
                    x={currentFolder.x}
                    y={currentFolder.y}
                    draggable
                    listening={true}
                    onMouseEnter={(e) => {
                      const container = e.target.getStage()?.container();
                      if (container) container.style.cursor = 'pointer';
                    }}
                    onMouseLeave={(e) => {
                      const container = e.target.getStage()?.container();
                      if (container && !isDragging) container.style.cursor = 'default';
                    }}
                    onDragStart={() => {
                      folderNameDragRef.current = true;
                    }}
                    onDragMove={(e) => {
                      const newX = e.target.x();
                      const newY = e.target.y();
                      const now = Date.now();

                      const updatedFolders = folders.map((f) =>
                        f.id === currentFolder.id ? { ...f, x: newX, y: newY } : f
                      );

                      const folderImgs = images.filter(img => currentFolder.imageIds.includes(img.id));
                      let updatedImages = [...images];
                      if (folderImgs.length > 0) {
                        const reflowedImages = reflowImagesInFolder(folderImgs, newX, newY, currentFolder.width);
                        updatedImages = images.map((img) => {
                          const reflowed = reflowedImages.find(r => r.id === img.id);
                          return reflowed ? reflowed : img;
                        });
                      }

                      if (now - lastOverlapCheckRef.current >= overlapThrottleMs) {
                        lastOverlapCheckRef.current = now;
                        const { folders: resolvedFolders, images: resolvedImages } = resolveOverlapsAndReflow(
                          updatedFolders,
                          updatedImages,
                          currentFolder.id
                        );
                        setFolders(resolvedFolders);
                        setImages(resolvedImages);
                      } else {
                        setFolders(updatedFolders);
                        setImages(updatedImages);
                      }
                    }}
                    onDragEnd={async () => {
                      setTimeout(() => {
                        folderNameDragRef.current = false;
                      }, 100);

                      const { folders: finalFolders, images: finalImages } = resolveOverlapsAndReflow(
                        folders,
                        images,
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
                      text={currentFolder.name}
                      fontSize={16}
                      fontStyle="600"
                      fill={currentFolder.color}
                      listening={true}
                      onClick={() => handleFolderDoubleClick(currentFolder)}
                      onTap={() => handleFolderDoubleClick(currentFolder)}
                    />
                    <Text
                      x={folderLabelWidths[currentFolder.id] ?? 0}
                      y={2}
                      text=" +"
                      fontSize={16}
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
                    onMouseEnter={() => setHoveredFolderBorder(currentFolder.id)}
                    onMouseLeave={() => {
                      if (!resizingFolderId) setHoveredFolderBorder(null);
                    }}
                  />
                  
                  {/* Resize Handle - Bottom-right corner */}
                  <Rect
                    x={borderX + borderWidth - 20}
                    y={borderY + borderHeight - 20}
                    width={20}
                    height={20}
                    fill={isHovered || isResizing ? currentFolder.color : 'transparent'}
                    opacity={isHovered || isResizing ? 0.6 : 0}
                    cornerRadius={4}
                    draggable
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
                      const now = Date.now();

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

                      // Throttled overlap checking
                      if (now - lastOverlapCheckRef.current >= overlapThrottleMs) {
                        lastOverlapCheckRef.current = now;
                        const { folders: resolvedFolders, images: resolvedImages } = resolveOverlapsAndReflow(
                          updatedFolders,
                          updatedImages,
                          currentFolder.id
                        );
                        setFolders(resolvedFolders);
                        setImages(resolvedImages);
                      } else {
                        setFolders(updatedFolders);
                        setImages(updatedImages);
                      }
                    }}
                    onDragEnd={async (e) => {
                      const container = e.target.getStage()?.container();
                      if (container) container.style.cursor = 'default';
                      setResizingFolderId(null);
                      setHoveredFolderBorder(null);

                      // Get current folder from state (may have been updated during drag)
                      const resizedFolder = folders.find(f => f.id === currentFolder.id);
                      if (!resizedFolder) return;

                      // Get folder images and their current positions
                      const folderImgs = images.filter(img => resizedFolder.imageIds.includes(img.id));
                      const imageCount = folderImgs.length;

                      if (imageCount === 0) {
                        // No images - just finalize
                        const { folders: finalFolders, images: finalImages } = resolveOverlapsAndReflow(
                          folders,
                          images,
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
                      const rowsFromHeight = Math.max(1, Math.floor(availableForCells / CELL_SIZE));

                      // But ensure we have enough rows for all images (minimum needed)
                      const maxRowWithImage = imageCount > 0 ? Math.max(0, ...currentPositions.map(p => p.row)) : 0;
                      const minRowsNeeded = maxRowWithImage + 1;
                      const rows = Math.max(rowsFromHeight, minRowsNeeded);

                      // Calculate snapped width: exact fit for columns with proper padding
                      const snappedWidth = (2 * GRID_CONFIG.folderPadding) + (cols * CELL_SIZE) - GRID_CONFIG.imageGap;

                      // Calculate snapped height: based on rows the user wants (with minimum for images)
                      const snappedContentHeight = (2 * GRID_CONFIG.folderPadding) + (rows * CELL_SIZE) - GRID_CONFIG.imageGap;
                      const snappedHeight = 30 + Math.max(snappedContentHeight, 100);

                      // Check if snapped dimensions would cut off any images
                      const snappedCols = calculateColsFromWidth(snappedWidth);
                      const snappedMaxRows = Math.max(1, Math.floor((snappedHeight - 30 - 2 * GRID_CONFIG.folderPadding + GRID_CONFIG.imageGap) / CELL_SIZE));

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
                      const snappedFolders = folders.map(f =>
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

                      const snappedImages = images.map(img => {
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

            {images.map((img) => (
              <ImageNode
                key={img.id}
                image={img}
                bypassedTabs={bypassedTabs}
                onClick={handleObjectClick}
                onDblClick={(e) => handleImageDoubleClick(img, e)}
                onContextMenu={handleImageContextMenu}
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
              .filter((img) => selectedIds.includes(img.id))
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

      {/* Right-click context menu on empty canvas: Create folder */}
      {canvasContextMenu && (
        <div
          ref={canvasContextMenuRef}
          className="fixed z-50 min-w-[160px] py-1 bg-[#171717] border border-[#2a2a2a] rounded-xl shadow-2xl shadow-black/50"
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
        </div>
      )}

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
              {user && (
                <button
                  type="button"
                  onClick={handleCreatePresetClick}
                  className="w-full px-4 py-2.5 text-left text-sm text-white hover:bg-[#252525] transition-colors border-t border-[#2a2a2a]"
                >
                  Create preset…
                </button>
              )}
            </>
          )}
        </div>
      )}

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

      {selectedObject && (
        <EditPanel
          object={selectedObject}
          onUpdate={(updates) => {
            if ('src' in selectedObject) {
              setImages((prev) =>
                prev.map((img) => (img.id === selectedIds[0] ? { ...img, ...updates } : img))
              );
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
            setBypassedTabs(prev => {
              const next = new Set(prev);
              if (next.has(tab)) {
                next.delete(tab);
              } else {
                next.add(tab);
              }
              return next;
            });
          }}
        />
      )}

    </div>
  );
}

// Custom brightness filter that multiplies instead of adds (prevents black screens)
// Uses pre-computed LUT for maximum performance
const createBrightnessFilter = (brightness: number) => {
  // Pre-compute 256-entry lookup table
  const lut = new Uint8ClampedArray(256);
  const factor = 1 + brightness;
  for (let i = 0; i < 256; i++) {
    lut[i] = i * factor; // Uint8ClampedArray auto-clamps to 0-255
  }

  return function(imageData: ImageData) {
    const data = imageData.data;
    const len = data.length;
    for (let i = 0; i < len; i += 4) {
      data[i] = lut[data[i]];
      data[i + 1] = lut[data[i + 1]];
      data[i + 2] = lut[data[i + 2]];
    }
  };
};

// Exposure filter - like brightness but uses power curve for more natural look
// Uses pre-computed LUT for maximum performance
const createExposureFilter = (exposure: number) => {
  // Pre-compute 256-entry lookup table
  const lut = new Uint8ClampedArray(256);
  const factor = Math.pow(2, exposure);
  for (let i = 0; i < 256; i++) {
    lut[i] = i * factor; // Uint8ClampedArray auto-clamps to 0-255
  }

  return function(imageData: ImageData) {
    const data = imageData.data;
    const len = data.length;
    for (let i = 0; i < len; i += 4) {
      data[i] = lut[data[i]];
      data[i + 1] = lut[data[i + 1]];
      data[i + 2] = lut[data[i + 2]];
    }
  };
};

// Tonal filter for highlights, shadows, whites, blacks
const createTonalFilter = (highlights: number, shadows: number, whites: number, blacks: number) => {
  const lut = new Uint8ClampedArray(256);

  for (let i = 0; i < 256; i++) {
    let val = i / 255;

    // Blacks: 0-25%
    if (val < 0.25) {
      const blackMask = 1 - val / 0.25;
      val += blacks * 0.3 * blackMask;
    }

    // Shadows: 0-50% (slightly more aggressive than other tonals)
    const shadowMask = val < 0.5 ? Math.sin(val * Math.PI) : 0;
    val += shadows * 0.12 * shadowMask;

    // Highlights: 50-100%
    const highlightMask = val > 0.5 ? Math.sin((val - 0.5) * Math.PI) : 0;
    val += highlights * 0.3 * highlightMask;

    // Whites: 75-100%
    if (val > 0.75) {
      const whiteMask = (val - 0.75) / 0.25;
      val += whites * 0.3 * whiteMask;
    }

    lut[i] = Math.max(0, Math.min(1, val)) * 255;
  }

  return function(imageData: ImageData) {
    const data = imageData.data;
    const len = data.length;
    for (let i = 0; i < len; i += 4) {
      data[i] = lut[data[i]];
      data[i + 1] = lut[data[i + 1]];
      data[i + 2] = lut[data[i + 2]];
    }
  };
};

// Temperature filter - warm/cool white balance
const createTemperatureFilter = (temperature: number) => {
  const tempFactor = temperature * 30;
  const redLut = new Uint8ClampedArray(256);
  const blueLut = new Uint8ClampedArray(256);

  for (let i = 0; i < 256; i++) {
    redLut[i] = i + tempFactor;
    blueLut[i] = i - tempFactor;
  }

  return function(imageData: ImageData) {
    const data = imageData.data;
    const len = data.length;
    for (let i = 0; i < len; i += 4) {
      data[i] = redLut[data[i]];
      data[i + 2] = blueLut[data[i + 2]];
    }
  };
};

// Vibrance filter - smart saturation (boosts muted colors more)
const createVibranceFilter = (vibrance: number) => {
  const amt = vibrance * 1.5;
  const rCoef = 0.299;
  const gCoef = 0.587;
  const bCoef = 0.114;

  return function(imageData: ImageData) {
    const data = imageData.data;
    const len = data.length;

    for (let i = 0; i < len; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const max = r > g ? (r > b ? r : b) : (g > b ? g : b);
      const min = r < g ? (r < b ? r : b) : (g < b ? g : b);

      if (max === 0) continue;

      const sat = (max - min) / max;
      const factor = 1 + amt * (1 - sat);
      const gray = rCoef * r + gCoef * g + bCoef * b;

      const nr = gray + (r - gray) * factor;
      const ng = gray + (g - gray) * factor;
      const nb = gray + (b - gray) * factor;

      data[i] = nr < 0 ? 0 : nr > 255 ? 255 : nr;
      data[i + 1] = ng < 0 ? 0 : ng > 255 ? 255 : ng;
      data[i + 2] = nb < 0 ? 0 : nb > 255 ? 255 : nb;
    }
  };
};

// Clarity filter - midtone contrast
const createClarityFilter = (clarity: number) => {
  const lut = new Uint8ClampedArray(256);
  const factor = 1 + clarity * 0.5;

  for (let i = 0; i < 256; i++) {
    const val = i / 255;
    const diff = val - 0.5;
    const weight = 1 - Math.abs(diff) * 1.5;
    const newVal = 0.5 + diff * (1 + (factor - 1) * Math.max(0, weight));
    lut[i] = Math.max(0, Math.min(1, newVal)) * 255;
  }

  return function(imageData: ImageData) {
    const data = imageData.data;
    const len = data.length;
    for (let i = 0; i < len; i += 4) {
      data[i] = lut[data[i]];
      data[i + 1] = lut[data[i + 1]];
      data[i + 2] = lut[data[i + 2]];
    }
  };
};

// Dehaze filter - contrast and saturation boost
const createDehazeFilter = (dehaze: number) => {
  const contrastBoost = 1 + dehaze * 0.5;
  const satBoost = 1 + dehaze * 0.3;
  const rCoef = 0.299, gCoef = 0.587, bCoef = 0.114;

  return function(imageData: ImageData) {
    const data = imageData.data;
    const len = data.length;

    for (let i = 0; i < len; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];

      let nr = 128 + (r - 128) * contrastBoost;
      let ng = 128 + (g - 128) * contrastBoost;
      let nb = 128 + (b - 128) * contrastBoost;

      const ngray = rCoef * nr + gCoef * ng + bCoef * nb;
      nr = ngray + (nr - ngray) * satBoost;
      ng = ngray + (ng - ngray) * satBoost;
      nb = ngray + (nb - ngray) * satBoost;

      data[i] = nr < 0 ? 0 : nr > 255 ? 255 : nr;
      data[i + 1] = ng < 0 ? 0 : ng > 255 ? 255 : ng;
      data[i + 2] = nb < 0 ? 0 : nb > 255 ? 255 : nb;
    }
  };
};

// Vignette filter - darken edges
const createVignetteFilter = (vignette: number) => {
  let falloffMap: Float32Array | null = null;
  let lastWidth = 0;
  let lastHeight = 0;

  return function(imageData: ImageData) {
    const data = imageData.data;
    const w = imageData.width;
    const h = imageData.height;

    if (w !== lastWidth || h !== lastHeight) {
      lastWidth = w;
      lastHeight = h;
      falloffMap = new Float32Array(w * h);

      const cx = w * 0.5;
      const cy = h * 0.5;
      const maxDistSq = cx * cx + cy * cy;

      for (let y = 0; y < h; y++) {
        const dy = y - cy;
        const dySq = dy * dy;
        const rowOffset = y * w;

        for (let x = 0; x < w; x++) {
          const dx = x - cx;
          const distSq = (dx * dx + dySq) / maxDistSq;
          const falloff = distSq * vignette;
          falloffMap[rowOffset + x] = falloff < 1 ? 1 - falloff : 0;
        }
      }
    }

    const map = falloffMap!;
    const pixelCount = w * h;

    for (let p = 0; p < pixelCount; p++) {
      const i = p * 4;
      const factor = map[p];
      data[i] *= factor;
      data[i + 1] *= factor;
      data[i + 2] *= factor;
    }
  };
};

// Grain filter - add noise
const createGrainFilter = (grain: number) => {
  const intensity = grain * 50;
  const patternSize = 4096;
  const noisePattern = new Int8Array(patternSize);
  for (let i = 0; i < patternSize; i++) {
    noisePattern[i] = ((Math.random() - 0.5) * intensity) | 0;
  }

  return function(imageData: ImageData) {
    const data = imageData.data;
    const len = data.length;
    let offset = (Math.random() * patternSize) | 0;

    for (let i = 0; i < len; i += 4) {
      const noise = noisePattern[offset];
      offset = (offset + 1) % patternSize;

      const r = data[i] + noise;
      const g = data[i + 1] + noise;
      const b = data[i + 2] + noise;

      data[i] = r < 0 ? 0 : r > 255 ? 255 : r;
      data[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
      data[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
    }
  };
};

// Build a lookup table from curve points (identity = no change when default two points)
const buildLUT = (points: CurvePoint[]): Uint8Array => {
  const lut = new Uint8Array(256);
  if (points.length === 2) {
    const sorted = [...points].sort((a, b) => a.x - b.x);
    if (sorted[0].x === 0 && sorted[0].y === 0 && sorted[1].x === 255 && sorted[1].y === 255) {
      for (let i = 0; i < 256; i++) lut[i] = i;
      return lut;
    }
  }
  const sorted = [...points].sort((a, b) => a.x - b.x);

  // Interpolation function using Catmull-Rom spline
  const interpolate = (x: number): number => {
    if (sorted.length === 0) return x;
    if (sorted.length === 1) return sorted[0].y;
    if (x <= sorted[0].x) return sorted[0].y;
    if (x >= sorted[sorted.length - 1].x) return sorted[sorted.length - 1].y;

    let i = 0;
    while (i < sorted.length - 1 && sorted[i + 1].x < x) i++;

    const p0 = sorted[Math.max(0, i - 1)];
    const p1 = sorted[i];
    const p2 = sorted[Math.min(sorted.length - 1, i + 1)];
    const p3 = sorted[Math.min(sorted.length - 1, i + 2)];

    const t = (x - p1.x) / (p2.x - p1.x || 1);
    const t2 = t * t;
    const t3 = t2 * t;

    const y = 0.5 * (
      (2 * p1.y) +
      (-p0.y + p2.y) * t +
      (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
      (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
    );

    return Math.max(0, Math.min(255, Math.round(y)));
  };

  // Build lookup table
  for (let i = 0; i < 256; i++) {
    lut[i] = interpolate(i);
  }

  return lut;
};

// Curve strength: 1 = full effect, lower = gentler (blend with original)
const CURVES_STRENGTH = 0.6;

// Custom curves filter using lookup tables for RGB + individual channels
const createCurvesFilter = (curves: ChannelCurves) => {
  // Pre-compute lookup tables for each channel
  const rgbLUT = buildLUT(curves.rgb);
  const redLUT = buildLUT(curves.red);
  const greenLUT = buildLUT(curves.green);
  const blueLUT = buildLUT(curves.blue);
  const s = CURVES_STRENGTH;

  return function(imageData: ImageData) {
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const origR = data[i];
      const origG = data[i + 1];
      const origB = data[i + 2];
      const curvedR = redLUT[rgbLUT[origR]];
      const curvedG = greenLUT[rgbLUT[origG]];
      const curvedB = blueLUT[rgbLUT[origB]];
      data[i] = Math.round((1 - s) * origR + s * curvedR);
      data[i + 1] = Math.round((1 - s) * origG + s * curvedG);
      data[i + 2] = Math.round((1 - s) * origB + s * curvedB);
    }
  };
};

// Konva Contrast exact formula: adjust = ((contrast+100)/100)^2, then (val/255-0.5)*adjust+0.5. Node gets contrast in -100..100; we pass image.contrast*25.
const createContrastFilterParam = (konvaContrastValue: number) => {
  const adjust = Math.pow((konvaContrastValue + 100) / 100, 2);
  return function(imageData: ImageData) {
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      let r = data[i] / 255 - 0.5; r = (r * adjust + 0.5) * 255; data[i] = r < 0 ? 0 : r > 255 ? 255 : r;
      let g = data[i + 1] / 255 - 0.5; g = (g * adjust + 0.5) * 255; data[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
      let b = data[i + 2] / 255 - 0.5; b = (b * adjust + 0.5) * 255; data[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
    }
  };
};

// Konva HSV exact formula: 3x3 RGB matrix from v=2^value(), s=2^saturation(), h=hue°; we only set saturation and hue (value=0). Node: saturation = image.saturation*2, hue = image.hue*180.
const createHSVFilterParam = (saturationValue: number, hueValue: number) => {
  const v = Math.pow(2, 0); // value not set on node
  const s = Math.pow(2, saturationValue);
  const h = Math.abs(hueValue + 360) % 360;
  const vsu = v * s * Math.cos((h * Math.PI) / 180);
  const vsw = v * s * Math.sin((h * Math.PI) / 180);
  const rr = 0.299 * v + 0.701 * vsu + 0.167 * vsw;
  const rg = 0.587 * v - 0.587 * vsu + 0.33 * vsw;
  const rb = 0.114 * v - 0.114 * vsu - 0.497 * vsw;
  const gr = 0.299 * v - 0.299 * vsu - 0.328 * vsw;
  const gg = 0.587 * v + 0.413 * vsu + 0.035 * vsw;
  const gb = 0.114 * v - 0.114 * vsu + 0.293 * vsw;
  const br = 0.299 * v - 0.3 * vsu + 1.25 * vsw;
  const bg = 0.587 * v - 0.586 * vsu - 1.05 * vsw;
  const bb = 0.114 * v + 0.886 * vsu - 0.2 * vsw;
  return function(imageData: ImageData) {
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const nr = rr * r + rg * g + rb * b;
      const ng = gr * r + gg * g + gb * b;
      const nb = br * r + bg * g + bb * b;
      data[i] = nr < 0 ? 0 : nr > 255 ? 255 : nr;
      data[i + 1] = ng < 0 ? 0 : ng > 255 ? 255 : ng;
      data[i + 2] = nb < 0 ? 0 : nb > 255 ? 255 : nb;
    }
  };
};

// Build filter list for export - same order and logic as canvas display (no Konva node, no bypass). Omit blur; applied via ctx.filter.
function buildExportFilterList(image: CanvasImage): ((imageData: ImageData) => void)[] {
  const list: ((imageData: ImageData) => void)[] = [];
  const isCurvesModified = (): boolean => {
    if (!image.curves) return false;
    const ch = (points: CurvePoint[]) => {
      if (!points || points.length === 0) return false;
      if (points.length > 2) return true;
      return points.some((p, i) => (i === 0 ? p.x !== 0 || p.y !== 0 : i === points.length - 1 ? p.x !== 255 || p.y !== 255 : true));
    };
    return ch(image.curves.rgb) || ch(image.curves.red) || ch(image.curves.green) || ch(image.curves.blue);
  };
  if (isCurvesModified() && image.curves) list.push(createCurvesFilter(image.curves));
  if (image.exposure !== 0) list.push(createExposureFilter(image.exposure));
  if (image.highlights !== 0 || image.shadows !== 0 || image.whites !== 0 || image.blacks !== 0)
    list.push(createTonalFilter(image.highlights, image.shadows, image.whites, image.blacks));
  if (image.clarity !== 0) list.push(createClarityFilter(image.clarity));
  if (image.brightness !== 0) list.push(createBrightnessFilter(image.brightness));
  if (image.contrast !== 0) list.push(createContrastFilterParam(image.contrast * 25));
  if (image.temperature !== 0) list.push(createTemperatureFilter(image.temperature));
  if (image.saturation !== 0 || image.hue !== 0) list.push(createHSVFilterParam(image.saturation * 2, image.hue * 180));
  if (image.vibrance !== 0) list.push(createVibranceFilter(image.vibrance));
  if (image.colorHSL && Object.values(image.colorHSL).some((a) => a && ((a.hue ?? 0) !== 0 || (a.saturation ?? 0) !== 0 || (a.luminance ?? 0) !== 0)))
    list.push(createHSLColorFilter(image.colorHSL));
  if (image.splitToning) list.push(createSplitToningFilter(image.splitToning));
  if (image.shadowTint !== undefined && image.shadowTint !== 0) list.push(createShadowTintFilter(image.shadowTint));
  if (image.colorGrading) list.push(createColorGradingFilter(image.colorGrading));
  if (image.colorCalibration) list.push(createColorCalibrationFilter(image.colorCalibration));
  if (image.dehaze !== 0) list.push(createDehazeFilter(image.dehaze));
  if (image.vignette !== 0) list.push(createVignetteFilter(image.vignette));
  if (image.grain !== 0) list.push(createGrainFilter(image.grain));
  // Blur: use Konva's exact Gaussian blur (same as canvas) instead of ctx.filter
  if (image.blur > 0) {
    const radius = Math.round(image.blur * 20);
    list.push((imageData: ImageData) => {
      const mock = { blurRadius: () => radius };
      (Konva.Filters.Blur as (this: { blurRadius(): number }, id: ImageData) => void).call(mock, imageData);
    });
  }
  if (image.filters?.includes('grayscale')) list.push((id: ImageData) => { (Konva.Filters.Grayscale as (id: ImageData) => void)(id); });
  if (image.filters?.includes('sepia')) list.push((id: ImageData) => { (Konva.Filters.Sepia as (id: ImageData) => void)(id); });
  if (image.filters?.includes('invert')) list.push((id: ImageData) => { (Konva.Filters.Invert as (id: ImageData) => void)(id); });
  return list;
}

// Export using the same filter pipeline as the canvas (WYSIWYG). Load image from URL, apply filters, return JPEG blob.
async function exportWithCanvasFilters(image: CanvasImage, imageUrl: string): Promise<Blob> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.crossOrigin = 'anonymous';
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Failed to load image'));
    el.src = imageUrl;
  });
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D not available');
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, w, h);
  const filters = buildExportFilterList(image);
  for (const f of filters) f(imageData);
  ctx.putImageData(imageData, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), 'image/jpeg', 0.95);
  });
}

// HSL color adjustment filter - applies hue/sat/lum shifts with smooth color blending like Lightroom
// Optimized with pre-computed lookup tables for all 360 hue values
const createHSLColorFilter = (colorHSL: ColorHSL) => {
  // Color center hues (in degrees) - matches Lightroom's HSL panel
  const colorCenters: { name: keyof ColorHSL; center: number }[] = [
    { name: 'red', center: 0 },
    { name: 'orange', center: 30 },
    { name: 'yellow', center: 60 },
    { name: 'green', center: 120 },
    { name: 'aqua', center: 180 },
    { name: 'blue', center: 225 },
    { name: 'purple', center: 270 },
    { name: 'magenta', center: 315 },
  ];

  // Calculate weight for a color based on hue distance (smooth falloff)
  const getColorWeight = (hue360: number, centerHue: number): number => {
    let diff = Math.abs(hue360 - centerHue);
    if (diff > 180) diff = 360 - diff; // Handle wrap-around
    // Use a smooth falloff - full weight within 15°, fades to 0 at 45°
    if (diff <= 15) return 1;
    if (diff >= 45) return 0;
    return 1 - (diff - 15) / 30; // Linear falloff between 15° and 45°
  };

  // PRE-COMPUTE: Build lookup tables for all 360 hue values
  // This moves the expensive per-color weight calculation out of the hot loop
  const hueLUT = new Float32Array(360); // Pre-computed hue adjustments
  const satLUT = new Float32Array(360); // Pre-computed saturation adjustments
  const lumLUT = new Float32Array(360); // Pre-computed luminance adjustments

  for (let hue = 0; hue < 360; hue++) {
    let totalHueAdj = 0;
    let totalSatAdj = 0;
    let totalLumAdj = 0;
    let totalWeight = 0;

    for (const { name, center } of colorCenters) {
      const weight = getColorWeight(hue, center);
      if (weight <= 0) continue;

      const adj = colorHSL[name];
      if (!adj) continue;

      totalHueAdj += (adj.hue ?? 0) * weight;
      totalSatAdj += (adj.saturation ?? 0) * weight;
      totalLumAdj += (adj.luminance ?? 0) * weight;
      totalWeight += weight;
    }

    if (totalWeight > 0) {
      hueLUT[hue] = totalHueAdj / totalWeight;
      satLUT[hue] = totalSatAdj / totalWeight;
      lumLUT[hue] = totalLumAdj / totalWeight;
    }
  }

  // Basic strength values
  const hueStrength = 0.2;
  const satStrength = 0.5;
  const lumStrength = 0.3;

  return function(imageData: ImageData) {
    const data = imageData.data;
    const len = data.length;

    for (let i = 0; i < len; i += 4) {
      const r = data[i] / 255;
      const g = data[i + 1] / 255;
      const b = data[i + 2] / 255;

      // Convert RGB to HSL (optimized)
      const max = r > g ? (r > b ? r : b) : (g > b ? g : b);
      const min = r < g ? (r < b ? r : b) : (g < b ? g : b);
      const l = (max + min) * 0.5;

      if (max === min) continue; // Skip grays

      const d = max - min;
      const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

      // Skip low-saturation pixels
      if (s < 0.05) continue;

      let h: number;
      if (max === r) {
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      } else if (max === g) {
        h = ((b - r) / d + 2) / 6;
      } else {
        h = ((r - g) / d + 4) / 6;
      }

      // Use integer hue for LUT lookup (0-359)
      const hueIdx = (h * 360) | 0; // Fast floor using bitwise OR

      // Get pre-computed adjustments from LUT
      const hueAdj = hueLUT[hueIdx];
      const satAdj = satLUT[hueIdx];
      const lumAdj = lumLUT[hueIdx];

      // Skip if adjustments are negligible
      if (hueAdj === 0 && satAdj === 0 && lumAdj === 0) continue;

      // Apply hue shift
      let newH = h + (hueAdj / 100) * hueStrength;
      if (newH < 0) newH += 1;
      else if (newH > 1) newH -= 1;

      // Apply saturation adjustment
      let newS = s;
      if (satAdj > 0) {
        newS = s + (1 - s) * (satAdj / 100) * satStrength;
      } else {
        newS = s * (1 + (satAdj / 100) * satStrength);
      }
      // Clamp saturation
      if (newS < 0) newS = 0;
      else if (newS > 1) newS = 1;

      // Apply luminance adjustment
      let newL = l;
      if (lumAdj > 0) {
        newL = l + (1 - l) * (lumAdj / 100) * lumStrength;
      } else if (lumAdj < 0) {
        newL = l * (1 + (lumAdj / 100) * lumStrength);
      }
      // Clamp luminance
      if (newL < 0) newL = 0;
      else if (newL > 1) newL = 1;

      // Convert HSL back to RGB (optimized)
      let newR: number, newG: number, newB: number;
      if (newS === 0) {
        newR = newG = newB = newL;
      } else {
        const q = newL < 0.5 ? newL * (1 + newS) : newL + newS - newL * newS;
        const p = 2 * newL - q;

        // Inline hue2rgb for performance
        let t = newH + 1/3;
        if (t > 1) t -= 1;
        if (t < 1/6) newR = p + (q - p) * 6 * t;
        else if (t < 1/2) newR = q;
        else if (t < 2/3) newR = p + (q - p) * (2/3 - t) * 6;
        else newR = p;

        t = newH;
        if (t < 1/6) newG = p + (q - p) * 6 * t;
        else if (t < 1/2) newG = q;
        else if (t < 2/3) newG = p + (q - p) * (2/3 - t) * 6;
        else newG = p;

        t = newH - 1/3;
        if (t < 0) t += 1;
        if (t < 1/6) newB = p + (q - p) * 6 * t;
        else if (t < 1/2) newB = q;
        else if (t < 2/3) newB = p + (q - p) * (2/3 - t) * 6;
        else newB = p;
      }

      data[i] = newR * 255;
      data[i + 1] = newG * 255;
      data[i + 2] = newB * 255;
    }
  };
};

// Split Toning filter - adds color to shadows and highlights
const createSplitToningFilter = (splitToning: SplitToning) => {
  return function(imageData: ImageData) {
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] / 255;
      const g = data[i + 1] / 255;
      const b = data[i + 2] / 255;

      // Calculate luminance
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;

      // Determine if this is shadow or highlight based on balance
      const balanceFactor = (splitToning.balance + 100) / 200; // -100 to +100 -> 0 to 1
      const isShadow = lum < balanceFactor;

      const hue = isShadow ? splitToning.shadowHue : splitToning.highlightHue;
      const saturation = (isShadow ? splitToning.shadowSaturation : splitToning.highlightSaturation) / 100;

      if (saturation > 0) {
        // Convert hue to RGB
        const h = hue / 360;
        const hue2rgb = (p: number, q: number, t: number) => {
          if (t < 0) t += 1;
          if (t > 1) t -= 1;
          if (t < 1/6) return p + (q - p) * 6 * t;
          if (t < 1/2) return q;
          if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
          return p;
        };

        const q = lum < 0.5 ? lum * (1 + saturation) : lum + saturation - lum * saturation;
        const p = 2 * lum - q;

        const toneR = hue2rgb(p, q, h + 1/3);
        const toneG = hue2rgb(p, q, h);
        const toneB = hue2rgb(p, q, h - 1/3);

        // Blend with original based on saturation strength
        const blend = isShadow ? (1 - lum) : lum; // Stronger effect in shadows or highlights
        const blendAmount = saturation * blend;

        data[i] = Math.max(0, Math.min(255, (r * (1 - blendAmount) + toneR * blendAmount) * 255));
        data[i + 1] = Math.max(0, Math.min(255, (g * (1 - blendAmount) + toneG * blendAmount) * 255));
        data[i + 2] = Math.max(0, Math.min(255, (b * (1 - blendAmount) + toneB * blendAmount) * 255));
      }
    }
  };
};

// Shadow Tint filter - adds green/magenta tint to shadows
const createShadowTintFilter = (tint: number) => {
  return function(imageData: ImageData) {
    const data = imageData.data;
    const tintAmount = tint; // -100 to +100 (green to magenta)

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] / 255;
      const g = data[i + 1] / 255;
      const b = data[i + 2] / 255;

      // Calculate luminance
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;

      // Apply tint more strongly to darker pixels
      const shadowStrength = Math.max(0, 1 - lum); // 0 in highlights, 1 in shadows
      const tintStrength = (Math.abs(tintAmount) / 100) * shadowStrength * 0.3; // Max 30% shift

      if (tintAmount > 0) {
        // Magenta tint (add red and blue, reduce green)
        data[i] = Math.min(255, data[i] + tintStrength * 255);
        data[i + 1] = Math.max(0, data[i + 1] - tintStrength * 255);
        data[i + 2] = Math.min(255, data[i + 2] + tintStrength * 255);
      } else {
        // Green tint (add green, reduce red and blue)
        data[i] = Math.max(0, data[i] - tintStrength * 255);
        data[i + 1] = Math.min(255, data[i + 1] + tintStrength * 255);
        data[i + 2] = Math.max(0, data[i + 2] - tintStrength * 255);
      }
    }
  };
};

// Color Grading filter - applies color grading to shadows, midtones, and highlights
const createColorGradingFilter = (colorGrading: ColorGrading) => {
  return function(imageData: ImageData) {
    const data = imageData.data;
    const blending = colorGrading.blending / 100; // 0-100 -> 0-1

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] / 255;
      const g = data[i + 1] / 255;
      const b = data[i + 2] / 255;

      // Calculate luminance
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;

      // Determine shadow/midtone/highlight weights using smooth curves
      const shadowWeight = Math.max(0, 1 - lum * 2); // Peaks at 0, fades by 0.5
      const highlightWeight = Math.max(0, lum * 2 - 1); // Peaks at 1, fades by 0.5
      const midtoneWeight = 1 - Math.abs(lum - 0.5) * 2; // Peaks at 0.5

      // Apply luminance adjustments
      let finalLum = lum;
      finalLum += (colorGrading.shadowLum / 100) * shadowWeight * 0.5;
      finalLum += (colorGrading.midtoneLum / 100) * midtoneWeight * 0.5;
      finalLum += (colorGrading.highlightLum / 100) * highlightWeight * 0.5;
      finalLum += (colorGrading.globalLum / 100) * 0.5;

      // Apply midtone color if saturation > 0
      if (colorGrading.midtoneSat > 0 && midtoneWeight > 0) {
        const h = colorGrading.midtoneHue / 360;
        const s = (colorGrading.midtoneSat / 100) * midtoneWeight;

        const hue2rgb = (p: number, q: number, t: number) => {
          if (t < 0) t += 1;
          if (t > 1) t -= 1;
          if (t < 1/6) return p + (q - p) * 6 * t;
          if (t < 1/2) return q;
          if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
          return p;
        };

        const q = finalLum < 0.5 ? finalLum * (1 + s) : finalLum + s - finalLum * s;
        const p = 2 * finalLum - q;

        const toneR = hue2rgb(p, q, h + 1/3);
        const toneG = hue2rgb(p, q, h);
        const toneB = hue2rgb(p, q, h - 1/3);

        data[i] = Math.max(0, Math.min(255, (r * (1 - s * blending) + toneR * s * blending) * 255));
        data[i + 1] = Math.max(0, Math.min(255, (g * (1 - s * blending) + toneG * s * blending) * 255));
        data[i + 2] = Math.max(0, Math.min(255, (b * (1 - s * blending) + toneB * s * blending) * 255));
      } else {
        // Just apply luminance changes
        const lumChange = finalLum - lum;
        data[i] = Math.max(0, Math.min(255, (r + lumChange) * 255));
        data[i + 1] = Math.max(0, Math.min(255, (g + lumChange) * 255));
        data[i + 2] = Math.max(0, Math.min(255, (b + lumChange) * 255));
      }

      // Apply global color if saturation > 0
      if (colorGrading.globalSat > 0) {
        const r = data[i] / 255;
        const g = data[i + 1] / 255;
        const b = data[i + 2] / 255;
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;

        const h = colorGrading.globalHue / 360;
        const s = (colorGrading.globalSat / 100) * blending;

        const hue2rgb = (p: number, q: number, t: number) => {
          if (t < 0) t += 1;
          if (t > 1) t -= 1;
          if (t < 1/6) return p + (q - p) * 6 * t;
          if (t < 1/2) return q;
          if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
          return p;
        };

        const q = lum < 0.5 ? lum * (1 + s) : lum + s - lum * s;
        const p = 2 * lum - q;

        const toneR = hue2rgb(p, q, h + 1/3);
        const toneG = hue2rgb(p, q, h);
        const toneB = hue2rgb(p, q, h - 1/3);

        data[i] = Math.max(0, Math.min(255, (r * (1 - s) + toneR * s) * 255));
        data[i + 1] = Math.max(0, Math.min(255, (g * (1 - s) + toneG * s) * 255));
        data[i + 2] = Math.max(0, Math.min(255, (b * (1 - s) + toneB * s) * 255));
      }
    }
  };
};

// Color Calibration filter - adjusts the hue and saturation of RGB primaries
const createColorCalibrationFilter = (colorCal: ColorCalibration) => {
  return function(imageData: ImageData) {
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
      let r = data[i] / 255;
      let g = data[i + 1] / 255;
      let b = data[i + 2] / 255;

      // Determine which primary color is dominant
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const delta = max - min;

      if (delta > 0.01) { // Only apply to non-gray pixels
        // Calculate hue (0-360)
        let hue = 0;
        if (max === r) {
          hue = ((g - b) / delta) % 6;
        } else if (max === g) {
          hue = (b - r) / delta + 2;
        } else {
          hue = (r - g) / delta + 4;
        }
        hue = (hue * 60 + 360) % 360;

        // Determine which primary this pixel belongs to and blend weights
        const redWeight = hue < 60 || hue > 300 ? 1 - Math.abs((hue < 60 ? hue : hue - 360) - 0) / 60 : 0;
        const greenWeight = hue >= 60 && hue < 180 ? 1 - Math.abs(hue - 120) / 60 : 0;
        const blueWeight = hue >= 180 && hue < 300 ? 1 - Math.abs(hue - 240) / 60 : 0;

        // Apply hue shifts
        const hueShift = (redWeight * colorCal.redHue +
                          greenWeight * colorCal.greenHue +
                          blueWeight * colorCal.blueHue) / 100 * 30; // Scale to reasonable range

        // Apply saturation adjustments
        const satShift = (redWeight * colorCal.redSaturation +
                          greenWeight * colorCal.greenSaturation +
                          blueWeight * colorCal.blueSaturation) / 100;

        // Convert to HSL
        const l = (max + min) / 2;
        const s = delta / (1 - Math.abs(2 * l - 1));

        // Apply adjustments
        const newHue = (hue + hueShift + 360) % 360;
        const newSat = Math.max(0, Math.min(1, s * (1 + satShift)));

        // Convert back to RGB
        const c = (1 - Math.abs(2 * l - 1)) * newSat;
        const x = c * (1 - Math.abs(((newHue / 60) % 2) - 1));
        const m = l - c / 2;

        let r1 = 0, g1 = 0, b1 = 0;
        if (newHue < 60) { r1 = c; g1 = x; b1 = 0; }
        else if (newHue < 120) { r1 = x; g1 = c; b1 = 0; }
        else if (newHue < 180) { r1 = 0; g1 = c; b1 = x; }
        else if (newHue < 240) { r1 = 0; g1 = x; b1 = c; }
        else if (newHue < 300) { r1 = x; g1 = 0; b1 = c; }
        else { r1 = c; g1 = 0; b1 = x; }

        r = r1 + m;
        g = g1 + m;
        b = b1 + m;
      }

      data[i] = Math.max(0, Math.min(255, r * 255));
      data[i + 1] = Math.max(0, Math.min(255, g * 255));
      data[i + 2] = Math.max(0, Math.min(255, b * 255));
    }
  };
};

// Image node component - memoized to prevent unnecessary re-renders
// Uses fast Konva filters with pre-computed LUTs for real-time editing
const ImageNode = React.memo(function ImageNode({
  image,
  onClick,
  onDblClick,
  onContextMenu,
  onDragEnd,
  onDragMove,
  onUpdate,
  bypassedTabs,
}: {
  image: CanvasImage;
  onClick: (e: Konva.KonvaEventObject<MouseEvent>) => void;
  onDblClick?: (e: Konva.KonvaEventObject<MouseEvent>) => void;
  onContextMenu?: (e: Konva.KonvaEventObject<PointerEvent>, imageId: string) => void;
  onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragMove?: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onUpdate: (updates: Partial<CanvasImage>) => void;
  bypassedTabs?: Set<'curves' | 'light' | 'color' | 'effects'>;
}) {
  const [img, imgStatus] = useImage(image.src, 'anonymous');
  const imageRef = useRef<Konva.Image>(null);
  const prevPosRef = useRef({ x: image.x, y: image.y });
  const isDraggingRef = useRef(false);
  const cacheTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Sync position when x/y change from state (e.g. after drop) – no animation, drop into place
  useEffect(() => {
    const node = imageRef.current;
    if (!node || isDraggingRef.current) return;

    const newX = image.x;
    const newY = image.y;
    const prevX = prevPosRef.current.x;
    const prevY = prevPosRef.current.y;

    if (Math.abs(newX - prevX) > 0.5 || Math.abs(newY - prevY) > 0.5) {
      node.position({ x: newX, y: newY });
      prevPosRef.current = { x: newX, y: newY };
    }
  }, [image.x, image.y]);

  // Check if curves are modified
  const isCurvesModified = useMemo(() => {
    if (!image.curves) return false;
    const isChannelModified = (points: CurvePoint[]) => {
      if (!points || points.length === 0) return false;
      if (points.length > 2) return true;
      return points.some((p, i) => {
        if (i === 0) return p.x !== 0 || p.y !== 0;
        if (i === points.length - 1) return p.x !== 255 || p.y !== 255;
        return true;
      });
    };
    return (
      isChannelModified(image.curves.rgb) ||
      isChannelModified(image.curves.red) ||
      isChannelModified(image.curves.green) ||
      isChannelModified(image.curves.blue)
    );
  }, [image.curves]);

  // Check if any filters are active
  const hasActiveFilters = useMemo(() =>
    image.exposure !== 0 || image.contrast !== 0 || image.highlights !== 0 ||
    image.shadows !== 0 || image.whites !== 0 || image.blacks !== 0 ||
    image.temperature !== 0 || image.vibrance !== 0 || image.saturation !== 0 ||
    image.clarity !== 0 || image.dehaze !== 0 || image.vignette !== 0 ||
    image.grain !== 0 || image.brightness !== 0 || image.hue !== 0 ||
    image.blur > 0 || image.filters.length > 0 || isCurvesModified ||
    image.colorHSL !== undefined || image.splitToning !== undefined ||
    image.colorGrading !== undefined || image.colorCalibration !== undefined ||
    (image.shadowTint !== undefined && image.shadowTint !== 0)
  , [image.exposure, image.contrast, image.highlights, image.shadows,
     image.whites, image.blacks, image.temperature, image.vibrance,
     image.saturation, image.clarity, image.dehaze, image.vignette,
     image.grain, image.brightness, image.hue, image.blur, image.filters,
     isCurvesModified, image.colorHSL, image.splitToning, image.colorGrading,
     image.colorCalibration, image.shadowTint]);

  // Apply Konva filters
  useEffect(() => {
    if (!imageRef.current || !img) return;
    const node = imageRef.current;

    if (!hasActiveFilters) {
      node.clearCache();
      node.filters([]);
      return;
    }

    // Build filter list using fast LUT-based filters
    const filterList: ((imageData: ImageData) => void)[] = [];
    const bypassCurves = bypassedTabs?.has('curves');
    const bypassLight = bypassedTabs?.has('light');
    const bypassColor = bypassedTabs?.has('color');
    const bypassEffects = bypassedTabs?.has('effects');

    // Curves
    if (!bypassCurves && isCurvesModified && image.curves) {
      filterList.push(createCurvesFilter(image.curves));
    }

    // Light adjustments
    if (!bypassLight) {
      if (image.exposure !== 0) {
        filterList.push(createExposureFilter(image.exposure));
      }
      if (image.highlights !== 0 || image.shadows !== 0 || image.whites !== 0 || image.blacks !== 0) {
        filterList.push(createTonalFilter(image.highlights, image.shadows, image.whites, image.blacks));
      }
      if (image.clarity !== 0) {
        filterList.push(createClarityFilter(image.clarity));
      }
      if (image.brightness !== 0) {
        filterList.push(createBrightnessFilter(image.brightness));
      }
      if (image.contrast !== 0) {
        filterList.push(Konva.Filters.Contrast as unknown as (imageData: ImageData) => void);
      }
    }

    // Color adjustments
    if (!bypassColor) {
      if (image.temperature !== 0) {
        filterList.push(createTemperatureFilter(image.temperature));
      }
      if (image.saturation !== 0 || image.hue !== 0) {
        filterList.push(Konva.Filters.HSV as unknown as (imageData: ImageData) => void);
      }
      if (image.vibrance !== 0) {
        filterList.push(createVibranceFilter(image.vibrance));
      }
      if (image.colorHSL) {
        const hasHSL = Object.values(image.colorHSL).some(
          (adj) => adj && ((adj.hue ?? 0) !== 0 || (adj.saturation ?? 0) !== 0 || (adj.luminance ?? 0) !== 0)
        );
        if (hasHSL) filterList.push(createHSLColorFilter(image.colorHSL));
      }
      if (image.splitToning) {
        filterList.push(createSplitToningFilter(image.splitToning));
      }
      if (image.shadowTint && image.shadowTint !== 0) {
        filterList.push(createShadowTintFilter(image.shadowTint));
      }
      if (image.colorGrading) {
        filterList.push(createColorGradingFilter(image.colorGrading));
      }
      if (image.colorCalibration) {
        filterList.push(createColorCalibrationFilter(image.colorCalibration));
      }
    }

    // Effects
    if (!bypassEffects) {
      if (image.dehaze !== 0) {
        filterList.push(createDehazeFilter(image.dehaze));
      }
      if (image.vignette !== 0) {
        filterList.push(createVignetteFilter(image.vignette));
      }
      if (image.grain !== 0) {
        filterList.push(createGrainFilter(image.grain));
      }
      if (image.blur > 0) {
        filterList.push(Konva.Filters.Blur as unknown as (imageData: ImageData) => void);
      }
    }

    // Legacy filters (always apply)
    if (image.filters.includes('grayscale')) {
      filterList.push(Konva.Filters.Grayscale as unknown as (imageData: ImageData) => void);
    }
    if (image.filters.includes('sepia')) {
      filterList.push(Konva.Filters.Sepia as unknown as (imageData: ImageData) => void);
    }
    if (image.filters.includes('invert')) {
      filterList.push(Konva.Filters.Invert as unknown as (imageData: ImageData) => void);
    }

    // Calculate pixelRatio to maintain source image quality
    // If source is larger than display, we need higher pixelRatio
    const scaleX = img.width / (image.width || img.width);
    const scaleY = img.height / (image.height || img.height);
    const sourceScale = Math.max(scaleX, scaleY, 1);
    const pixelRatio = Math.min(sourceScale * window.devicePixelRatio, 8);

    // Clear any pending cache update
    if (cacheTimeoutRef.current) {
      clearTimeout(cacheTimeoutRef.current);
    }

    // Debounce the cache + filter application for smoother sliders
    // Keeps full quality, just batches rapid updates
    cacheTimeoutRef.current = setTimeout(() => {
      if (imageRef.current) {
        imageRef.current.cache({ pixelRatio });
        imageRef.current.filters(filterList);
        imageRef.current.contrast(bypassLight ? 0 : image.contrast * 25);
        imageRef.current.saturation(bypassColor ? 0 : image.saturation * 2);
        imageRef.current.hue(bypassColor ? 0 : image.hue * 180);
        imageRef.current.blurRadius(bypassEffects ? 0 : image.blur * 20);
      }
    }, 16); // ~60fps max update rate
  }, [img, hasActiveFilters, isCurvesModified, image.exposure, image.contrast,
      image.highlights, image.shadows, image.whites, image.blacks,
      image.temperature, image.vibrance, image.saturation, image.clarity,
      image.dehaze, image.vignette, image.grain, image.brightness, image.hue,
      image.blur, image.filters, image.curves, image.colorHSL, image.splitToning,
      image.shadowTint, image.colorGrading, image.colorCalibration,
      image.width, image.height, image.scaleX, image.scaleY, bypassedTabs]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (cacheTimeoutRef.current) {
        clearTimeout(cacheTimeoutRef.current);
      }
    };
  }, []);

  if (!img || imgStatus === 'loading') {
    return null;
  }

  return (
    <KonvaImage
      ref={imageRef}
      id={image.id}
      image={img}
      x={image.x}
      y={image.y}
      width={image.width}
      height={image.height}
      rotation={image.rotation}
      scaleX={image.scaleX}
      scaleY={image.scaleY}
      draggable
      onClick={onClick}
      onDblClick={(e) => {
        e.cancelBubble = true;
        onDblClick?.(e);
      }}
      onContextMenu={(e) => {
        e.evt.preventDefault();
        onContextMenu?.(e as Konva.KonvaEventObject<PointerEvent>, image.id);
      }}
      onMouseEnter={(e) => {
        const container = e.target.getStage()?.container();
        if (container) container.style.cursor = 'pointer';
      }}
      onMouseLeave={(e) => {
        const container = e.target.getStage()?.container();
        if (container) container.style.cursor = 'default';
      }}
      onDragStart={(e) => {
        isDraggingRef.current = true;
        e.target.moveToTop();
      }}
      onDragEnd={(e) => {
        isDraggingRef.current = false;
        prevPosRef.current = { x: image.x, y: image.y };
        onDragEnd(e);
      }}
      onDragMove={onDragMove}
      onTransformEnd={() => {
        const node = imageRef.current;
        if (!node) return;
        onUpdate({ scaleX: node.scaleX(), scaleY: node.scaleY(), rotation: node.rotation() });
      }}
    />
  );
}, (prevProps, nextProps) => {
  // Custom comparison - only re-render if relevant props changed
  return (
    prevProps.image === nextProps.image &&
    prevProps.bypassedTabs === nextProps.bypassedTabs
  );
});

// Text node component
function TextNode({
  text,
  onClick,
  onDragEnd,
  onUpdate,
}: {
  text: CanvasText;
  isSelected: boolean;
  onClick: (e: Konva.KonvaEventObject<MouseEvent>) => void;
  onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onUpdate: (updates: Partial<CanvasText>) => void;
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
      fontSize={text.fontSize}
      fill={text.fill}
      rotation={text.rotation}
      draggable
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
