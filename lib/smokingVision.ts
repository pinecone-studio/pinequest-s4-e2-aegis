import { Detection } from "./yoloDecode";
import { SMOKING_MOUTH_BOX_MIN } from "./modelConfig";

type Box = [number, number, number, number];

export interface MouthRegionStats {
  solidRedRatio: number;
  uniformLightRatio: number;
  smokeLikeRatio: number;
  emberRatio: number;
  redClusterMaxRatio: number;
}

/** Sample mouth-area pixels from the live video frame (normalized person box). */
export function analyzeMouthRegion(
  video: HTMLVideoElement,
  personBox: Box,
): MouthRegionStats | null {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return null;

  const [px1, py1, px2, py2] = personBox;
  const pw = px2 - px1;
  const ph = py2 - py1;

  const x1 = Math.max(0, Math.floor((px1 + pw * 0.2) * w));
  const y1 = Math.max(0, Math.floor((py1 + ph * 0.08) * h));
  const x2 = Math.min(w, Math.ceil((px2 - pw * 0.2) * w));
  const y2 = Math.min(h, Math.ceil((py1 + ph * 0.32) * h));
  const rw = x2 - x1;
  const rh = y2 - y1;
  if (rw < 8 || rh < 8) return null;

  const canvas = document.createElement("canvas");
  canvas.width = rw;
  canvas.height = rh;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, x1, y1, rw, rh, 0, 0, rw, rh);
  const { data } = ctx.getImageData(0, 0, rw, rh);

  let solidRed = 0;
  let uniformLight = 0;
  let smokeLike = 0;
  let ember = 0;
  const total = rw * rh;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;

    // Large saturated red patch (LED, indicator light) — not a small ember.
    if (r > 170 && r > g * 1.6 && r > b * 1.6 && sat > 0.45) {
      solidRed++;
    }

    // Uniform white / pale wood toy in mouth.
    if (r > 185 && g > 175 && b > 160 && sat < 0.18) {
      uniformLight++;
    }

    // Wispy gray smoke: low saturation, mid brightness, channels roughly balanced.
    if (sat < 0.35 && max > 60 && max < 220 && Math.abs(r - g) < 35 && Math.abs(g - b) < 35) {
      smokeLike++;
    }

    // Small cigarette ember: hot orange/red point, not a broad lamp glow.
    if (r > 185 && g > 70 && g < 175 && b < 95 && sat > 0.35 && max > 120) {
      ember++;
    }
  }

  const cols = 8;
  const rows = 6;
  let redClusterMax = 0;
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      let cellRed = 0;
      let cellTotal = 0;
      const sx = Math.floor((gx / cols) * rw);
      const ex = Math.floor(((gx + 1) / cols) * rw);
      const sy = Math.floor((gy / rows) * rh);
      const ey = Math.floor(((gy + 1) / rows) * rh);
      for (let y = sy; y < ey; y++) {
        for (let x = sx; x < ex; x++) {
          const idx = (y * rw + x) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          cellTotal++;
          if (r > 170 && r > g * 1.6 && r > b * 1.6) cellRed++;
        }
      }
      if (cellTotal > 0) {
        redClusterMax = Math.max(redClusterMax, cellRed / cellTotal);
      }
    }
  }

  return {
    solidRedRatio: solidRed / total,
    uniformLightRatio: uniformLight / total,
    smokeLikeRatio: smokeLike / total,
    emberRatio: ember / total,
    redClusterMaxRatio: redClusterMax,
  };
}

/** Reject obvious non-smoking mouth visuals (toy, red lamp). */
export function isVisualFalsePositive(stats: MouthRegionStats): boolean {
  // Broad red glow covering much of the mouth area (not a tiny ember).
  if (stats.solidRedRatio > 0.22 && stats.redClusterMaxRatio > 0.65 && stats.emberRatio < 0.04) {
    return true;
  }

  // Pale uniform object (e.g. white wooden toy cigarette) with no smoke/ember.
  if (
    stats.uniformLightRatio > 0.48 &&
    stats.smokeLikeRatio < 0.08 &&
    stats.emberRatio < 0.015
  ) {
    return true;
  }

  return false;
}

export function hasSmokingVisualEvidence(stats: MouthRegionStats | null): boolean {
  if (!stats) return false;
  return stats.smokeLikeRatio > 0.07 || stats.emberRatio > 0.018;
}

/** Small smoking-model box overlapping mouth — likely ember / smoke, not a toy. */
export function hasMouthSmokingBox(
  personBox: Box,
  smokingDets: Detection[],
  minConfidence = SMOKING_MOUTH_BOX_MIN,
): boolean {
  const [px1, py1, px2, py2] = personBox;
  const pw = px2 - px1;
  const ph = py2 - py1;
  const mouth: Box = [px1 + pw * 0.15, py1 + ph * 0.05, px2 - pw * 0.15, py1 + ph * 0.32];

  return smokingDets.some((det) => {
    if (det.label !== "Smoking" || det.confidence < minConfidence) return false;
    const boxArea = (det.box[2] - det.box[0]) * (det.box[3] - det.box[1]);
    if (boxArea > 0.12) return false;
    return coverageRatio(mouth, det.box) > 0.12;
  });
}

function coverageRatio(region: Box, obj: Box): number {
  const x1 = Math.max(region[0], obj[0]);
  const y1 = Math.max(region[1], obj[1]);
  const x2 = Math.min(region[2], obj[2]);
  const y2 = Math.min(region[3], obj[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const objArea = Math.max(0, obj[2] - obj[0]) * Math.max(0, obj[3] - obj[1]);
  return objArea > 0 ? inter / objArea : 0;
}
