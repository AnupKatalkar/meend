/** Shared vision-layer types. Nothing here imports MediaPipe, so the pure
 *  geometry/classification code stays unit-testable without a camera. */

export interface Point {
  x: number;
  y: number;
  z: number;
}

/** Which musical job a hand is doing. Every module downstream of
 *  `HandTracker` speaks in roles, never in MediaPipe's raw "Left"/"Right"
 *  labels -- see vision/HandTracker.ts for the single conversion point. */
export type HandRole = "harmony" | "expression";

export type FingerName = "thumb" | "index" | "middle" | "ring" | "pinky";

/** Per-finger extension booleans, in thumb-to-pinky order. */
export interface FingerState {
  thumb: boolean;
  index: boolean;
  middle: boolean;
  ring: boolean;
  pinky: boolean;
}

/** One hand, one frame, fully derived. Instances are pooled and mutated in
 *  place by the tracker -- do not retain a reference across frames. */
export interface HandFrame {
  role: HandRole;
  present: boolean;
  /** 21 landmarks, normalized to [0,1] with y increasing downward. */
  landmarks: Point[];
  fingers: FingerState;
  /** How many of the five fingers read as extended, 0-5. */
  fingerCount: number;
  /** Wrist tilt away from vertical, mapped to [-1,1]. Negative = tilted left. */
  tilt: number;
  /** Vertical position of the hand, 0 at the bottom of frame, 1 at the top. */
  height: number;
  /** Thumb-tip to index-tip distance, normalized by palm length. */
  pinch: number;
  /** Wrist-to-middle-MCP distance; proxy for how close the user is sitting. */
  palmSize: number;
  /** MediaPipe's detection confidence for this hand. */
  score: number;
}

/** Snapshot handed to a play mode once per frame. */
export interface VisionFrame {
  harmony: HandFrame;
  expression: HandFrame;
  /** Milliseconds, from `performance.now()`, when the frame was captured. */
  timestamp: number;
  /** Seconds since the previous frame, clamped to something sane. */
  dt: number;
}

/** What the harmony hand resolved to after debouncing. */
export interface GestureState {
  /** Scale degree 1-7, or null for mute / no hand. */
  degree: number | null;
  /** Set when the harmony hand is a closed fist, as opposed to absent. */
  muted: boolean;
}
