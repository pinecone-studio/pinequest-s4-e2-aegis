import { NextRequest, NextResponse } from "next/server";

// Gemini vision detection proxy. Keeps GEMINI_API_KEY server-side; the browser
// never sees it. POST either:
//   { image }    — a single JPEG (base64 / data URL), or
//   { images }   — an ordered burst of JPEGs (oldest first), so Gemini can judge
//                  littering as an ACTION across frames, not a single still.
// Get back:
//   { detections: [{ label, confidence, box:[x1,y1,x2,y2] }], summary }
//
// Returns the app's Detection contract directly (Cigarette/Vape/Litter/Person,
// normalized 0-1 boxes) so the webcam tile can render boxes + the AI summary.

const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const ENDPOINT = (model: string, key: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

const PROMPT = `You are a surveillance vision system that monitors for SMOKING and LITTERING. Look at this single frame and report:
- "Cigarette": a cigarette held in a hand or at the mouth, lit or unlit.
- "Vape": an e-cigarette / vape pen / pod / box mod held near the mouth or hand.
- "Litter": a bottle, can, cup, wrapper, bag, or plastic item being held about to be dropped, mid-drop, or already lying discarded.
- "Person": each visible person (secondary — context only).

Be conservative: only report a Cigarette/Vape/Litter when you can CLEARLY see it. A hand near the face, a finger, a phone, a pen, jewelry, or fast movement (e.g. dancing) is NOT a cigarette — do not report one unless an actual cigarette/vape is visible. When in doubt, do NOT report it. Only assign confidence above 0.7 when you are genuinely confident.

Respond with STRICT JSON of this exact shape, no markdown:
{"summary":"one short sentence describing what you see and whether anything is illegal","detections":[{"label":"Cigarette|Vape|Litter|Person","confidence":0.0-1.0,"box":[x_min,y_min,x_max,y_max]}]}

The "summary" is always required — describe the scene in plain language (e.g. "A person standing, no smoking or littering"). Coordinates are normalized 0.0-1.0, origin at top-left. If nothing notable is present, return {"summary":"...","detections":[]}.`;

// Multi-frame prompt: the frames are an ordered burst from ONE camera, so the
// model can reason about actions over time — crucial for littering, which is a
// drop/abandon event, not a single-frame "is there trash" question.
const PROMPT_TEMPORAL = `You are a surveillance vision system monitoring for SMOKING and LITTERING. You are given SEVERAL frames from the SAME fixed camera, in time order (oldest first), roughly half a second apart. Use the SEQUENCE — how things change between frames — to judge actions over time.

Report:
- "Cigarette": a cigarette held in a hand or at the mouth, lit or unlit.
- "Vape": an e-cigarette / vape pen / pod / box mod held near the mouth or hand.
- "Litter": LITTERING AS AN ACTION — across the frames a person carries or holds an object (bottle, can, cup, wrapper, bag, plastic item) and then DROPS or DISCARDS it and leaves it behind. Also report an item clearly already lying discarded on the ground. Someone simply holding or carrying a bottle, with no drop, is NOT littering — do not report it.
- "Person": each visible person (secondary — context only).

Be conservative: only report a Cigarette/Vape/Litter when you can CLEARLY see it. A hand near the face, a finger, a phone, a pen, jewelry, or fast movement (e.g. dancing) is NOT a cigarette — do not report one unless an actual cigarette/vape is visible. For Litter, require evidence of the drop/abandon across frames, or an item plainly discarded on the ground. When in doubt, do NOT report it. Only assign confidence above 0.7 when you are genuinely confident.

Base all "box" coordinates on the LAST (most recent) frame.

Respond with STRICT JSON of this exact shape, no markdown:
{"summary":"one short sentence describing what happened across the frames and whether anything is illegal","detections":[{"label":"Cigarette|Vape|Litter|Person","confidence":0.0-1.0,"box":[x_min,y_min,x_max,y_max]}]}

The "summary" is always required. Coordinates are normalized 0.0-1.0, origin at top-left. If nothing notable is present, return {"summary":"...","detections":[]}.`;

interface RawBox {
  label?: string;
  confidence?: number;
  box?: number[];
}

interface Detection {
  label: string;
  confidence: number;
  box: [number, number, number, number]; // x1,y1,x2,y2 normalized [0,1]
}

const VALID_LABELS = new Set(["Cigarette", "Vape", "Litter", "Person"]);
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Models are inconsistent about coordinate scale — accept 0-1, 0-100, or 0-1000. */
function normalizeScale(box: number[]): number[] {
  const max = Math.max(...box.map(Math.abs));
  if (max <= 1) return box;
  if (max <= 100) return box.map((v) => v / 100);
  return box.map((v) => v / 1000);
}

function toDetection(raw: RawBox): Detection | null {
  if (!raw || typeof raw.label !== "string" || !VALID_LABELS.has(raw.label)) return null;
  if (!Array.isArray(raw.box) || raw.box.length !== 4 || raw.box.some((v) => typeof v !== "number"))
    return null;

  const [x1, y1, x2, y2] = normalizeScale(raw.box);
  const box: [number, number, number, number] = [
    clamp01(Math.min(x1, x2)),
    clamp01(Math.min(y1, y2)),
    clamp01(Math.max(x1, x2)),
    clamp01(Math.max(y1, y2)),
  ];
  return {
    label: raw.label,
    confidence: typeof raw.confidence === "number" ? clamp01(raw.confidence) : 0.5,
    box,
  };
}

/** Pull a JSON object/array out of the model's text, tolerating code fences/prose. */
function extractJson(text: string): unknown {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.search(/[[{]/);
    const end = Math.max(cleaned.lastIndexOf("]"), cleaned.lastIndexOf("}"));
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
    return null;
  }
}

/** Strip a data-URL prefix and report the mime type for Gemini inline_data. */
function parseImage(image: string): { data: string; mimeType: string } {
  const match = /^data:(image\/[a-zA-Z+]+);base64,([\s\S]*)$/.exec(image);
  if (match) return { mimeType: match[1], data: match[2] };
  return { mimeType: "image/jpeg", data: image };
}

const apiKey = () => process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";

/** Health check — confirms the key is configured before the UI relies on it. */
export async function GET(): Promise<NextResponse> {
  if (!apiKey()) {
    return NextResponse.json({ error: "GEMINI_API_KEY is not set on the server" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, model: MODEL });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const key = apiKey();
  if (!key) {
    return NextResponse.json({ error: "GEMINI_API_KEY is not set" }, { status: 500 });
  }

  const MAX_FRAMES = 8; // cap payload size — Gemini gets plenty of signal from a few
  let images: string[];
  try {
    const body = await req.json();
    if (Array.isArray(body.images) && body.images.length > 0) {
      images = body.images.map((i: unknown) => String(i ?? "")).filter(Boolean);
    } else if (body.image) {
      images = [String(body.image)];
    } else {
      throw new Error("missing image");
    }
    if (images.length === 0) throw new Error("missing image");
    images = images.slice(0, MAX_FRAMES);
  } catch {
    return NextResponse.json({ error: "invalid request body" }, { status: 400 });
  }

  // One image -> single-frame prompt; a burst -> temporal prompt (action over time).
  const isTemporal = images.length > 1;
  const parts: Array<Record<string, unknown>> = [
    { text: isTemporal ? PROMPT_TEMPORAL : PROMPT },
  ];
  for (const img of images) {
    const { data, mimeType } = parseImage(img);
    parts.push({ inline_data: { mime_type: mimeType, data } });
  }

  const requestBody = JSON.stringify({
    contents: [{ parts }],
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json",
    },
  });

  // Gemini occasionally returns 503 (overloaded) / 429 (rate) under load — these
  // are transient, so retry a couple of times with a short backoff before giving up.
  const RETRY_STATUSES = new Set([429, 503]);
  const MAX_ATTEMPTS = 3;

  try {
    let res: Response | null = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      res = await fetch(ENDPOINT(MODEL, key), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody,
      });
      if (res.ok || !RETRY_STATUSES.has(res.status) || attempt === MAX_ATTEMPTS) break;
      console.warn(`[gemini] ${res.status} (attempt ${attempt}/${MAX_ATTEMPTS}) — retrying`);
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
    if (!res) {
      return NextResponse.json({ error: "no response from Gemini" }, { status: 502 });
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("[gemini] error", res.status, detail.slice(0, 500));
      let message = `Gemini request failed (HTTP ${res.status})`;
      try {
        const parsed = JSON.parse(detail);
        if (parsed?.error?.message) message = parsed.error.message;
      } catch {
        /* keep generic message */
      }
      return NextResponse.json({ error: message, providerStatus: res.status }, { status: res.status });
    }

    // Gemini can return 200 with an empty/non-JSON body under load; guard the
    // parse so that becomes a clean 502 instead of an unhandled 500.
    const rawBody = await res.text();
    let payload: {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    try {
      payload = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      console.error("[gemini] non-JSON response", rawBody.slice(0, 200));
      return NextResponse.json({ error: "empty or invalid response from Gemini" }, { status: 502 });
    }

    const text: string =
      payload?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ??
      "{}";

    const parsed = extractJson(text);
    const list: RawBox[] = Array.isArray(parsed)
      ? (parsed as RawBox[])
      : Array.isArray((parsed as { detections?: RawBox[] })?.detections)
        ? (parsed as { detections: RawBox[] }).detections
        : [];

    const detections = list.map(toDetection).filter((d): d is Detection => d !== null);

    const summary =
      typeof (parsed as { summary?: unknown })?.summary === "string"
        ? ((parsed as { summary: string }).summary).slice(0, 240)
        : "";

    return NextResponse.json({ detections, summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : "detection failed";
    console.error("[gemini] error", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
