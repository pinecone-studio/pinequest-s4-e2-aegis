import { NextRequest, NextResponse } from "next/server";
import { analyzeCameraFrames } from "@/lib/geminiAnalyze";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ cameraId: string }> };

/** Dashboard Gemini analysis — only call after YOLO person-gate passes. */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { cameraId } = await context.params;
    const body = await request.json();
    const images: string[] = Array.isArray(body.images)
      ? body.images.filter((v: unknown) => typeof v === "string")
      : typeof body.image === "string"
        ? [body.image]
        : [];

    if (images.length === 0) {
      return NextResponse.json({ error: "images or image is required" }, { status: 400 });
    }

    const result = await analyzeCameraFrames(cameraId, images);
    return NextResponse.json({
      detections: result.detections,
      summary: result.summary,
      model: result.model,
      cameraId: result.cameraId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Gemini analysis failed";
    const status =
      err instanceof Error && "status" in err && typeof err.status === "number"
        ? err.status
        : 500;
    console.error("[client/api/vision]", err);
    return NextResponse.json({ error: message }, { status });
  }
}
