import { create } from 'zustand';

interface InteractionState {
  isDragging: boolean;
  isAdjustingSliders: boolean;
  sliderSettledWhileDragging: boolean;
  isSpacePressed: boolean;
  dragHoveredFolderId: string | null;
  dragSourceFolderBorderHovered: string | null;
  dragBorderBlink: boolean;
  hoveredFolderBorder: string | null;
  resizingFolderId: string | null;
  selectedFolderId: string | null;
  lastTouchDistance: number | null;
  lastTouchCenter: { x: number; y: number } | null;
  dragGhostPosition: {
    x: number;
    y: number;
    width: number;
    height: number;
    folderId: string;
  } | null;

  // Actions
  setIsDragging: (v: boolean) => void;
  setIsAdjustingSliders: (v: boolean) => void;
  setSliderSettledWhileDragging: (v: boolean) => void;
  setIsSpacePressed: (v: boolean) => void;
  setDragHoveredFolderId: (v: string | null) => void;
  setDragSourceFolderBorderHovered: (v: string | null) => void;
  setDragBorderBlink: (v: boolean) => void;
  setHoveredFolderBorder: (v: string | null) => void;
  setResizingFolderId: (v: string | null) => void;
  setSelectedFolderId: (v: string | null) => void;
  setLastTouchDistance: (v: number | null) => void;
  setLastTouchCenter: (v: { x: number; y: number } | null) => void;
  setDragGhostPosition: (v: InteractionState['dragGhostPosition']) => void;
}

export const useInteractionStore = create<InteractionState>()((set) => ({
  isDragging: false,
  isAdjustingSliders: false,
  sliderSettledWhileDragging: false,
  isSpacePressed: false,
  dragHoveredFolderId: null,
  dragSourceFolderBorderHovered: null,
  dragBorderBlink: false,
  hoveredFolderBorder: null,
  resizingFolderId: null,
  selectedFolderId: null,
  lastTouchDistance: null,
  lastTouchCenter: null,
  dragGhostPosition: null,

  setIsDragging: (v) => set({ isDragging: v }),
  setIsAdjustingSliders: (v) => set({ isAdjustingSliders: v }),
  setSliderSettledWhileDragging: (v) => set({ sliderSettledWhileDragging: v }),
  setIsSpacePressed: (v) => set({ isSpacePressed: v }),
  setDragHoveredFolderId: (v) => set({ dragHoveredFolderId: v }),
  setDragSourceFolderBorderHovered: (v) => set({ dragSourceFolderBorderHovered: v }),
  setDragBorderBlink: (v) => set({ dragBorderBlink: v }),
  setHoveredFolderBorder: (v) => set({ hoveredFolderBorder: v }),
  setResizingFolderId: (v) => set({ resizingFolderId: v }),
  setSelectedFolderId: (v) => set({ selectedFolderId: v }),
  setLastTouchDistance: (v) => set({ lastTouchDistance: v }),
  setLastTouchCenter: (v) => set({ lastTouchCenter: v }),
  setDragGhostPosition: (v) => set({ dragGhostPosition: v }),
}));

// Selectors
export const selectIsDragging = (state: InteractionState) => state.isDragging;
export const selectIsAdjustingSliders = (state: InteractionState) => state.isAdjustingSliders;
export const selectIsSpacePressed = (state: InteractionState) => state.isSpacePressed;
export const selectSelectedFolderId = (state: InteractionState) => state.selectedFolderId;
