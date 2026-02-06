import React, { useRef } from 'react';
import { Group, Text, Rect } from 'react-konva';
import Konva from 'konva';
import { supabase } from '@/lib/supabase';
import type { CanvasImage, PhotoFolder } from '@/lib/types';
import { useCanvasStore } from '@/lib/stores/canvasStore';
import { useInteractionStore } from '@/lib/stores/interactionStore';
import { useUIStore } from '@/lib/stores/uiStore';
import {
  SOCIAL_LAYOUT_PAGE_WIDTH, SOCIAL_LAYOUT_MAX_PAGES,
  DEFAULT_SOCIAL_LAYOUT_BG, GRID_CONFIG, CELL_SIZE, CELL_HEIGHT,
  isSocialLayout, getFolderBorderHeight,
  calculateColsFromWidth,
  getImageCellPositions, calculateMinimumFolderSize, smartRepackImages,
  positionImagesInCells,
  type CellAssignment,
} from '@/lib/folders/folderLayout';

const OVERLAP_THROTTLE_MS = 32;

interface FolderGroupProps {
  folder: PhotoFolder;
  folderLabelWidth: number;
  onLabelWidthChange: (folderId: string, width: number) => void;
  onLabelRef: (folderId: string, el: Konva.Text) => void;
  onFolderDoubleClick: (folder: PhotoFolder) => void;
  onAddPhotos: (folderId: string) => void;
  resolveOverlapsAndReflow: (
    currentFolders: PhotoFolder[],
    currentImages: CanvasImage[],
    changedFolderId?: string,
    addedImageId?: string
  ) => { folders: PhotoFolder[]; images: CanvasImage[] };
  saveToHistory: () => void;
  user: { id: string } | null;
}

export function FolderGroup({
  folder,
  folderLabelWidth,
  onLabelWidthChange,
  onLabelRef,
  onFolderDoubleClick,
  onAddPhotos,
  resolveOverlapsAndReflow,
  saveToHistory,
  user,
}: FolderGroupProps) {
  const folderNameDragRef = useRef(false);
  const lastOverlapCheckRef = useRef(0);

  // Read from stores
  const images = useCanvasStore((s) => s.images);
  const folders = useCanvasStore((s) => s.folders);
  const setImages = useCanvasStore.getState().setImages;
  const setFolders = useCanvasStore.getState().setFolders;

  const isDragging = useInteractionStore((s) => s.isDragging);
  const hoveredFolderBorder = useInteractionStore((s) => s.hoveredFolderBorder);
  const resizingFolderId = useInteractionStore((s) => s.resizingFolderId);
  const dragHoveredFolderId = useInteractionStore((s) => s.dragHoveredFolderId);
  const dragSourceFolderBorderHovered = useInteractionStore((s) => s.dragSourceFolderBorderHovered);
  const dragBorderBlink = useInteractionStore((s) => s.dragBorderBlink);
  const dragGhostPosition = useInteractionStore((s) => s.dragGhostPosition);
  const intActions = useInteractionStore.getState();

  const uiActions = useUIStore.getState();

  // Compute folder dimensions
  const currentFolder = folders.find(f => f.id === folder.id) || folder;
  const folderImages = images.filter(img => folder.imageIds.includes(img.id));
  const borderX = currentFolder.x;
  const borderY = currentFolder.y + 30;
  const borderWidth = currentFolder.width;
  const borderHeight = getFolderBorderHeight(currentFolder, folderImages.length);
  const isHovered = hoveredFolderBorder === currentFolder.id;
  const isResizing = resizingFolderId === currentFolder.id;

  return (
    <Group
      onContextMenu={(e) => {
        e.evt.preventDefault();
        e.cancelBubble = true;
        uiActions.setCanvasContextMenu(null);
        uiActions.setFolderContextMenu({ x: e.evt.clientX, y: e.evt.clientY, folderId: currentFolder.id });
      }}
    >
      {/* Folder Label (name + plus) */}
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
          const latestFolders = useCanvasStore.getState().folders;
          const latestImages = useCanvasStore.getState().images;

          const updatedFolders = latestFolders.map((f) =>
            f.id === currentFolder.id ? { ...f, x: newX, y: newY } : f
          );

          const folderImgs = latestImages.filter(img => currentFolder.imageIds.includes(img.id));
          let updatedImages = [...latestImages];
          if (folderImgs.length > 0) {
            const reflowedImages = folderImgs.map((img) => ({
              ...img,
              x: img.x + (newX - currentFolder.x),
              y: img.y + (newY - currentFolder.y),
            }));
            updatedImages = latestImages.map((img) => {
              const reflowed = reflowedImages.find(r => r.id === img.id);
              return reflowed ? reflowed : img;
            });
          }

          if (now - lastOverlapCheckRef.current >= OVERLAP_THROTTLE_MS) {
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
              onLabelRef(currentFolder.id, el);
              requestAnimationFrame(() => {
                const w = el.width();
                onLabelWidthChange(currentFolder.id, w);
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
          onClick={() => {
            if (!folderNameDragRef.current) onFolderDoubleClick(currentFolder);
          }}
          onTap={() => {
            if (!folderNameDragRef.current) onFolderDoubleClick(currentFolder);
          }}
        />
        <Text
          x={folderLabelWidth}
          y={2}
          text=" +"
          fontSize={16}
          fontStyle="600"
          fill={currentFolder.color}
          listening={true}
          onClick={(e) => {
            e.cancelBubble = true;
            onAddPhotos(currentFolder.id);
          }}
          onTap={(e) => {
            e.cancelBubble = true;
            onAddPhotos(currentFolder.id);
          }}
        />
      </Group>

      {/* Folder fill */}
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

      {/* Folder Border */}
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
        onMouseEnter={() => intActions.setHoveredFolderBorder(currentFolder.id)}
        onMouseLeave={() => {
          if (!resizingFolderId) intActions.setHoveredFolderBorder(null);
        }}
        onClick={(e) => {
          e.cancelBubble = true;
          if (isSocialLayout(currentFolder)) intActions.setSelectedFolderId(currentFolder.id);
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
          draggable
          dragBoundFunc={(pos) => pos}
          onMouseEnter={(e) => {
            const container = e.target.getStage()?.container();
            if (container) container.style.cursor = 'nwse-resize';
            intActions.setHoveredFolderBorder(currentFolder.id);
          }}
          onMouseLeave={(e) => {
            const container = e.target.getStage()?.container();
            if (container && !resizingFolderId) container.style.cursor = 'default';
            if (!resizingFolderId) intActions.setHoveredFolderBorder(null);
          }}
          onDragStart={() => {
            intActions.setResizingFolderId(currentFolder.id);
          }}
          onDragMove={(e) => {
            const handleSize = 20;
            const latestFolders = useCanvasStore.getState().folders;
            const latestImages = useCanvasStore.getState().images;
            const latestFolder = latestFolders.find(f => f.id === currentFolder.id) || currentFolder;

            const proposedWidth = Math.max(GRID_CONFIG.minFolderWidth, e.target.x() - borderX + handleSize);
            const proposedContentHeight = Math.max(100, e.target.y() - borderY + handleSize);
            const proposedHeight = 30 + proposedContentHeight;
            const now = Date.now();

            const folderImgs = latestImages.filter(img => latestFolder.imageIds.includes(img.id));
            const minSize = calculateMinimumFolderSize(folderImgs.length, proposedWidth);
            const newWidth = Math.max(proposedWidth, minSize.width);
            const newHeight = Math.max(proposedHeight, minSize.height);
            const newContentHeight = newHeight - 30;

            const oldCols = calculateColsFromWidth(latestFolder.width);
            const newCols = calculateColsFromWidth(newWidth);
            const dimensionsChanged = newWidth !== latestFolder.width || newHeight !== latestFolder.height;
            const needsRepack = newCols !== oldCols || newHeight < (latestFolder.height ?? Infinity);

            const currentPositions = folderImgs.length > 0
              ? getImageCellPositions(folderImgs, latestFolder.x, latestFolder.y, latestFolder.width)
              : [];

            let cellAssignments: CellAssignment[] = [];
            if (folderImgs.length > 0) {
              if (dimensionsChanged && needsRepack) {
                cellAssignments = smartRepackImages(
                  folderImgs,
                  currentPositions,
                  latestFolder.width,
                  newWidth,
                  newHeight
                );
              } else {
                cellAssignments = currentPositions.map(pos => ({
                  imageId: pos.imageId,
                  col: pos.col,
                  row: pos.row,
                }));
              }
            }

            const updatedFolders = latestFolders.map((f) =>
              f.id === currentFolder.id
                ? { ...f, width: newWidth, height: newHeight }
                : f
            );

            e.target.x(borderX + newWidth - handleSize);
            e.target.y(borderY + newContentHeight - handleSize);

            let updatedImages = [...latestImages];
            if (folderImgs.length > 0 && cellAssignments.length > 0) {
              const positionedImages = positionImagesInCells(
                folderImgs,
                cellAssignments,
                latestFolder.x,
                latestFolder.y,
                newWidth
              );

              updatedImages = latestImages.map((img) => {
                const positioned = positionedImages.find(p => p.id === img.id);
                return positioned ? positioned : img;
              });
            }

            if (now - lastOverlapCheckRef.current >= OVERLAP_THROTTLE_MS) {
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
            intActions.setResizingFolderId(null);
            intActions.setHoveredFolderBorder(null);

            const latestFolders = useCanvasStore.getState().folders;
            const latestImages = useCanvasStore.getState().images;
            const resizedFolder = latestFolders.find(f => f.id === currentFolder.id);
            if (!resizedFolder) return;

            const folderImgs = latestImages.filter(img => resizedFolder.imageIds.includes(img.id));
            const imageCount = folderImgs.length;

            if (imageCount === 0) {
              const { folders: finalFolders, images: finalImages } = resolveOverlapsAndReflow(
                latestFolders,
                latestImages,
                currentFolder.id
              );
              setFolders(finalFolders);
              setImages(finalImages);
              saveToHistory();
              return;
            }

            const currentPositions = getImageCellPositions(
              folderImgs,
              resizedFolder.x,
              resizedFolder.y,
              resizedFolder.width
            );

            const cols = calculateColsFromWidth(resizedFolder.width);
            const currentContentHeight = (resizedFolder.height ?? 130) - 30;
            const availableForCells = currentContentHeight - (2 * GRID_CONFIG.folderPadding) + GRID_CONFIG.imageGap;
            const rowsFromHeight = Math.max(1, Math.floor(availableForCells / CELL_HEIGHT));
            const maxRowWithImage = imageCount > 0 ? Math.max(0, ...currentPositions.map(p => p.row)) : 0;
            const minRowsNeeded = maxRowWithImage + 1;
            const rows = Math.max(rowsFromHeight, minRowsNeeded);

            const snappedWidth = (2 * GRID_CONFIG.folderPadding) + (cols * CELL_SIZE) - GRID_CONFIG.imageGap;
            const snappedContentHeight = (2 * GRID_CONFIG.folderPadding) + (rows * CELL_HEIGHT) - GRID_CONFIG.imageGap;
            const snappedHeight = 30 + Math.max(snappedContentHeight, 100);

            const snappedCols = calculateColsFromWidth(snappedWidth);
            const snappedMaxRows = Math.max(1, Math.floor((snappedHeight - 30 - 2 * GRID_CONFIG.folderPadding + GRID_CONFIG.imageGap) / CELL_HEIGHT));

            let cellAssignments: CellAssignment[];
            const needsRepack = currentPositions.some(p => p.col >= snappedCols || p.row >= snappedMaxRows);

            if (needsRepack) {
              cellAssignments = smartRepackImages(
                folderImgs,
                currentPositions,
                resizedFolder.width,
                snappedWidth,
                snappedHeight
              );
            } else {
              cellAssignments = currentPositions.map(pos => ({
                imageId: pos.imageId,
                col: pos.col,
                row: pos.row,
              }));
            }

            const snappedFolders = latestFolders.map(f =>
              f.id === resizedFolder.id
                ? { ...f, width: snappedWidth, height: snappedHeight }
                : f
            );

            const positionedImages = positionImagesInCells(
              folderImgs,
              cellAssignments,
              resizedFolder.x,
              resizedFolder.y,
              snappedWidth
            );

            const snappedImages = latestImages.map(img => {
              const positioned = positionedImages.find(p => p.id === img.id);
              return positioned ? positioned : img;
            });

            const { folders: finalFolders, images: finalImages } = resolveOverlapsAndReflow(
              snappedFolders,
              snappedImages,
              currentFolder.id
            );
            setFolders(finalFolders);
            setImages(finalImages);
            saveToHistory();

            if (user) {
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
}
