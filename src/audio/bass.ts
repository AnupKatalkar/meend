import * as Tone from "tone";
import { midiToNoteName } from "../music/theory.ts";

/** Lowest note the bass will play; below this it is mud on small speakers. */
const BASS_FLOOR = 24; // C1

/**
 * Auto bass: the chord root, two octaves below the chord voicing, on its own
 * mono synth with its own volume. Retriggers on chord change only.
 */
export class BassVoice {
  private readonly synth: Tone.MonoSynth;
  private readonly gain: Tone.Gain;
  private currentRoot: number | null = null;
  private enabled = false;

  constructor(destination: Tone.InputNode) {
    this.gain = new Tone.Gain(0.6);
    this.synth = new Tone.MonoSynth({
      oscillator: { type: "triangle" },
      envelope: { attack: 0.02, decay: 0.25, sustain: 0.6, release: 0.4 },
      filter: { type: "lowpass", rolloff: -24, Q: 1 },
      filterEnvelope: {
        attack: 0.02,
        decay: 0.3,
        sustain: 0.4,
        release: 0.6,
        baseFrequency: 90,
        octaves: 2.2,
      },
    });
    this.synth.connect(this.gain);
    this.gain.connect(destination);
  }

  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    if (!on) this.release();
    else if (this.currentRoot !== null) this.attack(this.currentRoot);
  }

  setVolume(v: number): void {
    this.gain.gain.rampTo(Math.max(0, Math.min(v, 1)), 0.05);
  }

  /** @param root MIDI note of the chord root, or null to stop. */
  setRoot(root: number | null): void {
    if (root === this.currentRoot) return;
    this.currentRoot = root;
    if (!this.enabled) return;
    if (root === null) this.release();
    else this.attack(root);
  }

  private attack(root: number): void {
    const note = Math.max(root - 24, BASS_FLOOR);
    this.synth.triggerAttack(midiToNoteName(note));
  }

  private release(): void {
    this.synth.triggerRelease();
  }

  panic(): void {
    this.currentRoot = null;
    this.synth.triggerRelease();
  }

  dispose(): void {
    this.synth.dispose();
    this.gain.dispose();
  }
}
