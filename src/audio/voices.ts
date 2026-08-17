import { sameNotes } from "../music/chords.ts";
import { midiToNoteName } from "../music/theory.ts";
import type { PolyVoice } from "./instruments.ts";

export interface VoiceChange {
  attacked: number[];
  released: number[];
  changed: boolean;
}

const NO_CHANGE: VoiceChange = { attacked: [], released: [], changed: false };

/**
 * Holds the sustained chord and enforces the retrigger policy.
 *
 * The rule that makes the instrument playable: a chord is only attacked when
 * its note set actually changes. Volume, filter and tilt all modulate the
 * voices that are already sounding. A hand wobbling between three and four
 * fingers must never machine-gun the same chord.
 *
 * Changes are applied as a delta rather than release-everything-then-attack,
 * so common tones between two chords ring through the transition instead of
 * being re-struck.
 */
export class ChordVoices {
  private held: number[] = [];

  constructor(private synth: PolyVoice) {}

  /**
   * Swap the instrument the chord plays on.
   *
   * Releases everything on the outgoing voice first: notes held by a synth
   * that is no longer being addressed would ring forever.
   */
  setVoice(next: PolyVoice): number[] {
    if (next === this.synth) return [];
    const wasHolding = this.held;
    if (wasHolding.length) this.synth.triggerRelease(wasHolding.map(midiToNoteName));
    this.synth.releaseAll();
    this.synth = next;
    this.held = [];
    return wasHolding;
  }

  get current(): readonly number[] {
    return this.held;
  }

  /** @returns what actually changed, so callers can measure latency and
   *  drive the bass/arp off real attacks rather than off gesture frames. */
  set(notes: readonly number[], velocity = 0.8): VoiceChange {
    if (sameNotes(this.held, notes)) return NO_CHANGE;

    const next = [...notes];
    const released = this.held.filter((n) => !next.includes(n));
    const attacked = next.filter((n) => !this.held.includes(n));

    if (released.length) {
      this.synth.triggerRelease(released.map(midiToNoteName));
    }
    if (attacked.length) {
      this.synth.triggerAttack(attacked.map(midiToNoteName), undefined, velocity);
    }

    this.held = next;
    return { attacked, released, changed: true };
  }

  /** Silence without forgetting anything else -- the fist gesture. */
  releaseAll(): VoiceChange {
    if (this.held.length === 0) return NO_CHANGE;
    const released = this.held;
    this.synth.triggerRelease(released.map(midiToNoteName));
    this.held = [];
    return { attacked: [], released, changed: true };
  }

  /** Belt and braces for mode changes: drop every voice the synth knows
   *  about, including any the delta bookkeeping may have lost track of. */
  panic(): void {
    this.held = [];
    this.synth.releaseAll();
  }
}
