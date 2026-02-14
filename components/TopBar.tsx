"use client";

import { useRef, useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { useUIStore } from "@/lib/stores/uiStore";
import { useRouter } from "next/navigation";

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
        if (next === "") {
          onPhotoFilterChange({ ...photoFilter, contentSearch: undefined });
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          onPhotoFilterChange({
            ...photoFilter,
            contentSearch: value.trim() || undefined,
          });
        }
      }}
      className="w-full md:w-56 h-10 md:h-8 px-3 py-1 text-sm bg-[#252525] border border-[#333] rounded-lg text-white placeholder:text-[#666] focus:outline-none focus:ring-1 focus:ring-[#3ECF8E] focus:border-[#3ECF8E]"
    />
  );
}

interface OnlineUser {
  id: string;
  email: string;
  name?: string;
  color: string;
}

interface TopBarProps {
  onUpload: (files: FileList | null) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  visible: boolean;
  isMobile?: boolean;
  photoFilter?: PhotoFilterState;
  onPhotoFilterChange?: (filter: PhotoFilterState) => void;
  onToggleSidebar?: () => void;
  sessionId?: string;
  onlineUsers?: OnlineUser[];
  pendingRequestCount?: number;
  approvedCount?: number;
  maxCollaborators?: number;
  isOwner?: boolean;
}

export function TopBar({
  onUpload,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  visible,
  photoFilter = {},
  onPhotoFilterChange,
  onToggleSidebar,
  sessionId,
  onlineUsers = [],
  pendingRequestCount = 0,
  approvedCount = 0,
  maxCollaborators = 0,
  isOwner = false,
}: TopBarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const helpRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);

  const { user, signOut } = useAuth();
  const mobileMenuOpen = useUIStore((s) => s.mobileMenuOpen);
  const setMobileMenuOpen = useUIStore((s) => s.setMobileMenuOpen);
  const router = useRouter();

  useEffect(() => {
    if (!helpOpen) return;
    const close = (e: MouseEvent) => {
      if (helpRef.current && !helpRef.current.contains(e.target as Node))
        setHelpOpen(false);
    };
    window.addEventListener("click", close, true);
    return () => window.removeEventListener("click", close, true);
  }, [helpOpen]);

  useEffect(() => {
    if (!filterOpen) return;
    const close = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node))
        setFilterOpen(false);
    };
    window.addEventListener("click", close, true);
    return () => window.removeEventListener("click", close, true);
  }, [filterOpen]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    onUpload(e.target.files);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSignOut = async () => {
    setMobileMenuOpen(false);
    try {
      await signOut();
    } catch (error) {
      console.error("Failed to sign out:", error);
    }
  };

  return (
    <div
      className={`absolute top-0 left-0 right-0 z-10 flex h-14 items-center gap-2 md:gap-3 bg-[#171717]/95 backdrop-blur-xl border-b border-[#2a2a2a] px-3 md:px-4 transition-transform duration-200 ${
        visible ? "translate-y-0" : "-translate-y-full"
      }`}
    >
      {/* Mobile hamburger */}
      <button
        type="button"
        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        className="md:hidden p-2 min-h-[44px] min-w-[44px] flex items-center justify-center text-[#888] hover:text-white hover:bg-[#252525] rounded-lg transition-colors"
      >
        {mobileMenuOpen ? (
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        ) : (
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 6h16M4 12h16M4 18h16"
            />
          </svg>
        )}
      </button>

      {/* Back to Community (only in session mode) */}
      {sessionId && (
        <button
          type="button"
          onClick={() => router.push("/community")}
          className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-[#888] hover:text-white hover:bg-[#252525] rounded-lg transition-colors cursor-pointer"
          title="Back to Community"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
          <span>Community</span>
        </button>
      )}

      {/* Logo */}
      <div className="flex items-center gap-2 md:mr-4">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#3ECF8E] to-[#2da36f] flex items-center justify-center">
          <svg
            className="w-4 h-4 text-[#0d0d0d]"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" />
          </svg>
        </div>
        <span className="hidden md:inline text-base font-semibold text-white">
          Driftboard
        </span>
      </div>

      {/* Desktop: Divider */}
      <div className="hidden md:block w-px h-6 bg-[#333]" />

      {/* Desktop: Filter search */}
      {onPhotoFilterChange && (
        <div className="hidden md:flex items-center gap-2">
          <div key={`search-${photoFilter.contentSearch ?? ""}`}>
            <SearchFilterInput
              initialValue={photoFilter.contentSearch ?? ""}
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
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
                />
              </svg>
            </button>
            {filterOpen && (
              <div className="absolute left-0 top-full mt-2 w-64 bg-[#171717] border border-[#2a2a2a] rounded-xl shadow-2xl shadow-black/50 z-50 p-3 space-y-3">
                <div>
                  <label className="block text-xs text-[#888] mb-1">
                    Date from
                  </label>
                  <input
                    type="date"
                    value={photoFilter.dateFrom ?? ""}
                    onChange={(e) =>
                      onPhotoFilterChange({
                        ...photoFilter,
                        dateFrom: e.target.value || undefined,
                      })
                    }
                    className="w-full h-8 px-2 text-sm bg-[#252525] border border-[#333] rounded text-white focus:outline-none focus:ring-1 focus:ring-[#3ECF8E]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#888] mb-1">
                    Date to
                  </label>
                  <input
                    type="date"
                    value={photoFilter.dateTo ?? ""}
                    onChange={(e) =>
                      onPhotoFilterChange({
                        ...photoFilter,
                        dateTo: e.target.value || undefined,
                      })
                    }
                    className="w-full h-8 px-2 text-sm bg-[#252525] border border-[#333] rounded text-white focus:outline-none focus:ring-1 focus:ring-[#3ECF8E]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#888] mb-1">
                    Camera make
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Canon"
                    value={photoFilter.cameraMake ?? ""}
                    onChange={(e) =>
                      onPhotoFilterChange({
                        ...photoFilter,
                        cameraMake: e.target.value || undefined,
                      })
                    }
                    className="w-full h-8 px-2 text-sm bg-[#252525] border border-[#333] rounded text-white placeholder:text-[#666] focus:outline-none focus:ring-1 focus:ring-[#3ECF8E]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#888] mb-1">
                    Camera model
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. EOS R5"
                    value={photoFilter.cameraModel ?? ""}
                    onChange={(e) =>
                      onPhotoFilterChange({
                        ...photoFilter,
                        cameraModel: e.target.value || undefined,
                      })
                    }
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

      {/* Upload */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-2 px-3 py-1.5 min-h-[44px] md:min-h-0 text-sm font-medium text-white bg-[#3ECF8E] hover:bg-[#35b87d] rounded-lg transition-colors cursor-pointer"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
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
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </button>
          {helpOpen && (
            <div className="absolute right-0 top-full mt-2 w-96 max-h-[calc(100vh-6rem)] overflow-y-auto bg-[#171717] border border-[#2a2a2a] rounded-xl shadow-2xl shadow-black/50 z-50">
              <div className="px-4 py-2 border-b border-[#2a2a2a]">
                <h3 className="text-sm font-semibold text-white">Shortcuts</h3>
              </div>
              <div className="px-4 py-3 text-left text-sm text-[#d4d4d4] leading-7">
                <ul className="space-y-3">
                  <li className="flex gap-2 items-center">
                    <kbd className="kbd shrink-0">Ctrl + Click + photo</kbd>
                    multi-select photos
                  </li>
                  <li className="flex gap-2 items-center">
                    <kbd className="kbd shrink-0">Shift + Click + photo</kbd>
                    range select photos
                  </li>
                  <li className="flex gap-2 items-center">
                    <kbd className="kbd shrink-0">Ctrl + Click + edit tab</kbd>
                    toggle edit
                  </li>
                  <li className="flex gap-2 items-center">
                    <kbd className="kbd shrink-0">Space + drag</kbd>pan
                  </li>
                  <li className="flex gap-2 items-center">
                    <kbd className="kbd shrink-0">Ctrl + scroll</kbd>zoom
                  </li>
                  <li className="flex gap-2 items-center">
                    <kbd className="kbd shrink-0">Ctrl + Z</kbd>undo photo edit
                  </li>
                  <li className="flex gap-2 items-center">
                    <kbd className="kbd shrink-0">Ctrl + Shift + Z</kbd>redo
                    photo edit
                  </li>
                  <li className="flex gap-2 items-center">
                    <kbd className="kbd shrink-0">2× click + photo</kbd>
                    fullscreen
                  </li>
                  <li className="flex gap-2 items-center">
                    <kbd className="kbd shrink-0">2× click + canvas</kbd>add
                    text
                  </li>
                  <li className="flex gap-2 items-center">
                    <kbd className="kbd shrink-0">Drag + photo into folder</kbd>
                    adds to folder
                  </li>
                  <li className="flex gap-2 items-center">
                    <kbd className="kbd shrink-0">
                      Drag + photo out of folder
                    </kbd>
                    creates/adds to new folder
                  </li>
                  <li className="flex gap-2 items-center">
                    <kbd className="kbd shrink-0">Right-click + 1 photo</kbd>
                    copy/paste edits, preset, export
                  </li>
                  <li className="flex gap-2 items-center">
                    <kbd className="kbd shrink-0">
                      Right-click + multiple photos
                    </kbd>
                    paste, export, new folder
                  </li>
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
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
              />
            </svg>
          </button>
          <div className="w-px h-5 bg-[#333]" />
          <button
            onClick={onRedo}
            disabled={!canRedo}
            className="p-2 min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 flex items-center justify-center text-[#999] hover:text-white disabled:text-[#555] disabled:cursor-not-allowed transition-colors rounded-r-lg hover:bg-[#333] cursor-pointer"
            title="Redo"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 10h-10a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6"
              />
            </svg>
          </button>
        </div>

        {/* Session: online users + member count badge (toggles sidebar) */}
        {sessionId && onToggleSidebar && (
          <button
            type="button"
            onClick={onToggleSidebar}
            className="hidden md:flex items-center gap-2 px-2 py-1 hover:bg-[#252525] rounded-lg transition-colors cursor-pointer relative"
            title="Members & Activity"
          >
            {/* Online user avatars */}
            <div className="flex -space-x-2">
              {onlineUsers.slice(0, 5).map((u) => (
                <div
                  key={u.id}
                  className="w-7 h-7 rounded-full border-2 border-[#171717] flex items-center justify-center text-[10px] font-medium"
                  style={{ backgroundColor: u.color }}
                  title={u.email}
                >
                  {u.name?.[0]?.toUpperCase() || u.email[0]?.toUpperCase()}
                </div>
              ))}
            </div>
            {/* Member count */}
            <span className="text-xs text-[#888]">
              {approvedCount}/{maxCollaborators}
            </span>
            {/* Pending requests indicator */}
            {isOwner && pendingRequestCount > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-yellow-500 text-black text-[10px] font-bold rounded-full flex items-center justify-center animate-pulse">
                {pendingRequestCount}
              </span>
            )}
          </button>
        )}

        {/* Desktop: Community link (home page only) */}
        {!sessionId && (
          <button
            type="button"
            onClick={() => router.push("/community")}
            className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-[#888] hover:text-white hover:bg-[#252525] rounded-lg transition-colors cursor-pointer"
            title="Community Sessions"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
              />
            </svg>
            <span>Community</span>
          </button>
        )}

        {/* Desktop: User menu (home page only) */}
        {!sessionId && (
          <div className="hidden md:flex items-center gap-2">
            {user?.user_metadata?.avatar_url ? (
              <img
                src={user.user_metadata.avatar_url}
                alt="Profile"
                className="w-8 h-8 rounded-full ring-2 ring-[#333]"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#3ECF8E] to-[#2da36f] flex items-center justify-center text-[#0d0d0d] text-sm font-semibold">
                {user?.email?.charAt(0).toUpperCase() || "U"}
              </div>
            )}
            <button
              onClick={handleSignOut}
              className="text-sm text-[#888] hover:text-white transition-colors cursor-pointer"
            >
              Sign out
            </button>
          </div>
        )}
      </div>

      {/* Mobile hamburger menu dropdown */}
      {mobileMenuOpen && (
        <div className="md:hidden absolute top-full left-0 right-0 bg-[#171717]/98 backdrop-blur-xl border-b border-[#2a2a2a] z-50 p-4 space-y-4">
          {/* Search */}
          {onPhotoFilterChange && (
            <div className="space-y-3">
              <div key={`mobile-search-${photoFilter.contentSearch ?? ""}`}>
                <SearchFilterInput
                  initialValue={photoFilter.contentSearch ?? ""}
                  photoFilter={photoFilter}
                  onPhotoFilterChange={(f) => {
                    onPhotoFilterChange(f);
                  }}
                />
              </div>

              {/* Date & Camera filters inline */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-[#888] mb-1">
                    Date from
                  </label>
                  <input
                    type="date"
                    value={photoFilter.dateFrom ?? ""}
                    onChange={(e) =>
                      onPhotoFilterChange({
                        ...photoFilter,
                        dateFrom: e.target.value || undefined,
                      })
                    }
                    className="w-full h-10 px-2 text-sm bg-[#252525] border border-[#333] rounded text-white focus:outline-none focus:ring-1 focus:ring-[#3ECF8E]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#888] mb-1">
                    Date to
                  </label>
                  <input
                    type="date"
                    value={photoFilter.dateTo ?? ""}
                    onChange={(e) =>
                      onPhotoFilterChange({
                        ...photoFilter,
                        dateTo: e.target.value || undefined,
                      })
                    }
                    className="w-full h-10 px-2 text-sm bg-[#252525] border border-[#333] rounded text-white focus:outline-none focus:ring-1 focus:ring-[#3ECF8E]"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-[#888] mb-1">
                    Camera make
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Canon"
                    value={photoFilter.cameraMake ?? ""}
                    onChange={(e) =>
                      onPhotoFilterChange({
                        ...photoFilter,
                        cameraMake: e.target.value || undefined,
                      })
                    }
                    className="w-full h-10 px-2 text-sm bg-[#252525] border border-[#333] rounded text-white placeholder:text-[#666] focus:outline-none focus:ring-1 focus:ring-[#3ECF8E]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#888] mb-1">
                    Camera model
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. EOS R5"
                    value={photoFilter.cameraModel ?? ""}
                    onChange={(e) =>
                      onPhotoFilterChange({
                        ...photoFilter,
                        cameraModel: e.target.value || undefined,
                      })
                    }
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

          {/* Community (mobile) */}
          <button
            onClick={() => {
              router.push("/community");
              setMobileMenuOpen(false);
            }}
            className="flex items-center gap-3 w-full py-2 text-sm text-[#888] hover:text-white transition-colors"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
              />
            </svg>
            Community
          </button>

          {/* Sidebar toggle (mobile, session mode) */}
          {sessionId && onToggleSidebar && (
            <>
              <div className="w-full h-px bg-[#2a2a2a]" />
              <button
                onClick={() => {
                  onToggleSidebar();
                  setMobileMenuOpen(false);
                }}
                className="flex items-center gap-3 w-full py-2 text-sm text-[#888] hover:text-white transition-colors"
              >
                <div className="flex -space-x-2">
                  {onlineUsers.slice(0, 4).map((u) => (
                    <div
                      key={u.id}
                      className="w-6 h-6 rounded-full border-2 border-[#171717] flex items-center justify-center text-[9px] font-medium"
                      style={{ backgroundColor: u.color }}
                    >
                      {u.name?.[0]?.toUpperCase() || u.email[0]?.toUpperCase()}
                    </div>
                  ))}
                </div>
                <span>Members ({approvedCount}/{maxCollaborators})</span>
                {isOwner && pendingRequestCount > 0 && (
                  <span className="ml-auto px-1.5 py-0.5 bg-yellow-500/20 text-yellow-400 text-xs rounded animate-pulse">
                    {pendingRequestCount} pending
                  </span>
                )}
              </button>
            </>
          )}

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

          {/* User / Sign out (home page only) */}
          {!sessionId && (
            <div className="flex items-center gap-3">
              {user?.user_metadata?.avatar_url ? (
                <img
                  src={user.user_metadata.avatar_url}
                  alt="Profile"
                  className="w-8 h-8 rounded-full ring-2 ring-[#333]"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#3ECF8E] to-[#2da36f] flex items-center justify-center text-[#0d0d0d] text-sm font-semibold">
                  {user?.email?.charAt(0).toUpperCase() || "U"}
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
          )}
        </div>
      )}
    </div>
  );
}
