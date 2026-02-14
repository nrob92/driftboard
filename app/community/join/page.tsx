"use client";

import { useEffect, useState, Suspense, useRef } from "react";
import { useAuth } from "@/lib/auth";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

function JoinSessionContent() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [sessionInfo, setSessionInfo] = useState<{
    id: string;
    name: string;
    owner_id: string;
  } | null>(null);
  const [sessionError, setSessionError] = useState("");
  const [requestStatus, setRequestStatus] = useState<
    "pending" | "approved" | "rejected" | "none"
  >("none");
  const [loadingState, setLoadingState] = useState(true);
  const [requesting, setRequesting] = useState(false);
  const [autoRedirect, setAutoRedirect] = useState(false);
  const memberChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const inviteCode = searchParams.get("code");

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (user && inviteCode) {
      fetchSessionInfo();
    } else if (!inviteCode) {
      setSessionError("No invite code provided");
      setLoadingState(false);
    }
  }, [user, inviteCode]);

  const fetchSessionInfo = async () => {
    try {
      const { data, error } = await supabase
        .from("collab_sessions")
        .select("id, name, owner_id")
        .eq("invite_code", inviteCode?.toUpperCase())
        .single();

      if (error || !data) {
        setSessionError("Invalid invite code");
      } else {
        setSessionInfo(data);

        // Check if user is already a member
        const { data: member } = await supabase
          .from("collab_members")
          .select("status")
          .eq("session_id", data.id)
          .eq("user_id", user?.id)
          .single();

        if (member) {
          setRequestStatus(
            member.status as "pending" | "approved" | "rejected",
          );
        }
      }
    } catch (err) {
      setSessionError("Failed to load session");
    } finally {
      setLoadingState(false);
    }
  };

  const requestToJoin = async () => {
    if (!sessionInfo) return;

    setRequesting(true);
    setSessionError("");

    try {
      const response = await fetch("/api/collab/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inviteCode: inviteCode,
          userId: user?.id,
          email: user?.email,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to request to join");
      }

      setRequestStatus("pending");

      // Set up realtime listener for this user's membership
      if (sessionInfo?.id && user?.id) {
        setupMembershipListener(sessionInfo.id, user.id);
      }
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to request to join";
      setSessionError(errorMessage);
    } finally {
      setRequesting(false);
    }
  };

  // Set up realtime listener for membership status changes
  const setupMembershipListener = (sessionId: string, userId: string) => {
    // Clean up any existing channel
    if (memberChannelRef.current) {
      supabase.removeChannel(memberChannelRef.current);
    }

    memberChannelRef.current = supabase
      .channel(`member-status:${sessionId}:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "collab_members",
          filter: `session_id=eq.${sessionId}`,
        },
        async (payload) => {
          // Check if this change is for our user
          const newRecord = payload.new as { user_id?: string; status?: string } | null;
          const oldRecord = payload.old as { user_id?: string } | null;
          const memberUserId = newRecord?.user_id || oldRecord?.user_id;
          
          if (memberUserId === userId) {
            const newStatus = newRecord?.status;
            
            if (newStatus === "approved") {
              setRequestStatus("approved");
              setAutoRedirect(true);
            } else if (newStatus === "rejected") {
              setRequestStatus("rejected");
            }
          }
        }
      )
      .subscribe();
  };

  // Auto-redirect when approved
  useEffect(() => {
    if (autoRedirect && sessionInfo) {
      const timer = setTimeout(() => {
        router.push(`/community/${sessionInfo.id}`);
      }, 1500); // Wait 1.5 seconds so user sees the "You're In!" message
      return () => clearTimeout(timer);
    }
  }, [autoRedirect, sessionInfo, router]);

  // Clean up channel on unmount
  useEffect(() => {
    return () => {
      if (memberChannelRef.current) {
        supabase.removeChannel(memberChannelRef.current);
      }
    };
  }, []);

  if (loading || loadingState) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#0a0a0a]">
        <div className="w-8 h-8 border-2 border-[#3ECF8E] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold mb-2">
            Join Collaborative Session
          </h1>
          {sessionInfo && (
            <p className="text-gray-400">
              You&apos;ve been invited to join{" "}
              <span className="text-[#3ECF8E]">{sessionInfo.name}</span>
            </p>
          )}
        </div>

        {sessionError && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm text-center">
            {sessionError}
          </div>
        )}

        {!sessionInfo && !sessionError && (
          <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-yellow-400 text-sm text-center">
            Loading session information...
          </div>
        )}

        {sessionInfo && (
          <div className="bg-[#171717] border border-[#2a2a2a] rounded-xl p-6">
            {requestStatus === "none" && (
              <>
                <p className="text-gray-300 mb-6 text-center">
                  Request to join this session? The master will need to approve
                  your request.
                </p>
                <div className="flex items-center justify-center gap-3">
                  <button
                    onClick={() => router.push("/community")}
                    className="px-4 py-2 border border-[#2a2a2a] hover:bg-[#1a1a1a] rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={requestToJoin}
                    disabled={requesting}
                    className="px-4 py-2 bg-[#3ECF8E] text-black font-medium rounded-lg hover:bg-[#35b87a] transition-colors disabled:opacity-50"
                  >
                    {requesting ? "Sending..." : "Request to Join"}
                  </button>
                </div>
              </>
            )}

            {requestStatus === "pending" && (
              <div className="text-center">
                <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-yellow-500/20 flex items-center justify-center">
                  <svg
                    className="w-6 h-6 text-yellow-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </div>
                <h3 className="font-medium text-lg mb-2">Request Pending</h3>
                <p className="text-gray-400 mb-6">
                  Your request has been sent. Please wait for the session master
                  to approve you.
                </p>
                <button
                  onClick={() => router.push("/community")}
                  className="px-4 py-2 border border-[#2a2a2a] hover:bg-[#1a1a1a] rounded-lg transition-colors"
                >
                  Back to Community
                </button>
              </div>
            )}

            {requestStatus === "approved" && (
              <div className="text-center">
                <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-[#3ECF8E]/20 flex items-center justify-center">
                  <svg
                    className="w-6 h-6 text-[#3ECF8E]"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </div>
                <h3 className="font-medium text-lg mb-2">You&apos;re In!</h3>
                <p className="text-gray-400 mb-6">
                  Your request has been approved. Welcome to the session!
                </p>
                <button
                  onClick={() => router.push(`/community/${sessionInfo.id}`)}
                  className="px-4 py-2 bg-[#3ECF8E] text-black font-medium rounded-lg hover:bg-[#35b87a] transition-colors"
                >
                  Open Session
                </button>
              </div>
            )}

            {requestStatus === "rejected" && (
              <div className="text-center">
                <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-red-500/20 flex items-center justify-center">
                  <svg
                    className="w-6 h-6 text-red-500"
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
                </div>
                <h3 className="font-medium text-lg mb-2">Request Declined</h3>
                <p className="text-gray-400 mb-6">
                  Sorry, your request to join this session was declined.
                </p>
                <button
                  onClick={() => router.push("/community")}
                  className="px-4 py-2 border border-[#2a2a2a] hover:bg-[#1a1a1a] rounded-lg transition-colors"
                >
                  Back to Community
                </button>
              </div>
            )}
          </div>
        )}

        {!sessionInfo && !sessionError && (
          <div className="text-center mt-6">
            <button
              onClick={() => router.push("/community")}
              className="text-gray-400 hover:text-white transition-colors"
            >
              ← Back to Community
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function JoinSessionPage() {
  return (
    <Suspense
      fallback={
        <div className="h-screen w-screen flex items-center justify-center bg-[#0a0a0a]">
          <div className="w-8 h-8 border-2 border-[#3ECF8E] border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <JoinSessionContent />
    </Suspense>
  );
}
