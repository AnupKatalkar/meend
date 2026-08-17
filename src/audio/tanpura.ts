import * as Tone from "tone";
import { midiToNoteName } from "../music/theory.ts";

/**
 * Tanpura drone.
 *
 * Not a sustained pad: a real tanpura is four strings plucked in a slow,
 * endless cycle, and the sound is the overlap of their decaying tails. A held
 * chord would sit still underneath the music; this breathes, which is the
 * whole point of the instrument.
 *
 * The cycle is companion - Sa - Sa - Sa(lower). The companion string is
 * usually Pa, but the raga decides -- see `tanpuraCompanion`.
 *
 * Karplus-Strong gives a plucked string with the right kind of shimmer for
 * far less than a sampled tanpura would cost to ship.
 */
export class Tanpura {
  private readonly pluck: Tone.PluckSynth;
  private readonly gain: Tone.Gain;
  private readonly loop: Tone.Loop;

  /** MIDI notes of the four strings, in the order they are plucked. */
  private strings: number[] = [];
  private step = 0;
  private enabled = false;

  constructor(destination: Tone.InputNode) {
    this.gain = new Tone.Gain(0);
    this.gain.connect(destination);

    this.pluck = new Tone.PluckSynth({
      attackNoise: 0.9,
      // Low dampening keeps the tail long, so strings overlap the way they do
      // on the real instrument.
      dampening: 1800,
      resonance: 0.96,
      release: 2.2,
    });
    this.pluck.connect(this.gain);

    // Interval is set from the tempo in `configure`; the cycle is deliberately
    // slow and independent of the tala.
    this.loop = new Tone.Loop((time) => this.pluckNext(time), 1.1);
  }

  private pluckNext(time: number): void {
    if (this.strings.length === 0) return;
    const note = this.strings[this.step % this.strings.length];
    this.step++;
    // PluckSynth has no velocity input, so the cycle's emphasis comes from
    // resonance instead: the Sa strings ring a touch longer than the rest.
    this.pluck.resonance = this.step % this.strings.length === 1 ? 0.97 : 0.94;
    this.pluck.triggerAttack(midiToNoteName(note), time);
  }

  /**
   * @param saMidi   MIDI note of Sa
   * @param companion semitones above Sa for the first string (usually Pa)
   */
  tune(saMidi: number, companion: number): void {
    // The companion sits below Sa, as it does on the instrument, and the last
    // string drops an octave to anchor the bottom.
    const next = [saMidi + companion - 12, saMidi, saMidi, saMidi - 12];
    if (next.length === this.strings.length && next.every((n, i) => n === this.strings[i])) {
      return;
    }
    this.strings = next;
  }

  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    if (on) {
      this.step = 0;
      this.loop.start(0);
    } else {
      this.loop.stop();
    }
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  setVolume(v: number): void {
    this.gain.gain.rampTo(Math.max(0, Math.min(v, 1)) * 0.55, 0.3);
  }

  /** Seconds between plucks. Slower for meditative ragas, faster for light. */
  setPace(seconds: number): void {
    this.loop.interval = Math.max(0.3, Math.min(seconds, 3));
  }

  dispose(): void {
    this.loop.stop();
    this.loop.dispose();
    this.pluck.dispose();
    this.gain.dispose();
  }
}
