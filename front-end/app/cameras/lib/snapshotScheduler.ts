import { extractRtspUrlFromStreamReference } from "./rtspUtils";

export const GRID_SNAPSHOT_POLL_MS = 4000;
export const GRID_SNAPSHOT_JITTER_MS = 1000;
export const BACKGROUND_SNAPSHOT_POLL_MS = GRID_SNAPSHOT_POLL_MS;
export const BACKGROUND_SNAPSHOT_JITTER_MS = GRID_SNAPSHOT_JITTER_MS;

const QUIET_SNAPSHOT_STATUSES = new Set([401, 503]);
const QUIET_LOG_COOLDOWN_MS = 30_000;
const lastQuietLogAt = new Map<string, number>();

function handleSnapshotHttpFailure(cameraId: string, status: number): void {
  if (!QUIET_SNAPSHOT_STATUSES.has(status)) return;

  const key = `${cameraId}:${status}`;
  const now = Date.now();
  const lastLoggedAt = lastQuietLogAt.get(key) ?? 0;
  if (now - lastLoggedAt < QUIET_LOG_COOLDOWN_MS) return;

  lastQuietLogAt.set(key, now);
  const reason = status === 401 ? "unauthorized" : "offline";
  console.warn(`[Snapshot]: Camera ${cameraId} is ${reason} (${status}). Skipping...`);
}

function buildSnapshotUrl(cameraId: string, streamUrl: string): string {
  const rtspDirect = extractRtspUrlFromStreamReference(streamUrl);
  const params = new URLSearchParams({
    cameraId,
    v: String(Date.now()),
  });
  params.set("streamUrl", rtspDirect ?? streamUrl);
  return `/api/snapshot/rtsp?${params.toString()}`;
}

/** Convert a JPEG snapshot blob into a data-URL base64 string for YOLO/LitServe. */
export async function blobToBase64DataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Failed to encode snapshot as base64"));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read snapshot blob"));
    reader.readAsDataURL(blob);
  });
}

/** Fetch one RTSP snapshot and return it as `data:image/jpeg;base64,...`. */
export async function fetchSnapshotAsBase64(
  cameraId: string,
  streamUrl: string,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const response = await fetch(buildSnapshotUrl(cameraId, streamUrl), {
      cache: "no-store",
      signal,
    });

    if (!response.ok) {
      handleSnapshotHttpFailure(cameraId, response.status);
      return null;
    }

    const blob = await response.blob();
    if (!blob.size) return null;
    return blobToBase64DataUrl(blob);
  } catch {
    return null;
  }
}
