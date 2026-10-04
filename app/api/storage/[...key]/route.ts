// app/api/storage/[...key]/route.ts
// Serves ciphertext blobs in development / local storage mode.
// Only accessible for encrypted ciphertext blobs under .storage/

import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { Readable } from "stream";

const LOCAL_STORAGE_DIR = path.resolve(process.cwd(), ".storage");

interface RouteParams {
  params: Promise<{ key: string[] }>;
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  const { key } = await params;
  const keyPath = key.join("/");

  // Prevent path traversal
  const fullPath = path.resolve(LOCAL_STORAGE_DIR, keyPath);
  if (!fullPath.startsWith(LOCAL_STORAGE_DIR)) {
    return NextResponse.json({ error: "Invalid storage path." }, { status: 400 });
  }

  if (!fs.existsSync(fullPath)) {
    return NextResponse.json({ error: "Object not found." }, { status: 404 });
  }

  const stat = fs.statSync(fullPath);
  const nodeStream = fs.createReadStream(fullPath);
  const webStream = Readable.toWeb(nodeStream);

  return new Response(webStream as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(stat.size),
      "Cache-Control": "private, max-age=300",
    },
  });
}
