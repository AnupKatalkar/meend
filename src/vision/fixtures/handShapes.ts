/**
 * Synthetic hand landmark generator for tests and for the no-camera replay
 * mode.
 *
 * Hands are built in a canonical pose -- palm facing the camera, fingers
 * pointing up, wrist at the bottom -- then rotated, scaled and translated.
 * Because the generator applies a rigid transform, any classifier that is
 * genuinely rotation- and distance-invariant must return identical results for
 * every transform of the same shape. That property is what the tests assert.
 */
import { LM, LANDMARK_COUNT } from "../landmarks.ts";
import type { FingerState, Point } from "../types.ts";

export interface HandTransform {
  /** Radians. Positive tilts the fingertips to the player's right on screen. */
  rotation?: number;
  /** 1 = default distance from camera; 0.5 = twice as far away. */
  scale?: number;
  /** Where to put the wrist, in normalized frame coordinates. */
  wrist?: { x: number; y: number };
  /** 0 = thumb at rest, 1 = thumb tip touching the index tip. */
  pinch?: number;
}

const CANON_WRIST = { x: 0.5, y: 0.8 };

/** Metacarpal knuckle positions, and the direction each finger points. */
const FINGER_GEOMETRY = {
  index: { mcp: { x: 0.440, y: 0.635 }, dir: { x: -0.05, y: -1 }, length: 0.120 },
  middle: { mcp: { x: 0.500, y: 0.620 }, dir: { x: 0.0, y: -1 }, length: 0.115 },
  ring: { mcp: { x: 0.558, y: 0.630 }, dir: { x: 0.06, y: -1 }, length: 0.108 },
  pinky: { mcp: { x: 0.612, y: 0.655 }, dir: { x: 0.13, y: -1 }, length: 0.100 },
} as const;

const THUMB = {
  cmc: { x: 0.455, y: 0.770 },
  mcp: { x: 0.415, y: 0.730 },
  extended: { ip: { x: 0.360, y: 0.700 }, tip: { x: 0.300, y: 0.665 } },
  curled: { ip: { x: 0.420, y: 0.712 }, tip: { x: 0.458, y: 0.678 } },
} as const;

/** Toward the wrist from the knuckles; curled fingertips fold along this. */
const PALM_DIR = { x: 0, y: 1 };

function norm(v: { x: number; y: number }) {
  const m = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / m, y: v.y / m };
}

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: 0 };
}

/** Joint chain for one non-thumb finger. */
function fingerPoints(
  geom: (typeof FINGER_GEOMETRY)[keyof typeof FINGER_GEOMETRY],
  extended: boolean,
): [Point, Point, Point, Point] {
  const d = norm(geom.dir);
  const { mcp, length } = geom;
  const at = (along: number, down: number): Point => ({
    x: mcp.x + d.x * along + PALM_DIR.x * down,
    y: mcp.y + d.y * along + PALM_DIR.y * down,
    z: 0,
  });

  if (extended) {
    return [
      { x: mcp.x, y: mcp.y, z: 0 },
      at(length * 0.46, 0),
      at(length * 0.77, 0),
      at(length, 0),
    ];
  }
  // Curled: the PIP still projects from the knuckle, but the tip folds back
  // down toward the palm, ending up closer to the wrist than the PIP is.
  return [
    { x: mcp.x, y: mcp.y, z: 0 },
    at(length * 0.42, 0),
    at(length * 0.48, 0.030),
    at(length * 0.17, 0.045),
  ];
}

/** Build a full 21-point hand for the given finger extension pattern. */
export function makeHand(spec: FingerState, transform: HandTransform = {}): Point[] {
  const lm: Point[] = new Array(LANDMARK_COUNT);

  lm[LM.WRIST] = { x: CANON_WRIST.x, y: CANON_WRIST.y, z: 0 };

  const thumb = spec.thumb ? THUMB.extended : THUMB.curled;
  lm[LM.THUMB_CMC] = { ...THUMB.cmc, z: 0 };
  lm[LM.THUMB_MCP] = { ...THUMB.mcp, z: 0 };
  lm[LM.THUMB_IP] = { ...thumb.ip, z: 0 };
  lm[LM.THUMB_TIP] = { ...thumb.tip, z: 0 };

  const chains: Array<[keyof typeof FINGER_GEOMETRY, number]> = [
    ["index", LM.INDEX_MCP],
    ["middle", LM.MIDDLE_MCP],
    ["ring", LM.RING_MCP],
    ["pinky", LM.PINKY_MCP],
  ];
  for (const [name, base] of chains) {
    const pts = fingerPoints(FINGER_GEOMETRY[name], spec[name]);
    for (let i = 0; i < 4; i++) lm[base + i] = pts[i];
  }

  // Pinch drags the thumb tip toward the index tip. Applied before the rigid
  // transform so the pinch distance scales with the hand like a real one.
  if (transform.pinch && transform.pinch > 0) {
    lm[LM.THUMB_TIP] = lerp(lm[LM.THUMB_TIP], lm[LM.INDEX_TIP], Math.min(transform.pinch, 1));
    lm[LM.THUMB_IP] = lerp(lm[LM.THUMB_IP], lm[LM.INDEX_TIP], Math.min(transform.pinch, 1) * 0.45);
  }

  return applyTransform(lm, transform);
}

/** Rigid transform about the wrist, then translation. Distances from the
 *  wrist scale uniformly and angles rotate exactly -- which is the point. */
export function applyTransform(lm: Point[], t: HandTransform): Point[] {
  const rot = t.rotation ?? 0;
  const scale = t.scale ?? 1;
  const target = t.wrist ?? CANON_WRIST;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const cx = CANON_WRIST.x;
  const cy = CANON_WRIST.y;

  return lm.map((p) => {
    const dx = (p.x - cx) * scale;
    const dy = (p.y - cy) * scale;
    return {
      x: target.x + dx * cos - dy * sin,
      y: target.y + dx * sin + dy * cos,
      z: p.z,
    };
  });
}

export const FINGERS_NONE: FingerState = {
  thumb: false, index: false, middle: false, ring: false, pinky: false,
};

export function fingers(...names: Array<keyof FingerState>): FingerState {
  const out = { ...FINGERS_NONE };
  for (const n of names) out[n] = true;
  return out;
}

/** The eight harmony gestures from the spec, as named shapes. */
export const HARMONY_GESTURES = {
  fist: FINGERS_NONE,
  one: fingers("index"),
  two: fingers("index", "middle"),
  three: fingers("index", "middle", "ring"),
  four: fingers("index", "middle", "ring", "pinky"),
  five: fingers("thumb", "index", "middle", "ring", "pinky"),
  horns: fingers("index", "pinky"),
  hornsThumb: fingers("index", "pinky", "thumb"),
} as const;
