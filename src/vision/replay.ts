import type { Point } from "./types.ts";

/**
 * Landmark capture and playback.
 *
 * Iterating threshold constants against a live webcam is miserable: you cannot
 * reproduce a gesture exactly, so you never know whether a change helped.
 * Recording 30 seconds of landmarks once and replaying it through the whole
 * pipeline -- classification, smoothing, chord building, audio -- makes tuning
 * repeatable, and works with no camera attached.
 */

export interface ReplayHand {
  label: string;
  score: number;
  landmarks: Point[];
}

export interface ReplayFrame {
  /** Milliseconds from the start of the recording. */
  t: number;
  hands: ReplayHand[];
}

export interface ReplayClip {
  version: 1;
  /** Frames per second the clip was captured at, for reference. */
  fps: number;
  durationMs: number;
  frames: ReplayFrame[];
}

/** Captures raw landmarks into memory for later download. */
export class LandmarkRecorder {
  private frames: ReplayFrame[] = [];
  private startedAt = 0;
  private recording = false;

  get isRecording(): boolean {
    return this.recording;
  }

  get frameCount(): number {
    return this.frames.length;
  }

  start(now: number): void {
    this.frames = [];
    this.startedAt = now;
    this.recording = true;
  }

  /** Landmarks are pooled and mutated in place upstream, so this must copy. */
  capture(now: number, hands: readonly ReplayHand[]): void {
    if (!this.recording) return;
    this.frames.push({
      t: Math.round(now - this.startedAt),
      hands: hands.map((h) => ({
        label: h.label,
        score: h.score,
        landmarks: h.landmarks.map((p) => ({
          x: round(p.x),
          y: round(p.y),
          z: round(p.z),
        })),
      })),
    });
  }

  stop(): ReplayClip {
    this.recording = false;
    const durationMs = this.frames.length ? this.frames[this.frames.length - 1].t : 0;
    return {
      version: 1,
      fps: durationMs > 0 ? Math.round((this.frames.length / durationMs) * 1000) : 30,
      durationMs,
      frames: this.frames,
    };
  }
}

/** Four decimals is well below landmark noise and keeps clips small. */
function round(v: number): number {
  return Math.round(v * 10000) / 10000;
}

/** Plays a clip back on a wall clock, looping. */
export class ReplayPlayer {
  private index = 0;
  private startedAt = 0;
  private lastElapsed = 0;

  constructor(readonly clip: ReplayClip) {}

  start(now: number): void {
    this.index = 0;
    this.lastElapsed = 0;
    this.startedAt = now;
  }

  /** @returns the frame that should be showing now, or null if none is due. */
  frameAt(now: number): ReplayFrame | null {
    const frames = this.clip.frames;
    if (frames.length === 0) return null;

    const elapsed = (now - this.startedAt) % Math.max(this.clip.durationMs, 1);
    // Detect the wrap by watching the clock go backwards. Comparing against
    // `frames[this.index]` instead would read undefined once the cursor has
    // run off the end, and the clip would play exactly once and then stop.
    if (elapsed < this.lastElapsed) this.index = 0;
    this.lastElapsed = elapsed;

    let next: ReplayFrame | null = null;
    while (this.index < frames.length && frames[this.index].t <= elapsed) {
      next = frames[this.index];
      this.index++;
    }
    return next;
  }
}

export function parseClip(json: string): ReplayClip {
  const parsed = JSON.parse(json) as ReplayClip;
  if (parsed.version !== 1 || !Array.isArray(parsed.frames)) {
    throw new Error("Not a Meend landmark clip");
  }
  return parsed;
}
