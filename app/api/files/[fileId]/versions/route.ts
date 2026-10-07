// GET /api/files/[fileId]/versions
// Returns the full version history for a file the current user owns.
// Used by the version-history drawer on the Files page.

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { getFileVersions } from "@/lib/vaultStore";

interface RouteParams {
  params: Promise<{ fileId: string }>;
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { fileId } = await params;
  try {
    const versions = await getFileVersions(fileId, session.sub, session.address);
    return NextResponse.json({ versions });
  } catch (err) {
    console.warn("[api/files/versions/GET] Error:", (err as Error).message);
    return NextResponse.json({ versions: [] });
  }
}
