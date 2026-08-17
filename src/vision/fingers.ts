import { FINGER_JOINTS, LM, clamp, dist, palmLength } from "./landmarks.ts";
import type { FingerState, Point } from "./types.ts";

/**
 * Thresholds live here rather than inline so the dev panel can tune them
 * against real footage without a rebuild. Defaults come from the spec; both
 * were sanity-checked against the synthetic fixtures in fingers.test.ts.
 */
export interface FingerThresholds {
  /** Tip must be this much farther from the wrist than the PIP joint. */
  extensionRatio: number;
  /** Thumb equivalent, measured against the pinky MCP instead of the wrist. */
  thumbRatio: number;
  /** Normalized thumb-tip/index-tip distance below which a pinch registers. */
  pinchThreshold: number;
}

export const DEFAULT_THRESHOLDS: FingerThresholds = {
  extensionRatio: 1.15,
  thumbRatio: 1.15,
  pinchThreshold: 0.42,
};

/**
 * A finger is extended when its tip sits meaningfully farther from the wrist
 * than its PIP joint does. The naive `tip.y < pip.y` test breaks the moment
 * the hand rotates; this one holds at any hand orientation because it only
 * uses distances, never screen-space direction.
 */
export function isFingerExtended(
  lm: Point[],
  finger: Exclude<keyof FingerState, "thumb">,
  ratio: number,
): boolean {
  const { tip, pip } = FINGER_JOINTS[finger];
  const wrist = lm[LM.WRIST];
  return dist(lm[tip], wrist) > dist(lm[pip], wrist) * ratio;
}

/**
 * The thumb abducts sideways instead of curling, so the wrist-distance test
 * misreads it: a folded thumb still sits far from the wrist. Measuring against
 * the pinky MCP works because an extended thumb swings away from the palm
 * while a folded one collapses toward it.
 */
export function isThumbExtended(lm: Point[], ratio: number): boolean {
  const anchor = lm[LM.PINKY_MCP];
  return dist(lm[LM.THUMB_TIP], anchor) > dist(lm[LM.THUMB_IP], anchor) * ratio;
}

export function classifyFingers(lm: Point[], t: FingerThresholds = DEFAULT_THRESHOLDS): FingerState {
  return {
    thumb: isThumbExtended(lm, t.thumbRatio),
    index: isFingerExtended(lm, "index", t.extensionRatio),
    middle: isFingerExtended(lm, "middle", t.extensionRatio),
    ring: isFingerExtended(lm, "ring", t.extensionRatio),
    pinky: isFingerExtended(lm, "pinky", t.extensionRatio),
  };
}

export function countFingers(f: FingerState): number {
  return (+f.thumb + +f.index + +f.middle + +f.ring + +f.pinky) | 0;
}

/**
 * Wrist tilt: the angle of the wrist -> middle-MCP vector away from vertical.
 * Returns radians, 0 upright, negative tilted left.
 */
export function wristTiltRadians(lm: Point[]): number {
  const wrist = lm[LM.WRIST];
  const mid = lm[LM.MIDDLE_MCP];
  return Math.atan2(mid.x - wrist.x, wrist.y - mid.y);
}

/** Usable tilt range. Past this the landmarks get unreliable anyway. */
export const MAX_TILT_RAD = (50 * Math.PI) / 180;

/** Wrist tilt normalized to [-1,1] across the usable +/-50 degree range. */
export function wristTilt(lm: Point[]): number {
  return clamp(wristTiltRadians(lm) / MAX_TILT_RAD, -1, 1);
}

/**
 * Thumb-tip to index-tip distance over palm length. Normalizing means the
 * pinch threshold holds whether the user is close to the camera or far.
 */
export function pinchDistance(lm: Point[]): number {
  const palm = palmLength(lm);
  if (palm <= 1e-6) return Number.POSITIVE_INFINITY;
  return dist(lm[LM.THUMB_TIP], lm[LM.INDEX_TIP]) / palm;
}

/**
 * Hand height as 0 at the bottom of frame, 1 at the top. Landmark y increases
 * downward, so this is inverted. Measured at the middle MCP rather than the
 * wrist: the wrist leaves frame first when the user raises a hand.
 */
export function handHeight(lm: Point[]): number {
  return clamp(1 - lm[LM.MIDDLE_MCP].y, 0, 1);
}

/**
 * Harmony-hand gesture -> scale degree, per the spec's table.
 *
 * Order matters. The exact vi (index+pinky) and vii (index+pinky+thumb) combos
 * are tested before the plain finger counts, otherwise index+pinky falls
 * through to "any 2 fingers" and reads as ii.
 *
 * Returns 1-7 for a degree, 0 for a closed fist (mute), null if unclassifiable.
 */
export function classifyDegree(f: FingerState): number | null {
  const { thumb, index, middle, ring, pinky } = f;

  // vi: index + pinky only -- the "horns".
  if (index && pinky && !middle && !ring && !thumb) return 6;
  // vii: the horns plus thumb.
  if (index && pinky && thumb && !middle && !ring) return 7;

  const count = countFingers(f);
  if (count === 0) return 0; // closed fist -> mute
  if (count >= 1 && count <= 5) return count; // 1..5 -> I ii iii IV V
  return null;
}
