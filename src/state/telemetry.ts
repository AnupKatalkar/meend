/**
 * Per-frame values that must never touch React.
 *
 * A mutable singleton, written by the rAF loop and read by whoever wants it
 * (HUD meters, dev overlay) on their own schedule. Pushing 30 fps of landmark
 * and level data through setState drops frames; this is the escape hatch.
 */
import type { HandFrame } from "../vision/types.ts";

export interface Telemetry {
  fps: number;
  /** Milliseconds spent inside detectForVideo on the last frame. */
  detectMs: number;
  /** Measured gesture-to-sound latency, ms: frame capture -> audio param set. */
  latencyMs: number;
  /** Master output level, 0..1, already smoothed for display. */
  level: number;
  /** Live expression readouts, for the HUD and dev overlay. */
  volume: number;
  cutoffHz: number;
  /** Last committed scale degree, 0 = muted, null = no hand. */
  degree: number | null;
  octaveShift: number;
  /** Set while the detector is throttled because no hands are in frame. */
  idle: boolean;
  /** Chord attacks this session. A held gesture must not increment this --
   *  it is how "one attack, not a stream of retriggers" is actually checked. */
  attacks: number;
  /** 1-based beat within the current tala cycle; 0 when not running. */
  matra: number;
  harmony: HandFrame | null;
  expression: HandFrame | null;
}

export const telemetry: Telemetry = {
  fps: 0,
  detectMs: 0,
  latencyMs: 0,
  level: 0,
  volume: 0,
  cutoffHz: 0,
  degree: null,
  octaveShift: 0,
  idle: false,
  attacks: 0,
  matra: 0,
  harmony: null,
  expression: null,
};

export function resetTelemetry(): void {
  telemetry.fps = 0;
  telemetry.detectMs = 0;
  telemetry.latencyMs = 0;
  telemetry.level = 0;
  telemetry.volume = 0;
  telemetry.cutoffHz = 0;
  telemetry.degree = null;
  telemetry.octaveShift = 0;
  telemetry.idle = false;
  telemetry.attacks = 0;
  telemetry.matra = 0;
  telemetry.harmony = null;
  telemetry.expression = null;
}
