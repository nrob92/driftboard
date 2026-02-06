'use client';

import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { Stage, Layer, Image as KonvaImage, Rect, Text, Group } from 'react-konva';
import useImage from 'use-image';
import Konva from 'konva';
import { CurvesEditor } from './CurvesEditor';
import { buildSandboxFilterList } from '@/lib/sandboxFilters';

const ACCEPT = 'image/jpeg,image/png,image/webp';

// Match main app CanvasEditor exactly (no DB writes)
const FOLDER_COLORS = ['#3ECF8E', '#74c0fc', '#ff9f43', '#ff6b6b', '#a78bfa', '#f472b6', '#fbbf24', '#34d399'];
const GRID_CONFIG = {
  imageMaxSize: 140,
  imageGap: 12,
  folderPadding: 15,
  defaultFolderWidth: 500,
  minFolderWidth: 180,
  minFolderHeight: 130,
  folderGap: 40,
};
const LABEL_HEIGHT = 30;
const CELL_SIZE = GRID_CONFIG.imageMaxSize + GRID_CONFIG.imageGap;

// Approximate width for 16px semibold (used until measured)
function approximateLabelWidth(name: string): number {
  return (name.length * 9.5) || 0;
}

function calculateColsFromWidth(folderWidth: number): number {
  const availableWidth = folderWidth - GRID_CONFIG.folderPadding * 2;
  const cols = Math.floor((availableWidth + GRID_CONFIG.imageGap) / CELL_SIZE);
  return Math.max(1, cols);
}

function getFolderLayoutMode(folderWidth: number): 'grid' | 'stack' {
  const cols = calculateColsFromWidth(folderWidth);
  return cols === 1 ? 'stack' : 'grid';
}

function getFolderBorderHeight(imageCount: number, folderWidth: number, folderHeight?: number): number {
  if (folderHeight != null) {
    return Math.max(folderHeight - LABEL_HEIGHT, 100);
  }
  if (imageCount === 0) return 100;
  
  // Calculate dynamic columns based on folder width (same as main app)
  const layoutMode = getFolderLayoutMode(folderWidth);
  
  if (layoutMode === 'stack') {
    // Stack mode: single column, height based on number of images
    return imageCount * CELL_SIZE + (GRID_CONFIG.folderPadding * 2);
  }
  
  // Grid mode: calculate rows based on columns
  const cols = calculateColsFromWidth(folderWidth);
  const rows = Math.ceil(imageCount / cols) || 1;
  return rows * CELL_SIZE + (GRID_CONFIG.folderPadding * 2);
}

type SandboxFolder = {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height?: number; // Optional height for resizing
  imageIds: string[];
  color: string;
};

function reflowSandboxImagesInFolder(
  images: SandboxImage[],
  folderX: number,
  folderY: number,
  folderWidth: number,
  folderHeight?: number
): SandboxImage[] {
  const { folderPadding, imageMaxSize } = GRID_CONFIG;
  const contentStartX = folderX + folderPadding;
  const contentStartY = folderY + LABEL_HEIGHT + folderPadding;
  
  // Calculate dynamic columns based on folder width (same as main app)
  const cols = calculateColsFromWidth(folderWidth);
  const layoutMode = getFolderLayoutMode(folderWidth);
  
  // Calculate max rows based on folder height if provided
  let maxRows = Infinity;
  if (folderHeight != null) {
    const contentHeight = folderHeight - LABEL_HEIGHT;
    const availableContentHeight = contentHeight - (2 * folderPadding);
    maxRows = Math.max(1, Math.floor(availableContentHeight / CELL_SIZE));
  }

  if (layoutMode === 'stack') {
    // Stack mode: single column, vertical stacking
    return images.map((img, index) => {
      const baseWidth = img.originalWidth ?? img.width;
      const baseHeight = img.originalHeight ?? img.height;
      const scale = Math.min(imageMaxSize / baseWidth, imageMaxSize / baseHeight, 1);
      const w = baseWidth * scale;
      const h = baseHeight * scale;
      
      // Center horizontally in folder
      const availableWidth = folderWidth - (2 * folderPadding);
      const cellOffsetX = (availableWidth - w) / 2;
      
      // Stack vertically with gaps
      const yOffset = index * CELL_SIZE;
      
      return {
        ...img,
        x: contentStartX + cellOffsetX,
        y: contentStartY + yOffset,
        width: w,
        height: h,
        originalWidth: img.originalWidth ?? baseWidth,
        originalHeight: img.originalHeight ?? baseHeight,
      };
    });
  }

  // Grid mode: multi-column layout
  return images.map((img, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    
    // If folder height is limited, ensure we don't exceed max rows
    if (folderHeight != null && row >= maxRows) {
      // This shouldn't happen if folder height is calculated correctly, but handle it
      const wrappedRow = row % maxRows;
      const wrappedCol = (Math.floor(index / maxRows) % cols);
      const baseWidth = img.originalWidth ?? img.width;
      const baseHeight = img.originalHeight ?? img.height;
      const scale = Math.min(imageMaxSize / baseWidth, imageMaxSize / baseHeight, 1);
      const w = baseWidth * scale;
      const h = baseHeight * scale;
      const cellOffsetX = (imageMaxSize - w) / 2;
      const cellOffsetY = (imageMaxSize - h) / 2;
      return {
        ...img,
        x: contentStartX + wrappedCol * CELL_SIZE + cellOffsetX,
        y: contentStartY + wrappedRow * CELL_SIZE + cellOffsetY,
        width: w,
        height: h,
        originalWidth: img.originalWidth ?? baseWidth,
        originalHeight: img.originalHeight ?? baseHeight,
      };
    }
    
    // Use original dimensions if available, otherwise use current dimensions
    const baseWidth = img.originalWidth ?? img.width;
    const baseHeight = img.originalHeight ?? img.height;
    
    // Constrain to imageMaxSize (same as main app: Math.min(width * scaleX, imageMaxSize))
    const scale = Math.min(imageMaxSize / baseWidth, imageMaxSize / baseHeight, 1);
    const w = baseWidth * scale;
    const h = baseHeight * scale;
    
    // Center images in their cells (same as main app)
    const cellOffsetX = (imageMaxSize - w) / 2;
    const cellOffsetY = (imageMaxSize - h) / 2;
    
    return {
      ...img,
      x: contentStartX + col * CELL_SIZE + cellOffsetX,
      y: contentStartY + row * CELL_SIZE + cellOffsetY,
      width: w,
      height: h,
      // Preserve original dimensions if not already set
      originalWidth: img.originalWidth ?? baseWidth,
      originalHeight: img.originalHeight ?? baseHeight,
    };
  });
}

interface CurvePoint { x: number; y: number; }
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

type SandboxImage = {
  id: string;
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
  folderId?: string;
  // Store original dimensions to restore when removed from folder
  originalWidth?: number;
  originalHeight?: number;
  exposure?: number;
  contrast?: number;
  highlights?: number;
  shadows?: number;
  whites?: number;
  blacks?: number;
  temperature?: number;
  vibrance?: number;
  saturation?: number;
  clarity?: number;
  dehaze?: number;
  vignette?: number;
  grain?: number;
  curves?: ChannelCurves;
};

function SandboxSlider({
  label,
  value,
  min,
  max,
  step,
  defaultValue,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-[#888] w-20 shrink-0">{label}</span>
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          onDoubleClick={() => onChange(defaultValue)}
          className="flex-1 h-1 bg-[#333] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#3ECF8E] [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-125"
        />
        <span className="text-[10px] text-[#666] w-10 text-right tabular-nums shrink-0">
          {value > 0 ? '+' : ''}{Math.round(value * 100)}
        </span>
      </div>
    </div>
  );
}

function SandboxImageNode({
  img,
  isZoomed,
  isSelected,
  onSelect,
  onDoubleClick,
  onDragMove,
  onDragEnd,
  onCursorOverImage,
  onNodeRef,
  isSpacePressed,
}: {
  img: SandboxImage;
  isZoomed: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onDoubleClick: () => void;
  onDragMove?: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd: (x: number, y: number) => void;
  onCursorOverImage: (over: boolean) => void;
  onNodeRef?: (node: Konva.Image | null) => void;
  isSpacePressed?: boolean;
}) {
  const nodeRef = useRef<Konva.Image>(null);
  const [image] = useImage(img.url, 'anonymous');
  const filterList = useMemo(() => buildSandboxFilterList(img), [img]);
  const hasFilters = filterList.length > 0;

  useEffect(() => {
    if (!image || !nodeRef.current) return;
    const node = nodeRef.current;
    
    if (!hasFilters || filterList.length === 0) {
      // No filters - clear cache and filters (don't cache to preserve quality)
      node.clearCache();
      node.filters([]);
      return;
    }
    
    // Calculate pixelRatio to maintain source image quality (match main app)
    // If source is larger than display, we need higher pixelRatio
    const imgElement = image as HTMLImageElement;
    const sourceWidth = imgElement.naturalWidth || img.width;
    const sourceHeight = imgElement.naturalHeight || img.height;
    const displayWidth = img.width;
    const displayHeight = img.height;
    const scaleX = sourceWidth / displayWidth;
    const scaleY = sourceHeight / displayHeight;
    const sourceScale = Math.max(scaleX, scaleY, 1);
    const pixelRatio = Math.min(sourceScale * (window.devicePixelRatio || 1), 8);
    
    // Apply filters, then cache with high quality
    node.filters(filterList);
    node.cache({ pixelRatio });
    // Force redraw to apply cache
    node.getLayer()?.batchDraw();
  }, [image, hasFilters, filterList, img.width, img.height]);

  useEffect(() => {
    if (onNodeRef && nodeRef.current) {
      onNodeRef(nodeRef.current);
    }
  }, [onNodeRef]);

  if (!image) return null;
  return (
    <KonvaImage
      ref={nodeRef}
      image={image}
      x={img.x}
      y={img.y}
      width={img.width}
      height={img.height}
      draggable={!isZoomed}
      onMouseEnter={(e) => {
        onCursorOverImage(true);
        const container = e.target.getStage()?.container();
        if (container && !isSpacePressed) container.style.cursor = 'pointer';
      }}
      onMouseLeave={(e) => {
        onCursorOverImage(false);
        const container = e.target.getStage()?.container();
        if (container && !isSpacePressed) container.style.cursor = 'default';
      }}
      onClick={(e) => e.evt.button === 0 && onSelect()}
      onDblClick={onDoubleClick}
      onDragMove={onDragMove}
      onDragEnd={(e) => {
        // Get the actual pointer position, not the node position (which may have been snapped during drag)
        const stage = e.target.getStage();
        if (stage) {
          // Get pointer position relative to stage (accounts for stage transform/scale)
          const pointerPos = stage.getRelativePointerPosition();
          if (pointerPos && pointerPos.x !== undefined && pointerPos.y !== undefined) {
            onDragEnd(pointerPos.x, pointerPos.y);
            return;
          }
        }
        // Fallback to node position if we can't get pointer position
        onDragEnd(e.target.x(), e.target.y());
      }}
      listening={true}
      stroke={isSelected ? '#3ECF8E' : undefined}
      strokeWidth={isSelected ? 2 : 0}
    />
  );
}

export function LoginSandbox({ onSignInClick }: { onSignInClick?: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageNodeRefs = useRef<Record<string, Konva.Image>>({});
  const [dimensions, setDimensions] = useState({ width: 400, height: 300 });
  const [sandboxImages, setSandboxImages] = useState<SandboxImage[]>([]);
  const [sandboxFolders, setSandboxFolders] = useState<SandboxFolder[]>([]);
  const [stageScale, setStageScale] = useState(0.55);
  const [stagePosition, setStagePosition] = useState({ x: 0, y: 0 });
  const [zoomedId, setZoomedId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<'curves' | 'light' | 'color' | 'effects' | null>(null);
  const [cursorOverImage, setCursorOverImage] = useState(false);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [folderLabelWidths, setFolderLabelWidths] = useState<Record<string, number>>({});
  const [hoveredFolderBorder, setHoveredFolderBorder] = useState<string | null>(null);
  const [resizingFolderId, setResizingFolderId] = useState<string | null>(null);
  const folderLabelRefs = useRef<Record<string, Konva.Text>>({});
  const preZoomViewRef = useRef<{ scale: number; x: number; y: number } | null>(null);
  const zoomAnimationRef = useRef<number | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0]?.contentRect ?? { width: 400, height: 300 };
      setDimensions({ width: Math.max(200, width), height: Math.max(200, height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Animate view transition (for zoom) - defined early so it can be used in useEffect
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
        setStageScale(scale);
        setStagePosition({ x, y });
      }
      if (t < 1) {
        zoomAnimationRef.current = requestAnimationFrame(tick);
      } else {
        zoomAnimationRef.current = null;
        onComplete?.();
      }
    };
    zoomAnimationRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        setIsSpacePressed(true);
      }
      if (e.code === 'Escape' && zoomedId) {
        if (zoomAnimationRef.current != null) {
          cancelAnimationFrame(zoomAnimationRef.current);
          zoomAnimationRef.current = null;
        }
        const pre = preZoomViewRef.current;
        if (pre) {
          animateView(
            { scale: stageScale, x: stagePosition.x, y: stagePosition.y },
            { scale: pre.scale, x: pre.x, y: pre.y },
            () => setZoomedId(null)
          );
        } else {
          setZoomedId(null);
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        setIsSpacePressed(false);
        setIsDragging(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [zoomedId, stageScale, stagePosition, animateView]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const addImagesToSandbox = useCallback((
    toAdd: { url: string; width: number; height: number }[],
    startIndex: number,
    createFolder: boolean,
    targetFolderId?: string
  ) => {
    const existingFolderCount = sandboxFolders.length;
    const folderX = 100;
    const folderY = 100 + existingFolderCount * 500;
    const folderId = targetFolderId ?? `folder-${Date.now()}`;
    const newFolder: SandboxFolder = {
      id: folderId,
      name: 'Untitled',
      x: folderX,
      y: folderY,
      width: GRID_CONFIG.defaultFolderWidth,
      imageIds: [],
      color: FOLDER_COLORS[existingFolderCount % FOLDER_COLORS.length],
    };
    const addToFolder = createFolder || !!targetFolderId;

    const newImages: SandboxImage[] = toAdd.map((item, i) => ({
      id: `sandbox-${Date.now()}-${startIndex + i}`,
      url: item.url,
      x: addToFolder ? 0 : 100 + ((startIndex + i) % 3) * (GRID_CONFIG.imageMaxSize + GRID_CONFIG.imageGap),
      y: addToFolder ? 0 : 100 + Math.floor((startIndex + i) / 3) * (GRID_CONFIG.imageMaxSize + GRID_CONFIG.imageGap),
      width: item.width,
      height: item.height,
      // Store original dimensions for when image is removed from folder
      originalWidth: item.width,
      originalHeight: item.height,
      folderId: addToFolder ? folderId : undefined,
      curves: JSON.parse(JSON.stringify(DEFAULT_CURVES)),
    }));

    if (createFolder) {
      setSandboxFolders((prev) => [
        ...prev,
        { ...newFolder, imageIds: newImages.map((im) => im.id) },
      ]);
    } else if (targetFolderId) {
      setSandboxFolders((prev) =>
        prev.map((f) =>
          f.id === targetFolderId
            ? { ...f, imageIds: [...f.imageIds, ...newImages.map((im) => im.id)] }
            : f
        )
      );
    }

    setSandboxImages((prev) => {
      const next = [...prev, ...newImages];
      if (!addToFolder) return next;
      const targetFolder: SandboxFolder =
        (targetFolderId ? sandboxFolders.find((f) => f.id === targetFolderId) : null) ?? newFolder;
      const folderImgs = next.filter((im) => im.folderId === folderId);
      const reflowed = reflowSandboxImagesInFolder(
        folderImgs,
        targetFolder.x,
        targetFolder.y,
        targetFolder.width,
        targetFolder.height
      );
      return next.map((im) => {
        const r = reflowed.find((x) => x.id === im.id);
        return r ? r : im;
      });
    });
  }, [sandboxFolders]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter((f) =>
      ACCEPT.split(',').some((t) => f.type === t.trim())
    );
    if (files.length === 0) return;
    const toAdd = files;
    if (toAdd.length === 0) return;

    const createFolder = sandboxFolders.length === 0 && toAdd.length > 0;
    const targetFolderId = sandboxFolders.length === 1 ? sandboxFolders[0].id : undefined;
    let loaded = 0;
    const items: { url: string; width: number; height: number }[] = [];

    toAdd.forEach((file) => {
      const url = URL.createObjectURL(file);
      const img = new window.Image();
      img.onload = () => {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        const maxSide = 280;
        const scale = Math.min(maxSide / w, maxSide / h, 1);
        const width = w * scale;
        const height = h * scale;
        items.push({ url, width, height });
        loaded++;
        if (loaded === toAdd.length) {
          addImagesToSandbox(items, sandboxImages.length, createFolder, targetFolderId);
        }
      };
      img.src = url;
    });
  }, [sandboxImages.length, sandboxFolders, addImagesToSandbox]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList?.length) return;
    const files = Array.from(fileList).filter((f) =>
      ACCEPT.split(',').some((t) => f.type === t.trim())
    );
    e.target.value = '';
    if (files.length === 0) return;
    const toAdd = files;
    if (toAdd.length === 0) return;

    const createFolder = sandboxFolders.length === 0 && toAdd.length > 0;
    const targetFolderId = sandboxFolders.length === 1 ? sandboxFolders[0].id : undefined;
    let loaded = 0;
    const items: { url: string; width: number; height: number }[] = [];

    toAdd.forEach((file) => {
      const url = URL.createObjectURL(file);
      const img = new window.Image();
      img.onload = () => {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        const maxSide = 280;
        const scale = Math.min(maxSide / w, maxSide / h, 1);
        const width = w * scale;
        const height = h * scale;
        items.push({ url, width, height });
        loaded++;
        if (loaded === toAdd.length) {
          addImagesToSandbox(items, sandboxImages.length, createFolder, targetFolderId);
        }
      };
      img.src = url;
    });
  }, [sandboxImages.length, sandboxFolders, addImagesToSandbox]);

  // Handle double-click to zoom into image
  const handleImageDoubleClick = useCallback((image: SandboxImage) => {
    const imgW = image.width;
    const imgH = image.height;
    const centerX = image.x + imgW / 2;
    const centerY = image.y + imgH / 2;

    if (zoomedId === image.id) {
      // Zoom back out
      const pre = preZoomViewRef.current;
      if (pre) {
        animateView(
          { scale: stageScale, x: stagePosition.x, y: stagePosition.y },
          { scale: pre.scale, x: pre.x, y: pre.y },
          () => setZoomedId(null)
        );
      } else {
        setZoomedId(null);
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
      () => setZoomedId(image.id)
    );
  }, [zoomedId, stageScale, stagePosition, dimensions.width, dimensions.height, animateView]);

  const handleWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
    if (!e.evt.ctrlKey && !e.evt.metaKey) return;
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const mousePointTo = { x: (pointer.x - stage.x()) / oldScale, y: (pointer.y - stage.y()) / oldScale };
    const scaleBy = 1.1;
    const newScale = e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;
    const clamped = Math.max(0.2, Math.min(5, newScale));
    setStageScale(clamped);
    setStagePosition({
      x: pointer.x - mousePointTo.x * clamped,
      y: pointer.y - mousePointTo.y * clamped,
    });
    if (zoomedId) {
      const pre = preZoomViewRef.current;
      if (pre) {
        animateView(
          { scale: clamped, x: pointer.x - mousePointTo.x * clamped, y: pointer.y - mousePointTo.y * clamped },
          { scale: pre.scale, x: pre.x, y: pre.y },
          () => setZoomedId(null)
        );
      } else {
        setZoomedId(null);
      }
    }
  }, [zoomedId, animateView]);

  // Handle real-time snapping during drag (same as main app)
  // Images MUST snap to one of exactly 3 positions - no free movement allowed
  const handleImageDragMove = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target;
    const currentX = node.x();
    const currentY = node.y();
    const currentImg = sandboxImages.find((i) => i.id === node.id());
    if (!currentImg) return;

    const currentCenterX = currentX + currentImg.width / 2;
    const currentCenterY = currentY + currentImg.height / 2;

    // Detect which folder is being hovered (check all folders, not just current folder)
    let targetFolderId: string | undefined = undefined;
    let targetFolder: SandboxFolder | undefined = undefined;
    
      for (const folder of sandboxFolders) {
        const contentHeight = getFolderBorderHeight(folder.imageIds.length, folder.width, folder.height);
        const top = folder.y + LABEL_HEIGHT;
        const bottom = folder.y + LABEL_HEIGHT + contentHeight;
        const left = folder.x;
        const right = folder.x + folder.width;
      
      if (currentCenterX >= left && currentCenterX <= right &&
          currentCenterY >= top && currentCenterY <= bottom) {
        targetFolderId = folder.id;
        targetFolder = folder;
        break;
      }
    }

    // If image is over a folder (whether already in it or being dragged into it), snap to grid positions
    if (targetFolderId && targetFolder) {
      const { folderPadding, imageMaxSize } = GRID_CONFIG;
      const contentStartX = targetFolder.x + folderPadding;
      const contentStartY = targetFolder.y + LABEL_HEIGHT + folderPadding;
      
      // Calculate dynamic columns based on folder width (same as main app)
      const cols = calculateColsFromWidth(targetFolder.width);
      const layoutMode = getFolderLayoutMode(targetFolder.width);
      
      // Calculate which cell the drag position corresponds to
      const relativeX = currentX - contentStartX;
      const relativeY = currentY - contentStartY;
      const targetCol = Math.max(0, Math.min(cols - 1, Math.floor(relativeX / CELL_SIZE)));
      
      // Calculate max rows based on folder height
      let maxRows = Infinity;
      if (targetFolder.height != null) {
        const contentHeight = targetFolder.height - LABEL_HEIGHT;
        const availableContentHeight = contentHeight - (2 * folderPadding);
        maxRows = Math.max(1, Math.floor(availableContentHeight / CELL_SIZE));
      }
      
      const targetRow = Math.max(0, Math.min(maxRows - 1, Math.floor(relativeY / CELL_SIZE)));
      
      // Get other images in folder
      const otherFolderImages = sandboxImages.filter(img => 
        targetFolder!.imageIds.includes(img.id) && img.id !== currentImg.id
      );
      
      // Calculate which cells each other image occupies (row, col pairs)
      const occupiedCells = new Set<string>();
      otherFolderImages.forEach((otherImg) => {
        const otherImgRelativeX = otherImg.x - contentStartX;
        const otherImgRelativeY = otherImg.y - contentStartY;
        const otherImgCol = Math.floor(otherImgRelativeX / CELL_SIZE);
        const otherImgRow = Math.floor(otherImgRelativeY / CELL_SIZE);
        if (otherImgCol >= 0 && otherImgCol < cols && otherImgRow >= 0 && otherImgRow < maxRows) {
          occupiedCells.add(`${otherImgRow},${otherImgCol}`);
        }
      });
      
      // Calculate current image's cell (if it's already in a valid spot)
      const currentImgRelativeX = currentImg.x - contentStartX;
      const currentImgRelativeY = currentImg.y - contentStartY;
      const currentImgCol = Math.floor(currentImgRelativeX / CELL_SIZE);
      const currentImgRow = Math.floor(currentImgRelativeY / CELL_SIZE);
      const isInValidSpot = currentImgCol >= 0 && currentImgCol < cols && currentImgRow >= 0 && currentImgRow < maxRows;
      
      let swapX: number | undefined;
      let swapY: number | undefined;
      let swapImgId: string | undefined;
      let finalCol = targetCol;
      let finalRow = targetRow;
      
      // If target cell is occupied, swap positions or find empty cell
      const targetCellKey = `${targetRow},${targetCol}`;
      if (occupiedCells.has(targetCellKey)) {
        if (isInValidSpot) {
          // Swap: move occupied image to current image's spot
          const currentCellKey = `${currentImgRow},${currentImgCol}`;
          const occupiedImg = otherFolderImages.find((otherImg) => {
            const otherImgRelativeX = otherImg.x - contentStartX;
            const otherImgRelativeY = otherImg.y - contentStartY;
            const otherImgCol = Math.floor(otherImgRelativeX / CELL_SIZE);
            const otherImgRow = Math.floor(otherImgRelativeY / CELL_SIZE);
            return otherImgCol === targetCol && otherImgRow === targetRow;
          });
          
          if (occupiedImg && !occupiedCells.has(currentCellKey)) {
            const baseWidth = occupiedImg.originalWidth ?? occupiedImg.width;
            const baseHeight = occupiedImg.originalHeight ?? occupiedImg.height;
            const scale = Math.min(imageMaxSize / baseWidth, imageMaxSize / baseHeight, 1);
            const swapImgWidth = baseWidth * scale;
            const swapImgHeight = baseHeight * scale;
            const swapOffsetX = (imageMaxSize - swapImgWidth) / 2;
            const swapOffsetY = (imageMaxSize - swapImgHeight) / 2;
            
            swapX = contentStartX + currentImgCol * CELL_SIZE + swapOffsetX;
            swapY = contentStartY + currentImgRow * CELL_SIZE + swapOffsetY;
            swapImgId = occupiedImg.id;
          }
        } else {
          // Image coming from outside folder - find nearest empty cell
          for (let radius = 0; radius < maxRows * cols; radius++) {
            let foundEmpty = false;
            for (let dr = -radius; dr <= radius && !foundEmpty; dr++) {
              for (let dc = -radius; dc <= radius && !foundEmpty; dc++) {
                if (Math.abs(dr) !== radius && Math.abs(dc) !== radius) continue;
                const checkRow = targetRow + dr;
                const checkCol = targetCol + dc;
                if (checkRow >= 0 && checkRow < maxRows && checkCol >= 0 && checkCol < cols) {
                  const checkCellKey = `${checkRow},${checkCol}`;
                  if (!occupiedCells.has(checkCellKey)) {
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
      
      // Ensure final position is valid
      finalCol = Math.max(0, Math.min(cols - 1, finalCol));
      finalRow = Math.max(0, Math.min(maxRows - 1, finalRow));
      
      // Use original dimensions if available, otherwise use current dimensions
      const baseWidth = currentImg.originalWidth ?? currentImg.width;
      const baseHeight = currentImg.originalHeight ?? currentImg.height;
      
      // Constrain to imageMaxSize (same as main app)
      const scale = Math.min(imageMaxSize / baseWidth, imageMaxSize / baseHeight, 1);
      const imgWidth = baseWidth * scale;
      const imgHeight = baseHeight * scale;
      
      const cellOffsetX = (imageMaxSize - imgWidth) / 2;
      const cellOffsetY = (imageMaxSize - imgHeight) / 2;
      
      // Calculate exact position for the snapped cell
      const finalX = contentStartX + finalCol * CELL_SIZE + cellOffsetX;
      const finalY = contentStartY + finalRow * CELL_SIZE + cellOffsetY;
      
      // Update positions in real-time
      setSandboxImages((prev) =>
        prev.map((img) => {
          if (img.id === currentImg.id) {
            return { 
              ...img, 
              x: finalX, 
              y: finalY,
              width: imgWidth,
              height: imgHeight,
              folderId: targetFolderId, // Update folder assignment during drag
              originalWidth: img.originalWidth ?? baseWidth,
              originalHeight: img.originalHeight ?? baseHeight,
            };
          }
          if (swapImgId && img.id === swapImgId && swapX !== undefined && swapY !== undefined) {
            return { ...img, x: swapX, y: swapY };
          }
          return img;
        })
      );
      
      // FORCE the node position immediately - this prevents any free movement
      node.setAttrs({ x: finalX, y: finalY });
    }
  }, [sandboxImages, sandboxFolders]);


  const handleImageDragEnd = useCallback((id: string, x: number, y: number) => {
    const img = sandboxImages.find((i) => i.id === id);
    if (!img) return;

    const centerX = x + img.width / 2;
    const centerY = y + img.height / 2;
    const oldFolderId = img.folderId;

    let targetFolderId: string | undefined;
    let targetFolder: SandboxFolder | undefined;
      for (const folder of sandboxFolders) {
        const contentHeight = getFolderBorderHeight(folder.imageIds.length, folder.width, folder.height);
        const top = folder.y + LABEL_HEIGHT;
        const bottom = folder.y + LABEL_HEIGHT + contentHeight;
        const left = folder.x;
        const right = folder.x + folder.width;
      if (centerX >= left && centerX <= right && centerY >= top && centerY <= bottom) {
        targetFolderId = folder.id;
        targetFolder = folder;
        break;
      }
    }

    if (targetFolderId !== oldFolderId) {
      if (!targetFolderId && oldFolderId) {
        // Image removed from folder - restore original size and reflow remaining images
        const oldFolder = sandboxFolders.find(f => f.id === oldFolderId);
        if (!oldFolder) return;
        
        const untitledNames = sandboxFolders.filter((f) => f.name.toLowerCase().startsWith('untitled')).map((f) => f.name.toLowerCase());
        let name = 'Untitled';
        if (untitledNames.includes('untitled')) {
          let n = 2;
          while (untitledNames.includes(`untitled-${n}`)) n++;
          name = `Untitled-${n}`;
        }
        const newFolderId = `folder-${Date.now()}`;
        const newFolder: SandboxFolder = {
          id: newFolderId,
          name,
          x: x,
          y: y - 50,
          width: GRID_CONFIG.defaultFolderWidth,
          imageIds: [id],
          color: FOLDER_COLORS[sandboxFolders.length % FOLDER_COLORS.length],
        };
        
        // Remove image from old folder
        const updatedOldFolder = { ...oldFolder, imageIds: oldFolder.imageIds.filter((i) => i !== id) };
        
        // Get remaining images in old folder
        const remainingOldFolderImages = sandboxImages.filter((i) => 
          i.folderId === oldFolderId && i.id !== id
        );
        
        // Reflow remaining images in old folder
        let reflowedOldFolderImages: SandboxImage[] = [];
        if (remainingOldFolderImages.length > 0) {
          reflowedOldFolderImages = reflowSandboxImagesInFolder(
            remainingOldFolderImages,
            oldFolder.x,
            oldFolder.y,
            oldFolder.width,
            oldFolder.height
          );
        }
        
        // Reflow new folder image
        const folderImages = sandboxImages.filter((i) => i.id === id);
        const reflowedNewFolderImages = reflowSandboxImagesInFolder(
          folderImages, 
          newFolder.x, 
          newFolder.y, 
          newFolder.width, 
          newFolder.height
        );
        
        // Update folders: remove old folder if empty, add new folder
        const updatedFolders = sandboxFolders
          .map((f) => (f.id === oldFolderId ? updatedOldFolder : f))
          .filter((f) => f.imageIds.length > 0)
          .concat(newFolder);
        
        // Update images: reflow old folder images, add new folder image
        const updatedImages = sandboxImages.map((i) => {
          if (i.id === id) {
            // Image moved to new folder
            return { ...reflowedNewFolderImages[0], folderId: newFolderId };
          }
          // Reflow remaining images in old folder
          if (i.folderId === oldFolderId) {
            const reflowed = reflowedOldFolderImages.find(r => r.id === i.id);
            if (reflowed) {
              return {
                ...reflowed,
                // Preserve original dimensions if available
                originalWidth: i.originalWidth ?? reflowed.width,
                originalHeight: i.originalHeight ?? reflowed.height,
              };
            }
          }
          return i;
        });
        
        setSandboxFolders(updatedFolders);
        setSandboxImages(updatedImages);
        return;
      }

      if (targetFolderId && targetFolder) {
        // When moving image INTO a folder, snap to nearest grid position based on release position
        // TypeScript guard: ensure targetFolder is defined
        const currentTargetFolder = targetFolder;
        const contentStartX = currentTargetFolder.x + GRID_CONFIG.folderPadding;
        const contentStartY = currentTargetFolder.y + LABEL_HEIGHT + GRID_CONFIG.folderPadding;
        
        // Calculate dynamic columns based on folder width (same as main app)
        const cols = calculateColsFromWidth(currentTargetFolder.width);
        
        // Calculate max rows based on folder height
        let maxRows = Infinity;
        if (currentTargetFolder.height != null) {
          const contentHeight = currentTargetFolder.height - LABEL_HEIGHT;
          const availableContentHeight = contentHeight - (2 * GRID_CONFIG.folderPadding);
          maxRows = Math.max(1, Math.floor(availableContentHeight / CELL_SIZE));
        }
        
        // Calculate which cell the release position corresponds to
        const relativeX = x - contentStartX;
        const relativeY = y - contentStartY;
        const targetCol = Math.max(0, Math.min(cols - 1, Math.floor(relativeX / CELL_SIZE)));
        const targetRow = Math.max(0, Math.min(maxRows - 1, Math.floor(relativeY / CELL_SIZE)));
        
        // Get other images in target folder (excluding the one being moved)
        const otherFolderImages = sandboxImages.filter(img => 
          img.folderId === targetFolderId && img.id !== id
        );
        
        // Calculate which cells each other image occupies (row, col pairs)
        const occupiedCells = new Set<string>();
        otherFolderImages.forEach((otherImg) => {
          const otherImgRelativeX = otherImg.x - contentStartX;
          const otherImgRelativeY = otherImg.y - contentStartY;
          const otherImgCol = Math.floor(otherImgRelativeX / CELL_SIZE);
          const otherImgRow = Math.floor(otherImgRelativeY / CELL_SIZE);
          if (otherImgCol >= 0 && otherImgCol < cols && otherImgRow >= 0 && otherImgRow < maxRows) {
            occupiedCells.add(`${otherImgRow},${otherImgCol}`);
          }
        });
        
        // Calculate current image's cell (if it's already in a valid spot in the old folder)
        let currentImgCol = -1;
        let currentImgRow = -1;
        if (oldFolderId) {
          const oldFolder = sandboxFolders.find(f => f.id === oldFolderId);
          if (oldFolder) {
            const oldContentStartX = oldFolder.x + GRID_CONFIG.folderPadding;
            const oldContentStartY = oldFolder.y + LABEL_HEIGHT + GRID_CONFIG.folderPadding;
            const currentImgRelativeX = img.x - oldContentStartX;
            const currentImgRelativeY = img.y - oldContentStartY;
            currentImgCol = Math.floor(currentImgRelativeX / CELL_SIZE);
            currentImgRow = Math.floor(currentImgRelativeY / CELL_SIZE);
          }
        }
        const isInValidSpot = currentImgCol >= 0 && currentImgRow >= 0;
        
        let swapX: number | undefined;
        let swapY: number | undefined;
        let swapImgId: string | undefined;
        let finalCol = targetCol;
        let finalRow = targetRow;
        
        // If target cell is occupied, swap positions or find empty cell
        const targetCellKey = `${targetRow},${targetCol}`;
        if (occupiedCells.has(targetCellKey)) {
          if (isInValidSpot && oldFolderId === targetFolderId) {
            // Swap: move occupied image to current image's spot
            const currentCellKey = `${currentImgRow},${currentImgCol}`;
            const occupiedImg = otherFolderImages.find((otherImg) => {
              const otherImgRelativeX = otherImg.x - contentStartX;
              const otherImgRelativeY = otherImg.y - contentStartY;
              const otherImgCol = Math.floor(otherImgRelativeX / CELL_SIZE);
              const otherImgRow = Math.floor(otherImgRelativeY / CELL_SIZE);
              return otherImgCol === targetCol && otherImgRow === targetRow;
            });
            
            if (occupiedImg && !occupiedCells.has(currentCellKey)) {
              const baseWidth = occupiedImg.originalWidth ?? occupiedImg.width;
              const baseHeight = occupiedImg.originalHeight ?? occupiedImg.height;
              const scale = Math.min(GRID_CONFIG.imageMaxSize / baseWidth, GRID_CONFIG.imageMaxSize / baseHeight, 1);
              const swapImgWidth = baseWidth * scale;
              const swapImgHeight = baseHeight * scale;
              const swapOffsetX = (GRID_CONFIG.imageMaxSize - swapImgWidth) / 2;
              const swapOffsetY = (GRID_CONFIG.imageMaxSize - swapImgHeight) / 2;
              
              swapX = contentStartX + currentImgCol * CELL_SIZE + swapOffsetX;
              swapY = contentStartY + currentImgRow * CELL_SIZE + swapOffsetY;
              swapImgId = occupiedImg.id;
            }
          } else {
            // Image coming from outside folder or different folder - find nearest empty cell
            for (let radius = 0; radius < maxRows * cols; radius++) {
              let foundEmpty = false;
              for (let dr = -radius; dr <= radius && !foundEmpty; dr++) {
                for (let dc = -radius; dc <= radius && !foundEmpty; dc++) {
                  if (Math.abs(dr) !== radius && Math.abs(dc) !== radius) continue;
                  const checkRow = targetRow + dr;
                  const checkCol = targetCol + dc;
                  if (checkRow >= 0 && checkRow < maxRows && checkCol >= 0 && checkCol < cols) {
                    const checkCellKey = `${checkRow},${checkCol}`;
                    if (!occupiedCells.has(checkCellKey)) {
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
        
        // Ensure final position is valid
        finalCol = Math.max(0, Math.min(cols - 1, finalCol));
        finalRow = Math.max(0, Math.min(maxRows - 1, finalRow));
        
        // Preserve original dimensions if not already set (same as main app)
        const baseWidth = img.originalWidth ?? img.width;
        const baseHeight = img.originalHeight ?? img.height;
        
        // Constrain to imageMaxSize (same as main app)
        const scale = Math.min(GRID_CONFIG.imageMaxSize / baseWidth, GRID_CONFIG.imageMaxSize / baseHeight, 1);
        const imgW = baseWidth * scale;
        const imgH = baseHeight * scale;
        
        const cellOffsetX = (GRID_CONFIG.imageMaxSize - imgW) / 2;
        const cellOffsetY = (GRID_CONFIG.imageMaxSize - imgH) / 2;
        
        // Calculate exact position for the snapped cell
        const finalX = contentStartX + finalCol * CELL_SIZE + cellOffsetX;
        const finalY = contentStartY + finalRow * CELL_SIZE + cellOffsetY;

        const updatedFolders = sandboxFolders.map((f) => {
          if (f.id === oldFolderId) return { ...f, imageIds: f.imageIds.filter((i) => i !== id) };
          if (f.id === targetFolderId) return { ...f, imageIds: [...f.imageIds, id] };
          return f;
        }).filter((f) => f.imageIds.length > 0);

        // Reflow remaining images in old folder (if moving between folders)
        const oldFolder = sandboxFolders.find((f) => f.id === oldFolderId);
        const remainingOldFolderImages = sandboxImages.filter((im) => 
          im.folderId === oldFolderId && im.id !== id
        );
        let reflowedOldFolderImages: SandboxImage[] = [];
        if (oldFolder && remainingOldFolderImages.length > 0 && oldFolderId !== targetFolderId) {
          reflowedOldFolderImages = reflowSandboxImagesInFolder(
            remainingOldFolderImages,
            oldFolder.x,
            oldFolder.y,
            oldFolder.width,
            oldFolder.height
          );
        }
        
        // Get target folder images (including the moved one) for reflow
        // Use the targetFolder that was already found above (don't redeclare)
        const targetFolderImages = sandboxImages.filter((im) => 
          im.folderId === targetFolderId || im.id === id
        );
        let reflowedTargetFolderImages: SandboxImage[] = [];
        if (currentTargetFolder && targetFolderImages.length > 0) {
          // Create a temporary image object for the moved image with its new position
          const movedImageForReflow = {
            ...img,
            x: finalX,
            y: finalY,
            width: imgW,
            height: imgH,
            folderId: targetFolderId,
          };
          const imagesToReflow = targetFolderImages.map((im) => 
            im.id === id ? movedImageForReflow : im
          );
          reflowedTargetFolderImages = reflowSandboxImagesInFolder(
            imagesToReflow,
            currentTargetFolder.x,
            currentTargetFolder.y,
            currentTargetFolder.width,
            currentTargetFolder.height
          );
        }
        
        // Update images - place moved image, reflow folders
        const updatedImages = sandboxImages.map((i) => {
          if (i.id === id) {
            // Moved image - use reflowed position from target folder
            const reflowed = reflowedTargetFolderImages.find(r => r.id === id);
            if (reflowed) {
              return {
                ...reflowed,
                originalWidth: img.originalWidth ?? baseWidth,
                originalHeight: img.originalHeight ?? baseHeight,
              };
            }
            // Fallback to calculated position
            return { 
              ...img, 
              x: finalX, 
              y: finalY, 
              width: imgW, 
              height: imgH,
              folderId: targetFolderId,
              originalWidth: img.originalWidth ?? baseWidth,
              originalHeight: img.originalHeight ?? baseHeight,
            };
          }
          if (swapImgId && i.id === swapImgId && swapX !== undefined && swapY !== undefined) {
            return { ...i, x: swapX, y: swapY };
          }
          // Reflow remaining images in old folder
          if (i.folderId === oldFolderId && oldFolderId !== targetFolderId) {
            const reflowed = reflowedOldFolderImages.find(r => r.id === i.id);
            if (reflowed) {
              return {
                ...reflowed,
                originalWidth: i.originalWidth ?? reflowed.width,
                originalHeight: i.originalHeight ?? reflowed.height,
              };
            }
          }
          // Reflow images in target folder (excluding the moved one, which is handled above)
          if (i.folderId === targetFolderId && i.id !== id) {
            const reflowed = reflowedTargetFolderImages.find(r => r.id === i.id);
            if (reflowed) {
              return {
                ...reflowed,
                originalWidth: i.originalWidth ?? reflowed.width,
                originalHeight: i.originalHeight ?? reflowed.height,
              };
            }
          }
          return i;
        });
        
        // Update Konva node position
        const node = imageNodeRefs.current[id];
        if (node) {
          node.x(finalX);
          node.y(finalY);
        }
        
        setSandboxFolders(updatedFolders);
        setSandboxImages(updatedImages);
        return;
      }
    }

    if (targetFolderId && targetFolder && targetFolderId === oldFolderId) {
      // Image dragged within same folder - recalculate nearest position based on release position
      const contentStartX = targetFolder.x + GRID_CONFIG.folderPadding;
      const contentStartY = targetFolder.y + LABEL_HEIGHT + GRID_CONFIG.folderPadding;
      
      // Calculate dynamic columns based on folder width (same as main app)
      const cols = calculateColsFromWidth(targetFolder.width);
      
      // Calculate max rows based on folder height
      let maxRows = Infinity;
      if (targetFolder.height != null) {
        const contentHeight = targetFolder.height - LABEL_HEIGHT;
        const availableContentHeight = contentHeight - (2 * GRID_CONFIG.folderPadding);
        maxRows = Math.max(1, Math.floor(availableContentHeight / CELL_SIZE));
      }
      
      // Calculate which cell the release position corresponds to
      const relativeX = x - contentStartX;
      const relativeY = y - contentStartY;
      const targetCol = Math.max(0, Math.min(cols - 1, Math.floor(relativeX / CELL_SIZE)));
      const targetRow = Math.max(0, Math.min(maxRows - 1, Math.floor(relativeY / CELL_SIZE)));
      
      // Get other images in folder (excluding dragged one)
      const otherFolderImages = sandboxImages.filter(img => 
        img.folderId === targetFolderId && img.id !== id
      );
      
      // Calculate which cells each other image occupies (row, col pairs)
      const occupiedCells = new Set<string>();
      otherFolderImages.forEach((otherImg) => {
        const otherImgRelativeX = otherImg.x - contentStartX;
        const otherImgRelativeY = otherImg.y - contentStartY;
        const otherImgCol = Math.floor(otherImgRelativeX / CELL_SIZE);
        const otherImgRow = Math.floor(otherImgRelativeY / CELL_SIZE);
        if (otherImgCol >= 0 && otherImgCol < cols && otherImgRow >= 0 && otherImgRow < maxRows) {
          occupiedCells.add(`${otherImgRow},${otherImgCol}`);
        }
      });
      
      // Calculate current image's cell
      const currentImgRelativeX = img.x - contentStartX;
      const currentImgRelativeY = img.y - contentStartY;
      const currentImgCol = Math.floor(currentImgRelativeX / CELL_SIZE);
      const currentImgRow = Math.floor(currentImgRelativeY / CELL_SIZE);
      const isInValidSpot = currentImgCol >= 0 && currentImgCol < cols && currentImgRow >= 0 && currentImgRow < maxRows;
      
      let swapX: number | undefined;
      let swapY: number | undefined;
      let swapImgId: string | undefined;
      let finalCol = targetCol;
      let finalRow = targetRow;
      
      // If target cell is occupied, swap positions or find empty cell
      const targetCellKey = `${targetRow},${targetCol}`;
      if (occupiedCells.has(targetCellKey)) {
        if (isInValidSpot) {
          // Swap: move occupied image to current image's spot
          const currentCellKey = `${currentImgRow},${currentImgCol}`;
          const occupiedImg = otherFolderImages.find((otherImg) => {
            const otherImgRelativeX = otherImg.x - contentStartX;
            const otherImgRelativeY = otherImg.y - contentStartY;
            const otherImgCol = Math.floor(otherImgRelativeX / CELL_SIZE);
            const otherImgRow = Math.floor(otherImgRelativeY / CELL_SIZE);
            return otherImgCol === targetCol && otherImgRow === targetRow;
          });
          
          if (occupiedImg && !occupiedCells.has(currentCellKey)) {
            const baseWidth = occupiedImg.originalWidth ?? occupiedImg.width;
            const baseHeight = occupiedImg.originalHeight ?? occupiedImg.height;
            const scale = Math.min(GRID_CONFIG.imageMaxSize / baseWidth, GRID_CONFIG.imageMaxSize / baseHeight, 1);
            const swapImgWidth = baseWidth * scale;
            const swapImgHeight = baseHeight * scale;
            const swapOffsetX = (GRID_CONFIG.imageMaxSize - swapImgWidth) / 2;
            const swapOffsetY = (GRID_CONFIG.imageMaxSize - swapImgHeight) / 2;
            
            swapX = contentStartX + currentImgCol * CELL_SIZE + swapOffsetX;
            swapY = contentStartY + currentImgRow * CELL_SIZE + swapOffsetY;
            swapImgId = occupiedImg.id;
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
                  const checkCellKey = `${checkRow},${checkCol}`;
                  if (!occupiedCells.has(checkCellKey)) {
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
      
      // Ensure final position is valid
      finalCol = Math.max(0, Math.min(cols - 1, finalCol));
      finalRow = Math.max(0, Math.min(maxRows - 1, finalRow));
      
      // Use original dimensions if available
      const baseWidth = img.originalWidth ?? img.width;
      const baseHeight = img.originalHeight ?? img.height;
      
      // Constrain to imageMaxSize
      const scale = Math.min(GRID_CONFIG.imageMaxSize / baseWidth, GRID_CONFIG.imageMaxSize / baseHeight, 1);
      const imgW = baseWidth * scale;
      const imgH = baseHeight * scale;
      
      const cellOffsetX = (GRID_CONFIG.imageMaxSize - imgW) / 2;
      const cellOffsetY = (GRID_CONFIG.imageMaxSize - imgH) / 2;
      
      // Calculate exact position for the snapped cell
      const finalX = contentStartX + finalCol * CELL_SIZE + cellOffsetX;
      const finalY = contentStartY + finalRow * CELL_SIZE + cellOffsetY;
      
      // Update Konva node position
      const node = imageNodeRefs.current[id];
      if (node) {
        node.x(finalX);
        node.y(finalY);
      }
      
      // Update state
      setSandboxImages((prev) => prev.map((i) => {
        if (i.id === id) {
          return { 
            ...i, 
            x: finalX, 
            y: finalY,
            width: imgW,
            height: imgH,
            originalWidth: i.originalWidth ?? baseWidth,
            originalHeight: i.originalHeight ?? baseHeight,
          };
        }
        if (swapImgId && i.id === swapImgId && swapX !== undefined && swapY !== undefined) {
          return { ...i, x: swapX, y: swapY };
        }
        return i;
      }));
      return;
    }

    // Image moved outside folders - restore original size if available (same as main app)
    setSandboxImages((prev) => prev.map((i) => {
      if (i.id === id) {
        // If image was removed from folder, restore original size
        if (oldFolderId && !targetFolderId && i.originalWidth && i.originalHeight) {
          return { ...i, x, y, width: i.originalWidth, height: i.originalHeight, folderId: undefined };
        }
        return { ...i, x, y };
      }
      return i;
    }));
  }, [sandboxImages, sandboxFolders]);

  const handleExportClick = useCallback(() => {
    if (onSignInClick) onSignInClick();
  }, [onSignInClick]);

  const handleStageMouseDown = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.target === e.target.getStage()) setSelectedId(null);
  }, []);

  const updateImageEdit = useCallback((id: string, updates: Partial<SandboxImage>) => {
    setSandboxImages((prev) => prev.map((img) => (img.id === id ? { ...img, ...updates } : img)));
  }, []);

  const handleDeleteImage = useCallback(() => {
    if (!selectedId) return;
    setSandboxImages((prev) => prev.filter((img) => img.id !== selectedId));
    setSandboxFolders((prev) =>
      prev
        .map((f) => ({ ...f, imageIds: f.imageIds.filter((id) => id !== selectedId) }))
        .filter((f) => f.imageIds.length > 0)
    );
    setSelectedId(null);
    setActivePanel(null);
  }, [selectedId]);

  const selectedImage = selectedId ? sandboxImages.find((i) => i.id === selectedId) : null;
  const canAddMore = true; // No limit on photos in sandbox
  const isEmpty = sandboxImages.length === 0;
  const containerCursor = cursorOverImage ? 'pointer' : isSpacePressed ? (isDragging ? 'grabbing' : 'grab') : 'default';

  const isCurveModified = (points: CurvePoint[]) => {
    if (!points || points.length === 0) return false;
    if (points.length > 2) return true;
    return points.some((p, i) => (i === 0 ? p.x !== 0 || p.y !== 0 : i === points.length - 1 ? p.x !== 255 || p.y !== 255 : true));
  };
  const isCurvesModified = selectedImage?.curves && (
    isCurveModified(selectedImage.curves.rgb) || isCurveModified(selectedImage.curves.red) ||
    isCurveModified(selectedImage.curves.green) || isCurveModified(selectedImage.curves.blue)
  );
  const isLightModified = selectedImage && (
    (selectedImage.exposure ?? 0) !== 0 || (selectedImage.contrast ?? 0) !== 0 ||
    (selectedImage.highlights ?? 0) !== 0 || (selectedImage.shadows ?? 0) !== 0 ||
    (selectedImage.whites ?? 0) !== 0 || (selectedImage.blacks ?? 0) !== 0
  );
  const isColorModified = selectedImage && (
    (selectedImage.temperature ?? 0) !== 0 || (selectedImage.vibrance ?? 0) !== 0 || (selectedImage.saturation ?? 0) !== 0
  );
  const isEffectsModified = selectedImage && (
    (selectedImage.clarity ?? 0) !== 0 || (selectedImage.dehaze ?? 0) !== 0 ||
    (selectedImage.vignette ?? 0) !== 0 || (selectedImage.grain ?? 0) !== 0
  );

  return (
    <div className="relative w-full max-w-5xl mx-auto">
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT}
        multiple
        className="hidden"
        aria-label="Add photos"
        onChange={handleFileSelect}
      />
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <p className="text-sm text-[#888]">
          {isEmpty
            ? 'Drop or click to add photos'
            : `${sandboxImages.length} photo${sandboxImages.length === 1 ? '' : 's'} — drag to move, Space + drag to pan, Ctrl + scroll to zoom`}
        </p>
        {canAddMore && (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="shrink-0 px-3 py-1.5 text-sm font-medium text-[#3ECF8E] bg-[#3ECF8E]/10 hover:bg-[#3ECF8E]/20 rounded-lg transition-colors cursor-pointer"
          >
            {isEmpty ? 'Add photos' : 'Add more'}
          </button>
        )}
        {!isEmpty && !selectedImage && (
          <button
            type="button"
            onClick={handleExportClick}
            className="shrink-0 px-3 py-1.5 text-sm font-medium text-[#3ECF8E] bg-[#3ECF8E]/10 hover:bg-[#3ECF8E]/20 rounded-lg transition-colors cursor-pointer"
          >
            Export — sign up
          </button>
        )}
      </div>

      <div
        ref={containerRef}
        className={`relative w-full rounded-xl border-2 border-dashed transition-colors ${
          isDragOver ? 'border-[#3ECF8E] bg-[#3ECF8E]/5' : 'border-[#333] bg-[#0d0d0d]'
        }`}
        style={{ minHeight: 480, height: 480, cursor: containerCursor }}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >

        <Stage
          ref={stageRef}
          width={dimensions.width}
          height={dimensions.height}
          scaleX={stageScale}
          scaleY={stageScale}
          x={stagePosition.x}
          y={stagePosition.y}
          draggable={isSpacePressed}
          onWheel={handleWheel}
          onMouseDown={(e) => {
            const clickedOnEmpty = e.target === e.target.getStage();
            if (zoomedId && clickedOnEmpty && e.evt.button === 0) {
              const pre = preZoomViewRef.current;
              if (pre) {
                animateView(
                  { scale: stageScale, x: stagePosition.x, y: stagePosition.y },
                  { scale: pre.scale, x: pre.x, y: pre.y },
                  () => setZoomedId(null)
                );
              } else {
                setZoomedId(null);
              }
              return;
            }
            handleStageMouseDown(e);
            if (isSpacePressed) setIsDragging(true);
          }}
          onMouseUp={() => setIsDragging(false)}
          onDragStart={() => isSpacePressed && setIsDragging(true)}
          onDragEnd={(e) => {
            if (isSpacePressed) {
              setStagePosition({ x: e.target.x(), y: e.target.y() });
              setIsDragging(false);
            }
          }}
        >
          <Layer>
            {sandboxFolders.map((folder) => {
              const count = folder.imageIds.length;
              const borderHeight = getFolderBorderHeight(count, folder.width, folder.height);
              const borderY = folder.y + LABEL_HEIGHT;
              const borderH = Math.max(borderHeight, 80);
              const isHovered = hoveredFolderBorder === folder.id;
              const isResizing = resizingFolderId === folder.id;
              return (
                <Group key={folder.id}>
                  {/* Folder label — Group at folder pos, draggable like main app */}
                  <Group 
                    x={folder.x} 
                    y={folder.y} 
                    draggable={true}
                    listening={true}
                    onMouseEnter={(e) => {
                      const container = e.target.getStage()?.container();
                      if (container) container.style.cursor = 'pointer';
                    }}
                    onMouseLeave={(e) => {
                      const container = e.target.getStage()?.container();
                      if (container) container.style.cursor = 'default';
                    }}
                    onDragMove={(e) => {
                      const newX = e.target.x();
                      const newY = e.target.y();
                      
                      // Update folder position
                      const updatedFolders = sandboxFolders.map((f) =>
                        f.id === folder.id ? { ...f, x: newX, y: newY } : f
                      );
                      
                      // Reflow images in the folder to match new position
                      const folderImgs = sandboxImages.filter(img => folder.imageIds.includes(img.id));
                      let updatedImages = [...sandboxImages];
                      if (folderImgs.length > 0) {
                        const reflowedImages = reflowSandboxImagesInFolder(folderImgs, newX, newY, folder.width, folder.height);
                        updatedImages = sandboxImages.map((img) => {
                          const reflowed = reflowedImages.find(r => r.id === img.id);
                          return reflowed ? reflowed : img;
                        });
                      }
                      
                      setSandboxFolders(updatedFolders);
                      setSandboxImages(updatedImages);
                    }}
                    onDragEnd={(e) => {
                      const newX = e.target.x();
                      const newY = e.target.y();
                      
                      // Final update with reflow
                      const updatedFolders = sandboxFolders.map((f) =>
                        f.id === folder.id ? { ...f, x: newX, y: newY } : f
                      );
                      
                      const folderImgs = sandboxImages.filter(img => folder.imageIds.includes(img.id));
                      let updatedImages = [...sandboxImages];
                      if (folderImgs.length > 0) {
                        const reflowedImages = reflowSandboxImagesInFolder(folderImgs, newX, newY, folder.width, folder.height);
                        updatedImages = sandboxImages.map((img) => {
                          const reflowed = reflowedImages.find(r => r.id === img.id);
                          return reflowed ? reflowed : img;
                        });
                      }
                      
                      setSandboxFolders(updatedFolders);
                      setSandboxImages(updatedImages);
                    }}
                  >
                    <Text
                      ref={(el) => {
                        if (el) {
                          folderLabelRefs.current[folder.id] = el;
                          requestAnimationFrame(() => {
                            const w = el.width();
                            setFolderLabelWidths((prev) => (prev[folder.id] === w ? prev : { ...prev, [folder.id]: w }));
                          });
                        }
                      }}
                      x={0}
                      y={0}
                      text={folder.name.toUpperCase()}
                      fontFamily="PP Fraktion Mono"
                      fontSize={16}
                      fontStyle="600"
                      letterSpacing={2}
                      fill={folder.color}
                      listening={true}
                    />
                  </Group>
                  {/* Folder border — dashed stroke, hover = solid + shadow (match app) */}
                  <Rect
                    x={folder.x}
                    y={borderY}
                    width={folder.width}
                    height={borderH}
                    stroke={folder.color}
                    strokeWidth={isHovered ? 3 : 1}
                    cornerRadius={12}
                    dash={isHovered ? undefined : [8, 4]}
                    opacity={isHovered ? 0.9 : 0.4}
                    shadowColor={folder.color}
                    shadowBlur={isHovered ? 20 : 0}
                    shadowOpacity={isHovered ? 0.6 : 0}
                    listening={true}
                    onMouseEnter={() => setHoveredFolderBorder(folder.id)}
                    onMouseLeave={() => setHoveredFolderBorder(null)}
                  />
                  {/* Resize handle — bottom-right, draggable to resize folder */}
                  <Rect
                    x={folder.x + folder.width - 20}
                    y={borderY + borderH - 20}
                    width={20}
                    height={20}
                    fill={isHovered || resizingFolderId === folder.id ? folder.color : 'transparent'}
                    opacity={isHovered || resizingFolderId === folder.id ? 0.6 : 0}
                    cornerRadius={4}
                    draggable={true}
                    dragBoundFunc={(pos) => pos}
                    listening={true}
                    onMouseEnter={(e) => {
                      const container = e.target.getStage()?.container();
                      if (container) container.style.cursor = 'nwse-resize';
                      setHoveredFolderBorder(folder.id);
                    }}
                    onMouseLeave={(e) => {
                      const container = e.target.getStage()?.container();
                      if (container && !resizingFolderId) container.style.cursor = 'default';
                      if (!resizingFolderId) setHoveredFolderBorder(null);
                    }}
                    onDragStart={() => {
                      setResizingFolderId(folder.id);
                    }}
                    onDragMove={(e) => {
                      const handleSize = 20;
                      const currentFolder = sandboxFolders.find(f => f.id === folder.id) || folder;
                      const proposedWidth = Math.max(GRID_CONFIG.minFolderWidth, e.target.x() - currentFolder.x + handleSize);
                      const proposedContentHeight = Math.max(100, e.target.y() - borderY + handleSize);
                      const proposedHeight = LABEL_HEIGHT + proposedContentHeight;
                      
                      // Get folder images
                      const folderImgs = sandboxImages.filter(img => currentFolder.imageIds.includes(img.id));
                      
                      // Calculate columns from proposed width
                      const proposedCols = calculateColsFromWidth(proposedWidth);
                      
                      // Calculate minimum size needed for all images
                      const rowsNeeded = Math.ceil(folderImgs.length / proposedCols) || 1;
                      const minContentHeight = rowsNeeded * CELL_SIZE + (2 * GRID_CONFIG.folderPadding);
                      const minHeight = LABEL_HEIGHT + Math.max(minContentHeight, 100);
                      
                      // Snap width to grid (exact fit for columns with proper padding)
                      const snappedWidth = (2 * GRID_CONFIG.folderPadding) + (proposedCols * CELL_SIZE) - GRID_CONFIG.imageGap;
                      
                      // Snap height to grid (based on rows needed)
                      const snappedContentHeight = (2 * GRID_CONFIG.folderPadding) + (rowsNeeded * CELL_SIZE) - GRID_CONFIG.imageGap;
                      const snappedHeight = LABEL_HEIGHT + Math.max(snappedContentHeight, 100);
                      
                      // Enforce minimum size (can't shrink smaller than needed)
                      const newWidth = Math.max(snappedWidth, GRID_CONFIG.minFolderWidth);
                      const newHeight = Math.max(snappedHeight, minHeight);
                      
                      // Keep handle at bottom-right corner
                      e.target.x(currentFolder.x + newWidth - handleSize);
                      e.target.y(borderY + (newHeight - LABEL_HEIGHT) - handleSize);
                      
                      // Update folder with new dimensions
                      const updatedFolders = sandboxFolders.map((f) =>
                        f.id === currentFolder.id ? { ...f, width: newWidth, height: newHeight } : f
                      );
                      
                      // Reflow images in the folder with new dimensions
                      let updatedImages = [...sandboxImages];
                      if (folderImgs.length > 0) {
                        const reflowedImages = reflowSandboxImagesInFolder(
                          folderImgs,
                          currentFolder.x,
                          currentFolder.y,
                          newWidth,
                          newHeight
                        );
                        updatedImages = sandboxImages.map((img) => {
                          const reflowed = reflowedImages.find(r => r.id === img.id);
                          return reflowed ? reflowed : img;
                        });
                      }
                      
                      setSandboxFolders(updatedFolders);
                      setSandboxImages(updatedImages);
                    }}
                    onDragEnd={(e) => {
                      const container = e.target.getStage()?.container();
                      if (container) container.style.cursor = 'default';
                      setResizingFolderId(null);
                      setHoveredFolderBorder(null);
                      
                      // Final snap to grid and reflow
                      const resizedFolder = sandboxFolders.find(f => f.id === folder.id);
                      if (resizedFolder) {
                        const folderImgs = sandboxImages.filter(img => resizedFolder.imageIds.includes(img.id));
                        
                        if (folderImgs.length === 0) {
                          // No images - just finalize dimensions
                          return;
                        }
                        
                        // Calculate snapped dimensions based on grid
                        const cols = calculateColsFromWidth(resizedFolder.width);
                        const rowsNeeded = Math.ceil(folderImgs.length / cols) || 1;
                        
                        // Snap width to grid
                        const snappedWidth = (2 * GRID_CONFIG.folderPadding) + (cols * CELL_SIZE) - GRID_CONFIG.imageGap;
                        
                        // Snap height to grid (ensure it fits all images)
                        const snappedContentHeight = (2 * GRID_CONFIG.folderPadding) + (rowsNeeded * CELL_SIZE) - GRID_CONFIG.imageGap;
                        const snappedHeight = LABEL_HEIGHT + Math.max(snappedContentHeight, 100);
                        
                        // Update folder with snapped dimensions
                        const finalFolders = sandboxFolders.map((f) =>
                          f.id === resizedFolder.id ? { ...f, width: snappedWidth, height: snappedHeight } : f
                        );
                        
                        // Reflow images with final snapped dimensions
                        const reflowedImages = reflowSandboxImagesInFolder(
                          folderImgs,
                          resizedFolder.x,
                          resizedFolder.y,
                          snappedWidth,
                          snappedHeight
                        );
                        
                        setSandboxFolders(finalFolders);
                        setSandboxImages((prev) =>
                          prev.map((img) => {
                            const reflowed = reflowedImages.find(r => r.id === img.id);
                            return reflowed ? reflowed : img;
                          })
                        );
                      }
                    }}
                  />
                </Group>
              );
            })}
            {sandboxImages.map((img) => (
              <SandboxImageNode
                key={img.id}
                img={img}
                isZoomed={zoomedId === img.id}
                isSelected={selectedId === img.id}
                onSelect={() => setSelectedId(img.id)}
                onDoubleClick={() => handleImageDoubleClick(img)}
                onDragMove={handleImageDragMove}
                onDragEnd={(x, y) => handleImageDragEnd(img.id, x, y)}
                onCursorOverImage={setCursorOverImage}
                isSpacePressed={isSpacePressed}
                onNodeRef={(node: Konva.Image | null) => {
                  if (node) imageNodeRefs.current[img.id] = node;
                  else delete imageNodeRefs.current[img.id];
                }}
              />
            ))}
          </Layer>
        </Stage>

        {isEmpty && canAddMore && (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="absolute inset-0 flex items-center justify-center cursor-pointer group"
            aria-label="Add photos"
          >
            <p className="text-[#555] group-hover:text-[#3ECF8E]/80 text-sm transition-colors">
              Drop or click to add photos
            </p>
          </button>
        )}
      </div>

      {/* Edit toolbar (same look as main app): Light, Curves, Color, Effects — no HSL; Export = sign up */}
      {selectedImage && selectedId && (
        <div className="absolute left-1/2 -translate-x-1/2 z-10 mt-3" style={{ top: '540px' }}>
          {/* Main toolbar — same structure as EditPanel */}
          <div className="bg-[#171717] border border-[#2a2a2a] rounded-xl shadow-2xl shadow-black/50 backdrop-blur-xl">
            <div className="px-4 py-3">
              <div className="flex items-center gap-2">
                {/* Curves button with popup */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setActivePanel(activePanel === 'curves' ? null : 'curves')}
                    className={`flex flex-col items-center gap-1 px-3 py-2 rounded-lg transition-all duration-150 cursor-pointer ${
                      activePanel === 'curves' || isCurvesModified ? 'bg-[#3ECF8E]/20 text-[#3ECF8E]' : 'bg-[#252525] text-[#999] hover:bg-[#333] hover:text-white'
                    }`}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 20 C 8 20, 8 4, 12 4 C 16 4, 16 20, 20 20" />
                    </svg>
                    <span className="text-[10px] font-medium uppercase tracking-wider">Curves</span>
                  </button>
                  {activePanel === 'curves' && (
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 z-20 mb-2">
                      <CurvesEditor
                        curves={selectedImage.curves ?? DEFAULT_CURVES}
                        onChange={(curves) => updateImageEdit(selectedId, { curves })}
                        onClose={() => setActivePanel(null)}
                      />
                    </div>
                  )}
                </div>
                
                {/* Light button with popup */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setActivePanel(activePanel === 'light' ? null : 'light')}
                    className={`flex flex-col items-center gap-1 px-3 py-2 rounded-lg transition-all duration-150 cursor-pointer ${
                      activePanel === 'light' || isLightModified ? 'bg-[#3ECF8E]/20 text-[#3ECF8E]' : 'bg-[#252525] text-[#999] hover:bg-[#333] hover:text-white'
                    }`}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                    <span className="text-[10px] font-medium uppercase tracking-wider">Light</span>
                  </button>
                  {activePanel === 'light' && (
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 z-20 mb-2">
                      <div className="bg-[#171717] border border-[#2a2a2a] rounded-xl shadow-2xl shadow-black/50 p-2.5 min-w-[256px] max-w-fit">
                        <div className="flex items-center justify-between mb-1.5">
                          <h3 className="text-xs font-medium text-white">Light</h3>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => updateImageEdit(selectedId, { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 })}
                              className="text-[10px] text-[#888] hover:text-white transition-colors cursor-pointer"
                            >
                              Reset
                            </button>
                            <button type="button" onClick={() => setActivePanel(null)} className="p-0.5 text-[#888] hover:text-white transition-colors cursor-pointer">
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <SandboxSlider label="Exposure" value={selectedImage.exposure ?? 0} min={-1} max={1} step={0.01} defaultValue={0} onChange={(v) => updateImageEdit(selectedId, { exposure: v })} />
                          <SandboxSlider label="Contrast" value={selectedImage.contrast ?? 0} min={-1} max={1} step={0.01} defaultValue={0} onChange={(v) => updateImageEdit(selectedId, { contrast: v })} />
                          <SandboxSlider label="Highlights" value={selectedImage.highlights ?? 0} min={-1} max={1} step={0.01} defaultValue={0} onChange={(v) => updateImageEdit(selectedId, { highlights: v })} />
                          <SandboxSlider label="Shadows" value={selectedImage.shadows ?? 0} min={-1} max={1} step={0.01} defaultValue={0} onChange={(v) => updateImageEdit(selectedId, { shadows: v })} />
                          <SandboxSlider label="Whites" value={selectedImage.whites ?? 0} min={-1} max={1} step={0.01} defaultValue={0} onChange={(v) => updateImageEdit(selectedId, { whites: v })} />
                          <SandboxSlider label="Blacks" value={selectedImage.blacks ?? 0} min={-1} max={1} step={0.01} defaultValue={0} onChange={(v) => updateImageEdit(selectedId, { blacks: v })} />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                
                {/* Color button with popup */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setActivePanel(activePanel === 'color' ? null : 'color')}
                    className={`flex flex-col items-center gap-1 px-3 py-2 rounded-lg transition-all duration-150 cursor-pointer ${
                      activePanel === 'color' || isColorModified ? 'bg-[#3ECF8E]/20 text-[#3ECF8E]' : 'bg-[#252525] text-[#999] hover:bg-[#333] hover:text-white'
                    }`}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                    </svg>
                    <span className="text-[10px] font-medium uppercase tracking-wider">Color</span>
                  </button>
                  {activePanel === 'color' && (
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 z-20 mb-2">
                      <div className="bg-[#171717] border border-[#2a2a2a] rounded-xl shadow-2xl shadow-black/50 p-2.5 min-w-[256px] max-w-fit">
                        <div className="flex items-center justify-between mb-1.5">
                          <h3 className="text-xs font-medium text-white">Color</h3>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => updateImageEdit(selectedId, { temperature: 0, vibrance: 0, saturation: 0 })}
                              className="text-[10px] text-[#888] hover:text-white transition-colors cursor-pointer"
                            >
                              Reset
                            </button>
                            <button type="button" onClick={() => setActivePanel(null)} className="p-0.5 text-[#888] hover:text-white transition-colors cursor-pointer">
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2.5">
                            <span className="text-[10px] text-[#888] w-18">Temp</span>
                            <div className="flex items-center gap-2 flex-1">
                              <span className="text-[9px] text-[#74c0fc]">Cool</span>
                              <input
                                type="range"
                                min={-1}
                                max={1}
                                step={0.01}
                                value={selectedImage.temperature ?? 0}
                                onChange={(e) => updateImageEdit(selectedId, { temperature: parseFloat(e.target.value) })}
                                onDoubleClick={() => updateImageEdit(selectedId, { temperature: 0 })}
                                className="flex-1 h-1 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:cursor-pointer"
                                style={{ background: 'linear-gradient(to right, #74c0fc, #ff9f43)' }}
                              />
                              <span className="text-[9px] text-[#ff9f43]">Warm</span>
                            </div>
                          </div>
                          <SandboxSlider label="Vibrance" value={selectedImage.vibrance ?? 0} min={-1} max={1} step={0.01} defaultValue={0} onChange={(v) => updateImageEdit(selectedId, { vibrance: v })} />
                          <SandboxSlider label="Saturation" value={selectedImage.saturation ?? 0} min={-1} max={1} step={0.01} defaultValue={0} onChange={(v) => updateImageEdit(selectedId, { saturation: v })} />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                
                {/* Effects button with popup */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setActivePanel(activePanel === 'effects' ? null : 'effects')}
                    className={`flex flex-col items-center gap-1 px-3 py-2 rounded-lg transition-all duration-150 cursor-pointer ${
                      activePanel === 'effects' || isEffectsModified ? 'bg-[#3ECF8E]/20 text-[#3ECF8E]' : 'bg-[#252525] text-[#999] hover:bg-[#333] hover:text-white'
                    }`}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                    </svg>
                    <span className="text-[10px] font-medium uppercase tracking-wider">Effects</span>
                  </button>
                  {activePanel === 'effects' && (
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 z-20 mb-2">
                      <div className="bg-[#171717] border border-[#2a2a2a] rounded-xl shadow-2xl shadow-black/50 p-3 min-w-[256px] max-w-fit">
                        <div className="flex items-center justify-between mb-2">
                          <h3 className="text-xs font-medium text-white">Effects</h3>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => updateImageEdit(selectedId, { clarity: 0, dehaze: 0, vignette: 0, grain: 0 })}
                              className="text-[10px] text-[#888] hover:text-white transition-colors cursor-pointer"
                            >
                              Reset
                            </button>
                            <button type="button" onClick={() => setActivePanel(null)} className="p-1 text-[#888] hover:text-white transition-colors cursor-pointer">
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                          </div>
                        </div>
                        <div className="space-y-2.5">
                          <SandboxSlider label="Clarity" value={selectedImage.clarity ?? 0} min={-1} max={1} step={0.01} defaultValue={0} onChange={(v) => updateImageEdit(selectedId, { clarity: v })} />
                          <SandboxSlider label="Dehaze" value={selectedImage.dehaze ?? 0} min={-1} max={1} step={0.01} defaultValue={0} onChange={(v) => updateImageEdit(selectedId, { dehaze: v })} />
                          <SandboxSlider label="Vignette" value={selectedImage.vignette ?? 0} min={0} max={1} step={0.01} defaultValue={0} onChange={(v) => updateImageEdit(selectedId, { vignette: v })} />
                          <SandboxSlider label="Grain" value={selectedImage.grain ?? 0} min={0} max={1} step={0.01} defaultValue={0} onChange={(v) => updateImageEdit(selectedId, { grain: v })} />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                <div className="w-px h-10 bg-[#333] mx-1" />
                <button
                  type="button"
                  onClick={handleDeleteImage}
                  className="p-2 rounded-lg bg-[#252525] text-[#f87171] hover:bg-[#3a2020] transition-colors cursor-pointer"
                  title="Delete photo"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={handleExportClick}
                  className="p-2 rounded-lg bg-[#6366f1]/20 text-[#6366f1] hover:bg-[#6366f1]/30 transition-colors cursor-pointer"
                  title="Sign up to export"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
