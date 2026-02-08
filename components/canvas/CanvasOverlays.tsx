import React from 'react';
import { useUIStore } from '@/lib/stores/uiStore';
import { useCanvasStore } from '@/lib/stores/canvasStore';
import { useEditStore } from '@/lib/stores/editStore';
import { useInteractionStore } from '@/lib/stores/interactionStore';
import {
  SOCIAL_LAYOUT_PAGE_WIDTH, SOCIAL_LAYOUT_MAX_PAGES,
  DEFAULT_SOCIAL_LAYOUT_BG, isSocialLayout,
} from '@/lib/folders/folderLayout';

interface CanvasOverlaysProps {
  // Upload handlers
  processFilesWithFolder: (name: string) => void;
  addFilesToExistingFolder: (folderId: string) => void;
  pendingFilesRef: React.MutableRefObject<File[]>;
  // Folder ops handlers
  handleRenameFolder: () => void;
  handleDeleteFolder: () => void;
  handleDeletePhotos: (ids: string[]) => Promise<void>;
  handleCreateEmptyFolderSave: () => void;
  handleCreateEmptyFolderCancel: () => void;
  handleCreateSocialLayoutSave: () => void;
  handleCreateSocialLayoutCancel: () => void;
  handleCreateFolderFromSelection: () => void;
  handleCreateFolderFromSelectionSave: () => void;
  handleCreateFolderFromSelectionCancel: () => void;
  handleLayoutAddPage: (folderId: string) => void;
  handleLayoutRemovePage: (folderId: string) => void;
  handleLayoutBackgroundColorPreview: (folderId: string, color: string) => void;
  handleLayoutBackgroundColorCommit: (folderId: string, color: string) => void;
  // Edit handlers
  handleCopyEdit: () => void;
  handlePasteEdit: () => void;
  handleExportSelection: () => void;
  handleCreatePresetClick: () => void;
  handleCreatePresetSave: () => void;
  handleCreatePresetCancel: () => void;
  // Refs
  canvasContextMenuRef: React.RefObject<HTMLDivElement | null>;
  folderContextMenuRef: React.RefObject<HTMLDivElement | null>;
  imageContextMenuRef: React.RefObject<HTMLDivElement | null>;
  borderDialogRef: React.RefObject<HTMLDivElement | null>;
}

export function CanvasOverlays({
  processFilesWithFolder,
  addFilesToExistingFolder,
  pendingFilesRef,
  handleRenameFolder,
  handleDeleteFolder,
  handleDeletePhotos,
  handleCreateEmptyFolderSave,
  handleCreateEmptyFolderCancel,
  handleCreateSocialLayoutSave,
  handleCreateSocialLayoutCancel,
  handleCreateFolderFromSelection,
  handleCreateFolderFromSelectionSave,
  handleCreateFolderFromSelectionCancel,
  handleLayoutAddPage,
  handleLayoutRemovePage,
  handleLayoutBackgroundColorPreview,
  handleLayoutBackgroundColorCommit,
  handleCopyEdit,
  handlePasteEdit,
  handleExportSelection,
  handleCreatePresetClick,
  handleCreatePresetSave,
  handleCreatePresetCancel,
  canvasContextMenuRef,
  folderContextMenuRef,
  imageContextMenuRef,
  borderDialogRef,
}: CanvasOverlaysProps) {
  const images = useCanvasStore((s) => s.images);
  const folders = useCanvasStore((s) => s.folders);
  const setImages = useCanvasStore.getState().setImages;
  const selectedFolderId = useInteractionStore((s) => s.selectedFolderId);

  // UI store
  const showFolderPrompt = useUIStore((s) => s.showFolderPrompt);
  const newFolderName = useUIStore((s) => s.newFolderName);
  const pendingFileCount = useUIStore((s) => s.pendingFileCount);
  const editingFolder = useUIStore((s) => s.editingFolder);
  const editingFolderName = useUIStore((s) => s.editingFolderName);
  const selectedExistingFolderId = useUIStore((s) => s.selectedExistingFolderId);
  const folderNameError = useUIStore((s) => s.folderNameError);
  const createFolderFromSelectionIds = useUIStore((s) => s.createFolderFromSelectionIds);
  const createFolderFromSelectionName = useUIStore((s) => s.createFolderFromSelectionName);
  const createFolderFromSelectionNameError = useUIStore((s) => s.createFolderFromSelectionNameError);
  const createEmptyFolderOpen = useUIStore((s) => s.createEmptyFolderOpen);
  const createEmptyFolderName = useUIStore((s) => s.createEmptyFolderName);
  const createEmptyFolderNameError = useUIStore((s) => s.createEmptyFolderNameError);
  const createSocialLayoutOpen = useUIStore((s) => s.createSocialLayoutOpen);
  const createSocialLayoutName = useUIStore((s) => s.createSocialLayoutName);
  const createSocialLayoutPages = useUIStore((s) => s.createSocialLayoutPages);
  const createSocialLayoutNameError = useUIStore((s) => s.createSocialLayoutNameError);
  const folderContextMenu = useUIStore((s) => s.folderContextMenu);
  const confirmDeleteFolderOpen = useUIStore((s) => s.confirmDeleteFolderOpen);
  const deleteFolderDontAskAgain = useUIStore((s) => s.deleteFolderDontAskAgain);
  const imageContextMenu = useUIStore((s) => s.imageContextMenu);
  const borderDialogImageId = useUIStore((s) => s.borderDialogImageId);
  const canvasContextMenu = useUIStore((s) => s.canvasContextMenu);
  const createPresetFromImageId = useUIStore((s) => s.createPresetFromImageId);
  const createPresetName = useUIStore((s) => s.createPresetName);
  const confirmDeletePhotoIds = useUIStore((s) => s.confirmDeletePhotoIds);
  const deletePhotoDontAskAgain = useUIStore((s) => s.deletePhotoDontAskAgain);
  const deleteFolderProgress = useUIStore((s) => s.deleteFolderProgress);
  const isUploading = useUIStore((s) => s.isUploading);
  const exportProgress = useUIStore((s) => s.exportProgress);
  const copiedEdit = useEditStore((s) => s.copiedEdit);

  const ui = useUIStore.getState();

  return (
    <>
      {/* Upload loading indicator */}
      {isUploading && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 bg-[#171717] border border-[#2a2a2a] rounded-xl px-4 py-3 shadow-2xl shadow-black/50">
          <div className="w-5 h-5 border-2 border-[#3ECF8E] border-t-transparent rounded-full animate-spin" />
          <span className="text-white text-sm font-medium">Uploading...</span>
        </div>
      )}

      {/* Delete folder progress */}
      {deleteFolderProgress && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 bg-[#171717] border border-[#2a2a2a] rounded-xl px-4 py-3 shadow-2xl shadow-black/50">
          <div className="w-5 h-5 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
          <span className="text-white text-sm font-medium">
            {deleteFolderProgress.total > 0
              ? `Deleting ${deleteFolderProgress.current} of ${deleteFolderProgress.total}`
              : 'Deleting folder...'}
          </span>
        </div>
      )}

      {/* Export progress indicator */}
      {exportProgress && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 bg-[#171717] border border-[#2a2a2a] rounded-xl px-4 py-3 shadow-2xl shadow-black/50">
          <div className="w-5 h-5 border-2 border-[#3ECF8E] border-t-transparent rounded-full animate-spin" />
          <span className="text-white text-sm font-medium">
            Exporting {exportProgress.current} of {exportProgress.total}
          </span>
          <span className="text-[#888] text-xs">You can keep editing</span>
        </div>
      )}

      {/* Folder Name Prompt Modal */}
      {showFolderPrompt && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-[#171717] border border-[#2a2a2a] rounded-2xl shadow-2xl shadow-black/50 p-6 w-full max-w-96 mx-4">
            <h2 className="text-lg font-semibold text-white mb-1">Add {pendingFileCount} photo{pendingFileCount > 1 ? 's' : ''}</h2>
            <p className="text-sm text-[#888] mb-4">Choose an existing folder or create a new one</p>

            {folders.length > 0 && (
              <div className="mb-4">
                <label className="block text-xs uppercase tracking-wide text-[#666] mb-2">Existing Folders</label>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {folders.map((folder) => (
                    <button
                      key={folder.id}
                      onClick={() => {
                        ui.setSelectedExistingFolderId(folder.id);
                        ui.setNewFolderName('');
                        ui.setFolderNameError('');
                      }}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors text-left cursor-pointer ${selectedExistingFolderId === folder.id
                          ? 'bg-[#3ECF8E]/20 border border-[#3ECF8E]'
                          : 'bg-[#252525] border border-[#333] hover:border-[#444]'
                        }`}
                    >
                      <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: folder.color }} />
                      <span className="text-sm text-white truncate">{folder.name}</span>
                      <span className="text-xs text-[#666] ml-auto">{folder.imageIds.length} photos</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {folders.length > 0 && (
              <div className="flex items-center gap-3 mb-4">
                <div className="flex-1 h-px bg-[#333]" />
                <span className="text-xs text-[#666]">OR</span>
                <div className="flex-1 h-px bg-[#333]" />
              </div>
            )}

            <label className="block text-xs uppercase tracking-wide text-[#666] mb-2">Create New Folder</label>
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => {
                ui.setNewFolderName(e.target.value);
                ui.setSelectedExistingFolderId(null);
                ui.setFolderNameError('');
              }}
              placeholder="e.g., Beach Trip 2024"
              className={`w-full px-4 py-3 text-white bg-[#252525] border rounded-xl focus:outline-none transition-colors mb-1 ${folderNameError ? 'border-red-500 focus:border-red-500' : 'border-[#333] focus:border-[#3ECF8E] focus:ring-1 focus:ring-[#3ECF8E]/20'}`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newFolderName.trim()) {
                  processFilesWithFolder(newFolderName.trim());
                }
              }}
            />
            {folderNameError && <p className="text-xs text-red-400 mb-3">{folderNameError}</p>}
            {!folderNameError && <div className="mb-4" />}

            <div className="flex gap-3">
              <button
                onClick={() => { ui.setShowFolderPrompt(false); ui.setNewFolderName(''); ui.setSelectedExistingFolderId(null); ui.setFolderNameError(''); pendingFilesRef.current = []; }}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-[#999] bg-[#252525] hover:bg-[#333] rounded-xl transition-colors cursor-pointer"
              >Cancel</button>
              {selectedExistingFolderId ? (
                <button onClick={() => addFilesToExistingFolder(selectedExistingFolderId)} className="flex-1 px-4 py-2.5 text-sm font-medium text-[#0d0d0d] bg-[#3ECF8E] hover:bg-[#35b87d] rounded-xl transition-colors cursor-pointer">Add to Folder</button>
              ) : (
                <button
                  onClick={() => { if (newFolderName.trim()) processFilesWithFolder(newFolderName.trim()); }}
                  disabled={!newFolderName.trim()}
                  className="flex-1 px-4 py-2.5 text-sm font-medium text-[#0d0d0d] bg-[#3ECF8E] hover:bg-[#35b87d] disabled:bg-[#333] disabled:text-[#666] disabled:cursor-not-allowed rounded-xl transition-colors cursor-pointer"
                >Create Folder</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Folder Edit Modal */}
      {editingFolder && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-[#171717] border border-[#2a2a2a] rounded-2xl shadow-2xl shadow-black/50 p-6 w-full max-w-96 mx-4">
            <h2 className="text-lg font-semibold text-white mb-4">Edit Folder</h2>
            <div className="mb-4">
              <label className="block text-sm text-[#888] mb-2">Folder Name</label>
              <input
                type="text"
                value={editingFolderName}
                onChange={(e) => { ui.setEditingFolderName(e.target.value); ui.setFolderNameError(''); }}
                placeholder="Folder name"
                className={`w-full px-4 py-3 text-white bg-[#252525] border rounded-xl focus:outline-none transition-colors ${folderNameError ? 'border-red-500 focus:border-red-500' : 'border-[#333] focus:border-[#3ECF8E] focus:ring-1 focus:ring-[#3ECF8E]/20'}`}
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter' && editingFolderName.trim()) handleRenameFolder(); }}
              />
              {folderNameError && <p className="text-xs text-red-400 mt-1">{folderNameError}</p>}
            </div>
            <p className="text-sm text-[#666] mb-4">{editingFolder.imageIds.length} photo{editingFolder.imageIds.length !== 1 ? 's' : ''} in this folder</p>
            <div className="flex flex-col gap-3">
              <div className="flex gap-3">
                <button onClick={() => { ui.setEditingFolder(null); ui.setEditingFolderName(''); ui.setFolderNameError(''); }} className="flex-1 px-4 py-2.5 text-sm font-medium text-[#999] bg-[#252525] hover:bg-[#333] rounded-xl transition-colors cursor-pointer">Cancel</button>
                <button onClick={handleRenameFolder} disabled={!editingFolderName.trim() || editingFolderName === editingFolder.name} className="flex-1 px-4 py-2.5 text-sm font-medium text-[#0d0d0d] bg-[#3ECF8E] hover:bg-[#35b87d] disabled:bg-[#333] disabled:text-[#666] disabled:cursor-not-allowed rounded-xl transition-colors cursor-pointer">Save Name</button>
              </div>
              <div className="pt-3 border-t border-[#333]">
                <button
                  onClick={() => {
                    const hasPhotos = editingFolder.imageIds.length > 0;
                    if (!hasPhotos) { handleDeleteFolder(); return; }
                    if (typeof window !== 'undefined' && window.localStorage.getItem('driftboard-delete-folder-skip-confirm') === 'true') { handleDeleteFolder(); }
                    else { ui.setDeleteFolderDontAskAgain(false); ui.setConfirmDeleteFolderOpen(true); }
                  }}
                  disabled={!!deleteFolderProgress}
                  className="w-full px-4 py-2.5 text-sm font-medium text-red-400 bg-red-400/10 hover:bg-red-400/20 disabled:opacity-60 disabled:cursor-not-allowed rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-2"
                >{editingFolder.imageIds.length > 0 ? 'Delete folder + photos' : 'Delete folder'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirm delete photo(s) */}
      {confirmDeletePhotoIds && confirmDeletePhotoIds.length > 0 && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-[#171717] border border-[#2a2a2a] rounded-2xl shadow-2xl shadow-black/50 p-6 w-full max-w-96 mx-4">
            <h2 className="text-lg font-semibold text-white mb-2">{confirmDeletePhotoIds.length === 1 ? 'Delete photo' : `Delete ${confirmDeletePhotoIds.length} photos`}</h2>
            <p className="text-sm text-[#888] mb-4">Are you sure? This will permanently delete {confirmDeletePhotoIds.length === 1 ? 'this photo' : `these ${confirmDeletePhotoIds.length} photos`}.</p>
            <label className="flex items-center gap-2 mb-4 cursor-pointer">
              <input type="checkbox" checked={deletePhotoDontAskAgain} onChange={(e) => ui.setDeletePhotoDontAskAgain(e.target.checked)} className="rounded border-[#333] bg-[#252525] text-[#3ECF8E] focus:ring-[#3ECF8E]/20" />
              <span className="text-sm text-[#888]">Don&apos;t ask again</span>
            </label>
            <div className="flex gap-3">
              <button type="button" onClick={() => ui.setConfirmDeletePhotoIds(null)} className="flex-1 px-4 py-2.5 text-sm font-medium text-[#999] bg-[#252525] hover:bg-[#333] rounded-xl transition-colors cursor-pointer">Cancel</button>
              <button type="button" onClick={async () => {
                if (deletePhotoDontAskAgain && typeof window !== 'undefined') window.localStorage.setItem('driftboard-delete-photo-skip-confirm', 'true');
                const ids = [...confirmDeletePhotoIds]; ui.setConfirmDeletePhotoIds(null); await handleDeletePhotos(ids);
              }} className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-xl transition-colors cursor-pointer">{confirmDeletePhotoIds.length === 1 ? 'Delete photo' : `Delete ${confirmDeletePhotoIds.length} photos`}</button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm delete folder + photos */}
      {confirmDeleteFolderOpen && editingFolder && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-[#171717] border border-[#2a2a2a] rounded-2xl shadow-2xl shadow-black/50 p-6 w-full max-w-96 mx-4">
            <h2 className="text-lg font-semibold text-white mb-2">Delete folder + photos</h2>
            <p className="text-sm text-[#888] mb-4">Are you sure? This will permanently delete the folder &quot;{editingFolder.name}&quot; and all {editingFolder.imageIds.length} photo{editingFolder.imageIds.length !== 1 ? 's' : ''} inside it.</p>
            <label className="flex items-center gap-2 mb-4 cursor-pointer">
              <input type="checkbox" checked={deleteFolderDontAskAgain} onChange={(e) => ui.setDeleteFolderDontAskAgain(e.target.checked)} className="rounded border-[#333] bg-[#252525] text-[#3ECF8E] focus:ring-[#3ECF8E]/20" />
              <span className="text-sm text-[#888]">Don&apos;t ask again</span>
            </label>
            <div className="flex gap-3">
              <button type="button" onClick={() => ui.setConfirmDeleteFolderOpen(false)} className="flex-1 px-4 py-2.5 text-sm font-medium text-[#999] bg-[#252525] hover:bg-[#333] rounded-xl transition-colors cursor-pointer">Cancel</button>
              <button type="button" onClick={() => {
                if (deleteFolderDontAskAgain && typeof window !== 'undefined') window.localStorage.setItem('driftboard-delete-folder-skip-confirm', 'true');
                ui.setConfirmDeleteFolderOpen(false); handleDeleteFolder();
              }} className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-xl transition-colors cursor-pointer">Delete folder + photos</button>
            </div>
          </div>
        </div>
      )}

      {/* Create empty folder */}
      {createEmptyFolderOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-[#171717] border border-[#2a2a2a] rounded-2xl shadow-2xl shadow-black/50 p-6 w-full max-w-96 mx-4">
            <h2 className="text-lg font-semibold text-white mb-1">Create folder</h2>
            <p className="text-sm text-[#888] mb-4">Name your folder. Existing folders will be pushed aside if nearby.</p>
            <label className="block text-xs uppercase tracking-wide text-[#666] mb-2">Folder name</label>
            <input type="text" value={createEmptyFolderName} onChange={(e) => { ui.setCreateEmptyFolderName(e.target.value); ui.setCreateEmptyFolderNameError(''); }}
              placeholder="e.g., Beach Trip 2024"
              className={`w-full px-4 py-3 text-white bg-[#252525] border rounded-xl focus:outline-none transition-colors mb-1 ${createEmptyFolderNameError ? 'border-red-500 focus:border-red-500' : 'border-[#333] focus:border-[#3ECF8E] focus:ring-1 focus:ring-[#3ECF8E]/20'}`}
              autoFocus onKeyDown={(e) => { if (e.key === 'Enter') handleCreateEmptyFolderSave(); if (e.key === 'Escape') handleCreateEmptyFolderCancel(); }} />
            {createEmptyFolderNameError && <p className="text-xs text-red-400 mb-3">{createEmptyFolderNameError}</p>}
            {!createEmptyFolderNameError && <div className="mb-4" />}
            <div className="flex gap-3">
              <button type="button" onClick={handleCreateEmptyFolderCancel} className="flex-1 px-4 py-2.5 text-sm font-medium text-[#999] bg-[#252525] hover:bg-[#333] rounded-xl transition-colors cursor-pointer">Cancel</button>
              <button type="button" onClick={handleCreateEmptyFolderSave} disabled={!createEmptyFolderName.trim()} className="flex-1 px-4 py-2.5 text-sm font-medium text-[#0d0d0d] bg-[#3ECF8E] hover:bg-[#35b87d] disabled:bg-[#333] disabled:text-[#666] disabled:cursor-not-allowed rounded-xl transition-colors cursor-pointer">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Create social media layout */}
      {createSocialLayoutOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-[#171717] border border-[#2a2a2a] rounded-2xl shadow-2xl shadow-black/50 p-6 w-full max-w-96 mx-4">
            <h2 className="text-lg font-semibold text-white mb-1">Create social media layout</h2>
            <p className="text-sm text-[#888] mb-4">Add a 4:5 layout. You can drag photos in and place them anywhere; add or remove pages later.</p>
            <label className="block text-xs uppercase tracking-wide text-[#666] mb-2">Layout name</label>
            <input type="text" value={createSocialLayoutName} onChange={(e) => { ui.setCreateSocialLayoutName(e.target.value); ui.setCreateSocialLayoutNameError(''); }}
              placeholder="e.g., Instagram carousel"
              className={`w-full px-4 py-3 text-white bg-[#252525] border rounded-xl focus:outline-none transition-colors mb-1 ${createSocialLayoutNameError ? 'border-red-500 focus:border-red-500' : 'border-[#333] focus:border-[#3ECF8E] focus:ring-1 focus:ring-[#3ECF8E]/20'}`}
              autoFocus onKeyDown={(e) => { if (e.key === 'Enter') handleCreateSocialLayoutSave(); if (e.key === 'Escape') handleCreateSocialLayoutCancel(); }} />
            {createSocialLayoutNameError && <p className="text-xs text-red-400 mb-3">{createSocialLayoutNameError}</p>}
            <label className="block text-xs uppercase tracking-wide text-[#666] mt-4 mb-2">Number of pages (1–10)</label>
            <select value={createSocialLayoutPages} onChange={(e) => ui.setCreateSocialLayoutPages(Number(e.target.value))} className="w-full px-4 py-3 text-white bg-[#252525] border border-[#333] rounded-xl focus:outline-none focus:border-[#3ECF8E] focus:ring-1 focus:ring-[#3ECF8E]/20">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (<option key={n} value={n} className="bg-[#252525] text-white">{n} page{n !== 1 ? 's' : ''}</option>))}
            </select>
            <div className="flex gap-3 mt-4">
              <button type="button" onClick={handleCreateSocialLayoutCancel} className="flex-1 px-4 py-2.5 text-sm font-medium text-[#999] bg-[#252525] hover:bg-[#333] rounded-xl transition-colors cursor-pointer">Cancel</button>
              <button type="button" onClick={handleCreateSocialLayoutSave} disabled={!createSocialLayoutName.trim()} className="flex-1 px-4 py-2.5 text-sm font-medium text-[#0d0d0d] bg-[#3ECF8E] hover:bg-[#35b87d] disabled:bg-[#333] disabled:text-[#666] disabled:cursor-not-allowed rounded-xl transition-colors cursor-pointer">Create</button>
            </div>
          </div>
        </div>
      )}

      {/* Create folder from selection */}
      {createFolderFromSelectionIds && createFolderFromSelectionIds.length > 0 && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-[#171717] border border-[#2a2a2a] rounded-2xl shadow-2xl shadow-black/50 p-6 w-full max-w-96 mx-4">
            <h2 className="text-lg font-semibold text-white mb-1">Create folder</h2>
            <p className="text-sm text-[#888] mb-4">Name your folder ({createFolderFromSelectionIds.length} photo{createFolderFromSelectionIds.length !== 1 ? 's' : ''} selected). Existing folders will be pushed aside if needed.</p>
            <label className="block text-xs uppercase tracking-wide text-[#666] mb-2">Folder name</label>
            <input type="text" value={createFolderFromSelectionName} onChange={(e) => { ui.setCreateFolderFromSelectionName(e.target.value); ui.setCreateFolderFromSelectionNameError(''); }}
              placeholder="e.g., Beach Trip 2024"
              className={`w-full px-4 py-3 text-white bg-[#252525] border rounded-xl focus:outline-none transition-colors mb-1 ${createFolderFromSelectionNameError ? 'border-red-500 focus:border-red-500' : 'border-[#333] focus:border-[#3ECF8E] focus:ring-1 focus:ring-[#3ECF8E]/20'}`}
              autoFocus onKeyDown={(e) => { if (e.key === 'Enter') handleCreateFolderFromSelectionSave(); if (e.key === 'Escape') handleCreateFolderFromSelectionCancel(); }} />
            {createFolderFromSelectionNameError && <p className="text-xs text-red-400 mb-3">{createFolderFromSelectionNameError}</p>}
            {!createFolderFromSelectionNameError && <div className="mb-4" />}
            <div className="flex gap-3">
              <button type="button" onClick={handleCreateFolderFromSelectionCancel} className="flex-1 px-4 py-2.5 text-sm font-medium text-[#999] bg-[#252525] hover:bg-[#333] rounded-xl transition-colors cursor-pointer">Cancel</button>
              <button type="button" onClick={handleCreateFolderFromSelectionSave} disabled={!createFolderFromSelectionName.trim()} className="flex-1 px-4 py-2.5 text-sm font-medium text-[#0d0d0d] bg-[#3ECF8E] hover:bg-[#35b87d] disabled:bg-[#333] disabled:text-[#666] disabled:cursor-not-allowed rounded-xl transition-colors cursor-pointer">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Canvas context menu */}
      {canvasContextMenu && (
        <div ref={canvasContextMenuRef} className="fixed z-50 min-w-[200px] py-1 bg-[#171717] border border-[#2a2a2a] rounded-xl shadow-2xl shadow-black/50" style={{ left: canvasContextMenu.x, top: canvasContextMenu.y }}>
          <button type="button" onClick={() => { ui.setCanvasContextMenu(null); ui.setCreateEmptyFolderOpen(true); ui.setCreateEmptyFolderName('New Folder'); ui.setCreateEmptyFolderNameError(''); }}
            className="w-full px-4 py-3.5 md:py-2.5 text-left text-sm text-white hover:bg-[#252525] transition-colors flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" /></svg>
            Create folder
          </button>
          <button type="button" onClick={() => { ui.setCanvasContextMenu(null); ui.setCreateSocialLayoutOpen(true); ui.setCreateSocialLayoutName('Social layout 1'); ui.setCreateSocialLayoutPages(3); ui.setCreateSocialLayoutNameError(''); }}
            className="w-full px-4 py-3.5 md:py-2.5 text-left text-sm text-white hover:bg-[#252525] transition-colors flex items-center gap-2 border-t border-[#2a2a2a]">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
            Create social media layout
          </button>
        </div>
      )}

      {/* Layout toolbar */}
      {selectedFolderId && (() => {
        const selectedFolder = folders.find((f) => f.id === selectedFolderId);
        if (!selectedFolder || !isSocialLayout(selectedFolder)) return null;
        const pageCount = Math.max(1, Math.min(SOCIAL_LAYOUT_MAX_PAGES, selectedFolder.pageCount ?? 1));
        const bg = selectedFolder.backgroundColor ?? DEFAULT_SOCIAL_LAYOUT_BG;
        const canAdd = pageCount < SOCIAL_LAYOUT_MAX_PAGES;
        const canRemove = pageCount > 1;
        return (
          <div className="fixed z-40 left-1/2 -translate-x-1/2 top-20 flex items-center gap-3 px-4 py-2.5 bg-[#171717] border border-[#2a2a2a] rounded-xl shadow-2xl shadow-black/50">
            <span className="text-sm text-[#888] whitespace-nowrap">Layout: {selectedFolder.name}</span>
            <div className="w-px h-6 bg-[#333]" />
            <label className="flex items-center gap-2 text-sm text-white">
              <span className="text-[#666]">Bg</span>
              <input type="color" value={bg} onInput={(e) => handleLayoutBackgroundColorPreview(selectedFolder.id, (e.target as HTMLInputElement).value)} onChange={(e) => e.stopPropagation()} onBlur={(e) => handleLayoutBackgroundColorCommit(selectedFolder.id, e.target.value)} className="w-8 h-8 rounded cursor-pointer border border-[#333] bg-transparent" />
            </label>
            <button type="button" onClick={() => handleLayoutAddPage(selectedFolder.id)} disabled={!canAdd} className="px-3 py-1.5 text-sm font-medium text-white bg-[#252525] hover:bg-[#333] disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors">+ Page</button>
            <button type="button" onClick={() => handleLayoutRemovePage(selectedFolder.id)} disabled={!canRemove} className="px-3 py-1.5 text-sm font-medium text-white bg-[#252525] hover:bg-[#333] disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors">&minus; Page</button>
          </div>
        );
      })()}

      {/* Folder context menu */}
      {folderContextMenu && (() => {
        const folder = folders.find((f) => f.id === folderContextMenu.folderId);
        if (!folder) return null;
        const isLayout = isSocialLayout(folder);
        const pageCount = Math.max(1, Math.min(SOCIAL_LAYOUT_MAX_PAGES, folder.pageCount ?? 1));
        const canAdd = pageCount < SOCIAL_LAYOUT_MAX_PAGES;
        const canRemove = pageCount > 1;
        return (
          <div ref={folderContextMenuRef} className="fixed z-50 min-w-[180px] py-1 bg-[#171717] border border-[#2a2a2a] rounded-xl shadow-2xl shadow-black/50" style={{ left: folderContextMenu.x, top: folderContextMenu.y }}>
            {isLayout && (
              <>
                <div className="px-4 py-2 text-xs text-[#666] uppercase tracking-wide">Layout</div>
                <label className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-white hover:bg-[#252525] cursor-pointer">
                  <span>Background color</span>
                  <input type="color" value={folder.backgroundColor ?? DEFAULT_SOCIAL_LAYOUT_BG} onInput={(e) => handleLayoutBackgroundColorPreview(folder.id, (e.target as HTMLInputElement).value)} onChange={(e) => e.stopPropagation()} onBlur={(e) => handleLayoutBackgroundColorCommit(folder.id, e.target.value)} className="w-6 h-6 rounded cursor-pointer border border-[#333] bg-transparent" onClick={(e) => e.stopPropagation()} />
                </label>
                <button type="button" onClick={() => handleLayoutAddPage(folder.id)} disabled={!canAdd} className="w-full px-4 py-3.5 md:py-2.5 text-left text-sm text-white hover:bg-[#252525] disabled:opacity-50 disabled:cursor-not-allowed transition-colors">Add page</button>
                <button type="button" onClick={() => handleLayoutRemovePage(folder.id)} disabled={!canRemove} className="w-full px-4 py-3.5 md:py-2.5 text-left text-sm text-white hover:bg-[#252525] disabled:opacity-50 disabled:cursor-not-allowed transition-colors">Remove page</button>
                <div className="my-1 border-t border-[#2a2a2a]" />
              </>
            )}
            <button type="button" onClick={() => { ui.setFolderContextMenu(null); ui.setEditingFolder(folder); ui.setEditingFolderName(folder.name); ui.setFolderNameError(''); }} className="w-full px-4 py-3.5 md:py-2.5 text-left text-sm text-white hover:bg-[#252525] transition-colors">Rename</button>
            <button type="button" onClick={() => { ui.setFolderContextMenu(null); ui.setConfirmDeleteFolderOpen(true); ui.setEditingFolder(folder); }} className="w-full px-4 py-3.5 md:py-2.5 text-left text-sm text-red-400 hover:bg-red-400/10 transition-colors border-t border-[#2a2a2a]">Delete folder</button>
          </div>
        );
      })()}

      {/* Image context menu */}
      {imageContextMenu && (
        <div ref={imageContextMenuRef} className="fixed z-50 min-w-[180px] py-1 bg-[#171717] border border-[#2a2a2a] rounded-xl shadow-2xl shadow-black/50" style={{ left: imageContextMenu.x, top: imageContextMenu.y }}>
          {imageContextMenu.selectedIds.length > 1 ? (
            <>
              <button type="button" onClick={handlePasteEdit} disabled={!copiedEdit} className="w-full px-4 py-3.5 md:py-2.5 text-left text-sm text-white hover:bg-[#252525] disabled:opacity-50 disabled:cursor-not-allowed transition-colors">Paste edit to selection ({imageContextMenu.selectedIds.length} photos)</button>
              <button type="button" onClick={handleExportSelection} className="w-full px-4 py-3.5 md:py-2.5 text-left text-sm text-white hover:bg-[#252525] transition-colors">Export selection ({imageContextMenu.selectedIds.length} photos)</button>
              <button type="button" onClick={handleCreateFolderFromSelection} className="w-full px-4 py-3.5 md:py-2.5 text-left text-sm text-white hover:bg-[#252525] transition-colors">Create folder</button>
              <button type="button" onClick={() => {
                const ids = imageContextMenu.selectedIds; ui.setImageContextMenu(null);
                if (typeof window !== 'undefined' && window.localStorage.getItem('driftboard-delete-photo-skip-confirm') === 'true') { handleDeletePhotos(ids); }
                else { ui.setDeletePhotoDontAskAgain(false); ui.setConfirmDeletePhotoIds(ids); }
              }} className="w-full px-4 py-3.5 md:py-2.5 text-left text-sm text-red-400 hover:bg-red-400/10 transition-colors border-t border-[#2a2a2a]">Delete selection ({imageContextMenu.selectedIds.length} photos)</button>
            </>
          ) : (
            <>
              <button type="button" onClick={handleCopyEdit} className="w-full px-4 py-3.5 md:py-2.5 text-left text-sm text-white hover:bg-[#252525] transition-colors">Copy edit</button>
              <button type="button" onClick={handlePasteEdit} disabled={!copiedEdit} className="w-full px-4 py-3.5 md:py-2.5 text-left text-sm text-white hover:bg-[#252525] disabled:opacity-50 disabled:cursor-not-allowed transition-colors">Paste edit</button>
              <div className="my-1 border-t border-[#2a2a2a]" />
              <button type="button" onClick={() => { ui.setBorderDialogImageId(imageContextMenu.imageId); ui.setImageContextMenu(null); }} className="w-full px-4 py-3.5 md:py-2.5 text-left text-sm text-white hover:bg-[#252525] transition-colors">Border…</button>
              <button type="button" onClick={handleCreatePresetClick} className="w-full px-4 py-2.5 text-left text-sm text-white hover:bg-[#252525] transition-colors border-t border-[#2a2a2a]">Create preset…</button>
            </>
          )}
        </div>
      )}

      {/* Border dialog */}
      {borderDialogImageId && (() => {
        const img = images.find((i) => i.id === borderDialogImageId);
        if (!img) return null;
        const borderWidth = img.borderWidth ?? 0;
        const borderColor = img.borderColor ?? '#ffffff';
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div ref={borderDialogRef} className="bg-[#171717] border border-[#2a2a2a] rounded-2xl shadow-2xl shadow-black/50 p-6 w-full max-w-96 mx-4">
              <h3 className="text-lg font-semibold text-white mb-4">Border</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-[#888] mb-2">Thickness: {borderWidth}px</label>
                  <input type="range" min="0" max="50" value={borderWidth}
                    onChange={(e) => { const width = parseInt(e.target.value, 10); setImages((prev) => prev.map((i) => i.id === borderDialogImageId ? { ...i, borderWidth: width } : i)); }}
                    className="w-full h-2 bg-[#252525] rounded-lg appearance-none cursor-pointer accent-[#3ECF8E]" />
                </div>
                <div>
                  <label className="block text-sm text-[#888] mb-2">Color</label>
                  <div className="flex items-center gap-3">
                    <input type="color" value={borderColor}
                      onChange={(e) => { setImages((prev) => prev.map((i) => i.id === borderDialogImageId ? { ...i, borderColor: e.target.value } : i)); }}
                      className="w-12 h-12 rounded cursor-pointer border border-[#333] bg-transparent" />
                    <input type="text" value={borderColor}
                      onChange={(e) => { const color = e.target.value; if (/^#[0-9A-Fa-f]{6}$/.test(color) || color === '') { setImages((prev) => prev.map((i) => i.id === borderDialogImageId ? { ...i, borderColor: color || '#ffffff' } : i)); } }}
                      placeholder="#ffffff" className="flex-1 px-4 py-2 bg-[#252525] border border-[#333] rounded-xl text-white placeholder-[#666] focus:outline-none focus:border-[#3ECF8E] focus:ring-1 focus:ring-[#3ECF8E]/20" />
                  </div>
                </div>
              </div>
              <div className="flex gap-2 justify-end mt-6">
                <button type="button" onClick={() => ui.setBorderDialogImageId(null)} className="px-4 py-2.5 text-sm text-[#888] hover:text-white transition-colors">Close</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Create preset modal */}
      {createPresetFromImageId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-[#171717] border border-[#2a2a2a] rounded-2xl shadow-2xl shadow-black/50 p-6 w-full max-w-96 mx-4">
            <h3 className="text-lg font-semibold text-white mb-2">Create preset</h3>
            <p className="text-sm text-[#888] mb-4">Save this image&apos;s edits as a preset you can apply to other photos.</p>
            <input type="text" value={createPresetName} onChange={(e) => ui.setCreatePresetName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreatePresetSave(); if (e.key === 'Escape') handleCreatePresetCancel(); }}
              placeholder="Preset name" className="w-full px-4 py-3 bg-[#252525] border border-[#333] rounded-xl text-white placeholder-[#666] focus:outline-none focus:border-[#3ECF8E] focus:ring-1 focus:ring-[#3ECF8E]/20 mb-4" autoFocus />
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={handleCreatePresetCancel} className="px-4 py-2.5 text-sm text-[#888] hover:text-white transition-colors">Cancel</button>
              <button type="button" onClick={handleCreatePresetSave} disabled={!createPresetName.trim()} className="px-4 py-2.5 text-sm font-medium text-[#0d0d0d] bg-[#3ECF8E] hover:bg-[#35b87d] rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-colors">Save preset</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
