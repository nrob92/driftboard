import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// GET /api/collab/session - List user's sessions
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const sessionId = searchParams.get('sessionId');

    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
    }

    // Get pending count for a specific session
    const pendingSessionId = searchParams.get('pendingSessionId') || searchParams.get('sessionId');
    if (searchParams.get('pending') === 'true' && pendingSessionId) {
      const { count, error: countError } = await supabase
        .from('collab_members')
        .select('*', { count: 'exact', head: true })
        .eq('session_id', pendingSessionId)
        .eq('status', 'pending');

      if (countError) {
        return NextResponse.json({ error: 'Failed to fetch pending count' }, { status: 500 });
      }

      return NextResponse.json({ count });
    }

    // If sessionId is provided, get specific session details
    if (sessionId) {
      const { data: session, error: sessionError } = await supabase
        .from('collab_sessions')
        .select(`
          *,
          collab_members (
            id,
            user_id,
            role,
            status,
            invited_email,
            approved_at,
            joined_at,
            created_at
          )
        `)
        .eq('id', sessionId)
        .single();

      if (sessionError) {
        return NextResponse.json({ error: 'Session not found' }, { status: 404 });
      }

      // Check if user is part of this session
      const isMember = session.collab_members?.some(
        (m: { user_id: string; status: string }) => 
          m.user_id === userId && m.status === 'approved'
      );
      const isOwner = session.owner_id === userId;

      if (!isMember && !isOwner) {
        return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
      }

      return NextResponse.json({ session });
    }

    // Get all sessions where user is owner or member
    const { data: ownedSessions, error: ownedError } = await supabase
      .from('collab_sessions')
      .select(`
        *,
        collab_members!collab_members_session_id_fkey(status)
      `)
      .eq('owner_id', userId)
      .order('created_at', { ascending: false });

    if (ownedError) {
      console.error('Error fetching owned sessions:', ownedError);
      return NextResponse.json(
        { error: 'Failed to fetch sessions' },
        { status: 500 }
      );
    }

    const { data: memberSessions, error: memberError } = await supabase
      .from('collab_members')
      .select('session_id')
      .eq('user_id', userId)
      .eq('status', 'approved');

    if (memberError) {
      console.error('Error fetching member sessions:', memberError);
      return NextResponse.json(
        { error: 'Failed to fetch sessions' },
        { status: 500 }
      );
    }

    // Attach pending counts to owned sessions
    const processedOwnedSessions = ownedSessions.map(session => {
      const pendingCount = session.collab_members?.filter((m: any) => m.status === 'pending').length || 0;
      const approvedCount = session.collab_members?.filter((m: any) => m.status === 'approved').length || 0;
      
      // Clean up the object for the response
      const { collab_members, ...sessionInfo } = session;
      return { 
        ...sessionInfo, 
        pending_count: pendingCount,
        approved_count: approvedCount 
      };
    });

    const allSessions = [...processedOwnedSessions];
    
    if (memberSessions && memberSessions.length > 0) {
      const sessionIds = memberSessions.map(m => m.session_id);
      const { data: memberSessionData } = await supabase
        .from('collab_sessions')
        .select(`
          *,
          collab_members!collab_members_session_id_fkey(status)
        `)
        .in('id', sessionIds);
      
      if (memberSessionData) {
        const processedMemberSessions = memberSessionData.map(session => {
          const approvedCount = session.collab_members?.filter((m: any) => m.status === 'approved').length || 0;
          const { collab_members, ...sessionInfo } = session;
          return { 
            ...sessionInfo, 
            approved_count: approvedCount 
          };
        });
        allSessions.push(...processedMemberSessions);
      }
    }

    // Remove duplicates
    const uniqueSessions = allSessions.filter((session, index, self) =>
      index === self.findIndex((s: { id: string }) => s.id === session.id)
    );

    return NextResponse.json({ sessions: uniqueSessions });
  } catch (error) {
    console.error('Session API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST /api/collab/session - Create new session
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, userId, maxCollaborators = 4 } = body;

    if (!name || !userId) {
      return NextResponse.json(
        { error: 'Missing required fields: name, userId' },
        { status: 400 }
      );
    }

    const { data: session, error } = await supabase
      .from('collab_sessions')
      .insert({
        name,
        owner_id: userId,
        max_collaborators: maxCollaborators,
        is_active: true
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating session:', error);
      return NextResponse.json(
        { error: 'Failed to create session', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ session });
  } catch (error) {
    console.error('Create session error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// PATCH /api/collab/session - Update session (close, rename, etc.)
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { sessionId, userId, updates } = body;

    if (!sessionId || !userId || !updates) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Verify user is the owner
    const { data: session, error: checkError } = await supabase
      .from('collab_sessions')
      .select('owner_id')
      .eq('id', sessionId)
      .single();

    if (checkError || !session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    if (session.owner_id !== userId) {
      return NextResponse.json(
        { error: 'Only the session owner can update it' },
        { status: 403 }
      );
    }

    const { data: updatedSession, error } = await supabase
      .from('collab_sessions')
      .update(updates)
      .eq('id', sessionId)
      .select()
      .single();

    if (error) {
      console.error('Error updating session:', error);
      return NextResponse.json(
        { error: 'Failed to update session', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ session: updatedSession });
  } catch (error) {
    console.error('Update session error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE /api/collab/session - Delete session
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');
    const userId = searchParams.get('userId');

    if (!sessionId || !userId) {
      return NextResponse.json(
        { error: 'Missing required fields: sessionId, userId' },
        { status: 400 }
      );
    }

    // Verify user is the owner
    const { data: session, error: checkError } = await supabase
      .from('collab_sessions')
      .select('owner_id')
      .eq('id', sessionId)
      .single();

    if (checkError || !session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    if (session.owner_id !== userId) {
      return NextResponse.json(
        { error: 'Only the session owner can delete it' },
        { status: 403 }
      );
    }

    // Delete session (cascades to all related data)
    const { error } = await supabase
      .from('collab_sessions')
      .delete()
      .eq('id', sessionId);

    if (error) {
      console.error('Error deleting session:', error);
      return NextResponse.json(
        { error: 'Failed to delete session', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete session error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}