'use client';

import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { Stage, Layer, Image as KonvaImage, Rect, Text, Group } from 'react-konva';
import useImage from 'use-image';
import Konva from 'konva';
import { CurvesEditor } from './CurvesEditor';
import { buildSandboxFilterList } from '@/lib/sandboxFilters';

const MAX_PHOTOS = 3;
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

function getFolderBorderHeight(imageCount: number, folderWidth: number): number {
  if (imageCount === 0) return 100;
  // Sandbox folders always use single row (max 3 photos)
  const rowHeight = GRID_CONFIG.imageMaxSize;
  return rowHeight + GRID_CONFIG.folderPadding * 2;
}

type SandboxFolder = {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  imageIds: string[];
  color: string;
};

function reflowSandboxImagesInFolder(
  images: SandboxImage[],
  folderX: number,
  folderY: number,
  folderWidth: number
): SandboxImage[] {
  const { folderPadding, imageMaxSize } = GRID_CONFIG;
  const contentStartX = folderX + folderPadding;
  const contentStartY = folderY + LABEL_HEIGHT + folderPadding;
  
  // Sandbox folders always use single row with 3 columns (max 3 photos)
  const cols = 3;
  const row = 0; // Always row 0 (single row)

  return images.map((img, index) => {
    const col = index % cols;
    const scale = Math.min(imageMaxSize / img.width, imageMaxSize / img.height, 1);
    const w = img.width * scale;
    const h = img.height * scale;
    const cellOffsetX = (imageMaxSize - w) / 2;
    const cellOffsetY = (imageMaxSize - h) / 2;
    return {
      ...img,
      x: contentStartX + col * CELL_SIZE + cellOffsetX,
      y: contentStartY + row * CELL_SIZE + cellOffsetY,
      width: w,
      height: h,
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
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-[#888] w-20">{label}</span>
      <div className="flex items-center gap-2 flex-1">
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
        <span className="text-[10px] text-[#666] w-8 text-right tabular-nums">
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
  onDragEnd,
  onCursorOverImage,
  onNodeRef,
}: {
  img: SandboxImage;
  isZoomed: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onDoubleClick: () => void;
  onDragEnd: (x: number, y: number) => void;
  onCursorOverImage: (over: boolean) => void;
  onNodeRef?: (node: Konva.Image | null) => void;
}) {
  const nodeRef = useRef<Konva.Image>(null);
  const [image] = useImage(img.url, 'anonymous');
  const filterList = useMemo(() => buildSandboxFilterList(img), [img]);
  const hasFilters = filterList.length > 0;

  useEffect(() => {
    if (!image || !nodeRef.current) return;
    if (hasFilters) {
      nodeRef.current.cache({ pixelRatio: Math.min(window.devicePixelRatio, 2) });
    } else {
      nodeRef.current.filters([]);
    }
  }, [image, hasFilters, filterList]);

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
      filters={hasFilters ? filterList : undefined}
      onMouseEnter={() => onCursorOverImage(true)}
      onMouseLeave={() => onCursorOverImage(false)}
      onClick={(e) => e.evt.button === 0 && onSelect()}
      onDblClick={onDoubleClick}
      onDragEnd={(e) => onDragEnd(e.target.x(), e.target.y())}
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
  const folderLabelRefs = useRef<Record<string, Konva.Text>>({});

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

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        setIsSpacePressed(true);
      }
      if (e.code === 'Escape') setZoomedId(null);
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
  }, []);

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
        targetFolder.width
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
    const toAdd = files.slice(0, MAX_PHOTOS - sandboxImages.length);
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
    const toAdd = files.slice(0, MAX_PHOTOS - sandboxImages.length);
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
    setZoomedId(null);
  }, []);

  const getSnappedPositionInFolder = useCallback((img: SandboxImage, x: number, y: number, folder: SandboxFolder): { x: number; y: number } | null => {
    const folderImages = sandboxImages.filter((i) => i.folderId === folder.id);
    if (folderImages.length > 3) return null; // Use grid snapping for >3 images
    
    const { folderPadding, imageMaxSize } = GRID_CONFIG;
    const contentStartX = folder.x + folderPadding;
    const contentStartY = folder.y + LABEL_HEIGHT + folderPadding;
    const contentWidth = folder.width - folderPadding * 2;
    const slotGap = 8;
    const slotWidth = (contentWidth - slotGap * 2) / 3; // Always 3 slots
    
    // Calculate slot centers
    const slotCenters: number[] = [];
    for (let i = 0; i < 3; i++) {
      const slotLeft = contentStartX + i * (slotWidth + slotGap);
      slotCenters.push(slotLeft + slotWidth / 2);
    }
    
    // Find nearest slot
    const dropCenterX = x + img.width / 2;
    let nearestSlotIndex = 0;
    let minDist = Math.abs(dropCenterX - slotCenters[0]);
    for (let i = 1; i < 3; i++) {
      const dist = Math.abs(dropCenterX - slotCenters[i]);
      if (dist < minDist) {
        minDist = dist;
        nearestSlotIndex = i;
      }
    }
    
    // Calculate snapped position for nearest slot
    const slotLeft = contentStartX + nearestSlotIndex * (slotWidth + slotGap);
    const maxW = Math.min(slotWidth - slotGap, imageMaxSize);
    const maxH = Math.min(imageMaxSize - slotGap, imageMaxSize);
    const scale = Math.min(maxW / img.width, maxH / img.height, 1);
    const w = img.width * scale;
    const h = img.height * scale;
    const snappedX = slotLeft + (slotWidth - w) / 2;
    const snappedY = contentStartY + (imageMaxSize - h) / 2;
    
    return { x: snappedX, y: snappedY };
  }, [sandboxImages]);


  const handleImageDragEnd = useCallback((id: string, x: number, y: number) => {
    const img = sandboxImages.find((i) => i.id === id);
    if (!img) return;

    const centerX = x + img.width / 2;
    const centerY = y + img.height / 2;
    const oldFolderId = img.folderId;

    let targetFolderId: string | undefined;
    let targetFolder: SandboxFolder | undefined;
    for (const folder of sandboxFolders) {
      const contentHeight = getFolderBorderHeight(folder.imageIds.length, folder.width);
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
        const updatedFolders = sandboxFolders
          .map((f) => (f.id === oldFolderId ? { ...f, imageIds: f.imageIds.filter((i) => i !== id) } : f))
          .filter((f) => f.imageIds.length > 0)
          .concat(newFolder);
        const folderImages = sandboxImages.filter((i) => i.id === id);
        const reflowed = reflowSandboxImagesInFolder(folderImages, newFolder.x, newFolder.y, newFolder.width);
        const updatedImages = sandboxImages.map((i) => (i.id === id ? { ...reflowed[0], folderId: newFolderId } : i));
        setSandboxFolders(updatedFolders);
        setSandboxImages(updatedImages);
        return;
      }

      if (targetFolderId && targetFolder) {
        // When moving image INTO a folder, ALWAYS snap to one of exactly 3 positions
        const contentStartX = targetFolder.x + GRID_CONFIG.folderPadding;
        const contentStartY = targetFolder.y + LABEL_HEIGHT + GRID_CONFIG.folderPadding;
        
        // Sandbox folders always have exactly 3 column positions
        const cols = 3;
        const row = 0;
        
        // Calculate the exact center X for each of the 3 spots
        const spotCenterXs: number[] = [];
        for (let col = 0; col < cols; col++) {
          const spotCenterX = contentStartX + col * CELL_SIZE + GRID_CONFIG.imageMaxSize / 2;
          spotCenterXs.push(spotCenterX);
        }
        
        // Find which of the 3 spots is closest to the image's center
        // Use image center (x + width/2) to determine nearest spot based on X
        // Y is ALWAYS snapped to row 0 regardless of drop Y position
        const imageCenterX = x + (img.width || GRID_CONFIG.imageMaxSize) / 2;
        let nearestSpotIndex = 0;
        let minDist = Math.abs(imageCenterX - spotCenterXs[0]);
        for (let spot = 1; spot < cols; spot++) {
          const dist = Math.abs(imageCenterX - spotCenterXs[spot]);
          if (dist < minDist) {
            minDist = dist;
            nearestSpotIndex = spot;
          }
        }
        
        // ALWAYS snap to this nearest spot (one of exactly 3 positions: 0, 1, or 2)
        // Y will always be snapped to row 0 (single row layout)
        const targetCol = nearestSpotIndex;
        
        const imgW = Math.min(img.width, GRID_CONFIG.imageMaxSize);
        const imgH = Math.min(img.height, GRID_CONFIG.imageMaxSize);
        const cellOffsetX = (GRID_CONFIG.imageMaxSize - imgW) / 2;
        const cellOffsetY = (GRID_CONFIG.imageMaxSize - imgH) / 2;
        
        // Calculate exact position for the snapped spot
        // X snaps to one of 3 column positions, Y ALWAYS snaps to row 0
        // This ensures that no matter where you drop (X, Y), it snaps to one of 3 exact positions
        const newX = contentStartX + targetCol * CELL_SIZE + cellOffsetX;
        const newY = contentStartY + row * CELL_SIZE + cellOffsetY; // Always row 0, regardless of drop Y

        const updatedFolders = sandboxFolders.map((f) => {
          if (f.id === oldFolderId) return { ...f, imageIds: f.imageIds.filter((i) => i !== id) };
          if (f.id === targetFolderId) return { ...f, imageIds: [...f.imageIds, id] };
          return f;
        }).filter((f) => f.imageIds.length > 0);

        const movedImg = { ...img, x: newX, y: newY, folderId: targetFolderId };
        const targetFolderImages = sandboxImages
          .filter((i) => (i.folderId === targetFolderId && i.id !== id) || i.id === id)
          .map((i) => (i.id === id ? movedImg : i));
        
        // Reflow all images in target folder to ensure they're in correct 3-position layout
        const reflowed = reflowSandboxImagesInFolder(
          targetFolderImages,
          targetFolder.x,
          targetFolder.y,
          targetFolder.width
        );
        
        // Find the final snapped position for the moved image
        const reflowedImg = reflowed.find((r) => r.id === id);
        const finalX = reflowedImg ? reflowedImg.x : newX;
        const finalY = reflowedImg ? reflowedImg.y : newY;
        
        // Update Konva node position FIRST to prevent visual glitch
        const node = imageNodeRefs.current[id];
        if (node) {
          node.x(finalX);
          node.y(finalY);
        }
        
        const updatedImages = sandboxImages.map((i) => {
          if (i.id === id) {
            // Use reflowed position to ensure it's in one of the 3 spots
            return reflowedImg ? { ...movedImg, x: reflowedImg.x, y: reflowedImg.y, width: reflowedImg.width, height: reflowedImg.height } : movedImg;
          }
          if (i.folderId === targetFolderId) {
            const r = reflowed.find((x) => x.id === i.id);
            return r ? r : i;
          }
          if (i.folderId === oldFolderId) {
            const remaining = sandboxImages.filter((im) => im.folderId === oldFolderId && im.id !== id);
            const reflowedOld = reflowSandboxImagesInFolder(
              remaining,
              sandboxFolders.find((f) => f.id === oldFolderId)!.x,
              sandboxFolders.find((f) => f.id === oldFolderId)!.y,
              sandboxFolders.find((f) => f.id === oldFolderId)!.width
            );
            const rr = reflowedOld.find((x) => x.id === i.id);
            return rr ? rr : i;
          }
          return i;
        });
        setSandboxFolders(updatedFolders);
        setSandboxImages(updatedImages);
        return;
      }
    }

    if (targetFolderId && targetFolder && targetFolderId === oldFolderId) {
      // ALWAYS snap to one of exactly 3 positions when dropped in folder - NO EXCEPTIONS
      const folderImages = sandboxImages.filter((i) => i.folderId === targetFolderId);
      const { folderPadding, imageMaxSize } = GRID_CONFIG;
      const contentStartX = targetFolder.x + folderPadding;
      const contentStartY = targetFolder.y + LABEL_HEIGHT + folderPadding;
      
      // Sandbox folders always have exactly 3 column positions (0, 1, 2)
      const cols = 3;
      const row = 0;
      
      // Calculate the exact center X for each of the 3 spots
      const spotCenterXs: number[] = [];
      for (let col = 0; col < cols; col++) {
        const spotCenterX = contentStartX + col * CELL_SIZE + imageMaxSize / 2;
        spotCenterXs.push(spotCenterX);
      }
      
      // Find which of the 3 spots is closest to the image's center
      // Use image center (x + width/2) to determine nearest spot based on X
      // Y is ALWAYS snapped to row 0 regardless of drop Y position
      const imageCenterX = x + (img.width || imageMaxSize) / 2;
      let nearestSpotIndex = 0;
      let minDist = Math.abs(imageCenterX - spotCenterXs[0]);
      for (let spot = 1; spot < cols; spot++) {
        const dist = Math.abs(imageCenterX - spotCenterXs[spot]);
        if (dist < minDist) {
          minDist = dist;
          nearestSpotIndex = spot;
        }
      }
      
      // ALWAYS snap to this nearest spot (one of exactly 3 positions: 0, 1, or 2)
      // Y will always be snapped to row 0 (single row layout)
      const targetCol = nearestSpotIndex;
      
      // Get other images in folder (excluding dragged one)
      const otherImages = folderImages.filter((i) => i.id !== id);
      
      // Calculate which of the 3 spots each other image occupies
      const occupiedSpots = new Set<number>();
      otherImages.forEach((otherImg) => {
        const otherImgRelativeX = otherImg.x - contentStartX;
        const otherImgCol = Math.floor(otherImgRelativeX / CELL_SIZE);
        // Clamp to valid range [0, 2]
        if (otherImgCol >= 0 && otherImgCol < cols) {
          occupiedSpots.add(otherImgCol);
        }
      });
      
      // Calculate current image's spot (if it's already in a valid spot)
      const currentImgRelativeX = img.x - contentStartX;
      const currentImgCol = Math.floor(currentImgRelativeX / CELL_SIZE);
      const isInValidSpot = currentImgCol >= 0 && currentImgCol < cols;
      
      let swapX: number | undefined;
      let swapY: number | undefined;
      let swapImgId: string | undefined;
      let finalCol = targetCol;
      
      // If target spot is occupied, swap positions
      if (occupiedSpots.has(targetCol)) {
        if (isInValidSpot) {
          // Swap: move occupied image to current image's spot
          const occupiedImg = otherImages.find((otherImg) => {
            const otherImgRelativeX = otherImg.x - contentStartX;
            const otherImgCol = Math.floor(otherImgRelativeX / CELL_SIZE);
            return otherImgCol >= 0 && otherImgCol < cols && otherImgCol === targetCol;
          });
          
          if (occupiedImg) {
            const swapImgWidth = Math.min(occupiedImg.width, imageMaxSize);
            const swapImgHeight = Math.min(occupiedImg.height, imageMaxSize);
            const swapOffsetX = (imageMaxSize - swapImgWidth) / 2;
            const swapOffsetY = (imageMaxSize - swapImgHeight) / 2;
            
            swapX = contentStartX + currentImgCol * CELL_SIZE + swapOffsetX;
            swapY = contentStartY + row * CELL_SIZE + swapOffsetY;
            swapImgId = occupiedImg.id;
          }
        } else {
          // Image coming from outside folder - find nearest empty spot
          for (let checkCol = 0; checkCol < cols; checkCol++) {
            if (!occupiedSpots.has(checkCol)) {
              finalCol = checkCol;
              break;
            }
          }
        }
      }
      
      // Calculate final position - ALWAYS one of exactly 3 spots (0, 1, or 2)
      // Ensure finalCol is always 0, 1, or 2
      finalCol = Math.max(0, Math.min(2, finalCol));
      
      const imgWidth = Math.min(img.width, imageMaxSize);
      const imgHeight = Math.min(img.height, imageMaxSize);
      const cellOffsetX = (imageMaxSize - imgWidth) / 2;
      const cellOffsetY = (imageMaxSize - imgHeight) / 2;
      
      // Calculate exact position for spot finalCol (one of 0, 1, or 2)
      const finalX = contentStartX + finalCol * CELL_SIZE + cellOffsetX;
      const finalY = contentStartY + row * CELL_SIZE + cellOffsetY;
      
      // Update Konva node position FIRST to prevent visual glitch
      const node = imageNodeRefs.current[id];
      if (node) {
        node.x(finalX);
        node.y(finalY);
      }
      
      // Then update state to match
      const updatedImages = sandboxImages.map((i) => {
        if (i.id === id) {
          return { ...i, x: finalX, y: finalY };
        }
        if (swapImgId && i.id === swapImgId && swapX !== undefined && swapY !== undefined) {
          return { ...i, x: swapX, y: swapY };
        }
        return i;
      });
      setSandboxImages(updatedImages);
      return;
    }

    setSandboxImages((prev) => prev.map((i) => (i.id === id ? { ...i, x, y } : i)));
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
  const canAddMore = sandboxImages.length < MAX_PHOTOS;
  const isEmpty = sandboxImages.length === 0;
  const containerCursor = cursorOverImage && !isSpacePressed ? 'pointer' : isSpacePressed ? (isDragging ? 'grabbing' : 'grab') : 'default';

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
    <div className="w-full max-w-5xl mx-auto">
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
            ? 'Drop or click to add up to 3 photos'
            : `${sandboxImages.length} / ${MAX_PHOTOS} photos — drag to move, Space + drag to pan, Ctrl + scroll to zoom`}
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
        {zoomedId && (
          <div
            className="absolute inset-0 z-20 bg-black/90 flex items-center justify-center cursor-pointer"
            onClick={() => setZoomedId(null)}
            onKeyDown={(e) => e.key === 'Escape' && setZoomedId(null)}
            role="button"
            tabIndex={0}
            aria-label="Close fullscreen"
          >
            <img
              src={sandboxImages.find((i) => i.id === zoomedId)?.url}
              alt="Fullscreen"
              className="max-w-full max-h-full object-contain pointer-events-none"
              draggable={false}
              onClick={(e) => e.stopPropagation()}
            />
            <p className="absolute bottom-4 left-1/2 -translate-x-1/2 text-[#888] text-sm">
              Double-click or Esc to exit
            </p>
          </div>
        )}

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
              const borderHeight = getFolderBorderHeight(count, folder.width);
              const borderY = folder.y + LABEL_HEIGHT;
              const borderH = Math.max(borderHeight, 80);
              const isHovered = hoveredFolderBorder === folder.id;
              const nameWidth = folderLabelWidths[folder.id] ?? approximateLabelWidth(folder.name);
              return (
                <Group key={folder.id}>
                  {/* Folder label (name + " +") — Group at folder pos, same as app */}
                  <Group x={folder.x} y={folder.y} listening={true}>
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
                      text={folder.name}
                      fontSize={16}
                      fontStyle="600"
                      fill={folder.color}
                      listening={true}
                    />
                    <Text
                      x={nameWidth}
                      y={2}
                      text=" +"
                      fontSize={16}
                      fontStyle="600"
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
                  {/* Resize handle — bottom-right, visible on hover (match app) */}
                  <Rect
                    x={folder.x + folder.width - 20}
                    y={borderY + borderHeight - 20}
                    width={20}
                    height={20}
                    fill={isHovered ? folder.color : 'transparent'}
                    opacity={isHovered ? 0.6 : 0}
                    cornerRadius={4}
                    listening={true}
                    onMouseEnter={(e) => {
                      const container = e.target.getStage()?.container();
                      if (container) container.style.cursor = 'nwse-resize';
                      setHoveredFolderBorder(folder.id);
                    }}
                    onMouseLeave={(e) => {
                      const container = e.target.getStage()?.container();
                      if (container) container.style.cursor = 'default';
                      setHoveredFolderBorder(null);
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
                onDoubleClick={() => setZoomedId((id) => (id === img.id ? null : img.id))}
                onDragEnd={(x, y) => handleImageDragEnd(img.id, x, y)}
                onCursorOverImage={setCursorOverImage}
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
              Drop or click to add up to {MAX_PHOTOS} photos
            </p>
          </button>
        )}
      </div>

      {/* Edit toolbar (same look as main app): Light, Curves, Color, Effects — no HSL; Export = sign up */}
      {selectedImage && selectedId && (
        <div className="mt-3 relative z-0">
          {/* Curves popup */}
          {activePanel === 'curves' && (
            <CurvesEditor
              curves={selectedImage.curves ?? DEFAULT_CURVES}
              onChange={(curves) => updateImageEdit(selectedId, { curves })}
              onClose={() => setActivePanel(null)}
            />
          )}

          {/* Light panel popup — match EditPanel position */}
          {activePanel === 'light' && (
            <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20">
              <div className="bg-[#171717] border border-[#2a2a2a] rounded-xl shadow-2xl shadow-black/50 p-4 w-72">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-medium text-white">Light</h3>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => updateImageEdit(selectedId, { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 })}
                      className="text-xs text-[#888] hover:text-white transition-colors cursor-pointer"
                    >
                      Reset
                    </button>
                    <button type="button" onClick={() => setActivePanel(null)} className="p-1 text-[#888] hover:text-white transition-colors cursor-pointer">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                </div>
                <div className="space-y-3">
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

          {/* Color panel popup (no HSL) */}
          {activePanel === 'color' && (
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 z-20 mb-2">
              <div className="bg-[#171717] border border-[#2a2a2a] rounded-xl shadow-2xl shadow-black/50 p-4 w-80">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-medium text-white">Color</h3>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => updateImageEdit(selectedId, { temperature: 0, vibrance: 0, saturation: 0 })}
                      className="text-xs text-[#888] hover:text-white transition-colors cursor-pointer"
                    >
                      Reset
                    </button>
                    <button type="button" onClick={() => setActivePanel(null)} className="p-1 text-[#888] hover:text-white transition-colors cursor-pointer">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-[#888] w-20">Temp</span>
                    <div className="flex items-center gap-2 flex-1">
                      <span className="text-[10px] text-[#74c0fc]">Cool</span>
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
                      <span className="text-[10px] text-[#ff9f43]">Warm</span>
                    </div>
                  </div>
                  <SandboxSlider label="Vibrance" value={selectedImage.vibrance ?? 0} min={-1} max={1} step={0.01} defaultValue={0} onChange={(v) => updateImageEdit(selectedId, { vibrance: v })} />
                  <SandboxSlider label="Saturation" value={selectedImage.saturation ?? 0} min={-1} max={1} step={0.01} defaultValue={0} onChange={(v) => updateImageEdit(selectedId, { saturation: v })} />
                </div>
              </div>
            </div>
          )}

          {/* Effects panel popup — match EditPanel position */}
          {activePanel === 'effects' && (
            <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20">
              <div className="bg-[#171717] border border-[#2a2a2a] rounded-xl shadow-2xl shadow-black/50 p-4 w-72">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-medium text-white">Effects</h3>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => updateImageEdit(selectedId, { clarity: 0, dehaze: 0, vignette: 0, grain: 0 })}
                      className="text-xs text-[#888] hover:text-white transition-colors cursor-pointer"
                    >
                      Reset
                    </button>
                    <button type="button" onClick={() => setActivePanel(null)} className="p-1 text-[#888] hover:text-white transition-colors cursor-pointer">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                </div>
                <div className="space-y-3">
                  <SandboxSlider label="Clarity" value={selectedImage.clarity ?? 0} min={-1} max={1} step={0.01} defaultValue={0} onChange={(v) => updateImageEdit(selectedId, { clarity: v })} />
                  <SandboxSlider label="Dehaze" value={selectedImage.dehaze ?? 0} min={-1} max={1} step={0.01} defaultValue={0} onChange={(v) => updateImageEdit(selectedId, { dehaze: v })} />
                  <SandboxSlider label="Vignette" value={selectedImage.vignette ?? 0} min={0} max={1} step={0.01} defaultValue={0} onChange={(v) => updateImageEdit(selectedId, { vignette: v })} />
                  <SandboxSlider label="Grain" value={selectedImage.grain ?? 0} min={0} max={1} step={0.01} defaultValue={0} onChange={(v) => updateImageEdit(selectedId, { grain: v })} />
                </div>
              </div>
            </div>
          )}

          {/* Main toolbar — same structure as EditPanel */}
          <div className="bg-[#171717] border border-[#2a2a2a] rounded-xl shadow-2xl shadow-black/50 backdrop-blur-xl">
            <div className="px-4 py-3">
              <div className="flex items-center gap-2">
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
