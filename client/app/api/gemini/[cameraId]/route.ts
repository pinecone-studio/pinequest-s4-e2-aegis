import { NextRequest } from "next/server";
import { forwardToBackend } from "@/lib/backendProxy";

export const dynamic = "force-dynamic";

/** YOLO person-gate — proxied to server → LitServe models service. */
export async function GET(request: NextRequest) {
  return forwardToBackend(request);
}

export async function POST(request: NextRequest) {
  return forwardToBackend(request);
}
