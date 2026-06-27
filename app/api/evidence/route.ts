import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const form = await req.formData();
    const file = form.get("file");

    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "missing file" }, { status: 400 });
    }

    const cameraId = String(form.get("cameraId") ?? "webcam").replace(/[^\w-]/g, "");
    const type = String(form.get("type") ?? "detection").replace(/[^\w-]/g, "");
    const confidence = String(form.get("confidence") ?? "0").replace(/[^\d.]/g, "");

    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const evidenceDir = path.join(process.cwd(), "evidence");
    await mkdir(evidenceDir, { recursive: true });

    const filename = `${ts}_${cameraId}_${type}_${confidence}.jpg`;
    const filepath = path.join(evidenceDir, filename);
    const bytes = Buffer.from(await file.arrayBuffer());
    await writeFile(filepath, bytes);

    return NextResponse.json({ saved: `evidence/${filename}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : "save failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
