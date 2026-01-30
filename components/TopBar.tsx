'use client';

import { useRef } from 'react';
import { useAuth } from '@/lib/auth';

interface TopBarProps {
  onUpload: (files: FileList | null) => void;
  onAddFolder: () => void;
  onRecenter: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  visible: boolean;
}

export function TopBar({
  onUpload,
  onAddFolder,
  onRecenter,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  visible,
}: TopBarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { user, signOut } = useAuth();

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    onUpload(e.target.files);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (error) {
      console.error('Failed to sign out:', error);
    }
  };

  return (
    <div 
      className={`absolute top-0 left-0 right-0 z-10 flex h-14 items-center gap-3 bg-[#171717]/95 backdrop-blur-xl border-b border-[#2a2a2a] px-4 transition-transform duration-200 ${
        visible ? 'translate-y-0' : '-translate-y-full'
      }`}
    >
      {/* Logo */}
      <div className="flex items-center gap-2 mr-4">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#3ECF8E] to-[#2da36f] flex items-center justify-center">
          <svg className="w-4 h-4 text-[#0d0d0d]" fill="currentColor" viewBox="0 0 20 20">
            <path d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" />
          </svg>
        </div>
        <span className="text-base font-semibold text-white">Driftboard</span>
      </div>

      {/* Divider */}
      <div className="w-px h-6 bg-[#333]" />

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-white bg-[#3ECF8E] hover:bg-[#35b87d] rounded-lg transition-colors cursor-pointer"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          Upload
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          onChange={handleFileSelect}
          className="hidden"
        />
        <button
          onClick={onAddFolder}
          className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-white bg-[#252525] hover:bg-[#333] rounded-lg transition-colors cursor-pointer"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
          </svg>
          Folder
        </button>
        <button
          onClick={onRecenter}
          className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-white bg-[#252525] hover:bg-[#333] rounded-lg transition-colors cursor-pointer"
          title="Arrange folders in center"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v3m0 12v3" />
          </svg>
          Recenter
        </button>
      </div>

      {/* Right side */}
      <div className="ml-auto flex items-center gap-2">
        {/* Undo/Redo */}
        <div className="flex items-center bg-[#252525] rounded-lg">
          <button
            onClick={onUndo}
            disabled={!canUndo}
            className="p-2 text-[#999] hover:text-white disabled:text-[#555] disabled:cursor-not-allowed transition-colors rounded-l-lg hover:bg-[#333] cursor-pointer"
            title="Undo"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
            </svg>
          </button>
          <div className="w-px h-5 bg-[#333]" />
          <button
            onClick={onRedo}
            disabled={!canRedo}
            className="p-2 text-[#999] hover:text-white disabled:text-[#555] disabled:cursor-not-allowed transition-colors rounded-r-lg hover:bg-[#333] cursor-pointer"
            title="Redo"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 10h-10a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6" />
            </svg>
          </button>
        </div>


        {/* User menu */}
        <div className="flex items-center gap-2">
          {user?.user_metadata?.avatar_url ? (
            <img
              src={user.user_metadata.avatar_url}
              alt="Profile"
              className="w-8 h-8 rounded-full ring-2 ring-[#333]"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#3ECF8E] to-[#2da36f] flex items-center justify-center text-[#0d0d0d] text-sm font-semibold">
              {user?.email?.charAt(0).toUpperCase() || 'U'}
            </div>
          )}
          <button
            onClick={handleSignOut}
            className="text-sm text-[#888] hover:text-white transition-colors cursor-pointer"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
