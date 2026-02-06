import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { CanvasImage, PhotoFolder } from '@/lib/types';

interface FolderPromptState {
  showFolderPrompt: boolean;
  newFolderName: string;
  pendingFileCount: number;
  editingFolder: PhotoFolder | null;
  editingFolderName: string;
  selectedExistingFolderId: string | null;
  folderNameError: string;
}

interface CreateFolderFromSelectionState {
  createFolderFromSelectionIds: string[] | null;
  createFolderFromSelectionName: string;
  createFolderFromSelectionNameError: string;
}

interface CreateEmptyFolderState {
  createEmptyFolderOpen: boolean;
  createEmptyFolderName: string;
  createEmptyFolderNameError: string;
}

interface CreateSocialLayoutState {
  createSocialLayoutOpen: boolean;
  createSocialLayoutName: string;
  createSocialLayoutPages: number;
  createSocialLayoutNameError: string;
}

interface ContextMenuState {
  folderContextMenu: { x: number; y: number; folderId: string } | null;
  imageContextMenu: { x: number; y: number; imageId: string; selectedIds: string[] } | null;
  canvasContextMenu: { x: number; y: number } | null;
}

interface DeleteConfirmState {
  confirmDeleteFolderOpen: boolean;
  deleteFolderDontAskAgain: boolean;
  deletingPhotoId: string | null;
  confirmDeletePhotoIds: string[] | null;
  deletePhotoDontAskAgain: boolean;
  deleteFolderProgress: { current: number; total: number } | null;
}

interface UIState extends
  FolderPromptState,
  CreateFolderFromSelectionState,
  CreateEmptyFolderState,
  CreateSocialLayoutState,
  ContextMenuState,
  DeleteConfirmState {
  // Misc UI
  borderDialogImageId: string | null;
  createPresetFromImageId: string | null;
  createPresetName: string;
  applyPresetToSelectionIds: string[] | null;
  exportProgress: { current: number; total: number } | null;
  applyPresetProgress: { current: number; total: number } | null;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  zoomedImageId: string | null;
  showHeader: boolean;
  photoFilter: {
    dateFrom?: string;
    dateTo?: string;
    cameraMake?: string;
    cameraModel?: string;
    contentSearch?: string;
  };
  isUploading: boolean;
  mobileEditFullscreen: boolean;
  mobileMenuOpen: boolean;

  // Actions
  setShowFolderPrompt: (v: boolean) => void;
  setNewFolderName: (v: string) => void;
  setPendingFileCount: (v: number) => void;
  setEditingFolder: (v: PhotoFolder | null) => void;
  setEditingFolderName: (v: string) => void;
  setSelectedExistingFolderId: (v: string | null) => void;
  setFolderNameError: (v: string) => void;
  setCreateFolderFromSelectionIds: (v: string[] | null) => void;
  setCreateFolderFromSelectionName: (v: string) => void;
  setCreateFolderFromSelectionNameError: (v: string) => void;
  setCreateEmptyFolderOpen: (v: boolean) => void;
  setCreateEmptyFolderName: (v: string) => void;
  setCreateEmptyFolderNameError: (v: string) => void;
  setCreateSocialLayoutOpen: (v: boolean) => void;
  setCreateSocialLayoutName: (v: string) => void;
  setCreateSocialLayoutPages: (v: number) => void;
  setCreateSocialLayoutNameError: (v: string) => void;
  setFolderContextMenu: (v: { x: number; y: number; folderId: string } | null) => void;
  setImageContextMenu: (v: { x: number; y: number; imageId: string; selectedIds: string[] } | null) => void;
  setCanvasContextMenu: (v: { x: number; y: number } | null) => void;
  setConfirmDeleteFolderOpen: (v: boolean) => void;
  setDeleteFolderDontAskAgain: (v: boolean) => void;
  setDeletingPhotoId: (v: string | null) => void;
  setConfirmDeletePhotoIds: (v: string[] | null) => void;
  setDeletePhotoDontAskAgain: (v: boolean) => void;
  setDeleteFolderProgress: (v: { current: number; total: number } | null) => void;
  setBorderDialogImageId: (v: string | null) => void;
  setCreatePresetFromImageId: (v: string | null) => void;
  setCreatePresetName: (v: string) => void;
  setApplyPresetToSelectionIds: (v: string[] | null) => void;
  setExportProgress: (v: { current: number; total: number } | null) => void;
  setApplyPresetProgress: (v: { current: number; total: number } | null) => void;
  setSaveStatus: (v: 'idle' | 'saving' | 'saved' | 'error') => void;
  setZoomedImageId: (v: string | null) => void;
  setShowHeader: (v: boolean) => void;
  setPhotoFilter: (v: UIState['photoFilter'] | ((prev: UIState['photoFilter']) => UIState['photoFilter'])) => void;
  setIsUploading: (v: boolean) => void;
  setMobileEditFullscreen: (v: boolean) => void;
  setMobileMenuOpen: (v: boolean) => void;
  closeAllMenus: () => void;
}

export const useUIStore = create<UIState>()(
  immer((set) => ({
    // Folder prompt
    showFolderPrompt: false,
    newFolderName: '',
    pendingFileCount: 0,
    editingFolder: null,
    editingFolderName: '',
    selectedExistingFolderId: null,
    folderNameError: '',

    // Create from selection
    createFolderFromSelectionIds: null,
    createFolderFromSelectionName: '',
    createFolderFromSelectionNameError: '',

    // Create empty folder
    createEmptyFolderOpen: false,
    createEmptyFolderName: '',
    createEmptyFolderNameError: '',

    // Create social layout
    createSocialLayoutOpen: false,
    createSocialLayoutName: '',
    createSocialLayoutPages: 3,
    createSocialLayoutNameError: '',

    // Context menus
    folderContextMenu: null,
    imageContextMenu: null,
    canvasContextMenu: null,

    // Delete confirmations
    confirmDeleteFolderOpen: false,
    deleteFolderDontAskAgain: false,
    deletingPhotoId: null,
    confirmDeletePhotoIds: null,
    deletePhotoDontAskAgain: false,
    deleteFolderProgress: null,

    // Misc UI
    borderDialogImageId: null,
    createPresetFromImageId: null,
    createPresetName: '',
    applyPresetToSelectionIds: null,
    exportProgress: null,
    applyPresetProgress: null,
    saveStatus: 'idle',
    zoomedImageId: null,
    showHeader: false,
    photoFilter: {},
    isUploading: false,
    mobileEditFullscreen: false,
    mobileMenuOpen: false,

    // Actions
    setShowFolderPrompt: (v) => set({ showFolderPrompt: v }),
    setNewFolderName: (v) => set({ newFolderName: v }),
    setPendingFileCount: (v) => set({ pendingFileCount: v }),
    setEditingFolder: (v) => set({ editingFolder: v }),
    setEditingFolderName: (v) => set({ editingFolderName: v }),
    setSelectedExistingFolderId: (v) => set({ selectedExistingFolderId: v }),
    setFolderNameError: (v) => set({ folderNameError: v }),
    setCreateFolderFromSelectionIds: (v) => set({ createFolderFromSelectionIds: v }),
    setCreateFolderFromSelectionName: (v) => set({ createFolderFromSelectionName: v }),
    setCreateFolderFromSelectionNameError: (v) => set({ createFolderFromSelectionNameError: v }),
    setCreateEmptyFolderOpen: (v) => set({ createEmptyFolderOpen: v }),
    setCreateEmptyFolderName: (v) => set({ createEmptyFolderName: v }),
    setCreateEmptyFolderNameError: (v) => set({ createEmptyFolderNameError: v }),
    setCreateSocialLayoutOpen: (v) => set({ createSocialLayoutOpen: v }),
    setCreateSocialLayoutName: (v) => set({ createSocialLayoutName: v }),
    setCreateSocialLayoutPages: (v) => set({ createSocialLayoutPages: v }),
    setCreateSocialLayoutNameError: (v) => set({ createSocialLayoutNameError: v }),
    setFolderContextMenu: (v) => set({ folderContextMenu: v }),
    setImageContextMenu: (v) => set({ imageContextMenu: v }),
    setCanvasContextMenu: (v) => set({ canvasContextMenu: v }),
    setConfirmDeleteFolderOpen: (v) => set({ confirmDeleteFolderOpen: v }),
    setDeleteFolderDontAskAgain: (v) => set({ deleteFolderDontAskAgain: v }),
    setDeletingPhotoId: (v) => set({ deletingPhotoId: v }),
    setConfirmDeletePhotoIds: (v) => set({ confirmDeletePhotoIds: v }),
    setDeletePhotoDontAskAgain: (v) => set({ deletePhotoDontAskAgain: v }),
    setDeleteFolderProgress: (v) => set({ deleteFolderProgress: v }),
    setBorderDialogImageId: (v) => set({ borderDialogImageId: v }),
    setCreatePresetFromImageId: (v) => set({ createPresetFromImageId: v }),
    setCreatePresetName: (v) => set({ createPresetName: v }),
    setApplyPresetToSelectionIds: (v) => set({ applyPresetToSelectionIds: v }),
    setExportProgress: (v) => set({ exportProgress: v }),
    setApplyPresetProgress: (v) => set({ applyPresetProgress: v }),
    setSaveStatus: (v) => set({ saveStatus: v }),
    setZoomedImageId: (v) => set({ zoomedImageId: v }),
    setShowHeader: (v) => set({ showHeader: v }),
    setPhotoFilter: (v) => set((state) => {
      state.photoFilter = typeof v === 'function' ? v(state.photoFilter) : v;
    }),
    setIsUploading: (v) => set({ isUploading: v }),
    setMobileEditFullscreen: (v) => set({ mobileEditFullscreen: v }),
    setMobileMenuOpen: (v) => set({ mobileMenuOpen: v }),
    closeAllMenus: () => set({
      folderContextMenu: null,
      imageContextMenu: null,
      canvasContextMenu: null,
    }),
  }))
);

// Selectors
export const selectSaveStatus = (state: UIState) => state.saveStatus;
export const selectExportProgress = (state: UIState) => state.exportProgress;
export const selectZoomedImageId = (state: UIState) => state.zoomedImageId;
export const selectPhotoFilter = (state: UIState) => state.photoFilter;
export const selectIsUploading = (state: UIState) => state.isUploading;
