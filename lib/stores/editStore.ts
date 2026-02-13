import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { CanvasImage } from "@/lib/types";
import { cloneEditValue, EDIT_KEYS } from "@/lib/types";

type BypassTab = "curves" | "light" | "color" | "effects";

interface EditSnapshot {
  imageId: string;
  snapshot: Partial<CanvasImage>;
}

interface EditState {
  editHistory: EditSnapshot[];
  editRedoStack: EditSnapshot[];
  bypassedTabs: Set<BypassTab>;
  copiedEdit: Partial<CanvasImage> | null;

  // Actions
  pushSnapshot: (imageId: string, image: CanvasImage) => void;
  undo: (
    images: CanvasImage[],
    updateImage: (id: string, updates: Partial<CanvasImage>) => void,
  ) => void;
  redo: (
    images: CanvasImage[],
    updateImage: (id: string, updates: Partial<CanvasImage>) => void,
  ) => void;
  toggleBypass: (tab: BypassTab) => void;
  setBypassedTabs: (tabs: Set<BypassTab>) => void;
  copyEdit: (image: CanvasImage) => void;
  setCopiedEdit: (v: Partial<CanvasImage> | null) => void;
  setEditHistory: (
    v: EditSnapshot[] | ((prev: EditSnapshot[]) => EditSnapshot[]),
  ) => void;
  setEditRedoStack: (
    v: EditSnapshot[] | ((prev: EditSnapshot[]) => EditSnapshot[]),
  ) => void;
}

export const useEditStore = create<EditState>()(
  immer((set, get) => ({
    editHistory: [],
    editRedoStack: [],
    bypassedTabs: new Set<BypassTab>(),
    copiedEdit: null,

    pushSnapshot: (imageId, image) =>
      set((state) => {
        const snapshot: Partial<CanvasImage> = {};
        for (const key of EDIT_KEYS) {
          if (key in image) {
            (snapshot as Record<string, unknown>)[key] = cloneEditValue(
              key,
              (image as unknown as Record<string, unknown>)[key],
            );
          }
        }
        state.editHistory.push({ imageId, snapshot });
        state.editRedoStack = [];
      }),

    undo: (images, updateImage) => {
      const { editHistory } = get();
      if (editHistory.length === 0) return;

      const last = editHistory[editHistory.length - 1];
      const currentImage = images.find((img) => img.id === last.imageId);
      if (!currentImage) return;

      // Save current state for redo
      const currentSnapshot: Partial<CanvasImage> = {};
      for (const key of EDIT_KEYS) {
        if (key in currentImage) {
          (currentSnapshot as Record<string, unknown>)[key] = cloneEditValue(
            key,
            (currentImage as unknown as Record<string, unknown>)[key],
          );
        }
      }

      // Apply the undo snapshot
      updateImage(last.imageId, last.snapshot);

      set((state) => {
        state.editRedoStack.push({
          imageId: last.imageId,
          snapshot: currentSnapshot,
        });
        state.editHistory.pop();
      });
    },

    redo: (images, updateImage) => {
      const { editRedoStack } = get();
      if (editRedoStack.length === 0) return;

      const next = editRedoStack[editRedoStack.length - 1];
      const currentImage = images.find((img) => img.id === next.imageId);
      if (!currentImage) return;

      // Save current state for undo
      const currentSnapshot: Partial<CanvasImage> = {};
      for (const key of EDIT_KEYS) {
        if (key in currentImage) {
          (currentSnapshot as Record<string, unknown>)[key] = cloneEditValue(
            key,
            (currentImage as unknown as Record<string, unknown>)[key],
          );
        }
      }

      // Apply the redo snapshot
      updateImage(next.imageId, next.snapshot);

      set((state) => {
        state.editHistory.push({
          imageId: next.imageId,
          snapshot: currentSnapshot,
        });
        state.editRedoStack.pop();
      });
    },

    toggleBypass: (tab) =>
      set((state) => {
        const newSet = new Set(state.bypassedTabs);
        if (newSet.has(tab)) {
          newSet.delete(tab);
        } else {
          newSet.add(tab);
        }
        state.bypassedTabs = newSet;
      }),

    setBypassedTabs: (tabs) => set({ bypassedTabs: tabs }),

    copyEdit: (image) =>
      set((state) => {
        const edit: Partial<CanvasImage> = {};
        for (const key of EDIT_KEYS) {
          if (key in image) {
            (edit as Record<string, unknown>)[key] = cloneEditValue(
              key,
              (image as unknown as Record<string, unknown>)[key],
            );
          }
        }
        state.copiedEdit = edit;
      }),

    setCopiedEdit: (v) => set({ copiedEdit: v }),

    setEditHistory: (v) =>
      set((state) => {
        state.editHistory = typeof v === "function" ? v(state.editHistory) : v;
      }),

    setEditRedoStack: (v) =>
      set((state) => {
        state.editRedoStack =
          typeof v === "function" ? v(state.editRedoStack) : v;
      }),
  })),
);

// Selectors
export const selectBypassedTabs = (state: EditState) => state.bypassedTabs;
export const selectCopiedEdit = (state: EditState) => state.copiedEdit;
export const selectCanUndo = (state: EditState) => state.editHistory.length > 0;
export const selectCanRedo = (state: EditState) =>
  state.editRedoStack.length > 0;
