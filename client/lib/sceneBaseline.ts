import { FRAME_HISTORY_MS, GEMINI_BURST_FRAMES } from "./aiConfig";

type TimestampedFrame = { dataUrl: string; at: number };

const histories = new Map<string, TimestampedFrame[]>();
const baselines = new Map<string, TimestampedFrame>();

function pruneHistory(frames: TimestampedFrame[], now: number): TimestampedFrame[] {
  return frames.filter((f) => now - f.at < FRAME_HISTORY_MS);
}

/** Track snapshots for temporal litter checks (baseline = last empty scene). */
export function recordSceneFrame(
  cameraId: string,
  dataUrl: string,
  hasPerson: boolean,
): void {
  const now = Date.now();
  const history = pruneHistory(histories.get(cameraId) ?? [], now);
  history.push({ dataUrl, at: now });
  histories.set(cameraId, history);

  if (!hasPerson) {
    baselines.set(cameraId, { dataUrl, at: now });
  }
}

/** Oldest-first frame set for Gemini: empty-scene baseline + recent + current. */
export function buildGeminiFrameSet(cameraId: string, current: string): string[] {
  const ordered: string[] = [];
  const push = (url: string) => {
    if (!url || url === ordered[ordered.length - 1]) return;
    ordered.push(url);
  };

  const baseline = baselines.get(cameraId)?.dataUrl;
  if (baseline) push(baseline);

  const history = histories.get(cameraId) ?? [];
  for (const frame of history.slice(-2)) {
    push(frame.dataUrl);
  }
  push(current);

  return ordered.slice(-GEMINI_BURST_FRAMES);
}

export function hasTemporalContext(cameraId: string, current: string): boolean {
  return buildGeminiFrameSet(cameraId, current).length >= 2;
}
