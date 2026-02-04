'use client';

import { useRef, useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';

interface TopBarProps {
  onUpload: (files: FileList | null) => void;
  onRecenter: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  visible: boolean;
}

export function TopBar({
  onUpload,
  onRecenter,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  visible,
}: TopBarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const helpRef = useRef<HTMLDivElement>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const { user, signOut } = useAuth();

  useEffect(() => {
    if (!helpOpen) return;
    const close = (e: MouseEvent) => {
      if (helpRef.current && !helpRef.current.contains(e.target as Node)) setHelpOpen(false);
    };
    window.addEventListener('click', close, true);
    return () => window.removeEventListener('click', close, true);
  }, [helpOpen]);

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
          accept="image/jpeg,image/png,image/webp,image/x-adobe-dng,.dng"
          multiple
          onChange={handleFileSelect}
          className="hidden"
        />
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
        {/* Help / Shortcuts dropdown */}
        <div className="relative" ref={helpRef}>
          <button
            type="button"
            onClick={() => setHelpOpen((o) => !o)}
            className="p-2 text-[#888] hover:text-white hover:bg-[#252525] rounded-lg transition-colors cursor-pointer"
            title="Shortcuts & tips"
            aria-expanded={helpOpen}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
          {helpOpen && (
            <div className="absolute right-0 top-full mt-2 w-96 max-h-[calc(100vh-6rem)] overflow-y-auto bg-[#171717] border border-[#2a2a2a] rounded-xl shadow-2xl shadow-black/50 z-50">
              <div className="px-4 py-2 border-b border-[#2a2a2a]">
                <h3 className="text-sm font-semibold text-white">Shortcuts</h3>
              </div>
              <div className="px-4 py-3 text-left text-sm text-[#d4d4d4] leading-7">
                <ul className="space-y-3">
                  <li className="flex gap-2 items-center"><kbd className="kbd shrink-0">Ctrl + Click + photo</kbd>multi-select photos</li>
                  <li className="flex gap-2 items-center"><kbd className="kbd shrink-0">Shift + Click + photo</kbd>range select photos</li>
                  <li className="flex gap-2 items-center"><kbd className="kbd shrink-0">Ctrl + Click + edit tab</kbd>toggle edit</li>
                  <li className="flex gap-2 items-center"><kbd className="kbd shrink-0">Space + drag</kbd>pan</li>
                  <li className="flex gap-2 items-center"><kbd className="kbd shrink-0">Ctrl + scroll</kbd>zoom</li>
                  <li className="flex gap-2 items-center"><kbd className="kbd shrink-0">2× click + photo</kbd>fullscreen</li>
                  <li className="flex gap-2 items-center"><kbd className="kbd shrink-0">2× click + canvas</kbd>add text</li>
                  <li className="flex gap-2 items-center"><kbd className="kbd shrink-0">Drag + photo into folder</kbd>adds to folder</li>
                  <li className="flex gap-2 items-center"><kbd className="kbd shrink-0">Drag + photo out of folder</kbd>creates/adds to new folder</li>
                  <li className="flex gap-2 items-center"><kbd className="kbd shrink-0">Right-click + 1 photo</kbd>copy/paste edits, preset, export</li>
                  <li className="flex gap-2 items-center"><kbd className="kbd shrink-0">Right-click + multiple photos</kbd>paste, export, new folder</li>
                </ul>
              </div>
            </div>
          )}
        </div>

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
