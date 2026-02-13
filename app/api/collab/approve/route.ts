import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

// POST /api/collab/approve - Approve or reject a join request (master only)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { memberId, userId, action } = body; // action: 'approve' | 'reject' | 'remove'

    if (!memberId || !userId || !action) {
      return NextResponse.json(
        { error: "Missing required fields: memberId, userId, action" },
        { status: 400 },
      );
    }

    if (!["approve", "reject", "remove"].includes(action)) {
      return NextResponse.json(
        { error: "Invalid action. Must be: approve, reject, or remove" },
        { status: 400 },
      );
    }

    // Get member info with session details
    const { data: member, error: memberError } = await supabase
      .from("collab_members")
      .select(
        `
        *,
        session:collab_sessions (
          id,
          owner_id,
          name,
          max_collaborators
        )
      `,
      )
      .eq("id", memberId)
      .single();

    if (memberError || !member) {
      return NextResponse.json(
        { error: "Member request not found" },
        { status: 404 },
      );
    }

    // Verify the requester is the session owner
    if (member.session.owner_id !== userId) {
      return NextResponse.json(
        { error: "Only the session owner can approve or reject requests" },
        { status: 403 },
      );
    }

    // Cannot approve/reject master
    if (member.role === "master") {
      return NextResponse.json(
        { error: "Cannot modify the master user" },
        { status: 400 },
      );
    }

    let newStatus: "approved" | "rejected" | "removed";
    if (action === "approve") {
      // Check if session is full
      const { count } = await supabase
        .from("collab_members")
        .select("id", { count: "exact" })
        .eq("session_id", member.session_id)
        .eq("status", "approved");

      if (count !== null && count >= member.session.max_collaborators) {
        return NextResponse.json({ error: "Session is full" }, { status: 400 });
      }
      newStatus = "approved";
    } else if (action === "reject") {
      newStatus = "rejected";
    } else {
      newStatus = "removed";
    }

    const { data: updatedMember, error } = await supabase
      .from("collab_members")
      .update({
        status: newStatus,
        approved_at: action === "approve" ? new Date().toISOString() : null,
        joined_at: action === "approve" ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", memberId)
      .select()
      .single();

    if (error) {
      console.error("Error updating member status:", error);
      return NextResponse.json(
        { error: "Failed to update request", details: error.message },
        { status: 500 },
      );
    }

    // Log activity
    if (action === "approve") {
      await supabase.from("collab_activity").insert({
        session_id: member.session_id,
        user_id: userId,
        action: "member_joined",
        target_type: "member",
        target_id: memberId,
        metadata: {
          joined_user_id: member.user_id,
          status: "approved",
        },
      });
    }

    return NextResponse.json({
      success: true,
      member: updatedMember,
      action,
    });
  } catch (error) {
    console.error("Approve/reject error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// POST /api/collab/leave - Leave a session (member only)
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("sessionId");
    const userId = searchParams.get("userId");

    if (!sessionId || !userId) {
      return NextResponse.json(
        { error: "Missing required fields: sessionId, userId" },
        { status: 400 },
      );
    }

    // Find the member record
    const { data: member, error: memberError } = await supabase
      .from("collab_members")
      .select("id, role, session_id, user_id")
      .eq("session_id", sessionId)
      .eq("user_id", userId)
      .single();

    if (memberError || !member) {
      return NextResponse.json(
        { error: "You are not a member of this session" },
        { status: 404 },
      );
    }

    if (member.role === "master") {
      return NextResponse.json(
        {
          error:
            "Masters cannot leave their own session. Delete the session instead.",
        },
        { status: 400 },
      );
    }

    // Remove member
    const { error } = await supabase
      .from("collab_members")
      .delete()
      .eq("id", member.id);

    if (error) {
      console.error("Error leaving session:", error);
      return NextResponse.json(
        { error: "Failed to leave session", details: error.message },
        { status: 500 },
      );
    }

    // Log activity
    await supabase.from("collab_activity").insert({
      session_id: sessionId,
      user_id: userId,
      action: "member_left",
      target_type: "member",
      target_id: member.id,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Leave session error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
