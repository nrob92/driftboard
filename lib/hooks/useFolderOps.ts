import { useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type { CanvasImage, PhotoFolder } from "@/lib/types";
import { useCanvasStore } from "@/lib/stores/canvasStore";
import { useUIStore } from "@/lib/stores/uiStore";
import { useInteractionStore } from "@/lib/stores/interactionStore";
import {
  SOCIAL_LAYOUT_ASPECT,
  SOCIAL_LAYOUT_PAGE_WIDTH,
  SOCIAL_LAYOUT_MAX_PAGES,
  DEFAULT_SOCIAL_LAYOUT_BG,
  FOLDER_COLORS,
  GRID_CONFIG,
  isSocialLayout,
  reflowImagesInFolder,
} from "@/lib/folders/folderLayout";

function getDeletePhotoPayload(img: CanvasImage): {
  storagePath?: string;
  originalStoragePath?: string;
} {
  if (img.originalStoragePath) {
    return {
      storagePath: img.storagePath ?? undefined,
      originalStoragePath: img.originalStoragePath,
    };
  }
  if (img.storagePath?.toLowerCase().endsWith(".dng")) {
    return { originalStoragePath: img.storagePath };
  }
  return { storagePath: img.storagePath ?? undefined };
}

interface UseFolderOpsOptions {
  user: User | null;
  saveToHistory: () => void;
  resolveOverlapsAndReflow: (
    currentFolders: PhotoFolder[],
    currentImages: CanvasImage[],
    changedFolderId?: string,
    addedImageId?: string,
  ) => { folders: PhotoFolder[]; images: CanvasImage[] };
  skipNextPhotosLoadRef: React.MutableRefObject<boolean>;
}

export function useFolderOps({
  user,
  saveToHistory,
  resolveOverlapsAndReflow,
  skipNextPhotosLoadRef,
}: UseFolderOpsOptions) {
  const queryClient = useQueryClient();
  const colorPreviewPendingRef = useRef<{
    folderId: string;
    color: string;
  } | null>(null);
  const colorPreviewRafRef = useRef<number | null>(null);

  const handleCreateFolderFromSelection = useCallback(() => {
    const { imageContextMenu } = useUIStore.getState();
    const { images } = useCanvasStore.getState();
    if (!imageContextMenu || imageContextMenu.selectedIds.length === 0) return;
    const ids = imageContextMenu.selectedIds.filter((id) =>
      images.some((img) => img.id === id),
    );
    if (ids.length === 0) return;
    const ui = useUIStore.getState();
    ui.setCreateFolderFromSelectionIds(ids);
    ui.setCreateFolderFromSelectionName("New Folder");
    ui.setCreateFolderFromSelectionNameError("");
    ui.setImageContextMenu(null);
  }, []);

  const handleCreateFolderFromSelectionSave = useCallback(async () => {
    const ui = useUIStore.getState();
    const { images, folders, setFolders, setImages } =
      useCanvasStore.getState();
    const { stagePosition, stageScale, dimensions } = useCanvasStore.getState();
    const { createFolderFromSelectionIds, createFolderFromSelectionName } = ui;

    if (
      !createFolderFromSelectionIds ||
      createFolderFromSelectionIds.length === 0
    )
      return;
    const name = createFolderFromSelectionName.trim();
    if (!name) {
      ui.setCreateFolderFromSelectionNameError("Enter a folder name");
      return;
    }
    if (folders.some((f) => f.name.toLowerCase() === name.toLowerCase())) {
      ui.setCreateFolderFromSelectionNameError(
        "A folder with this name already exists",
      );
      return;
    }

    const ids = createFolderFromSelectionIds;
    const selectedImages = images.filter((img) => ids.includes(img.id));
    if (selectedImages.length === 0) {
      ui.setCreateFolderFromSelectionIds(null);
      ui.setCreateFolderFromSelectionName("");
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

    const reflowed = reflowImagesInFolder(
      selectedImages,
      newFolder.x,
      newFolder.y,
      newFolder.width,
    );
    const imagesWithReflow = images.map((img) => {
      if (!ids.includes(img.id)) return img;
      const r = reflowed.find((ri) => ri.id === img.id);
      return r ? { ...r, folderId } : { ...img, folderId };
    });

    const { folders: resolvedFolders, images: resolvedImages } =
      resolveOverlapsAndReflow(
        foldersWithNewFolder,
        imagesWithReflow,
        folderId,
      );

    setFolders(resolvedFolders);
    setImages(resolvedImages);
    ui.setCreateFolderFromSelectionIds(null);
    ui.setCreateFolderFromSelectionName("");
    ui.setCreateFolderFromSelectionNameError("");

    if (user) {
      try {
        await supabase.from("photo_folders").insert({
          id: folderId,
          user_id: user.id,
          name,
          x: Math.round(newFolder.x),
          y: Math.round(newFolder.y),
          width: GRID_CONFIG.defaultFolderWidth,
          color: FOLDER_COLORS[colorIndex],
        });
        const finalReflowed = resolvedImages.filter(
          (img) => img.folderId === folderId,
        );
        for (const img of finalReflowed) {
          const path = img.storagePath || img.originalStoragePath;
          if (path) {
            await supabase
              .from("photo_edits")
              .update({
                folder_id: folderId,
                x: Math.round(img.x),
                y: Math.round(img.y),
              })
              .eq("storage_path", path)
              .eq("user_id", user.id);
          }
        }
        const movedFolders = resolvedFolders.filter((f) => {
          if (f.id === folderId) return false;
          const prev = foldersWithNewFolder.find((of) => of.id === f.id);
          return prev && (prev.x !== f.x || prev.y !== f.y);
        });
        for (const f of movedFolders) {
          await supabase
            .from("photo_folders")
            .update({ x: Math.round(f.x), y: Math.round(f.y) })
            .eq("id", f.id)
            .eq("user_id", user.id);
          const movedFolderImgIds = new Set(f.imageIds);
          for (const img of resolvedImages) {
            if (!movedFolderImgIds.has(img.id)) continue;
            const path = img.storagePath || img.originalStoragePath;
            if (path) {
              await supabase
                .from("photo_edits")
                .update({ x: Math.round(img.x), y: Math.round(img.y) })
                .eq("storage_path", path)
                .eq("user_id", user.id);
            }
          }
        }
      } catch (err) {
        console.error("Failed to create folder / update edits:", err);
      }
      // Update React Query cache directly instead of invalidating to avoid redundant network requests
      if (user) {
        queryClient.setQueryData(
          ["user-photos", user.id],
          (
            old:
              | {
                  savedEdits: unknown[];
                  savedFolders: unknown[];
                  photosFiles: unknown[];
                  originalsFiles: unknown[];
                }
              | undefined,
          ) => {
            const newFolderData = {
              id: folderId,
              user_id: user.id,
              name,
              x: Math.round(newFolder.x),
              y: Math.round(newFolder.y),
              width: GRID_CONFIG.defaultFolderWidth,
              color: FOLDER_COLORS[colorIndex],
            };

            // Update edits for images moved to the new folder
            const updatedEdits = (old?.savedEdits ?? []).map((e: unknown) => {
              const edit = e as {
                storage_path: string;
                folder_id?: string;
                x: number;
                y: number;
              };
              const matchingImg = resolvedImages.find(
                (img) =>
                  (img.storagePath === edit.storage_path ||
                    img.originalStoragePath === edit.storage_path) &&
                  ids.includes(img.id),
              );
              if (matchingImg) {
                return {
                  ...edit,
                  folder_id: folderId,
                  x: Math.round(matchingImg.x),
                  y: Math.round(matchingImg.y),
                };
              }
              return edit;
            });

            return {
              savedEdits: updatedEdits,
              savedFolders: [...(old?.savedFolders ?? []), newFolderData],
              photosFiles: old?.photosFiles ?? [],
              originalsFiles: old?.originalsFiles ?? [],
            };
          },
        );
      }
    }

    saveToHistory();
  }, [
    user,
    resolveOverlapsAndReflow,
    saveToHistory,
    queryClient,
    skipNextPhotosLoadRef,
  ]);

  const handleCreateFolderFromSelectionCancel = useCallback(() => {
    const ui = useUIStore.getState();
    ui.setCreateFolderFromSelectionIds(null);
    ui.setCreateFolderFromSelectionName("");
    ui.setCreateFolderFromSelectionNameError("");
  }, []);

  const handleCreateEmptyFolderSave = useCallback(async () => {
    const ui = useUIStore.getState();
    const { images, folders, setFolders, setImages } =
      useCanvasStore.getState();
    const { stagePosition, stageScale, dimensions } = useCanvasStore.getState();

    const name = ui.createEmptyFolderName.trim();
    if (!name) {
      ui.setCreateEmptyFolderNameError("Enter a folder name");
      return;
    }
    if (folders.some((f) => f.name.toLowerCase() === name.toLowerCase())) {
      ui.setCreateEmptyFolderNameError(
        "A folder with this name already exists",
      );
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
    const { folders: resolvedFolders, images: resolvedImages } =
      resolveOverlapsAndReflow(foldersWithNew, images, folderId);

    setFolders(resolvedFolders);
    setImages(resolvedImages);
    ui.setCreateEmptyFolderOpen(false);
    ui.setCreateEmptyFolderName("");
    ui.setCreateEmptyFolderNameError("");

    if (user) {
      const finalFolder = resolvedFolders.find((f) => f.id === folderId);
      if (finalFolder) {
        try {
          await supabase.from("photo_folders").insert({
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
              .from("photo_folders")
              .update({ x: Math.round(f.x), y: Math.round(f.y) })
              .eq("id", f.id)
              .eq("user_id", user.id);
          }
        } catch (err) {
          console.error("Failed to create folder", err);
        }
      }
    }

    saveToHistory();
  }, [user, resolveOverlapsAndReflow, saveToHistory]);

  const handleCreateEmptyFolderCancel = useCallback(() => {
    const ui = useUIStore.getState();
    ui.setCreateEmptyFolderOpen(false);
    ui.setCreateEmptyFolderName("");
    ui.setCreateEmptyFolderNameError("");
  }, []);

  const handleCreateSocialLayoutSave = useCallback(async () => {
    const ui = useUIStore.getState();
    const { images, folders, setFolders, setImages } =
      useCanvasStore.getState();
    const { stagePosition, stageScale, dimensions } = useCanvasStore.getState();

    const name = ui.createSocialLayoutName.trim();
    if (!name) {
      ui.setCreateSocialLayoutNameError("Enter a layout name");
      return;
    }
    if (folders.some((f) => f.name.toLowerCase() === name.toLowerCase())) {
      ui.setCreateSocialLayoutNameError(
        "A folder or layout with this name already exists",
      );
      return;
    }

    const pages = Math.max(
      1,
      Math.min(SOCIAL_LAYOUT_MAX_PAGES, ui.createSocialLayoutPages),
    );
    const centerX = (dimensions.width / 2 - stagePosition.x) / stageScale;
    const centerY = (dimensions.height / 2 - stagePosition.y) / stageScale;
    const folderId = `folder-${Date.now()}`;
    const colorIndex = folders.length % FOLDER_COLORS.length;
    const width = pages * SOCIAL_LAYOUT_PAGE_WIDTH;
    const pageHeight =
      (SOCIAL_LAYOUT_PAGE_WIDTH * SOCIAL_LAYOUT_ASPECT.h) /
      SOCIAL_LAYOUT_ASPECT.w;
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
      type: "social_layout",
      pageCount: pages,
      backgroundColor: DEFAULT_SOCIAL_LAYOUT_BG,
    };

    const foldersWithNew = [...folders, newFolder];
    const { folders: resolvedFolders, images: resolvedImages } =
      resolveOverlapsAndReflow(foldersWithNew, images, folderId);

    setFolders(resolvedFolders);
    setImages(resolvedImages);
    ui.setCreateSocialLayoutOpen(false);
    ui.setCreateSocialLayoutName("");
    ui.setCreateSocialLayoutPages(3);
    ui.setCreateSocialLayoutNameError("");

    if (user) {
      const finalFolder = resolvedFolders.find((f) => f.id === folderId);
      if (finalFolder) {
        try {
          await supabase.from("photo_folders").insert({
            id: folderId,
            user_id: user.id,
            name,
            x: Math.round(finalFolder.x),
            y: Math.round(finalFolder.y),
            width: Math.round(width),
            height: Math.round(height),
            color: FOLDER_COLORS[colorIndex],
            type: "social_layout",
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
              .from("photo_folders")
              .update({
                x: Math.round(f.x),
                y: Math.round(f.y),
                ...(f.type === "social_layout" && f.pageCount != null
                  ? {
                      width: Math.round(f.pageCount * SOCIAL_LAYOUT_PAGE_WIDTH),
                      page_count: f.pageCount,
                      background_color: f.backgroundColor ?? undefined,
                    }
                  : {}),
              })
              .eq("id", f.id)
              .eq("user_id", user.id);
          }
        } catch (err) {
          console.error("Failed to create social layout", err);
        }
      }
    }

    saveToHistory();
  }, [user, resolveOverlapsAndReflow, saveToHistory]);

  const handleCreateSocialLayoutCancel = useCallback(() => {
    const ui = useUIStore.getState();
    ui.setCreateSocialLayoutOpen(false);
    ui.setCreateSocialLayoutName("");
    ui.setCreateSocialLayoutPages(3);
    ui.setCreateSocialLayoutNameError("");
  }, []);

  const handleLayoutAddPage = useCallback(
    (folderId: string) => {
      const { folders, setFolders } = useCanvasStore.getState();
      const folder = folders.find((f) => f.id === folderId);
      if (!folder || !isSocialLayout(folder)) return;
      const n = Math.min(SOCIAL_LAYOUT_MAX_PAGES, (folder.pageCount ?? 1) + 1);
      if (n === (folder.pageCount ?? 1)) return;
      const width = n * SOCIAL_LAYOUT_PAGE_WIDTH;
      setFolders(
        folders.map((f) =>
          f.id === folderId ? { ...f, pageCount: n, width } : f,
        ),
      );
      useUIStore.getState().setFolderContextMenu(null);
      useInteractionStore.getState().setSelectedFolderId(null);
      saveToHistory();
      if (user) {
        supabase
          .from("photo_folders")
          .update({ page_count: n, width: Math.round(width) })
          .eq("id", folderId)
          .eq("user_id", user.id)
          .then(({ error }) => {
            if (error) console.error("Failed to update layout pages:", error);
          });
      }
    },
    [user, saveToHistory],
  );

  const handleLayoutRemovePage = useCallback(
    (folderId: string) => {
      const { folders, setFolders } = useCanvasStore.getState();
      const folder = folders.find((f) => f.id === folderId);
      if (!folder || !isSocialLayout(folder)) return;
      const n = Math.max(1, (folder.pageCount ?? 1) - 1);
      if (n === (folder.pageCount ?? 1)) return;
      const width = n * SOCIAL_LAYOUT_PAGE_WIDTH;
      setFolders(
        folders.map((f) =>
          f.id === folderId ? { ...f, pageCount: n, width } : f,
        ),
      );
      useUIStore.getState().setFolderContextMenu(null);
      useInteractionStore.getState().setSelectedFolderId(null);
      saveToHistory();
      if (user) {
        supabase
          .from("photo_folders")
          .update({ page_count: n, width: Math.round(width) })
          .eq("id", folderId)
          .eq("user_id", user.id)
          .then(({ error }) => {
            if (error) console.error("Failed to update layout pages:", error);
          });
      }
    },
    [user, saveToHistory],
  );

  // Live preview only (no DB call) — throttled to once per frame so dragging feels smooth
  const handleLayoutBackgroundColorPreview = useCallback(
    (folderId: string, color: string) => {
      colorPreviewPendingRef.current = { folderId, color };
      if (colorPreviewRafRef.current == null) {
        colorPreviewRafRef.current = requestAnimationFrame(() => {
          colorPreviewRafRef.current = null;
          const p = colorPreviewPendingRef.current;
          if (p) {
            const { folders, setFolders } = useCanvasStore.getState();
            setFolders(
              folders.map((f) =>
                f.id === p.folderId ? { ...f, backgroundColor: p.color } : f,
              ),
            );
          }
        });
      }
    },
    [],
  );

  // Commit to DB — fires once when the color picker is released/closed
  const handleLayoutBackgroundColorCommit = useCallback(
    (folderId: string, color: string) => {
      const { folders, setFolders } = useCanvasStore.getState();
      setFolders(
        folders.map((f) =>
          f.id === folderId ? { ...f, backgroundColor: color } : f,
        ),
      );
      saveToHistory();
      if (user) {
        supabase
          .from("photo_folders")
          .update({ background_color: color })
          .eq("id", folderId)
          .eq("user_id", user.id)
          .then(({ error }) => {
            if (error)
              console.error("Failed to update layout background:", error);
          });
      }
    },
    [user, saveToHistory],
  );

  const handleRenameFolder = useCallback(async () => {
    const ui = useUIStore.getState();
    const { folders, setFolders } = useCanvasStore.getState();
    const { editingFolder, editingFolderName } = ui;

    if (!editingFolder || !editingFolderName.trim()) return;
    const newName = editingFolderName.trim();

    if (
      folders.some(
        (f) =>
          f.id !== editingFolder.id &&
          f.name.toLowerCase() === newName.toLowerCase(),
      )
    ) {
      ui.setFolderNameError("A folder with this name already exists");
      return;
    }

    ui.setFolderNameError("");
    setFolders(
      folders.map((f) =>
        f.id === editingFolder.id ? { ...f, name: newName } : f,
      ),
    );

    if (user) {
      try {
        await supabase
          .from("photo_folders")
          .update({ name: newName })
          .eq("id", editingFolder.id)
          .eq("user_id", user.id);
      } catch (error) {
        console.error("Failed to update folder name:", error);
      }
    }

    ui.setEditingFolder(null);
    ui.setEditingFolderName("");
    ui.setFolderNameError("");
    saveToHistory();
  }, [user, saveToHistory]);

  const handleDeleteFolder = useCallback(async () => {
    const ui = useUIStore.getState();
    const { images, setImages, setFolders } = useCanvasStore.getState();
    const { editingFolder } = ui;

    if (!editingFolder) return;

    const folder = editingFolder;
    const folderImageIds = [...folder.imageIds];
    const total = folderImageIds.length;

    ui.setConfirmDeleteFolderOpen(false);
    ui.setEditingFolder(null);
    ui.setEditingFolderName("");
    ui.setFolderNameError("");
    ui.setDeleteFolderProgress(
      total > 0 ? { current: 0, total } : { current: 0, total: 0 },
    );

    try {
      if (user) {
        for (let i = 0; i < folderImageIds.length; i++) {
          ui.setDeleteFolderProgress({ current: i + 1, total });
          const imgId = folderImageIds[i];
          const img = images.find((im) => im.id === imgId);
          if (!img) continue;
          const payload = getDeletePhotoPayload(img);
          if (!payload.storagePath && !payload.originalStoragePath) continue;
          try {
            const res = await fetch("/api/delete-photo", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...payload, userId: user.id }),
            });
            if (!res.ok) {
              const data = await res.json();
              console.error("Failed to delete image:", data);
            }
          } catch (error) {
            console.error("Failed to delete image:", error);
          }
        }
      }

      if (total === 0) ui.setDeleteFolderProgress({ current: 0, total: 0 });

      setImages((prev) =>
        prev.filter((img) => !folderImageIds.includes(img.id)),
      );

      if (user) {
        try {
          await supabase
            .from("photo_folders")
            .delete()
            .eq("id", folder.id)
            .eq("user_id", user.id);
        } catch (error) {
          console.error("Failed to delete folder:", error);
        }
      }

      setFolders((prev) => prev.filter((f) => f.id !== folder.id));
      if (user)
        queryClient.invalidateQueries({ queryKey: ["user-photos", user.id] });
      saveToHistory();
    } finally {
      ui.setDeleteFolderProgress(null);
    }
  }, [user, saveToHistory, queryClient]);

  const handleDeletePhotos = useCallback(
    async (ids: string[]) => {
      const { images, setImages, setSelectedIds } = useCanvasStore.getState();
      const ui = useUIStore.getState();

      const photoIds = ids.filter((id) => {
        const img = images.find((i) => i.id === id);
        return img && "src" in img;
      });
      if (photoIds.length === 0) return;

      ui.setDeletingPhotoId(photoIds[0]);
      try {
        if (user) {
          for (const photoId of photoIds) {
            const img = images.find((i) => i.id === photoId);
            if (!img || !("src" in img)) continue;
            const payload = getDeletePhotoPayload(img);
            if (!payload.storagePath && !payload.originalStoragePath) continue;
            try {
              const res = await fetch("/api/delete-photo", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...payload, userId: user.id }),
              });
              if (!res.ok) {
                const data = await res.json();
                console.error("Delete photo failed:", data);
              }
            } catch (err) {
              console.error("Error deleting photo:", err);
            }
          }
          queryClient.invalidateQueries({ queryKey: ["user-photos", user.id] });
        }
        setImages((prev) => prev.filter((img) => !photoIds.includes(img.id)));
        setSelectedIds((prev) => prev.filter((id) => !photoIds.includes(id)));
        saveToHistory();
      } finally {
        ui.setDeletingPhotoId(null);
      }
    },
    [user, queryClient, saveToHistory],
  );

  const handleRecenterFolders = useCallback(async () => {
    const {
      images,
      folders,
      setFolders,
      setImages,
      stagePosition,
      stageScale,
      dimensions,
    } = useCanvasStore.getState();
    if (folders.length === 0) return;

    const { folderGap } = GRID_CONFIG;

    let totalWidth = 0;
    for (const folder of folders) {
      totalWidth += folder.width;
    }
    totalWidth += (folders.length - 1) * folderGap;

    const viewportCenterX =
      (dimensions.width / 2 - stagePosition.x) / stageScale;
    const viewportCenterY =
      (dimensions.height / 2 - stagePosition.y) / stageScale;

    let currentX = viewportCenterX - totalWidth / 2;

    const sortedFolders = [...folders].sort((a, b) => a.x - b.x);

    const recenteredFolders: PhotoFolder[] = [];
    let recenteredImages = [...images];

    for (let i = 0; i < sortedFolders.length; i++) {
      const folder = sortedFolders[i];
      const newFolder = {
        ...folder,
        x: currentX,
        y: viewportCenterY - 100,
      };
      recenteredFolders.push(newFolder);

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

    if (user) {
      for (const f of recenteredFolders) {
        supabase
          .from("photo_folders")
          .update({ x: Math.round(f.x), y: Math.round(f.y) })
          .eq("id", f.id)
          .eq("user_id", user.id)
          .then(({ error }) => {
            if (error)
              console.error("Failed to update folder position:", error);
          });
      }

      const folderImages = recenteredImages.filter(
        (img) => (img.storagePath || img.originalStoragePath) && img.folderId,
      );
      for (const img of folderImages) {
        const canonicalPath = img.storagePath || img.originalStoragePath!;
        supabase
          .from("photo_edits")
          .update({ x: Math.round(img.x), y: Math.round(img.y) })
          .eq("storage_path", canonicalPath)
          .eq("user_id", user.id)
          .then(({ error }) => {
            if (error) console.error("Failed to update image position:", error);
          });
      }
    }
  }, [user, saveToHistory]);

  return {
    handleCreateFolderFromSelection,
    handleCreateFolderFromSelectionSave,
    handleCreateFolderFromSelectionCancel,
    handleCreateEmptyFolderSave,
    handleCreateEmptyFolderCancel,
    handleCreateSocialLayoutSave,
    handleCreateSocialLayoutCancel,
    handleLayoutAddPage,
    handleLayoutRemovePage,
    handleLayoutBackgroundColorPreview,
    handleLayoutBackgroundColorCommit,
    handleRenameFolder,
    handleDeleteFolder,
    handleDeletePhotos,
    handleRecenterFolders,
  };
}
