import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { CanvasImage, CanvasText, PhotoFolder } from '@/lib/types';

interface CanvasState {
  // Core data
  images: CanvasImage[];
  texts: CanvasText[];
  folders: PhotoFolder[];
  selectedIds: string[];

  // Viewport
  stageScale: number;
  stagePosition: { x: number; y: number };
  dimensions: { width: number; height: number };

  // Actions - data
  setImages: (images: CanvasImage[] | ((prev: CanvasImage[]) => CanvasImage[])) => void;
  updateImage: (id: string, updates: Partial<CanvasImage>) => void;
  setTexts: (texts: CanvasText[] | ((prev: CanvasText[]) => CanvasText[])) => void;
  setFolders: (folders: PhotoFolder[] | ((prev: PhotoFolder[]) => PhotoFolder[])) => void;
  updateFolder: (id: string, updates: Partial<PhotoFolder>) => void;
  setSelectedIds: (ids: string[] | ((prev: string[]) => string[])) => void;

  // Actions - viewport
  setStageScale: (scale: number) => void;
  setStagePosition: (pos: { x: number; y: number }) => void;
  setDimensions: (dims: { width: number; height: number }) => void;
}

export const useCanvasStore = create<CanvasState>()(
  immer((set, get) => ({
    images: [],
    texts: [],
    folders: [],
    selectedIds: [],
    stageScale: 1,
    stagePosition: { x: 0, y: 0 },
    dimensions: { width: 1920, height: 1080 },

    setImages: (imagesOrFn) => set((state) => {
      state.images = typeof imagesOrFn === 'function'
        ? imagesOrFn(state.images)
        : imagesOrFn;
    }),

    updateImage: (id, updates) => set((state) => {
      const idx = state.images.findIndex((img) => img.id === id);
      if (idx !== -1) {
        Object.assign(state.images[idx], updates);
      }
    }),

    setTexts: (textsOrFn) => set((state) => {
      state.texts = typeof textsOrFn === 'function'
        ? textsOrFn(state.texts)
        : textsOrFn;
    }),

    setFolders: (foldersOrFn) => set((state) => {
      state.folders = typeof foldersOrFn === 'function'
        ? foldersOrFn(state.folders)
        : foldersOrFn;
    }),

    updateFolder: (id, updates) => set((state) => {
      const idx = state.folders.findIndex((f) => f.id === id);
      if (idx !== -1) {
        Object.assign(state.folders[idx], updates);
      }
    }),

    setSelectedIds: (idsOrFn) => set((state) => {
      state.selectedIds = typeof idsOrFn === 'function'
        ? idsOrFn(state.selectedIds)
        : idsOrFn;
    }),

    setStageScale: (scale) => set({ stageScale: scale }),
    setStagePosition: (pos) => set({ stagePosition: pos }),
    setDimensions: (dims) => set({ dimensions: dims }),
  }))
);

// Selectors for granular subscriptions
export const selectImages = (state: CanvasState) => state.images;
export const selectSelectedIds = (state: CanvasState) => state.selectedIds;
export const selectFolders = (state: CanvasState) => state.folders;
export const selectStageScale = (state: CanvasState) => state.stageScale;
export const selectStagePosition = (state: CanvasState) => state.stagePosition;
export const selectDimensions = (state: CanvasState) => state.dimensions;

export const selectSelectedImage = (state: CanvasState): CanvasImage | undefined => {
  if (state.selectedIds.length !== 1) return undefined;
  return state.images.find((img) => img.id === state.selectedIds[0]);
};
