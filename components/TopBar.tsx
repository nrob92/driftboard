'use client';

import { useRef, useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { useUIStore } from '@/lib/stores/uiStore';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

interface CollabSession {
  id: string;
  name: string;
  invite_code: string;
  owner_id: string;
  max_collaborators: number;
  is_active: boolean;
  created_at: string;
}

export interface PhotoFilterState {
  dateFrom?: string;
  dateTo?: string;
  cameraMake?: string;
  cameraModel?: string;
  contentSearch?: string;
}

function SearchFilterInput({
  initialValue,
  photoFilter,
  onPhotoFilterChange,
}: {
  initialValue: string;
  photoFilter: PhotoFilterState;
  onPhotoFilterChange: (filter: PhotoFilterState) => void;
}) {
  const [value, setValue] = useState(initialValue);
  return (
    <input
      type="search"
      placeholder="Search photos — press Enter"
      value={value}
      onChange={(e) => {
        const next = e.target.value;
        setValue(next);
        if (next === '') {
          onPhotoFilterChange({ ...photoFilter, contentSearch: undefined });
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          onPhotoFilterChange({ ...photoFilter, contentSearch: value.trim() || undefined });
        }
      }}
      className="w-full md:w-56 h-10 md:h-8 px-3 py-1 text-sm bg-[#252525] border border-[#333] rounded-lg text-white placeholder:text-[#666] focus:outline-none focus:ring-1 focus:ring-[#3ECF8E] focus:border-[#3ECF8E]"
    />
  );
}

interface TopBarProps {
  onUpload: (files: FileList | null) => void;
  onRecenterHorizontally?: () => void;
  onRecenterVertically?: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  visible: boolean;
  isMobile?: boolean;
  photoFilter?: PhotoFilterState;
  onPhotoFilterChange?: (filter: PhotoFilterState) => void;
}

export function TopBar({
  onUpload,
  onRecenterHorizontally,
  onRecenterVertically,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  visible,
  isMobile,
  photoFilter = {},
  onPhotoFilterChange,
}: TopBarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const helpRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<HTMLDivElement>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [collabSessions, setCollabSessions] = useState<CollabSession[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [success, setSuccess] = useState('');
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const { user, signOut } = useAuth();
  const mobileMenuOpen = useUIStore((s) => s.mobileMenuOpen);
  const setMobileMenuOpen = useUIStore((s) => s.setMobileMenuOpen);
  const router = useRouter();

  useEffect(() => {
    if (!helpOpen) return;
    const close = (e: MouseEvent) => {
      if (helpRef.current && !helpRef.current.contains(e.target as Node)) setHelpOpen(false);
    };
    window.addEventListener('click', close, true);
    return () => window.removeEventListener('click', close, true);
  }, [helpOpen]);

  useEffect(() => {
    if (!filterOpen) return;
    const close = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setFilterOpen(false);
    };
    window.addEventListener('click', close, true);
    return () => window.removeEventListener('click', close, true);
  }, [filterOpen]);

  useEffect(() => {
    if (!sessionsOpen) return;
    const close = (e: MouseEvent) => {
      if (sessionRef.current && !sessionRef.current.contains(e.target as Node)) setSessionsOpen(false);
    };
    window.addEventListener('click', close, true);
    return () => window.removeEventListener('click', close, true);
  }, [sessionsOpen]);

  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel('session-updates')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'collab_members',
          filter: `user_id=eq.${user.id}`
        },
        (payload: { eventType?: string; new?: { user_id?: string; status?: string }; old?: { user_id?: string } }) => {
          console.log('TopBar pg-change received:', payload.eventType, payload);
          if (payload.new?.user_id === user?.id || payload.old?.user_id === user?.id) {
            fetchCollabSessions();
            
            if (payload.eventType === 'UPDATE' && payload.new?.status === 'approved') {
              console.log('TopBar showing toast');
              setToastMessage('Your join request was approved!');
              setShowToast(true);
              setTimeout(() => setShowToast(false), 3000);
            }
          }
        }
      )
      .subscribe((status) => {
        console.log('TopBar subscription status:', status);
      });

    const sessionChannel = supabase
      .channel('session-inserts')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'collab_sessions',
          filter: `owner_id=eq.${user.id}`
        },
        () => {
          console.log('New owned session detected');
          fetchCollabSessions();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(sessionChannel);
    };
  }, [user]);

  useEffect(() => {
    if (user && sessionsOpen) {
      fetchCollabSessions();
    }
  }, [user, sessionsOpen]);

  const fetchCollabSessions = async () => {
    setLoadingSessions(true);
    try {
      const response = await fetch(`/api/collab/session?userId=${user?.id}`);
      const result = await response.json();
      
      if (result.sessions) {
        setCollabSessions(result.sessions as CollabSession[]);
      }
    } catch (err) {
      console.error('Error fetching sessions:', err);
    } finally {
      setLoadingSessions(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    onUpload(e.target.files);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSignOut = async () => {
    setMobileMenuOpen(false);
    try {
      await signOut();
    } catch (error) {
      console.error('Failed to sign out:', error);
    }
  };

  return (
    <div
      className={`absolute top-0 left-0 right-0 z-10 flex h-14 items-center gap-2 md:gap-3 bg-[#171717]/95 backdrop-blur-xl border-b border-[#2a2a2a] px-3 md:px-4 transition-transform duration-200 ${
        visible ? 'translate-y-0' : '-translate-y-full'
      }`}
    >
      {/* Mobile hamburger */}
      <button
        type="button"
        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        className="md:hidden p-2 min-h-[44px] min-w-[44px] flex items-center justify-center text-[#888] hover:text-white hover:bg-[#252525] rounded-lg transition-colors"
      >
        {mobileMenuOpen ? (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        )}
      </button>

      {/* Logo */}
      <div className="flex items-center gap-2 md:mr-4">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#3ECF8E] to-[#2da36f] flex items-center justify-center">
          <svg className="w-4 h-4 text-[#0d0d0d]" fill="currentColor" viewBox="0 0 20 20">
            <path d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" />
          </svg>
        </div>
        <span className="hidden md:inline text-base font-semibold text-white">Driftboard</span>
      </div>

      {/* Desktop: Divider */}
      <div className="hidden md:block w-px h-6 bg-[#333]" />

      {/* Desktop: Filter search */}
      {onPhotoFilterChange && (
        <div className="hidden md:flex items-center gap-2">
          <div key={`search-${photoFilter.contentSearch ?? ''}`}>
            <SearchFilterInput
              initialValue={photoFilter.contentSearch ?? ''}
              photoFilter={photoFilter}
              onPhotoFilterChange={onPhotoFilterChange}
            />
          </div>
          <div className="relative" ref={filterRef}>
            <button
              type="button"
              onClick={() => setFilterOpen((o) => !o)}
              className="p-2 text-[#888] hover:text-white hover:bg-[#252525] rounded-lg transition-colors cursor-pointer"
              title="Date & camera filters"
              aria-expanded={filterOpen}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
            </button>
            {filterOpen && (
              <div className="absolute left-0 top-full mt-2 w-64 bg-[#171717] border border-[#2a2a2a] rounded-xl shadow-2xl shadow-black/50 z-50 p-3 space-y-3">
                <div>
                  <label className="block text-xs text-[#888] mb-1">Date from</label>
                  <input
                    type="date"
                    value={photoFilter.dateFrom ?? ''}
                    onChange={(e) => onPhotoFilterChange({ ...photoFilter, dateFrom: e.target.value || undefined })}
                    className="w-full h-8 px-2 text-sm bg-[#252525] border border-[#333] rounded text-white focus:outline-none focus:ring-1 focus:ring-[#3ECF8E]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#888] mb-1">Date to</label>
                  <input
                    type="date"
                    value={photoFilter.dateTo ?? ''}
                    onChange={(e) => onPhotoFilterChange({ ...photoFilter, dateTo: e.target.value || undefined })}
                    className="w-full h-8 px-2 text-sm bg-[#252525] border border-[#333] rounded text-white focus:outline-none focus:ring-1 focus:ring-[#3ECF8E]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#888] mb-1">Camera make</label>
                  <input
                    type="text"
                    placeholder="e.g. Canon"
                    value={photoFilter.cameraMake ?? ''}
                    onChange={(e) => onPhotoFilterChange({ ...photoFilter, cameraMake: e.target.value || undefined })}
                    className="w-full h-8 px-2 text-sm bg-[#252525] border border-[#333] rounded text-white placeholder:text-[#666] focus:outline-none focus:ring-1 focus:ring-[#3ECF8E]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#888] mb-1">Camera model</label>
                  <input
                    type="text"
                    placeholder="e.g. EOS R5"
                    value={photoFilter.cameraModel ?? ''}
                    onChange={(e) => onPhotoFilterChange({ ...photoFilter, cameraModel: e.target.value || undefined })}
                    className="w-full h-8 px-2 text-sm bg-[#252525] border border-[#333] rounded text-white placeholder:text-[#666] focus:outline-none focus:ring-1 focus:ring-[#3ECF8E]"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => onPhotoFilterChange({})}
                  className="w-full py-1.5 text-xs text-[#888] hover:text-white border border-[#333] rounded-lg hover:bg-[#252525]"
                >
                  Clear filters
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Desktop: Divider */}
      <div className="hidden md:block w-px h-6 bg-[#333]" />

      {/* Upload + Recenter (Upload always visible, Recenter desktop only) */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-2 px-3 py-1.5 min-h-[44px] md:min-h-0 text-sm font-medium text-white bg-[#3ECF8E] hover:bg-[#35b87d] rounded-lg transition-colors cursor-pointer"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <span className="hidden md:inline">Upload</span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/x-adobe-dng,.dng"
          multiple
          onChange={handleFileSelect}
          className="hidden"
        />
        <div className="hidden md:flex items-center bg-[#252525] rounded-lg overflow-hidden">
          <span className="px-3 py-1.5 text-sm font-medium text-[#888] cursor-default select-none">
            Recenter
          </span>
          {onRecenterHorizontally && (
            <>
              <div className="w-px h-5 bg-[#333]" />
              <button
                onClick={onRecenterHorizontally}
                className="p-2 text-[#999] hover:text-white hover:bg-[#333] transition-colors cursor-pointer"
                title="Recenter horizontally"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
            </>
          )}
          {onRecenterVertically && (
            <>
              <div className="w-px h-5 bg-[#333]" />
              <button
                onClick={onRecenterVertically}
                className="p-2 text-[#999] hover:text-white hover:bg-[#333] transition-colors cursor-pointer"
                title="Recenter vertically"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 4v16M12 4v16M18 4v16" />
                </svg>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Right side */}
      <div className="ml-auto flex items-center gap-2">
        {/* Desktop: Help / Shortcuts dropdown */}
        <div className="hidden md:block relative" ref={helpRef}>
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
                  <li className="flex gap-2 items-center"><kbd className="kbd shrink-0">Ctrl + Z</kbd>undo photo edit</li>
                  <li className="flex gap-2 items-center"><kbd className="kbd shrink-0">Ctrl + Shift + Z</kbd>redo photo edit</li>
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
            className="p-2 min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 flex items-center justify-center text-[#999] hover:text-white disabled:text-[#555] disabled:cursor-not-allowed transition-colors rounded-l-lg hover:bg-[#333] cursor-pointer"
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
            className="p-2 min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 flex items-center justify-center text-[#999] hover:text-white disabled:text-[#555] disabled:cursor-not-allowed transition-colors rounded-r-lg hover:bg-[#333] cursor-pointer"
            title="Redo"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 10h-10a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6" />
            </svg>
          </button>
        </div>

        {/* Community / Session Selector */}
        <div className="hidden md:block relative" ref={sessionRef}>
          <button
            type="button"
            onClick={() => setSessionsOpen((o) => !o)}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-[#888] hover:text-white hover:bg-[#252525] rounded-lg transition-colors cursor-pointer"
            title="Community Sessions"
            aria-expanded={sessionsOpen}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            <span>Sessions</span>
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {sessionsOpen && (
            <div className="absolute right-0 top-full mt-2 w-72 bg-[#171717] border border-[#2a2a2a] rounded-xl shadow-2xl shadow-black/50 z-50 overflow-hidden">
              <div className="px-4 py-3 border-b border-[#2a2a2a] flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white">Your Sessions</h3>
                <button
                  onClick={() => router.push('/community')}
                  className="text-xs text-[#3ECF8E] hover:text-[#35b87a] transition-colors"
                >
                  Manage all
                </button>
              </div>
              <div className="max-h-64 overflow-y-auto">
                {loadingSessions ? (
                  <div className="px-4 py-6 text-center">
                    <div className="w-5 h-5 border-2 border-[#3ECF8E] border-t-transparent rounded-full animate-spin mx-auto" />
                  </div>
                ) : collabSessions.length === 0 ? (
                  <div className="px-4 py-6 text-center">
                    <p className="text-sm text-gray-400 mb-3">No sessions yet</p>
                    <button
                      onClick={() => { setSessionsOpen(false); router.push('/community'); }}
                      className="px-3 py-1.5 text-xs bg-[#3ECF8E] text-black font-medium rounded-lg hover:bg-[#35b87a] transition-colors"
                    >
                      Create Session
                    </button>
                  </div>
                ) : (
                  <div className="py-2">
                    {collabSessions.map((session) => (
                      <button
                        key={session.id}
                        onClick={() => { router.push(`/community/${session.id}`); setSessionsOpen(false); }}
                        className="w-full px-4 py-2 text-left hover:bg-[#252525] transition-colors flex items-center gap-3"
                      >
                        <div className="w-8 h-8 rounded-lg bg-[#252525] flex items-center justify-center">
                          <svg className="w-4 h-4 text-[#3ECF8E]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-white truncate">{session.name}</p>
                          <p className="text-xs text-gray-500">{session.owner_id === user?.id ? 'You are master' : 'Collaborator'}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="px-4 py-3 border-t border-[#2a2a2a]">
                <button
                  onClick={() => { setSessionsOpen(false); router.push('/community'); }}
                  className="w-full px-3 py-1.5 text-sm text-[#888] hover:text-white hover:bg-[#252525] rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Create or Join Session
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Desktop: User menu */}
        <div className="hidden md:flex items-center gap-2">
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

      {/* Mobile hamburger menu dropdown */}
      {mobileMenuOpen && (
        <div className="md:hidden absolute top-full left-0 right-0 bg-[#171717]/98 backdrop-blur-xl border-b border-[#2a2a2a] z-50 p-4 space-y-4">
          {/* Search */}
          {onPhotoFilterChange && (
            <div className="space-y-3">
              <div key={`mobile-search-${photoFilter.contentSearch ?? ''}`}>
                <SearchFilterInput
                  initialValue={photoFilter.contentSearch ?? ''}
                  photoFilter={photoFilter}
                  onPhotoFilterChange={(f) => { onPhotoFilterChange(f); }}
                />
              </div>

              {/* Date & Camera filters inline */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-[#888] mb-1">Date from</label>
                  <input
                    type="date"
                    value={photoFilter.dateFrom ?? ''}
                    onChange={(e) => onPhotoFilterChange({ ...photoFilter, dateFrom: e.target.value || undefined })}
                    className="w-full h-10 px-2 text-sm bg-[#252525] border border-[#333] rounded text-white focus:outline-none focus:ring-1 focus:ring-[#3ECF8E]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#888] mb-1">Date to</label>
                  <input
                    type="date"
                    value={photoFilter.dateTo ?? ''}
                    onChange={(e) => onPhotoFilterChange({ ...photoFilter, dateTo: e.target.value || undefined })}
                    className="w-full h-10 px-2 text-sm bg-[#252525] border border-[#333] rounded text-white focus:outline-none focus:ring-1 focus:ring-[#3ECF8E]"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-[#888] mb-1">Camera make</label>
                  <input
                    type="text"
                    placeholder="e.g. Canon"
                    value={photoFilter.cameraMake ?? ''}
                    onChange={(e) => onPhotoFilterChange({ ...photoFilter, cameraMake: e.target.value || undefined })}
                    className="w-full h-10 px-2 text-sm bg-[#252525] border border-[#333] rounded text-white placeholder:text-[#666] focus:outline-none focus:ring-1 focus:ring-[#3ECF8E]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#888] mb-1">Camera model</label>
                  <input
                    type="text"
                    placeholder="e.g. EOS R5"
                    value={photoFilter.cameraModel ?? ''}
                    onChange={(e) => onPhotoFilterChange({ ...photoFilter, cameraModel: e.target.value || undefined })}
                    className="w-full h-10 px-2 text-sm bg-[#252525] border border-[#333] rounded text-white placeholder:text-[#666] focus:outline-none focus:ring-1 focus:ring-[#3ECF8E]"
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={() => onPhotoFilterChange({})}
                className="w-full py-2 text-xs text-[#888] hover:text-white border border-[#333] rounded-lg hover:bg-[#252525]"
              >
                Clear filters
              </button>
            </div>
          )}

          <div className="w-full h-px bg-[#2a2a2a]" />

          {/* Recenter */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-[#888]">Recenter</span>
            {onRecenterHorizontally && (
              <button
                onClick={() => { onRecenterHorizontally(); setMobileMenuOpen(false); }}
                className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center text-[#999] hover:text-white hover:bg-[#333] rounded-lg transition-colors"
                title="Recenter horizontally"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
            )}
            {onRecenterVertically && (
              <button
                onClick={() => { onRecenterVertically(); setMobileMenuOpen(false); }}
                className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center text-[#999] hover:text-white hover:bg-[#333] rounded-lg transition-colors"
                title="Recenter vertically"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 4v16M12 4v16M18 4v16" />
                </svg>
              </button>
            )}
          </div>

          <div className="w-full h-px bg-[#2a2a2a]" />

          {/* Community - mobile hamburger */}
          <button
            onClick={() => { router.push('/community'); setMobileMenuOpen(false); }}
            className="flex items-center gap-3 w-full py-2 text-sm text-[#888] hover:text-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            Community Sessions
          </button>

          <div className="w-full h-px bg-[#2a2a2a]" />

          {/* Help - mobile tips */}
          <div>
            <h3 className="text-sm font-semibold text-white mb-2">Tips</h3>
            <ul className="text-xs text-[#999] space-y-1.5">
              <li>Tap photo to select</li>
              <li>Double-tap photo to edit</li>
              <li>Long-press for more options</li>
              <li>Pinch to zoom</li>
              <li>Drag to pan</li>
            </ul>
          </div>

          <div className="w-full h-px bg-[#2a2a2a]" />

          {/* Community - mobile */}
          <button
            onClick={() => { router.push('/community'); setMobileMenuOpen(false); }}
            className="flex items-center gap-3 w-full py-2 text-sm text-[#888] hover:text-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            Community Sessions
          </button>

          <div className="w-full h-px bg-[#2a2a2a]" />

          {/* User / Sign out */}
          <div className="flex items-center gap-3">
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
            <span className="text-sm text-[#ccc]">{user?.email}</span>
            <button
              onClick={handleSignOut}
              className="ml-auto text-sm text-[#888] hover:text-white transition-colors py-2"
            >
              Sign out
            </button>
          </div>
        </div>
      )}

      {/* Toast notification */}
      {showToast && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-[#171717] border border-[#3ECF8E]/30 rounded-lg shadow-lg">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-[#3ECF8E]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span className="text-sm text-white">{toastMessage}</span>
          </div>
        </div>
      )}
    </div>
  );
}
