import * as Tone from "tone";
import { midiToNoteName } from "../music/theory.ts";
import type { PolyVoice } from "./instruments.ts";
import type { ArpRate } from "../state/store.ts";

/** Note rate per setting, against the transport BPM. */
const RATE_INTERVAL: Record<Exclude<ArpRate, "off">, string> = {
  slow: "4n",
  normal: "8n",
  fast: "16n",
};

/**
 * Cycles the current chord's notes upward.
 *
 * The loop reads the chord through a callback on every tick rather than
 * scheduling a fixed pattern, so changing chord takes effect on the next tick
 * without tearing down and rebuilding the loop -- rebuilding mid-bar is what
 * makes arpeggiators stutter when you change chord.
 */
export class Arpeggiator {
  private readonly loop: Tone.Loop;
  private step = 0;
  private rate: ArpRate = "off";

  constructor(
    private readonly getSynth: () => PolyVoice,
    private readonly getChord: () => readonly number[],
  ) {
    this.loop = new Tone.Loop((time) => this.tick(time), RATE_INTERVAL.normal);
  }

  get active(): boolean {
    return this.rate !== "off";
  }

  private tick(time: number): void {
    const chord = this.getChord();
    if (chord.length === 0) return;
    const note = chord[this.step % chord.length];
    this.step++;
    // Short, so successive steps articulate instead of blurring together.
    this.getSynth().triggerAttackRelease(midiToNoteName(note), "16n", time, 0.8);
  }

  setRate(rate: ArpRate): void {
    if (rate === this.rate) return;
    this.rate = rate;
    if (rate === "off") {
      this.loop.stop();
      return;
    }
    this.loop.interval = RATE_INTERVAL[rate];
    // Restart the cycle from the bottom of the chord so a rate change lands
    // on a predictable note rather than wherever the old cycle happened to be.
    this.step = 0;
    this.loop.start(0);
  }

  dispose(): void {
    this.loop.stop();
    this.loop.dispose();
  }
}
