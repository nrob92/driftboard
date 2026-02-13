import { useEffect, useCallback, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { CanvasImage, PhotoFolder } from "@/lib/types";
import type { CollaborationConfig, CursorPosition, ActivityLog } from "./types";

export interface UseCollaborationProps {
  config: CollaborationConfig | null;
  onPhotosUpdate?: (photos: CanvasImage[]) => void;
  onFoldersUpdate?: (folders: PhotoFolder[]) => void;
}

export function useCollaboration({
  config,
  onPhotosUpdate,
  onFoldersUpdate,
}: UseCollaborationProps) {
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const [onlineUsers, setOnlineUsers] = useState<CursorPosition[]>([]);
  const [activityFeed, setActivityFeed] = useState<ActivityLog[]>([]);

  useEffect(() => {
    if (!config) return;

    const channel = supabase.channel(`collab:${config.sessionId}`, {
      config: { presence: { key: config.userId } },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        const users: CursorPosition[] = [];

        Object.entries(state).forEach(([key, presences], index) => {
          const presence = presences[0] as { email?: string; name?: string };
          users.push({
            userId: key,
            x: 0,
            y: 0,
            color: getUserColor(index),
            name: presence?.name,
          });
        });

        setOnlineUsers(users);
      })
      .on("broadcast", { event: "cursor" }, ({ payload }) => {
        setOnlineUsers((prev) =>
          prev.map((u) =>
            u.userId === payload.userId
              ? { ...u, x: payload.x, y: payload.y }
              : u,
          ),
        );
      })
      .on("broadcast", { event: "activity" }, ({ payload }) => {
        setActivityFeed((prev) => [payload.activity, ...prev.slice(0, 99)]);
      })
      .on("broadcast", { event: "photo_update" }, ({ payload }) => {
        if (payload.photos && onPhotosUpdate) {
          onPhotosUpdate(payload.photos);
        }
      })
      .on("broadcast", { event: "folder_update" }, ({ payload }) => {
        if (payload.folders && onFoldersUpdate) {
          onFoldersUpdate(payload.folders);
        }
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ email: "user", name: "User" });
        }
      });

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
    };
  }, [config, onPhotosUpdate, onFoldersUpdate]);

  // Simple throttle for cursor broadcasts to prevent network spam
  const lastCursorBroadcast = useRef<number>(0);
  const CURSOR_THROTTLE_MS = 50; // 20 cursor updates per second max

  const broadcastCursor = useCallback(
    (x: number, y: number) => {
      if (!config || !channelRef.current) return;

      const now = Date.now();
      if (now - lastCursorBroadcast.current < CURSOR_THROTTLE_MS) return;
      lastCursorBroadcast.current = now;

      channelRef.current.send({
        type: "broadcast",
        event: "cursor",
        payload: { userId: config.userId, x, y },
      });
    },
    [config],
  );

  const broadcastActivity = useCallback(
    (
      action: string,
      targetType: string,
      targetId: string,
      metadata: Record<string, unknown> = {},
    ) => {
      if (!config || !channelRef.current) return;
      const activity: ActivityLog = {
        id: crypto.randomUUID(),
        userId: config.userId,
        action,
        targetType,
        targetId,
        metadata,
        createdAt: new Date().toISOString(),
      };
      channelRef.current.send({
        type: "broadcast",
        event: "activity",
        payload: { activity },
      });
    },
    [config],
  );

  const broadcastPhotosUpdate = useCallback(
    (photos: CanvasImage[]) => {
      if (!config || !channelRef.current) return;
      channelRef.current.send({
        type: "broadcast",
        event: "photo_update",
        payload: { photos },
      });
    },
    [config],
  );

  const broadcastFoldersUpdate = useCallback(
    (folders: PhotoFolder[]) => {
      if (!config || !channelRef.current) return;
      channelRef.current.send({
        type: "broadcast",
        event: "folder_update",
        payload: { folders },
      });
    },
    [config],
  );

  return {
    onlineUsers,
    activityFeed,
    broadcastCursor,
    broadcastActivity,
    broadcastPhotosUpdate,
    broadcastFoldersUpdate,
  };
}

function getUserColor(index: number): string {
  const colors = [
    "#3ECF8E",
    "#F59E0B",
    "#EF4444",
    "#8B5CF6",
    "#EC4899",
    "#06B6D4",
  ];
  return colors[index % colors.length];
}
