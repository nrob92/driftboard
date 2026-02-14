"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";

/**
 * Global notification component that shows toast when:
 * - User's join request is approved
 * Works on ALL pages of the app
 */
export function GlobalNotifications({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [showToast, setShowToast] = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    if (!user) return;

    // Set up realtime listener for membership status changes
    const channel = supabase
      .channel("global-member-notifications")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "collab_members",
          filter: `user_id=eq.${user.id}`,
        },
        (payload: { new?: { status?: string }; old?: { status?: string } }) => {
          // Check if status changed to approved
          if (payload.new?.status === "approved" && payload.old?.status !== "approved") {
            setToastMessage("Your join request was approved!");
            setShowToast(true);
            setTimeout(() => setShowToast(false), 5000);
          }
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [user]);

  return (
    <>
      {children}
      
      {/* Global Toast Notification */}
      {showToast && (
        <div className="fixed top-4 right-4 z-[9999] animate-slide-down">
          <div className="bg-[#171717] border border-[#3ECF8E]/30 rounded-lg px-4 py-3 shadow-lg shadow-black/50 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-[#3ECF8E]/20 flex items-center justify-center">
              <svg className="w-4 h-4 text-[#3ECF8E]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <p className="text-white text-sm font-medium">Approved!</p>
              <p className="text-gray-400 text-xs">{toastMessage}</p>
            </div>
            <button
              onClick={() => setShowToast(false)}
              className="ml-2 text-gray-400 hover:text-white"
            >
              ×
            </button>
          </div>
        </div>
      )}
    </>
  );
}
