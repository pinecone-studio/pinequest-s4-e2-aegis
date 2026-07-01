import { NextRequest } from "next/server";
import { forwardToBackend } from "@/lib/backendProxy";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ cameraId: string }> };

async function forwardYoloGate(request: NextRequest, cameraId: string) {
  return forwardToBackend(
    request,
    `/api/gemini/${encodeURIComponent(cameraId)}`,
  );
}

/** YOLO person-gate — proxied to server → LitServe models service. */
export async function GET(request: NextRequest, context: RouteContext) {
  const { cameraId } = await context.params;
  return forwardYoloGate(request, cameraId);
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { cameraId } = await context.params;
  return forwardYoloGate(request, cameraId);
}
