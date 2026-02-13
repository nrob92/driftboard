import type { CanvasImage, PhotoFolder } from "@/lib/types";

export interface CollaborationConfig {
  sessionId: string;
  userId: string;
  isOwner: boolean;
  broadcastCursor: (x: number, y: number) => void;
  broadcastActivity: (activity: {
    action: string;
    target_type: string;
    target_id: string;
    metadata: Record<string, unknown>;
  }) => void;
  broadcastPhotoUpdate: (payload: PhotoUpdatePayload) => void;
  broadcastFolderUpdate: (payload: FolderUpdatePayload) => void;
}

export interface PhotoUpdatePayload {
  type: "create" | "update" | "delete";
  photoId?: string;
  changes?: Partial<CanvasImage>;
}

export interface FolderUpdatePayload {
  type: "create" | "update" | "delete";
  folderId?: string;
  changes?: Partial<PhotoFolder>;
}

export interface CursorPosition {
  userId: string;
  x: number;
  y: number;
  color: string;
  name?: string;
}

export interface ActivityLog {
  id: string;
  userId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export function canEditPhoto(
  photo: CanvasImage,
  userId: string,
  _isOwner: boolean,
): boolean {
  return photo.userId === userId;
}

export function canEditFolder(
  folder: PhotoFolder,
  userId: string,
  _isOwner: boolean,
): boolean {
  return folder.userId === userId;
}

export function getOwnerBadge(
  userId: string,
  isOwner: boolean,
): { color: string; label: string } | null {
  if (isOwner) return { color: "#3ECF8E", label: "Owner" };
  return null;
}

export function shouldShowOwnerIndicator(
  photo: CanvasImage,
  currentUserId: string,
): boolean {
  return photo.userId !== currentUserId;
}
