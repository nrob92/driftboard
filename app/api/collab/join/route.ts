import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// POST /api/collab/join - Request to join a session
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { inviteCode, userId, email } = body;

    if (!inviteCode || !userId) {
      return NextResponse.json(
        { error: 'Missing required fields: inviteCode, userId' },
        { status: 400 }
      );
    }

    // Find the session by invite code
    const { data: session, error: sessionError } = await supabase
      .from('collab_sessions')
      .select('id, name, owner_id, is_active, max_collaborators')
      .eq('invite_code', inviteCode.toUpperCase())
      .single();

    if (sessionError || !session) {
      return NextResponse.json({ error: 'Invalid invite code' }, { status: 404 });
    }

    if (!session.is_active) {
      return NextResponse.json({ error: 'This session is no longer active' }, { status: 400 });
    }

    // Check if user is already a member
    const { data: existingMember } = await supabase
      .from('collab_members')
      .select('id, status')
      .eq('session_id', session.id)
      .eq('user_id', userId)
      .single();

    if (existingMember) {
      if (existingMember.status === 'approved') {
        return NextResponse.json({ error: 'You are already a member' }, { status: 400 });
      }
      if (existingMember.status === 'pending') {
        return NextResponse.json({ error: 'Request already pending' }, { status: 400 });
      }
      if (existingMember.status === 'rejected' || existingMember.status === 'removed') {
        // Allow re-apply by updating the existing record
        await supabase
          .from('collab_members')
          .update({ status: 'pending', invited_email: email, updated_at: new Date().toISOString() })
          .eq('id', existingMember.id);
        return NextResponse.json({ message: 'Request submitted', sessionId: session.id });
      }
    }

    // Check if session is full
    const { count } = await supabase
      .from('collab_members')
      .select('id', { count: 'exact' })
      .eq('session_id', session.id)
      .eq('status', 'approved');

    if (count !== null && count >= session.max_collaborators) {
      return NextResponse.json({ error: 'Session is full' }, { status: 400 });
    }

    // Create join request
    const { data: member, error } = await supabase
      .from('collab_members')
      .insert({
        session_id: session.id,
        user_id: userId,
        role: 'collaborator',
        status: 'pending',
        invited_email: email
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating join request:', error);
      return NextResponse.json(
        { error: 'Failed to submit request', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ 
      message: 'Request submitted, waiting for approval',
      sessionId: session.id,
      sessionName: session.name
    });
  } catch (error) {
    console.error('Join session error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// GET /api/collab/join?sessionId=xxx - Get pending requests for a session (master only)
export async function GET(request: NextRequest) {
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
    const { data: session, error: sessionError } = await supabase
      .from('collab_sessions')
      .select('owner_id')
      .eq('id', sessionId)
      .single();

    if (sessionError || !session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    if (session.owner_id !== userId) {
      return NextResponse.json(
        { error: 'Only the session owner can view requests' },
        { status: 403 }
      );
    }

    // Get pending requests with user info
    const { data: pendingRequests, error } = await supabase
      .from('collab_members')
      .select(`
        id,
        user_id,
        invited_email,
        created_at
      `)
      .eq('session_id', sessionId)
      .eq('status', 'pending');

    if (error) {
      console.error('Error fetching pending requests:', error);
      return NextResponse.json(
        { error: 'Failed to fetch requests' },
        { status: 500 }
      );
    }

    // Get user profiles for each request
    const userIds = pendingRequests?.map((r: { user_id: string }) => r.user_id).filter(Boolean) || [];
    let userProfiles: Record<string, { email: string; user_metadata: { full_name?: string } }> = {};

    if (userIds.length > 0) {
      const { data: authUsers } = await supabase.auth.admin.listUsers();
      userProfiles = authUsers.users?.reduce((acc: Record<string, { email: string; user_metadata: { full_name?: string } }>, user) => {
        acc[user.id] = { 
          email: user.email || '', 
          user_metadata: user.user_metadata || {} 
        };
        return acc;
      }, {}) || {};
    }

    const requestsWithProfiles = pendingRequests?.map((r: { id: string; user_id: string | null; invited_email: string | null; created_at: string }) => ({
      id: r.id,
      userId: r.user_id,
      email: r.invited_email || (r.user_id ? userProfiles[r.user_id]?.email : null),
      name: r.user_id ? userProfiles[r.user_id]?.user_metadata?.full_name : null,
      createdAt: r.created_at
    })) || [];

    return NextResponse.json({ requests: requestsWithProfiles });
  } catch (error) {
    console.error('Get pending requests error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}