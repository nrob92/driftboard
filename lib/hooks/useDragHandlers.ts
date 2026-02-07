import { useCallback, useRef } from 'react';
import Konva from 'konva';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { snapToGrid, findNearestPhoto } from '@/lib/utils';
import type { CanvasImage, PhotoFolder } from '@/lib/types';
import { useCanvasStore } from '@/lib/stores/canvasStore';
import { useInteractionStore } from '@/lib/stores/interactionStore';
import {
  FOLDER_COLORS, GRID_CONFIG, CELL_SIZE, CELL_HEIGHT,
  isSocialLayout, calculateColsFromWidth,
  getFolderBounds, getFolderBorderHeight, distanceToRectBorder,
} from '@/lib/folders/folderLayout';

const GRID_SIZE = 50;

interface UseDragHandlersOptions {
  user: User | null;
  saveToHistory: () => void;
  resolveOverlapsAndReflow: (
    currentFolders: PhotoFolder[],
    currentImages: CanvasImage[],
    changedFolderId?: string,
    addedImageId?: string
  ) => { folders: PhotoFolder[]; images: CanvasImage[] };
  latestFoldersRef: React.MutableRefObject<PhotoFolder[]>;
  latestImagesRef: React.MutableRefObject<CanvasImage[]>;
}

export function useDragHandlers({
  user,
  saveToHistory,
  resolveOverlapsAndReflow,
  latestFoldersRef,
  latestImagesRef,
}: UseDragHandlersOptions) {
  const dragMoveRafRef = useRef<number | null>(null);
  const dragMoveNodeRef = useRef<Konva.Image | null>(null);
  const dragPrevCellRef = useRef<{ imageId: string; col: number; row: number; cellIndex: number } | null>(null);
  const lastSwappedImageRef = useRef<{ id: string; x: number; y: number } | null>(null);

  // Refs to track drag state without causing re-renders
  const lastDragUpdateRef = useRef<number>(0);
  const pendingHoveredFolderRef = useRef<string | null>(null);
  const pendingBorderHoveredRef = useRef<string | null>(null);
  const DRAG_THROTTLE_MS = 50; // Only update store every 50ms (20fps) during drag

  const handleImageDragMove = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      dragMoveNodeRef.current = e.target as Konva.Image;
      if (dragMoveRafRef.current != null) return;

      dragMoveRafRef.current = requestAnimationFrame(() => {
        dragMoveRafRef.current = null;
        const node = dragMoveNodeRef.current;
        if (!node) return;
        const currentX = node.x();
        const currentY = node.y();
        // Read latest state from refs to avoid stale closures
        const images = latestImagesRef.current;
        const folders = latestFoldersRef.current;
        const currentImg = images.find((i) => i.id === node.id());
        if (!currentImg) return;

        const currentCenterX = currentX + currentImg.width / 2;
        const currentCenterY = currentY + currentImg.height / 2;

        // Compute drag state values
        let newBorderHovered: string | null = null;
        let newHoveredFolderId: string | null = null;

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
            newBorderHovered = dist <= BORDER_BLINK_THRESHOLD ? currentImg.folderId : null;
          }
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

        newHoveredFolderId = targetFolderId || null;

        // Sync image position to store during drag (triggers batchDraw for smooth visuals, like folder drag)
        useCanvasStore.getState().setImages((prev) =>
          prev.map((img) =>
            img.id === node.id() ? { ...img, x: currentX, y: currentY } : img
          )
        );

        // If image is in a folder, calculate grid position (for swap tracking)
        if (targetFolderId && targetFolder && !isSocialLayout(targetFolder)) {
          const cols = calculateColsFromWidth(targetFolder.width);
          const { folderPadding, imageMaxSize } = GRID_CONFIG;
          const contentStartX = targetFolder.x + folderPadding;
          const contentStartY = targetFolder.y + 30 + folderPadding;

          const relativeX = currentX - contentStartX;
          const relativeY = currentY - contentStartY;
          const targetCol = Math.max(0, Math.floor(relativeX / CELL_SIZE));
          const targetRow = Math.max(0, Math.floor(relativeY / CELL_HEIGHT));
          const clampedCol = Math.min(targetCol, cols - 1);
          const { imageMaxHeight } = GRID_CONFIG;
          const targetCellCenterX = contentStartX + clampedCol * CELL_SIZE + imageMaxSize / 2;
          const targetCellCenterY = contentStartY + targetRow * CELL_HEIGHT + imageMaxHeight / 2;

          const snapThreshold = 40;
          const distanceToCellCenter = Math.sqrt(
            Math.pow(currentX + currentImg.width / 2 - targetCellCenterX, 2) +
            Math.pow(currentY + currentImg.height / 2 - targetCellCenterY, 2)
          );

          if (distanceToCellCenter <= snapThreshold) {
            // Track the dragged image's previous cell
            if (!dragPrevCellRef.current || dragPrevCellRef.current.imageId !== currentImg.id) {
              const currentImgRelativeX = currentImg.x - contentStartX;
              const currentImgRelativeY = currentImg.y - contentStartY;
              const currentImgCol = Math.max(0, Math.min(cols - 1, Math.floor(currentImgRelativeX / CELL_SIZE)));
              const currentImgRow = Math.max(0, Math.floor(currentImgRelativeY / CELL_HEIGHT));
              const currentImgCell = currentImgRow * cols + currentImgCol;
              dragPrevCellRef.current = { imageId: currentImg.id, col: currentImgCol, row: currentImgRow, cellIndex: currentImgCell };
            }
          }
        }

        // Throttle store updates - only update if changed and enough time passed
        const now = Date.now();
        const shouldUpdateStore = now - lastDragUpdateRef.current >= DRAG_THROTTLE_MS;

        if (shouldUpdateStore) {
          lastDragUpdateRef.current = now;
          const intStore = useInteractionStore.getState();

          // Only update if values actually changed
          if (pendingBorderHoveredRef.current !== newBorderHovered) {
            pendingBorderHoveredRef.current = newBorderHovered;
            intStore.setDragSourceFolderBorderHovered(newBorderHovered);
          }
          if (pendingHoveredFolderRef.current !== newHoveredFolderId) {
            pendingHoveredFolderRef.current = newHoveredFolderId;
            intStore.setDragHoveredFolderId(newHoveredFolderId);
          }
          // Ghost position is always null during drag move (only set on drag end)
          intStore.setDragGhostPosition(null);
        }
      });
    },
    [] // Stable: reads from refs, no closure deps needed
  );

  const handleObjectDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>, type: 'image' | 'text') => {
      if (dragMoveRafRef.current != null) {
        cancelAnimationFrame(dragMoveRafRef.current);
        dragMoveRafRef.current = null;
      }
      dragMoveNodeRef.current = null;
      lastDragUpdateRef.current = 0; // Reset throttle timer

      const node = e.target;
      const currentX = node.x();
      const currentY = node.y();

      useInteractionStore.getState().setDragGhostPosition(null);

      let newX = currentX;
      let newY = currentY;

      const { setImages, setTexts, setFolders } = useCanvasStore.getState();

      if (type === 'image') {
        const latestFolders = latestFoldersRef.current;
        const latestImages = latestImagesRef.current;
        const currentImg = latestImages.find((img) => img.id === node.id());
        if (currentImg) {
          newX = currentX;
          newY = currentY;

          const currentCenterX = currentX + currentImg.width / 2;
          const currentCenterY = currentY + currentImg.height / 2;

          // Find target folder (smallest area when overlapping)
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

          // Snap to grid for regular folders
          if (!targetFolder && targetFolderId) {
            targetFolder = latestFolders.find(f => f.id === targetFolderId);
          }
          if (targetFolderId && targetFolder) {
            if (isSocialLayout(targetFolder)) {
              // Social layout: no snap
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
          } else if (!targetFolderId) {
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
            // Dropped outside all folders AND was in a folder -> create new "Untitled" folder
            if (!targetFolderId && oldFolderId) {
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

              return;
            }

            // Moving between existing folders or into a folder
            if (targetFolderId) {
              let gridX = newX;
              let gridY = newY;
              let finalWidth = currentImg.width;
              let finalHeight = currentImg.height;
              let finalScaleX = currentImg.scaleX ?? 1;
              let finalScaleY = currentImg.scaleY ?? 1;

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

              const updatedFolders = latestFolders.map((f) => {
                if (f.id === oldFolderId) {
                  return { ...f, imageIds: f.imageIds.filter((id) => id !== currentImg.id) };
                }
                if (f.id === targetFolderId) {
                  const hasAlready = f.imageIds.includes(currentImg.id);
                  return { ...f, imageIds: hasAlready ? f.imageIds : [...f.imageIds, currentImg.id] };
                }
                return f;
              });

              const updatedImages = latestImages.map((img) =>
                img.id === currentImg.id
                  ? { ...img, x: gridX, y: gridY, folderId: targetFolderId, width: finalWidth, height: finalHeight, scaleX: finalScaleX, scaleY: finalScaleY }
                  : img
              );

              const { folders: resolvedFolders, images: resolvedImages } = resolveOverlapsAndReflow(
                updatedFolders,
                updatedImages,
                targetFolderId,
                currentImg.id
              );

              setFolders(resolvedFolders);
              setImages(resolvedImages);

              const finalImg = resolvedImages.find(img => img.id === currentImg.id);
              if (finalImg) {
                node.position({ x: finalImg.x, y: finalImg.y });
              }

              if (user) {
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
                  lastSwappedImageRef.current = null;
                }
              }

              return;
            }
          }

          // Same folder move
          if (targetFolderId && targetFolderId === oldFolderId) {
            if (!targetFolder && targetFolderId) {
              targetFolder = latestFolders.find(f => f.id === targetFolderId);
            }
            if (!targetFolder) return;

            let finalX = node.x();
            let finalY = node.y();
            let swapImgId: string | undefined;
            let swapX: number | undefined;
            let swapY: number | undefined;
            let updatedImageIds: string[] | null = null;

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

              // Sync imageIds order with new visual positions
              const _ids = [...targetFolder.imageIds];
              const draggedIdx = _ids.indexOf(currentImg.id);
              if (draggedIdx !== -1) {
                if (swapImgId) {
                  const swapIdx = _ids.indexOf(swapImgId);
                  if (swapIdx !== -1) {
                    _ids[draggedIdx] = swapImgId;
                    _ids[swapIdx] = currentImg.id;
                  }
                } else {
                  const newCellIndex = finalRow * cols + finalCol;
                  _ids.splice(draggedIdx, 1);
                  _ids.splice(Math.min(newCellIndex, _ids.length), 0, currentImg.id);
                }
                updatedImageIds = _ids;
              }
            } else {
              finalX = newX;
              finalY = newY;
            }

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

            // Update folder imageIds to match new visual order
            if (updatedImageIds) {
              setFolders((prev) =>
                prev.map((f) =>
                  f.id === targetFolderId ? { ...f, imageIds: updatedImageIds! } : f
                )
              );
            }

            if (user) {
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

              if (lastSwappedImageRef.current) {
                const swappedRef = lastSwappedImageRef.current;
                const swappedImg = latestImages.find(img => img.id === swappedRef.id);
                const swappedCanonical = swappedImg?.storagePath || swappedImg?.originalStoragePath;
                if (swappedImg && swappedCanonical) {
                  const swappedX = swappedRef.x;
                  const swappedY = swappedRef.y;

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
                lastSwappedImageRef.current = null;
              }
            }

            node.position({ x: finalX, y: finalY });
            return;
          }
        }
      }

      node.position({ x: newX, y: newY });

      if (type === 'image') {
        const currentImg = latestImagesRef.current.find((img) => img.id === node.id());
        setImages((prev) =>
          prev.map((img) => (img.id === node.id() ? { ...img, x: newX, y: newY } : img))
        );
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
    [user, resolveOverlapsAndReflow, saveToHistory, latestFoldersRef, latestImagesRef]
  );

  return {
    handleImageDragMove,
    handleObjectDragEnd,
    dragPrevCellRef,
  };
}
