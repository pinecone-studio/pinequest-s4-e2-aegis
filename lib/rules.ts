import { Detection } from "./yoloDecode";
import {
  SMOKING_MODEL_MIN,
  SMOKING_COMPOSITE_THRESHOLD,
  SMOKING_HIGH_CONFIDENCE,
  SMOKING_MOUTH_BOX_MIN,
  SMOKING_VISUAL_FP_MAX,
} from "./modelConfig";

export interface SmokingSignals {
  hasHandheldObject: boolean;
  isNearMouth: boolean;
  smokingModelScore: number;
  hasMouthSmokingBox: boolean;
  smokeLikeRatio: number;
}

export interface PersonResult {
  personBox: [number, number, number, number];
  compositeScore: number;
  signals: SmokingSignals;
}

export interface CompositeDetections {
  smokingResults: PersonResult[];
}

export interface MouthAnalysis {
  smokeLikeRatio: number;
  emberRatio: number;
  isFalsePositive: boolean;
}

const MAX_LITTER_BOX_AREA = 0.5;
const FACE_FRACTION = 0.25;
const SMOKING_CLASS = "Smoking";

type Box = [number, number, number, number];

export function getFaceBoxes(personBoxes: Box[]): Box[] {
  return personBoxes.map(([px1, py1, px2, py2]) => {
    const faceBottom = py1 + (py2 - py1) * FACE_FRACTION;
    return [px1, py1, px2, faceBottom];
  });
}

export function filterLitterByFaces(
  litterDets: Detection[],
  faceBoxes: Box[],
): Detection[] {
  return litterDets.filter((lit) => {
    if (boxArea(lit.box) > MAX_LITTER_BOX_AREA) return false;

    const cx = (lit.box[0] + lit.box[2]) / 2;
    const cy = (lit.box[1] + lit.box[3]) / 2;

    return !faceBoxes.some(([fx1, fy1, fx2, fy2]) =>
      cx >= fx1 && cx <= fx2 && cy >= fy1 && cy <= fy2,
    );
  });
}

/** Head / face — litter here is almost always a false positive. */
function isOnHead(cx: number, cy: number, person: Box): boolean {
  const [px1, py1, px2, py2] = person;
  const pw = Math.max(px2 - px1, 1e-6);
  const ph = Math.max(py2 - py1, 1e-6);
  const relX = (cx - px1) / pw;
  const relY = (cy - py1) / ph;
  return relX >= 0.12 && relX <= 0.88 && relY >= 0 && relY <= 0.34;
}

function isOnTorso(cx: number, cy: number, person: Box): boolean {
  const [px1, py1, px2, py2] = person;
  const pw = Math.max(px2 - px1, 1e-6);
  const ph = Math.max(py2 - py1, 1e-6);
  const relX = (cx - px1) / pw;
  const relY = (cy - py1) / ph;
  return relX >= 0.26 && relX <= 0.74 && relY >= 0.18 && relY <= 0.58;
}

/** Arms / hands / waist — litter here is often a real held object. */
function isLikelyHandHeldLitter(cx: number, cy: number, person: Box): boolean {
  const [px1, py1, px2, py2] = person;
  const pw = Math.max(px2 - px1, 1e-6);
  const ph = Math.max(py2 - py1, 1e-6);
  const relX = (cx - px1) / pw;
  const relY = (cy - py1) / ph;

  if (relX < 0 || relX > 1 || relY < 0 || relY > 1) return false;

  const onLeftArm = relX <= 0.3;
  const onRightArm = relX >= 0.7;
  const belowShoulder = relY >= 0.36;
  const lowerBody = relY >= 0.52;
  const frontHold = relX >= 0.22 && relX <= 0.78 && relY >= 0.5;

  return (belowShoulder && (onLeftArm || onRightArm)) || lowerBody || frontHold;
}

function litterInsidePersonBody(cx: number, cy: number, person: Box): boolean {
  const [px1, py1, px2, py2] = person;
  return cx >= px1 && cx <= px2 && cy >= py1 && cy <= py2;
}

/**
 * Drop litter on head/torso (false positives on face, shirt, hair).
 * Keep litter in hands or outside the person.
 */
export function filterLitterByPersons(
  litterDets: Detection[],
  personBoxes: Box[],
): Detection[] {
  return litterDets.filter((lit) => {
    if (boxArea(lit.box) > MAX_LITTER_BOX_AREA) return false;

    const cx = (lit.box[0] + lit.box[2]) / 2;
    const cy = (lit.box[1] + lit.box[3]) / 2;

    for (const person of personBoxes) {
      if (!litterInsidePersonBody(cx, cy, person)) continue;

      if (isLikelyHandHeldLitter(cx, cy, person)) continue;

      if (isOnHead(cx, cy, person) || isOnTorso(cx, cy, person)) {
        return false;
      }
    }

    return true;
  });
}

function boxArea(b: Box): number {
  return Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
}

function intersectionArea(a: Box, b: Box): number {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[2], b[2]);
  const y2 = Math.min(a[3], b[3]);
  return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
}

function coverageRatio(region: Box, obj: Box): number {
  const area = boxArea(obj);
  return area > 0 ? intersectionArea(region, obj) / area : 0;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function expandBox(box: Box, factor: number): Box {
  const cx = (box[0] + box[2]) / 2;
  const cy = (box[1] + box[3]) / 2;
  const w = (box[2] - box[0]) * factor;
  const h = (box[3] - box[1]) * factor;
  return [
    clamp01(cx - w / 2),
    clamp01(cy - h / 2),
    clamp01(cx + w / 2),
    clamp01(cy + h / 2),
  ];
}

function mouthSmokingBox(
  personBox: Box,
  smokingDets: Detection[],
): { found: boolean; score: number } {
  const [px1, py1, px2, py2] = personBox;
  const pw = px2 - px1;
  const ph = py2 - py1;
  const mouth: Box = [px1 + pw * 0.12, py1 + ph * 0.04, px2 - pw * 0.12, py1 + ph * 0.35];

  let best = 0;
  for (const det of smokingDets) {
    if (det.label !== SMOKING_CLASS) continue;
    if (det.confidence < SMOKING_MOUTH_BOX_MIN) continue;
    const area = boxArea(det.box);
    if (area > 0.15) continue;
    if (coverageRatio(mouth, det.box) > 0.08) {
      best = Math.max(best, det.confidence);
    }
  }
  return { found: best >= SMOKING_MOUTH_BOX_MIN, score: best };
}

function scorePersonSmoking(
  personBox: Box,
  smokingDets: Detection[],
  mouthStats: MouthAnalysis | null,
): PersonResult | null {
  let smokingModelScore = 0;
  for (const det of smokingDets) {
    if (det.label !== SMOKING_CLASS) continue;
    if (det.confidence < SMOKING_MODEL_MIN) continue;
    if (coverageRatio(personBox, det.box) > 0.08) {
      smokingModelScore = Math.max(smokingModelScore, det.confidence);
    }
  }

  if (smokingModelScore < SMOKING_MODEL_MIN) return null;

  if (
    mouthStats?.isFalsePositive &&
    smokingModelScore < SMOKING_VISUAL_FP_MAX
  ) {
    return null;
  }

  const mouthBox = mouthSmokingBox(personBox, smokingDets);
  let score = smokingModelScore;

  if (mouthBox.found) {
    score = Math.min(1, score + mouthBox.score * 0.2);
  }

  const smokeLikeRatio = mouthStats?.smokeLikeRatio ?? 0;
  const emberRatio = mouthStats?.emberRatio ?? 0;

  if (smokeLikeRatio > 0.05) {
    score = Math.min(1, score + Math.min(0.15, smokeLikeRatio * 0.35));
  }
  if (emberRatio > 0.012) {
    score = Math.min(1, score + Math.min(0.12, emberRatio * 3));
  }

  const hasVisualEvidence =
    mouthBox.found || smokeLikeRatio > 0.06 || emberRatio > 0.015;

  // Require mouth-level cue or smoke pixels unless model is very confident.
  if (!hasVisualEvidence && smokingModelScore < SMOKING_HIGH_CONFIDENCE) {
    return null;
  }

  if (score < SMOKING_COMPOSITE_THRESHOLD && smokingModelScore < SMOKING_HIGH_CONFIDENCE) {
    return null;
  }

  return {
    personBox,
    compositeScore: Math.min(1, score),
    signals: {
      hasHandheldObject: false,
      isNearMouth: false,
      smokingModelScore,
      hasMouthSmokingBox: mouthBox.found,
      smokeLikeRatio,
    },
  };
}

function smokingMatchedPerson(smokingBox: Box, personBoxes: Box[]): boolean {
  return personBoxes.some((person) => coverageRatio(person, smokingBox) > 0.08);
}

/**
 * Smoking from YOLO class-1 boxes + optional COCO person boxes.
 * Also emits direct smoking hits when COCO misses the person.
 */
export function computeCompositeDetections(
  smokingDets: Detection[],
  personBoxes: Box[],
  analyzeMouth?: (personBox: Box) => MouthAnalysis | null,
): CompositeDetections {
  const smokingResults: PersonResult[] = [];
  const usedPersons = new Set<number>();

  for (let i = 0; i < personBoxes.length; i++) {
    const personBox = personBoxes[i];
    const mouthStats = analyzeMouth?.(personBox) ?? null;
    const result = scorePersonSmoking(personBox, smokingDets, mouthStats);
    if (result) {
      smokingResults.push(result);
      usedPersons.add(i);
    }
  }

  for (const det of smokingDets) {
    if (det.label !== SMOKING_CLASS || det.confidence < SMOKING_MODEL_MIN) continue;
    if (smokingMatchedPerson(det.box, personBoxes)) continue;
    if (det.confidence < SMOKING_HIGH_CONFIDENCE) continue;

    const displayBox = expandBox(det.box, 4);
    const mouthStats = analyzeMouth?.(displayBox) ?? null;
    if (mouthStats?.isFalsePositive) continue;

    const hasCue =
      mouthStats &&
      (mouthStats.smokeLikeRatio > 0.06 || mouthStats.emberRatio > 0.015);
    if (!hasCue) continue;

    smokingResults.push({
      personBox: displayBox,
      compositeScore: det.confidence,
      signals: {
        hasHandheldObject: false,
        isNearMouth: false,
        smokingModelScore: det.confidence,
        hasMouthSmokingBox: true,
        smokeLikeRatio: mouthStats?.smokeLikeRatio ?? 0,
      },
    });
  }

  return { smokingResults };
}
