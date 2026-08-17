import type { FingerName, Point } from "./types.ts";

/**
 * MediaPipe hand landmark indices. 21 points per hand.
 *
 *   0        wrist
 *   1-4      thumb:  CMC, MCP, IP, TIP
 *   5-8      index:  MCP, PIP, DIP, TIP
 *   9-12     middle: MCP, PIP, DIP, TIP
 *   13-16    ring:   MCP, PIP, DIP, TIP
 *   17-20    pinky:  MCP, PIP, DIP, TIP
 */
export const LM = {
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_DIP: 11,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_DIP: 15,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20,
} as const;

export const LANDMARK_COUNT = 21;

/** Tip and PIP index per finger, for the wrist-distance extension test. */
export const FINGER_JOINTS: Record<FingerName, { tip: number; pip: number; mcp: number }> = {
  thumb: { tip: LM.THUMB_TIP, pip: LM.THUMB_IP, mcp: LM.THUMB_MCP },
  index: { tip: LM.INDEX_TIP, pip: LM.INDEX_PIP, mcp: LM.INDEX_MCP },
  middle: { tip: LM.MIDDLE_TIP, pip: LM.MIDDLE_PIP, mcp: LM.MIDDLE_MCP },
  ring: { tip: LM.RING_TIP, pip: LM.RING_PIP, mcp: LM.RING_MCP },
  pinky: { tip: LM.PINKY_TIP, pip: LM.PINKY_PIP, mcp: LM.PINKY_MCP },
};

export const FINGER_NAMES: readonly FingerName[] = ["thumb", "index", "middle", "ring", "pinky"];

/** The standard MediaPipe skeleton edges, used for the overlay. */
export const HAND_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  // thumb
  [0, 1], [1, 2], [2, 3], [3, 4],
  // index
  [0, 5], [5, 6], [6, 7], [7, 8],
  // middle
  [5, 9], [9, 10], [10, 11], [11, 12],
  // ring
  [9, 13], [13, 14], [14, 15], [15, 16],
  // pinky
  [13, 17], [17, 18], [18, 19], [19, 20],
  // palm base
  [0, 17],
];

/** 2D distance. z is deliberately ignored: MediaPipe's z is relative depth
 *  with a different scale to x/y, and mixing it in makes thresholds drift. */
export function dist(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

/** Wrist to middle-MCP: roughly palm length, and invariant to how far the user
 *  is sitting from the camera. Every absolute distance is divided by this. */
export function palmLength(lm: Point[]): number {
  return dist(lm[LM.WRIST], lm[LM.MIDDLE_MCP]);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Map `v` from [inLo,inHi] onto [outLo,outHi], clamped at both ends. */
export function mapRange(v: number, inLo: number, inHi: number, outLo: number, outHi: number): number {
  if (inHi === inLo) return outLo;
  const t = clamp((v - inLo) / (inHi - inLo), 0, 1);
  return outLo + t * (outHi - outLo);
}

/** Allocation-free point pool for the per-frame hot path. */
export function makeLandmarkArray(): Point[] {
  const out: Point[] = new Array(LANDMARK_COUNT);
  for (let i = 0; i < LANDMARK_COUNT; i++) out[i] = { x: 0, y: 0, z: 0 };
  return out;
}
