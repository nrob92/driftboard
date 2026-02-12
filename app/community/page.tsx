'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useAuth } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { TopBar } from '@/components/TopBar';

interface Session {
  id: string;
  name: string;
  invite_code: string;
  owner_id: string;
  max_collaborators: number;
  is_active: boolean;
  created_at: string;
  pending_count?: number;
  approved_count?: number;
}

export default function CommunityPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [newSessionName, setNewSessionName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [pendingRequests, setPendingRequests] = useState<Record<string, number>>({});

  const [loadingData, setLoadingData] = useState(true);
  const isFetching = useRef(false);
  const isInitialized = useRef(false);

  const fetchSessions = useCallback(async (force = false) => {
    if (!user || (!force && (isFetching.current || isInitialized.current))) {
      if (user && isInitialized.current) setLoadingData(false);
      return;
    }
    
    try {
      isFetching.current = true;
      if (!force) setLoadingData(true);
      
      const response = await fetch(`/api/collab/session?userId=${user.id}`);
      const result = await response.json();
      
      if (result.sessions) {
        setSessions(result.sessions as Session[]);
        
        // Map pending counts from the session data
        const counts: Record<string, number> = {};
        result.sessions.forEach((s: Session) => {
          if (s.pending_count !== undefined) {
            counts[s.id] = s.pending_count;
          }
        });
        setPendingRequests(counts);
        isInitialized.current = true;
      }
    } catch (err) {
      console.error('Error fetching sessions:', err);
    } finally {
      isFetching.current = false;
      setLoadingData(false);
    }
  }, [user]);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (user) {
      fetchSessions();
    }
    return () => {
      isInitialized.current = false;
    };
  }, [user, fetchSessions]);

  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel('session-updates')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'collab_members'
        },
        (payload: { eventType?: string; new?: { user_id?: string; status?: string; session_id?: string }; old?: { user_id?: string } }) => {
          console.log('pg-change received:', payload.eventType, payload);
          if (payload.new?.user_id === user.id || payload.old?.user_id === user.id) {
            fetchSessions(true);
            
            if (payload.eventType === 'UPDATE' && payload.new?.status === 'approved') {
              console.log('Showing toast for approved status');
              setToastMessage('Your join request was approved!');
              setShowToast(true);
              setTimeout(() => setShowToast(false), 3000);
            }
          } else if (payload.new?.session_id) {
            // If someone else joined/requested a session I own, refresh
            fetchSessions(true);
          }
        }
      )
      .subscribe();

    const sessionChannel = supabase
      .channel('session-inserts')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'collab_sessions',
          filter: `owner_id=eq.${user.id}`
        },
        () => {
          console.log('Session table change detected');
          fetchSessions(true);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(sessionChannel);
    };
  }, [user, fetchSessions]);

  const createSession = async () => {
    if (!newSessionName.trim()) {
      setError('Please enter a session name');
      return;
    }

    setCreating(true);
    setError('');

    try {
      const { data, error } = await supabase
        .from('collab_sessions')
        .insert({
          name: newSessionName.trim(),
          owner_id: user?.id,
          max_collaborators: 4,
          is_active: true
        })
        .select()
        .single();

      if (error) throw error;

      setSuccess('Session created successfully!');
      setShowCreateModal(false);
      setNewSessionName('');
      fetchSessions();
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to create session';
      setError(errorMessage);
    } finally {
      setCreating(false);
    }
  };

  const joinSession = async () => {
    if (!joinCode.trim()) {
      setError('Please enter an invite code');
      return;
    }

    setJoining(true);
    setError('');

    try {
      const { data, error } = await supabase
        .from('collab_members')
        .insert({
          session_id: null, // Will be resolved by invite code
          user_id: user?.id,
          role: 'collaborator',
          status: 'pending'
        })
        .select()
        .single();

      // Call the join API
      const response = await fetch('/api/collab/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inviteCode: joinCode.trim(),
          userId: user?.id,
          email: user?.email
        })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to join session');
      }

      setSuccess('Join request sent! Waiting for approval.');
      setShowJoinModal(false);
      setJoinCode('');
      fetchSessions();
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to join session';
      setError(errorMessage);
    } finally {
      setJoining(false);
    }
  };

  const copyInviteLink = (code: string) => {
    const link = `${window.location.origin}/community/join?code=${code}`;
    navigator.clipboard.writeText(link);
    setSuccess('Invite link copied!');
    setTimeout(() => setSuccess(''), 2000);
  };

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#0a0a0a]">
        <div className="w-8 h-8 border-2 border-[#3ECF8E] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      <TopBar
        onUpload={() => {}}
        onUndo={() => {}}
        onRedo={() => {}}
        canUndo={false}
        canRedo={false}
        visible={true}
      />

      <div className="pt-24 pb-12 px-6 max-w-6xl mx-auto">
        {/* Page Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">Community Sessions</h1>
            <p className="text-gray-400 max-w-lg">
              Create a collaborative workspace or join your team&apos;s existing sessions to edit and organize photos together in realtime.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowJoinModal(true)}
              className="px-4 py-2 border border-[#2a2a2a] hover:bg-[#1a1a1a] rounded-xl transition-all text-sm font-medium text-gray-300"
            >
              Join with Code
            </button>
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-5 py-2 bg-[#3ECF8E] text-black font-semibold rounded-xl hover:bg-[#35b87a] transition-all text-sm shadow-lg shadow-[#3ECF8E]/10"
            >
              Create New Session
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm flex items-center gap-3">
            <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {error}
          </div>
        )}

        {success && (
          <div className="mb-6 p-4 bg-[#3ECF8E]/10 border border-[#3ECF8E]/20 rounded-xl text-[#3ECF8E] text-sm flex items-center gap-3">
            <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            {success}
          </div>
        )}

        {loadingData ? (
          <div className="grid gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="border border-[#2a2a2a] bg-[#111] rounded-2xl p-6 animate-pulse">
                <div className="flex justify-between items-center">
                  <div className="flex-1">
                    <div className="h-6 w-48 bg-[#222] rounded mb-3" />
                    <div className="flex gap-4">
                      <div className="h-4 w-24 bg-[#222] rounded" />
                      <div className="h-4 w-24 bg-[#222] rounded" />
                    </div>
                  </div>
                  <div className="h-10 w-24 bg-[#222] rounded-xl" />
                </div>
              </div>
            ))}
          </div>
        ) : sessions.length === 0 ? (
          <div className="text-center py-24 bg-[#111] border border-[#2a2a2a] rounded-2xl">
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-[#1a1a1a] flex items-center justify-center text-gray-600">
              <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-white mb-2">No active sessions</h2>
            <p className="text-gray-500 mb-8 max-w-xs mx-auto">Start your first collaborative project by creating a session or entering an invite code.</p>
            <div className="flex items-center justify-center gap-4">
              <button
                onClick={() => setShowCreateModal(true)}
                className="px-6 py-2.5 bg-[#3ECF8E] text-black font-bold rounded-xl hover:bg-[#35b87a] transition-all"
              >
                Create Session
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-1 gap-4">
            {sessions.map((session) => {
              const isOwner = session.owner_id === user.id;
              const approvedCount = session.approved_count || 0;

              return (
                <div
                  key={session.id}
                  className="group border border-[#2a2a2a] bg-[#111] rounded-2xl p-6 hover:border-[#3ECF8E]/30 hover:bg-[#141414] transition-all duration-300 relative overflow-hidden"
                >
                  <div className="absolute top-0 left-0 w-1 h-full bg-[#3ECF8E] opacity-0 group-hover:opacity-100 transition-opacity" />
                  
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="font-bold text-xl text-white truncate">{session.name}</h3>
                        {isOwner && pendingRequests[session.id] > 0 && (
                          <span className="animate-pulse px-2.5 py-1 bg-yellow-500/20 text-yellow-400 text-[10px] font-bold uppercase tracking-wider rounded-full border border-yellow-500/20">
                            {pendingRequests[session.id]} New Request{pendingRequests[session.id] > 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                      
                      <div className="flex flex-wrap items-center gap-y-2 gap-x-4 text-sm text-gray-500">
                        {isOwner ? (
                          <div className="flex items-center gap-1.5 text-[#3ECF8E]/80 font-medium">
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M10 2a4 4 0 00-4 4v1H5a1 1 0 00-.994.89l-1 9A1 1 0 004 18h12a1 1 0 00.994-1.11l-1-9A1 1 0 0015 7h-1V6a4 4 0 00-4-4zm2 5V6a2 2 0 10-4 0v1h4zm-6 3a1 1 0 112 0 1 1 0 01-2 0zm7-1a1 1 0 100 2 1 1 0 000-2z" clipRule="evenodd" />
                            </svg>
                            Master
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                            </svg>
                            Collaborator
                          </div>
                        )}
                        <div className="flex items-center gap-1.5">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                          </svg>
                          {approvedCount}/{session.max_collaborators} Members
                        </div>
                        <div className="flex items-center gap-1.5">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          {new Date(session.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-3 sm:self-center">
                      {isOwner && (
                        <button
                          onClick={() => copyInviteLink(session.invite_code)}
                          className="p-2.5 text-gray-400 hover:text-white hover:bg-[#252525] rounded-xl transition-all border border-transparent hover:border-[#333]"
                          title="Copy invite link"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        </button>
                      )}
                      <button
                        onClick={() => router.push(`/community/${session.id}`)}
                        className="flex items-center gap-2 px-6 py-2.5 bg-[#252525] hover:bg-[#333] text-white font-medium rounded-xl transition-all border border-[#333] group-hover:border-[#3ECF8E]/50"
                      >
                        Open
                        <svg className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showCreateModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#171717] border border-[#2a2a2a] rounded-2xl p-8 w-full max-w-md shadow-2xl">
            <h2 className="text-2xl font-bold text-white mb-2">Create Session</h2>
            <p className="text-gray-400 text-sm mb-6">Give your collaborative workspace a name to get started.</p>
            
            <div className="mb-6">
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Session Name</label>
              <input
                type="text"
                autoFocus
                value={newSessionName}
                onChange={(e) => setNewSessionName(e.target.value)}
                placeholder="e.g., Summer Collection 2025"
                className="w-full px-4 py-3 bg-[#0a0a0a] border border-[#2a2a2a] rounded-xl focus:outline-none focus:border-[#3ECF8E] focus:ring-1 focus:ring-[#3ECF8E] transition-all text-white placeholder:text-gray-600"
              />
            </div>
            
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setNewSessionName('');
                  setError('');
                }}
                className="px-5 py-2.5 text-gray-400 hover:text-white font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={createSession}
                disabled={creating}
                className="px-6 py-2.5 bg-[#3ECF8E] text-black font-bold rounded-xl hover:bg-[#35b87a] transition-all disabled:opacity-50 flex items-center gap-2 shadow-lg shadow-[#3ECF8E]/10"
              >
                {creating ? (
                  <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                ) : null}
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {showJoinModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#171717] border border-[#2a2a2a] rounded-2xl p-8 w-full max-w-md shadow-2xl">
            <h2 className="text-2xl font-bold text-white mb-2">Join Session</h2>
            <p className="text-gray-400 text-sm mb-6">Enter the 8-character invite code provided by the session master.</p>
            
            <div className="mb-6">
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Invite Code</label>
              <input
                type="text"
                autoFocus
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="E.G. ABCD1234"
                className="w-full px-4 py-3 bg-[#0a0a0a] border border-[#2a2a2a] rounded-xl focus:outline-none focus:border-[#3ECF8E] focus:ring-1 focus:ring-[#3ECF8E] transition-all text-white font-mono tracking-widest text-center text-lg placeholder:text-gray-600 placeholder:font-sans placeholder:tracking-normal placeholder:text-sm"
              />
            </div>
            
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => {
                  setShowJoinModal(false);
                  setJoinCode('');
                  setError('');
                }}
                className="px-5 py-2.5 text-gray-400 hover:text-white font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={joinSession}
                disabled={joining}
                className="px-6 py-2.5 bg-[#3ECF8E] text-black font-bold rounded-xl hover:bg-[#35b87a] transition-all disabled:opacity-50 flex items-center gap-2 shadow-lg shadow-[#3ECF8E]/10"
              >
                {joining ? (
                  <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                ) : null}
                Join Session
              </button>
            </div>
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