import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

// GET /api/collab/folders - Get all folders in a session
export async function GET(request: NextRequest) {
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

    // Verify membership
    const { data: membership, error: membershipError } = await supabase
      .from("collab_members")
      .select("status")
      .eq("session_id", sessionId)
      .eq("user_id", userId)
      .single();

    if (membershipError || !membership) {
      return NextResponse.json(
        { error: "Not a member of this session" },
        { status: 403 },
      );
    }

    const { data: folders, error } = await supabase
      .from("collab_folders")
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching folders:", error);
      return NextResponse.json(
        { error: "Failed to fetch folders" },
        { status: 500 },
      );
    }

    return NextResponse.json({ folders: folders || [] });
  } catch (error) {
    console.error("Get folders error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// POST /api/collab/folders - Create a new folder
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      sessionId,
      userId,
      name,
      x = 0,
      y = 0,
      width = 600,
      height = 400,
      color = "#3b82f6",
      type = "folder",
      pageCount = 1,
      backgroundColor = null,
    } = body;

    if (!sessionId || !userId || !name) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    // Verify membership
    const { data: membership, error: membershipError } = await supabase
      .from("collab_members")
      .select("status")
      .eq("session_id", sessionId)
      .eq("user_id", userId)
      .single();

    if (membershipError || !membership) {
      return NextResponse.json(
        { error: "Not a member of this session" },
        { status: 403 },
      );
    }

    if (membership.status !== "approved") {
      return NextResponse.json(
        { error: "Your membership is not approved" },
        { status: 403 },
      );
    }

    const { data: folder, error } = await supabase
      .from("collab_folders")
      .insert({
        session_id: sessionId,
        user_id: userId,
        name,
        x,
        y,
        width,
        height,
        color,
        type,
        page_count: pageCount,
        background_color: backgroundColor,
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating folder:", error);
      return NextResponse.json(
        { error: "Failed to create folder", details: error.message },
        { status: 500 },
      );
    }

    // Log activity
    await supabase.from("collab_activity").insert({
      session_id: sessionId,
      user_id: userId,
      action: "folder_created",
      target_type: "folder",
      target_id: folder.id,
    });

    return NextResponse.json({ folder });
  } catch (error) {
    console.error("Create folder error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// PATCH /api/collab/folders - Update a folder
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { sessionId, userId, folderId, updates } = body;

    if (!sessionId || !userId || !folderId || !updates) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    // Verify ownership - can only update own folders
    const { data: folder, error: folderError } = await supabase
      .from("collab_folders")
      .select("user_id")
      .eq("id", folderId)
      .single();

    if (folderError || !folder) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }

    if (folder.user_id !== userId) {
      return NextResponse.json(
        { error: "You can only update your own folders" },
        { status: 403 },
      );
    }

    const { data: updatedFolder, error } = await supabase
      .from("collab_folders")
      .update(updates)
      .eq("id", folderId)
      .select()
      .single();

    if (error) {
      console.error("Error updating folder:", error);
      return NextResponse.json(
        { error: "Failed to update folder", details: error.message },
        { status: 500 },
      );
    }

    return NextResponse.json({ folder: updatedFolder });
  } catch (error) {
    console.error("Update folder error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// DELETE /api/collab/folders - Delete a folder
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("sessionId");
    const userId = searchParams.get("userId");
    const folderId = searchParams.get("folderId");

    if (!sessionId || !userId || !folderId) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    // Verify ownership - can only delete own folders
    const { data: folder, error: folderError } = await supabase
      .from("collab_folders")
      .select("id, user_id")
      .eq("id", folderId)
      .single();

    if (folderError || !folder) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }

    if (folder.user_id !== userId) {
      return NextResponse.json(
        { error: "You can only delete your own folders" },
        { status: 403 },
      );
    }

    // Delete from database (cascades to photos via RLS)
    const { error } = await supabase
      .from("collab_folders")
      .delete()
      .eq("id", folderId);

    if (error) {
      console.error("Error deleting folder:", error);
      return NextResponse.json(
        { error: "Failed to delete folder", details: error.message },
        { status: 500 },
      );
    }

    // Log activity
    await supabase.from("collab_activity").insert({
      session_id: sessionId,
      user_id: userId,
      action: "folder_deleted",
      target_type: "folder",
      target_id: folderId,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete folder error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
