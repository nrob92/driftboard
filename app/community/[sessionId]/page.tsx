'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState, useRef, useCallback } from 'react';
import { useAuth } from '@/lib/auth';
import { useRouter, useParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { CanvasImage, PhotoFolder } from '@/lib/types';
import { useCanvasStore } from '@/lib/stores/canvasStore';

const CanvasEditor = dynamic(() => import('@/components/CanvasEditor').then((m) => m.CanvasEditor), {
  ssr: false,
});

interface Session {
  id: string;
  name: string;
  owner_id: string;
  invite_code: string;
  max_collaborators: number;
  collab_members: SessionMember[];
}

interface SessionMember {
  id: string;
  user_id: string;
  role: string;
  status: string;
  approved_at?: string;
  joined_at?: string;
}

interface UserPresence {
  id: string;
  email: string;
  name?: string;
  color: string;
  cursor?: { x: number; y: number };
}

interface PendingRequest {
  id: string;
  userId: string;
  email: string;
  name?: string;
  createdAt: string;
}

interface Activity {
  id: string;
  user_id: string;
  action: string;
  target_type: string;
  target_id: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

const USER_COLORS = [
  '#3ECF8E', '#F59E0B', '#EF4444', '#8B5CF6', 
  '#EC4899', '#06B6D4', '#84CC16', '#F97316'
];

// Module-level initialization tracking to prevent re-fetching on tab switch
const initializedSessions = new Set<string>();

export default function CollaborativeCanvasPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const sessionId = params.sessionId as string;

  const [session, setSession] = useState<Session | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [error, setError] = useState('');
  const [isOwner, setIsOwner] = useState(false);
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<UserPresence[]>([]);
  const [activityFeed, setActivityFeed] = useState<Activity[]>([]);
  const [showMembers, setShowMembers] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const [photosLoading, setPhotosLoading] = useState(true);

  const realtimeChannel = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const presenceChannel = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const dbChangesChannel = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const isFetching = useRef(false);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  const fetchAuthorization = useCallback(async () => {
    if (!user || !sessionId || isFetching.current || initializedSessions.has(sessionId)) return;
    
    try {
      isFetching.current = true;
      setLoadingSession(true);

      // Fetch session and activity (CanvasEditor will handle photos/folders)
      const [sessionRes, activityRes] = await Promise.all([
        supabase
          .from('collab_sessions')
          .select('*, collab_members(*)')
          .eq('id', sessionId)
          .single(),
        supabase
          .from('collab_activity')
          .select('*')
          .eq('session_id', sessionId)
          .order('created_at', { ascending: false })
          .limit(50)
      ]);

      if (sessionRes.error || !sessionRes.data) {
        setError('Session not found');
        return;
      }

      const rawSession = sessionRes.data;
      const members = (rawSession.collab_members || []) as SessionMember[];
      const ownerStatus = rawSession.owner_id === user.id;
      const membership = members.find(m => m.user_id === user.id && m.status === 'approved');

      if (!membership && !ownerStatus) {
        setError('You are not a member of this session');
        return;
      }

      setSession({
        ...rawSession,
        collab_members: members
      } as Session);
      setIsOwner(ownerStatus);
      setActivityFeed(activityRes.data || []);

      // Initialize Realtime
      initializeRealtime();

      // Fetch pending requests only for owners
      if (ownerStatus) {
        const response = await fetch(`/api/collab/join?sessionId=${sessionId}&userId=${user.id}`);
        const result = await response.json();
        if (result.requests) setPendingRequests(result.requests);
      }

      initializedSessions.add(sessionId);
    } catch (err) {
      console.error('Auth error:', err);
      setError('Failed to authorize');
    } finally {
      setLoadingSession(false);
      isFetching.current = false;
    }
  }, [user, sessionId]);

  useEffect(() => {
    fetchAuthorization();
    
    return () => {
      cleanupRealtime();
      // Don't reset isInitialized.current - we want to prevent re-fetching on tab switch
    };
  }, [fetchAuthorization]);

  const fetchSession = async () => {
    try {
      const { data } = await supabase
        .from('collab_sessions')
        .select('*, collab_members(*)')
        .eq('id', sessionId)
        .single();

      if (data) {
        setSession(data as Session);
      }
    } catch (err) {
      console.error('Error refreshing session:', err);
    }
  };

  const fetchActivity = async () => {
    try {
      const { data } = await supabase
        .from('collab_activity')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: false })
        .limit(50);
      setActivityFeed(data || []);
    } catch (err) {
      console.error('Error refreshing activity:', err);
    }
  };

  const initializeRealtime = () => {
    presenceChannel.current = supabase.channel(`presence:${sessionId}`, {
      config: {
        presence: { key: user?.id },
      },
    });

    presenceChannel.current
      .on('presence', { event: 'sync' }, () => {
        const state = presenceChannel.current?.presenceState() || {};
        const users: UserPresence[] = [];
        
        Object.entries(state).forEach(([key, presences], index) => {
          const presence = presences[0] as { email?: string; name?: string };
          users.push({
            id: key,
            email: presence?.email || '',
            name: presence?.name,
            color: USER_COLORS[index % USER_COLORS.length],
          });
        });

        setOnlineUsers(users);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await presenceChannel.current?.track({
            email: user?.email,
            name: user?.email?.split('@')[0],
          });
        }
      });

    realtimeChannel.current = supabase.channel(`broadcast:${sessionId}`);

    realtimeChannel.current
      .on('broadcast', { event: 'cursor' }, ({ payload }) => {
        setOnlineUsers(prev => prev.map(u => 
          u.id === payload.userId 
            ? { ...u, cursor: { x: payload.x, y: payload.y } }
            : u
        ));
      })
      .subscribe();

    dbChangesChannel.current = supabase.channel(`db-changes:${sessionId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'collab_members',
        filter: `session_id=eq.${sessionId}`
      }, () => {
        fetchSession();
        if (isOwner) fetchPendingRequests();
      })
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'collab_activity',
        filter: `session_id=eq.${sessionId}`
      }, (payload) => {
        const newActivity = payload.new as Activity;
        setActivityFeed(prev => [newActivity, ...prev.slice(0, 49)]);
      })
      .subscribe();
  };

  const fetchPendingRequests = async () => {
    try {
      const response = await fetch(`/api/collab/join?sessionId=${sessionId}&userId=${user?.id}`);
      const result = await response.json();
      if (result.requests) {
        setPendingRequests(result.requests);
      }
    } catch (err) {
      console.error('Error fetching pending requests:', err);
    }
  };

  const cleanupRealtime = () => {
    if (presenceChannel.current) {
      supabase.removeChannel(presenceChannel.current);
      presenceChannel.current = null;
    }
    if (realtimeChannel.current) {
      supabase.removeChannel(realtimeChannel.current);
      realtimeChannel.current = null;
    }
    if (dbChangesChannel.current) {
      supabase.removeChannel(dbChangesChannel.current);
      dbChangesChannel.current = null;
    }
  };

  const handleApproveRequest = async (memberId: string) => {
    try {
      const response = await fetch('/api/collab/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId, userId: user?.id, action: 'approve' })
      });

      if (response.ok) {
        setPendingRequests(prev => prev.filter(r => r.id !== memberId));
      }
    } catch (err) {
      console.error('Error approving request:', err);
    }
  };

  const handleRejectRequest = async (memberId: string) => {
    try {
      const response = await fetch('/api/collab/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId, userId: user?.id, action: 'reject' })
      });

      if (response.ok) {
        setPendingRequests(prev => prev.filter(r => r.id !== memberId));
      }
    } catch (err) {
      console.error('Error rejecting request:', err);
    }
  };

  const handleRemoveMember = async (memberId: string, memberUserId: string) => {
    if (!confirm('Are you sure you want to remove this member?')) return;
    try {
      const response = await fetch('/api/collab/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId, userId: user?.id, action: 'remove' })
      });

      if (response.ok) {
        // Refresh handled by realtime
      }
    } catch (err) {
      console.error('Error removing member:', err);
    }
  };

  const handleEndSession = async () => {
    if (!confirm('Are you sure you want to end this session? All data will be deleted.')) return;
    try {
      const response = await fetch(`/api/collab/session?sessionId=${sessionId}&userId=${user?.id}`, { method: 'DELETE' });
      if (response.ok) router.push('/community');
    } catch (err) {
      console.error('Error ending session:', err);
    }
  };

  const broadcastCursor = useCallback((x: number, y: number) => {
    if (realtimeChannel.current) {
      realtimeChannel.current.send({ type: 'broadcast', event: 'cursor', payload: { userId: user?.id, x, y } });
    }
  }, [user?.id]);

  if (loading || loadingSession) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#0a0a0a]">
        <div className="w-8 h-8 border-2 border-[#3ECF8E] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user || error) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#0a0a0a]">
        <div className="text-center">
          <p className="text-red-400 mb-4">{error || 'Session not found'}</p>
          <button onClick={() => router.push('/community')} className="px-4 py-2 bg-[#3ECF8E] text-black font-medium rounded-lg">
            Back to Community
          </button>
        </div>
      </div>
    );
  }

  const approvedMembers = session?.collab_members?.filter((m: SessionMember) => m.status === 'approved') || [];

  return (
    <div className="h-screen w-screen overflow-hidden relative bg-[#0a0a0a]">
      {/* Collaborative Canvas */}
      <CanvasEditor 
        sessionId={sessionId} 
        onPhotosLoadStateChange={setPhotosLoading} 
      />

      {/* Loading Overlay */}
      {photosLoading && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-[#171717] border border-[#2a2a2a] rounded-xl px-4 py-3 shadow-2xl shadow-black/50">
          <div className="w-5 h-5 border-2 border-[#3ECF8E] border-t-transparent rounded-full animate-spin" />
          <span className="text-white text-sm font-medium">Loading session data...</span>
        </div>
      )}

      {/* Online Users */}
      <div className="absolute top-4 right-4 z-50 flex items-center gap-2">
        <div className="flex -space-x-2">
          {onlineUsers.map((onlineUser) => (
            <div key={onlineUser.id} className="w-8 h-8 rounded-full border-2 border-[#0a0a0a] flex items-center justify-center text-xs font-medium" 
                 style={{ backgroundColor: onlineUser.color }} title={onlineUser.email}>
              {onlineUser.name?.[0]?.toUpperCase() || onlineUser.email[0]?.toUpperCase()}
            </div>
          ))}
        </div>
        <button onClick={() => setShowMembers(true)} className="ml-2 px-3 py-1 bg-[#171717]/80 backdrop-blur border border-[#2a2a2a] rounded-lg text-xs hover:bg-[#1a1a1a] text-white">
          {approvedMembers.length}/{session?.max_collaborators}
        </button>
      </div>

      {/* Pending Requests Badge */}
      {isOwner && pendingRequests.length > 0 && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50">
          <button onClick={() => setShowMembers(true)} className="px-3 py-1 bg-yellow-500/20 border border-yellow-500/30 rounded-lg text-xs text-yellow-400 animate-pulse">
            {pendingRequests.length} pending request{pendingRequests.length > 1 ? 's' : ''}
          </button>
        </div>
      )}

      {/* Activity Button */}
      <button onClick={() => setShowActivity(true)} className="absolute bottom-4 right-4 z-50 p-2 bg-[#171717]/80 backdrop-blur border border-[#2a2a2a] rounded-lg hover:bg-[#1a1a1a] text-white">
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
      </button>

      {/* Back Button */}
      <button onClick={() => router.push('/community')} className="absolute top-4 left-4 z-50 px-3 py-1 bg-[#171717]/80 backdrop-blur border border-[#2a2a2a] rounded-lg text-xs hover:bg-[#1a1a1a] text-white">
        ← Community
      </button>

      {/* Members Panel */}
      {showMembers && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-end z-[100]">
          <div className="w-80 h-full bg-[#171717] border-l border-[#2a2a2a] p-4 overflow-y-auto text-white">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold">Members</h2>
              <button onClick={() => setShowMembers(false)} className="p-1 hover:bg-[#1a1a1a] rounded">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            {isOwner && (
              <div className="mb-4 p-3 bg-[#0a0a0a] rounded-lg">
                <p className="text-xs text-gray-400 mb-2">Invite others:</p>
                <div className="flex items-center gap-2">
                  <input type="text" readOnly value={`${typeof window !== 'undefined' ? window.location.origin : ''}/community/join?code=${session?.invite_code}`} className="flex-1 text-xs bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1 text-gray-300" />
                  <button onClick={() => navigator.clipboard.writeText(`${window.location.origin}/community/join?code=${session?.invite_code}`)} className="p-1 bg-[#3ECF8E] rounded text-black hover:bg-[#35b87a]">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                  </button>
                </div>
              </div>
            )}

            {isOwner && pendingRequests.length > 0 && (
              <div className="mb-4">
                <h3 className="text-sm font-medium mb-2 text-yellow-400">Pending Requests</h3>
                {pendingRequests.map((request) => (
                  <div key={request.id} className="flex items-center justify-between p-2 bg-[#0a0a0a] rounded-lg mb-2">
                    <div>
                      <p className="text-sm">{request.name || request.email}</p>
                      <p className="text-xs text-gray-400">{request.email}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => handleApproveRequest(request.id)} className="p-1 bg-[#3ECF8E] rounded hover:bg-[#35b87a]"><svg className="w-4 h-4 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg></button>
                      <button onClick={() => handleRejectRequest(request.id)} className="p-1 bg-red-500/20 rounded hover:bg-red-500/30"><svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div>
              <h3 className="text-sm font-medium mb-2">Members ({approvedMembers.length}/{session?.max_collaborators})</h3>
              {approvedMembers.map((member: SessionMember) => (
                <div key={member.id} className="flex items-center justify-between p-2 hover:bg-[#1a1a1a] rounded-lg">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-[#3ECF8E] flex items-center justify-center text-xs font-medium text-black uppercase">
                      {member.role === 'master' ? 'M' : 'C'}
                    </div>
                    <div>
                      <p className="text-sm">{member.role === 'master' ? 'Master' : 'Collaborator'}{member.user_id === user?.id && ' (You)'}</p>
                    </div>
                  </div>
                  {isOwner && member.role !== 'master' && member.user_id !== user?.id && (
                    <button onClick={() => handleRemoveMember(member.id, member.user_id)} className="p-1 text-gray-400 hover:text-red-400">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  )}
                </div>
              ))}
            </div>

            {isOwner && (
              <div className="mt-6 pt-4 border-t border-[#2a2a2a]">
                <button onClick={handleEndSession} className="w-full px-4 py-2 bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg hover:bg-red-500/20">
                  End Session
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Activity Feed */}
      {showActivity && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-end z-[100]">
          <div className="w-80 h-full bg-[#171717] border-l border-[#2a2a2a] p-4 overflow-y-auto text-white">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold">Activity</h2>
              <button onClick={() => setShowActivity(false)} className="p-1 hover:bg-[#1a1a1a] rounded">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="space-y-3">
              {activityFeed.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">No activity yet</p>
              ) : (
                activityFeed.map((activity) => (
                  <div key={activity.id} className="text-sm border-b border-[#2a2a2a] pb-2">
                    <p className="text-gray-300"><span className="text-[#3ECF8E] font-medium">{activity.action.replace(/_/g, ' ')}</span></p>
                    <p className="text-xs text-gray-500">{new Date(activity.created_at).toLocaleString()}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}