import type { AudioEngine } from "../audio/AudioEngine.ts";
import type { Settings } from "../state/store.ts";
import type { VisionFrame } from "../vision/types.ts";

/** Pushed to React when the sounding chord changes -- a rare, discrete event,
 *  unlike the per-frame data which never touches React. */
export interface ChordReadout {
  chordName: string;
  romanLabel: string;
}

export interface ModeContext {
  audio: AudioEngine;
  settings: Settings;
  frame: VisionFrame;
  /** Call only when the readout actually changed. */
  publish: (readout: ChordReadout) => void;
}

/**
 * A play mode owns its own filters and debouncers. Switching modes calls
 * `reset()` and panics the audio engine, so no state -- and no stuck note --
 * survives a transition.
 */
export interface PlayModeHandler {
  readonly id: string;
  update(ctx: ModeContext): void;
  reset(): void;
}
