import type { CanvasImage, PhotoFolder } from '@/lib/types';

// ── Social Layout Constants ──────────────────────────────────────────────
export const SOCIAL_LAYOUT_ASPECT = { w: 4, h: 5 };
export const SOCIAL_LAYOUT_PAGE_WIDTH = 400; // canvas units per page
export const SOCIAL_LAYOUT_MAX_PAGES = 10;
export const DEFAULT_SOCIAL_LAYOUT_BG = '#1a1a1a';

export function isSocialLayout(folder: PhotoFolder): boolean {
  return folder.type === 'social_layout';
}

export function getSocialLayoutDimensions(): { pageWidth: number; pageHeight: number; contentHeight: number } {
  const pageWidth = SOCIAL_LAYOUT_PAGE_WIDTH;
  const pageHeight = (pageWidth * SOCIAL_LAYOUT_ASPECT.h) / SOCIAL_LAYOUT_ASPECT.w;
  return { pageWidth, pageHeight, contentHeight: pageHeight };
}

// ── Folder Colors ────────────────────────────────────────────────────────
export const FOLDER_COLORS = [
  '#3ECF8E', // Green
  '#74c0fc', // Blue
  '#ff9f43', // Orange
  '#ff6b6b', // Red
  '#a78bfa', // Purple
  '#f472b6', // Pink
  '#fbbf24', // Yellow
  '#34d399', // Teal
];

export function hexToRgba(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

// ── Grid Configuration ───────────────────────────────────────────────────
// Centralized grid configuration - one size everywhere (360×450), no scaling
export const GRID_CONFIG = {
  imageMaxSize: 360,   // Same as layout: max width for images
  imageMaxHeight: 450, // Same as layout: max height (4:5)
  imageGap: 12,
  folderPadding: 15,
  // Default width so 4 columns fit (folderPadding*2 + 4*(imageMaxSize+imageGap) - imageGap)
  defaultFolderWidth: 15 * 2 + 4 * (360 + 12) - 12,
  minFolderWidth: 400,
  minFolderHeight: 520,
  folderGap: 40,
};
export const CELL_SIZE = GRID_CONFIG.imageMaxSize + GRID_CONFIG.imageGap;
export const CELL_HEIGHT = GRID_CONFIG.imageMaxHeight + GRID_CONFIG.imageGap;

// Import at layout size (90% of 4:5 page) so no scaling needed in social layout
export const LAYOUT_IMPORT_MAX_WIDTH = 360;
export const LAYOUT_IMPORT_MAX_HEIGHT = 450;

// ── Grid Calculation Functions ───────────────────────────────────────────

// Calculate columns based on folder width
export const calculateColsFromWidth = (folderWidth: number): number => {
  const availableWidth = folderWidth - (GRID_CONFIG.folderPadding * 2);
  const cols = Math.floor((availableWidth + GRID_CONFIG.imageGap) / CELL_SIZE);
  return Math.max(1, cols);
};

// Determine layout mode based on folder width
export const getFolderLayoutMode = (folderWidth: number): 'grid' | 'stack' => {
  const cols = calculateColsFromWidth(folderWidth);
  return cols === 1 ? 'stack' : 'grid';
};

// Reflow images within a folder based on its width
export const reflowImagesInFolder = (
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

  const { imageMaxHeight } = GRID_CONFIG;
  if (layoutMode === 'stack') {
    return folderImages.map((img, index) => {
      const imgWidth = Math.min(img.width * img.scaleX, imageMaxSize);
      const availableWidth = folderWidth - (2 * folderPadding);
      const cellOffsetX = (availableWidth - imgWidth) / 2;
      const yOffset = index * (imageMaxHeight + imageGap);
      return { ...img, x: contentStartX + cellOffsetX, y: contentStartY + yOffset };
    });
  }

  const cols = calculateColsFromWidth(folderWidth);
  return folderImages.map((img, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const imgWidth = Math.min(img.width * img.scaleX, imageMaxSize);
    const imgHeight = Math.min(img.height * img.scaleY, imageMaxHeight);
    const cellOffsetX = (imageMaxSize - imgWidth) / 2;
    const cellOffsetY = (imageMaxHeight - imgHeight) / 2;
    return {
      ...img,
      x: contentStartX + col * CELL_SIZE + cellOffsetX,
      y: contentStartY + row * CELL_HEIGHT + cellOffsetY,
    };
  });
};

// ── Folder Bounds ────────────────────────────────────────────────────────

// Calculate folder bounding box (including label)
export const getFolderBounds = (folder: PhotoFolder, imageCount: number) => {
  if (isSocialLayout(folder)) {
    const n = Math.max(1, Math.min(SOCIAL_LAYOUT_MAX_PAGES, folder.pageCount ?? 1));
    const { pageHeight } = getSocialLayoutDimensions();
    const width = n * SOCIAL_LAYOUT_PAGE_WIDTH;
    const height = 30 + pageHeight; // 30px label
    return {
      x: folder.x,
      y: folder.y,
      width,
      height,
      right: folder.x + width,
      bottom: folder.y + height,
    };
  }

  const layoutMode = getFolderLayoutMode(folder.width);
  let contentHeight;

  if (layoutMode === 'stack') {
    contentHeight = imageCount * CELL_HEIGHT + (GRID_CONFIG.folderPadding * 2);
  } else {
    const cols = calculateColsFromWidth(folder.width);
    const rows = Math.ceil(imageCount / cols) || 1;
    contentHeight = rows * CELL_HEIGHT + (GRID_CONFIG.folderPadding * 2);
  }

  const calculatedHeight = 30 + Math.max(contentHeight, 100);
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
export const getFolderBorderHeight = (folder: PhotoFolder, imageCount: number): number => {
  if (isSocialLayout(folder)) {
    const { pageHeight } = getSocialLayoutDimensions();
    return pageHeight;
  }

  if (folder.height != null) {
    return Math.max(folder.height - 30, 100); // 30px for label
  }

  const layoutMode = getFolderLayoutMode(folder.width);
  let contentHeight;

  if (layoutMode === 'stack') {
    contentHeight = imageCount * CELL_HEIGHT + (GRID_CONFIG.folderPadding * 2);
  } else {
    const cols = calculateColsFromWidth(folder.width);
    const rows = Math.ceil(imageCount / cols) || 1;
    contentHeight = rows * CELL_HEIGHT + (GRID_CONFIG.folderPadding * 2);
  }

  return Math.max(contentHeight, 100);
};

// Distance from point to a rectangle's border (perimeter)
export function distanceToRectBorder(
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

// ── Cell Positioning ─────────────────────────────────────────────────────

// Interface for image cell positions
export interface ImageCellPosition {
  imageId: string;
  col: number;
  row: number;
  cellIndex: number;
}

// Get current grid cell positions for all images in a folder
export const getImageCellPositions = (
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
    const row = Math.max(0, Math.floor(relativeY / CELL_HEIGHT));

    return {
      imageId: img.id,
      col,
      row,
      cellIndex: row * cols + col,
    };
  });
};

// Interface for minimum folder size
export interface MinimumSize {
  width: number;
  height: number;
}

// Calculate minimum folder size to fit all images
export const calculateMinimumFolderSize = (
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
    const contentHeight = imageCount * CELL_HEIGHT + (2 * GRID_CONFIG.folderPadding);
    return {
      width: GRID_CONFIG.minFolderWidth,
      height: 30 + Math.max(contentHeight, 100),
    };
  }

  const cols = calculateColsFromWidth(proposedWidth);
  const rows = Math.ceil(imageCount / cols) || 1;
  const contentHeight = rows * CELL_HEIGHT + (2 * GRID_CONFIG.folderPadding);

  return {
    width: proposedWidth,
    height: 30 + Math.max(contentHeight, 100),
  };
};

// ── Smart Repacking ──────────────────────────────────────────────────────

// Cell assignment for smart positioning
export interface CellAssignment {
  imageId: string;
  col: number;
  row: number;
}

// Intelligently reposition images only when borders would cut them off
// Returns cell assignments (row/col) for each image, NOT just sorted IDs
export const smartRepackImages = (
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
    newMaxRows = Math.max(1, Math.floor(availableContentHeight / CELL_HEIGHT));
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
export const positionImagesInCells = (
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

    const { imageMaxHeight } = GRID_CONFIG;
    const imgWidth = Math.min(img.width * img.scaleX, imageMaxSize);
    const imgHeight = Math.min(img.height * img.scaleY, imageMaxHeight);

    if (layoutMode === 'stack') {
      const availableWidth = folderWidth - (2 * folderPadding);
      const cellOffsetX = (availableWidth - imgWidth) / 2;
      const yOffset = assignment.row * CELL_HEIGHT;
      return { ...img, x: contentStartX + cellOffsetX, y: contentStartY + yOffset };
    }

    const cellOffsetX = (imageMaxSize - imgWidth) / 2;
    const cellOffsetY = (imageMaxHeight - imgHeight) / 2;
    return {
      ...img,
      x: contentStartX + assignment.col * CELL_SIZE + cellOffsetX,
      y: contentStartY + assignment.row * CELL_HEIGHT + cellOffsetY,
    };
  });
};

// ── Folder Overlap Resolution ────────────────────────────────────────────

// Check if two rectangles overlap
export const rectsOverlap = (
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
export const resolveFolderOverlaps = (
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
