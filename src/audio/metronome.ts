import * as Tone from "tone";
import { type Tala, beatRole } from "../music/tala.ts";
import type { ClickSound, TimeSignature } from "../state/store.ts";

/** Beats per bar and the note value one beat occupies, per time signature. */
const METER: Record<TimeSignature, { beats: number; subdivision: string; signature: [number, number] }> = {
  "4/4": { beats: 4, subdivision: "4n", signature: [4, 4] },
  "3/4": { beats: 3, subdivision: "4n", signature: [3, 4] },
  // 6/8 is counted in eighths so the accent lands where players expect it.
  "6/8": { beats: 6, subdivision: "8n", signature: [6, 8] },
};

export interface MetronomeConfig {
  bpm: number;
  timeSignature: TimeSignature;
  /** 0 = run until stopped. */
  barLimit: number;
  sound: ClickSound;
  volume: number;
  enabled: boolean;
  /** When set, the cycle is a tala and `timeSignature` is ignored. */
  tala?: Tala | null;
}

/**
 * Runs on the shared Tone transport, so the arpeggiator stays locked to it.
 * Accents beat one; optionally stops itself after a bar count.
 */
export class Metronome {
  private readonly gain: Tone.Gain;
  private readonly click: Tone.NoiseSynth;
  private readonly woodblock: Tone.MembraneSynth;
  private readonly beep: Tone.Synth;
  private readonly tabla: Tone.MembraneSynth;

  private eventId: number | null = null;
  private beat = 0;
  private bars = 0;
  private config: MetronomeConfig = {
    bpm: 100,
    timeSignature: "4/4",
    barLimit: 0,
    sound: "click",
    volume: 0.5,
    enabled: false,
  };

  /** Fired when the bar limit is reached, so the UI can untick the box. */
  onBarLimitReached: (() => void) | null = null;
  /** Fired on every beat with the 1-based position in the cycle, so the UI can
   *  show where sam is. Scheduled through Draw, never straight from audio. */
  onBeat: ((matra: number) => void) | null = null;

  constructor(destination: Tone.InputNode) {
    this.gain = new Tone.Gain(0.5);
    this.gain.connect(destination);

    this.click = new Tone.NoiseSynth({
      noise: { type: "white" },
      envelope: { attack: 0.001, decay: 0.02, sustain: 0, release: 0.01 },
    });
    this.click.connect(this.gain);

    this.woodblock = new Tone.MembraneSynth({
      pitchDecay: 0.008,
      octaves: 2,
      envelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.02 },
    });
    this.woodblock.connect(this.gain);

    this.beep = new Tone.Synth({
      oscillator: { type: "sine" },
      envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.02 },
    });
    this.beep.connect(this.gain);

    // Tabla-ish: a pitched membrane with a fast bend, which gets close enough
    // to Dha/Na/Ke to keep a tala cycle legible.
    this.tabla = new Tone.MembraneSynth({
      pitchDecay: 0.03,
      octaves: 4,
      envelope: { attack: 0.001, decay: 0.28, sustain: 0, release: 0.05 },
    });
    this.tabla.connect(this.gain);
  }

  /** Beats in one cycle, and the note value one beat occupies. */
  private cycle(): { beats: number; subdivision: string } {
    const tala = this.config.tala;
    if (tala) return { beats: tala.matras, subdivision: "4n" };
    const meter = METER[this.config.timeSignature];
    return { beats: meter.beats, subdivision: meter.subdivision };
  }

  configure(next: MetronomeConfig): void {
    const meterChanged =
      next.timeSignature !== this.config.timeSignature ||
      (next.tala?.id ?? null) !== (this.config.tala?.id ?? null);
    this.config = next;

    const transport = Tone.getTransport();
    transport.bpm.value = next.bpm;
    transport.timeSignature = next.tala
      ? [next.tala.matras, 4]
      : METER[next.timeSignature].signature;
    this.gain.gain.rampTo(next.volume, 0.05);

    if (next.enabled) {
      // Rescheduling on a meter change keeps the accent on the downbeat.
      if (this.eventId === null || meterChanged) this.schedule();
    } else {
      this.unschedule();
    }
  }

  private schedule(): void {
    this.unschedule();
    this.beat = 0;
    this.bars = 0;
    const { subdivision } = this.cycle();
    this.eventId = Tone.getTransport().scheduleRepeat((time) => this.tick(time), subdivision, 0);
  }

  private unschedule(): void {
    if (this.eventId !== null) {
      Tone.getTransport().clear(this.eventId);
      this.eventId = null;
    }
  }

  private tick(time: number): void {
    const { beats } = this.cycle();
    const matra = (this.beat % beats) + 1;
    const tala = this.config.tala;

    // A tala is not "accent beat one". Sam resolves the cycle, tali is a clap,
    // and khali is a deliberately *lighter* beat -- rendering it as a normal
    // stroke loses the shape of the cycle.
    const role = tala ? beatRole(tala, matra) : matra === 1 ? "sam" : "beat";
    this.play(role, time);
    Tone.getDraw().schedule(() => this.onBeat?.(matra), time);

    this.beat++;
    if (this.beat % beats === 0) {
      this.bars++;
      if (this.config.barLimit > 0 && this.bars >= this.config.barLimit) {
        this.unschedule();
        // Defer out of the audio callback; touching UI state from inside a
        // scheduled event can stall the audio thread.
        Tone.getDraw().schedule(() => this.onBarLimitReached?.(), time);
      }
    }
  }

  private play(role: "sam" | "tali" | "khali" | "beat", time: number): void {
    const velocity = role === "sam" ? 1 : role === "tali" ? 0.7 : role === "khali" ? 0.32 : 0.5;
    switch (this.config.sound) {
      case "click":
        this.click.triggerAttackRelease("32n", time, velocity);
        break;
      case "woodblock":
        this.woodblock.triggerAttackRelease(
          role === "sam" ? "C4" : role === "khali" ? "D3" : "G3",
          "32n",
          time,
          velocity,
        );
        break;
      case "beep":
        this.beep.triggerAttackRelease(
          role === "sam" ? 1760 : role === "khali" ? 880 : 1174,
          "32n",
          time,
          velocity,
        );
        break;
      case "tabla":
        // Roughly the three strokes a theka is built from: an open Dha on sam,
        // a ringing Na on tali, a closed Ke on khali.
        this.tabla.triggerAttackRelease(
          role === "sam" ? "G2" : role === "khali" ? "C2" : "D3",
          role === "khali" ? "64n" : "16n",
          time,
          velocity,
        );
        break;
    }
  }

  get running(): boolean {
    return this.eventId !== null;
  }

  dispose(): void {
    this.unschedule();
    this.click.dispose();
    this.woodblock.dispose();
    this.beep.dispose();
    this.tabla.dispose();
    this.gain.dispose();
  }
}
