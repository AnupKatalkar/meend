import * as Tone from "tone";
import type { Tala } from "../music/tala.ts";
import { midiToFrequency, midiToNoteName } from "../music/theory.ts";
import type { ArpRate, ClickSound, TimeSignature } from "../state/store.ts";
import { Arpeggiator } from "./arpeggiator.ts";
import { BassVoice } from "./bass.ts";
import {
  CHORD_INSTRUMENTS,
  type ChordInstrumentId,
  type PolyVoice,
  PianoSampler,
  createElectricPiano,
} from "./instruments.ts";
import { Metronome } from "./metronome.ts";
import { Tanpura } from "./tanpura.ts";
import { ChordVoices } from "./voices.ts";

/** Filter sweep range. Mapped exponentially: pitch is heard logarithmically,
 *  and a linear sweep spends most of its travel in the top octave. */
const CUTOFF_MIN_HZ = 200;
const CUTOFF_MAX_HZ = 8000;

/** Ramp time for every continuously-modulated parameter. Long enough to kill
 *  zipper noise at 30 Hz update rate, short enough to feel immediate. */
const PARAM_RAMP = 0.03;

/** Below this, a resting hand is silent rather than quietly droning. */
const VOLUME_DEAD_ZONE = 0.04;

const MAX_POLYPHONY = 8;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export interface MetronomeSettings {
  enabled: boolean;
  bpm: number;
  timeSignature: TimeSignature;
  barLimit: number;
  sound: ClickSound;
  volume: number;
  /** A tala cycle, which replaces the time signature when present. */
  tala?: Tala | null;
}

/**
 * The whole Tone.js graph, built once on the first user gesture and kept alive
 * for the session. Nothing here is ever constructed inside a render or a
 * per-frame callback.
 *
 *   PolySynth (saw) -> Filter -> expression Gain -> Reverb -> Limiter -> out
 *   MonoSynth  (bass)     -> its own Gain --------------------^
 *   Metronome click       -> its own Gain --------------------^
 *   Theremin / piano      -> their own Gains -----------------^
 */
export class AudioEngine {
  private started = false;

  private chordSynth!: Tone.PolySynth;
  private filter!: Tone.Filter;
  private expressionGain!: Tone.Gain;
  private reverb!: Tone.Reverb;
  private limiter!: Tone.Limiter;
  private meter!: Tone.Meter;
  private waveform!: Tone.Waveform;

  private theremin!: Tone.Synth;
  private thereminGain!: Tone.Gain;
  private monoPiano!: Tone.Synth;
  private pianoGain!: Tone.Gain;

  /** Raga mode: a single melodic voice over a tanpura. */
  private lead!: Tone.MonoSynth;
  private leadGain!: Tone.Gain;
  private leadVibrato!: Tone.Vibrato;
  private tanpura!: Tanpura;

  private electricPiano!: Tone.PolySynth<Tone.FMSynth>;
  private piano!: PianoSampler;
  private instrument: ChordInstrumentId = "synth";

  private voices!: ChordVoices;
  private arp!: Arpeggiator;
  private bass!: BassVoice;
  private metronome!: Metronome;

  private currentChord: number[] = [];
  private masterVolume = 0.8;
  private expression = 0;
  private lastCutoff = -1;
  private lastGain = -1;
  private arpRate: ArpRate = "off";
  private blend = 0.35;

  /** Estimated one-way latency from a parameter write to audible output, ms.
   *  Includes the context's own lookahead and the device's output latency. */
  get outputLatencyMs(): number {
    const ctx = Tone.getContext();
    const raw = ctx.rawContext as unknown as AudioContext;
    const base = (raw.baseLatency ?? 0) + (raw.outputLatency ?? 0);
    return (ctx.lookAhead + base) * 1000;
  }

  get isStarted(): boolean {
    return this.started;
  }

  /** Master bus, for MediaRecorder to tap during recording. */
  get masterTap(): Tone.ToneAudioNode {
    return this.limiter;
  }

  get level(): number {
    if (!this.started) return 0;
    const v = this.meter.getValue();
    return typeof v === "number" ? clamp01(v) : 0;
  }

  get chord(): readonly number[] {
    return this.currentChord;
  }

  /** Raw samples off the master bus, for the scope in the HUD. Returns null
   *  before the graph exists so callers can draw a flat line. */
  getWaveform(): Float32Array | null {
    return this.started ? this.waveform.getValue() : null;
  }

  dispose(): void {
    if (!this.started) return;
    this.panic();
    this.arp.dispose();
    this.bass.dispose();
    this.metronome.dispose();
    this.chordSynth.dispose();
    this.theremin.dispose();
    this.thereminGain.dispose();
    this.monoPiano.dispose();
    this.pianoGain.dispose();
    this.electricPiano.dispose();
    this.piano.dispose();
    this.lead.dispose();
    this.leadVibrato.dispose();
    this.leadGain.dispose();
    this.tanpura.dispose();
    this.filter.dispose();
    this.expressionGain.dispose();
    this.reverb.dispose();
    this.meter.dispose();
    this.waveform.dispose();
    this.limiter.dispose();
    Tone.getTransport().stop();
    this.started = false;
  }

  /**
   * Must be called from a real user gesture -- browsers will not start an
   * AudioContext otherwise.
   */
  async start(): Promise<void> {
    if (this.started) return;

    // Tone's default 0.1s lookahead would blow the whole 100ms latency budget
    // on its own. "interactive" plus a short lookahead is the difference
    // between an instrument and a delay pedal.
    Tone.setContext(new Tone.Context({ latencyHint: "interactive", lookAhead: 0.02 }));
    await Tone.start();

    this.limiter = new Tone.Limiter(-3);
    this.meter = new Tone.Meter({ normalRange: true, smoothing: 0.85 });
    // 256 samples is plenty for a thumbnail scope and keeps the per-frame
    // copy cheap.
    this.waveform = new Tone.Waveform(256);
    this.limiter.connect(this.meter);
    this.limiter.connect(this.waveform);
    this.limiter.toDestination();

    this.reverb = new Tone.Reverb({ decay: 1.8, wet: 0.18, preDelay: 0.01 });
    this.reverb.connect(this.limiter);

    this.expressionGain = new Tone.Gain(0);
    this.expressionGain.connect(this.reverb);

    this.filter = new Tone.Filter({ type: "lowpass", rolloff: -24, Q: 1.2, frequency: 2000 });
    this.filter.connect(this.expressionGain);

    // "fatsawtooth" is a stack of detuned saws per voice. With spread at 0 it
    // is an ordinary sawtooth; opening the spread is what fuses separate notes
    // into one chord rather than three things happening at once.
    this.chordSynth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "fatsawtooth", count: 3, spread: 0 },
      envelope: { attack: 0.02, decay: 0.15, sustain: 0.7, release: 0.35 },
    });
    this.chordSynth.maxPolyphony = MAX_POLYPHONY;
    this.chordSynth.connect(this.filter);

    // Theremin: a single sine that glides rather than steps between pitches.
    this.thereminGain = new Tone.Gain(0);
    this.thereminGain.connect(this.reverb);
    this.theremin = new Tone.Synth({
      oscillator: { type: "sine" },
      envelope: { attack: 0.1, decay: 0.1, sustain: 1, release: 0.3 },
      portamento: 0.05,
    });
    this.theremin.connect(this.thereminGain);

    // Mono piano: fast attack, medium decay, low sustain.
    this.pianoGain = new Tone.Gain(0.9);
    this.pianoGain.connect(this.reverb);
    this.monoPiano = new Tone.Synth({
      oscillator: { type: "triangle" },
      envelope: { attack: 0.005, decay: 0.9, sustain: 0.08, release: 0.9 },
    });
    this.monoPiano.connect(this.pianoGain);

    // Raga mode: one sustained melodic line, plus the tanpura beneath it.
    // Portamento is the meend -- the glide between notes that carries as much
    // of the raga as the notes themselves do.
    this.leadGain = new Tone.Gain(0);
    this.leadGain.connect(this.reverb);
    this.leadVibrato = new Tone.Vibrato({ frequency: 5.2, depth: 0.06 });
    this.leadVibrato.connect(this.leadGain);
    this.lead = new Tone.MonoSynth({
      oscillator: { type: "triangle" },
      envelope: { attack: 0.12, decay: 0.3, sustain: 0.85, release: 0.5 },
      filter: { type: "lowpass", rolloff: -12, Q: 1.5 },
      filterEnvelope: {
        attack: 0.15,
        decay: 0.4,
        sustain: 0.7,
        release: 0.6,
        baseFrequency: 320,
        octaves: 3,
      },
      portamento: 0.08,
    });
    this.lead.connect(this.leadVibrato);
    this.tanpura = new Tanpura(this.limiter);

    // Every chord instrument hangs off the same filter -> expression -> reverb
    // chain, so switching one for another changes only the timbre.
    this.electricPiano = createElectricPiano();
    this.electricPiano.connect(this.filter);
    this.piano = new PianoSampler(this.filter);

    this.voices = new ChordVoices(this.chordSynth);
    this.arp = new Arpeggiator(() => this.chordVoice(), () => this.currentChord);
    this.bass = new BassVoice(this.limiter);
    this.metronome = new Metronome(this.limiter);

    // Reverb builds its impulse response asynchronously; without this the
    // first second of play is dry.
    await this.reverb.ready;

    this.started = true;
  }

  setMasterVolume(v: number): void {
    this.masterVolume = clamp01(v);
    this.applyGain();
  }

  /**
   * Expression-hand height -> loudness.
   *
   * Curved rather than linear because perceived loudness is not linear in
   * gain, and with a dead zone at the bottom so a hand at rest is silent.
   */
  setExpression(height: number): void {
    const h = clamp01(height);
    this.expression = h < VOLUME_DEAD_ZONE ? 0 : Math.pow(h, 1.5);
    this.applyGain();
  }

  private applyGain(): void {
    if (!this.started) return;
    const target = this.expression * this.masterVolume;
    // Skip inaudible changes: at 30 Hz, redundant ramps are just scheduling
    // churn on the audio thread.
    if (Math.abs(target - this.lastGain) < 0.001) return;
    this.lastGain = target;
    this.expressionGain.gain.rampTo(target, PARAM_RAMP);
  }

  /** The voice chords currently play on. Falls back to the synth while the
   *  sampled piano is still downloading. */
  private chordVoice(): PolyVoice {
    if (this.instrument === "epiano") return this.electricPiano;
    if (this.instrument === "piano" && this.piano.instance) return this.piano.instance;
    return this.chordSynth;
  }

  get chordInstrument(): ChordInstrumentId {
    return this.instrument;
  }

  /**
   * Switch the chord timbre.
   *
   * The sampled piano is fetched on demand, so this resolves only once the
   * instrument is actually audible. Whatever chord is being held is re-struck
   * on the new voice, so a switch mid-performance does not leave silence.
   */
  async setChordInstrument(id: ChordInstrumentId): Promise<void> {
    if (!this.started || id === this.instrument) return;
    if (!CHORD_INSTRUMENTS.some((i) => i.id === id)) return;

    if (id === "piano" && !this.piano.loaded) {
      try {
        await this.piano.load();
      } catch (err) {
        console.warn("[audio] piano samples failed to load", err);
        throw err;
      }
      // The player may have switched away again while it downloaded.
      if (this.instrument !== "synth" && this.instrument !== "epiano" && this.instrument !== id) {
        return;
      }
    }

    this.instrument = id;
    const wasHolding = this.voices.setVoice(this.chordVoice());
    // Re-attack, unless the arpeggiator is doing the playing anyway.
    if (wasHolding.length && !this.arp.active) this.voices.set(wasHolding);
    this.setChordBlend(this.blend);
  }

  /**
   * How much the chord's notes fuse into a single sound.
   *
   * Three things stop a struck chord reading as one object: a fast attack, so
   * each note articulates separately; zero detune, so nothing beats against
   * anything; and a dry signal, so the notes never share a space. Blend moves
   * all three together, from a crisp stab at 0 to a pad at 1.
   */
  setChordBlend(amount: number): void {
    if (!this.started) return;
    const a = clamp01(amount);
    this.blend = a;

    // The sampled piano has no oscillator or envelope to reshape -- its attack
    // is baked into the recording, which is the point of it. Blend still
    // controls how long notes ring and how much room they sit in.
    const sampler = this.piano.instance;
    if (sampler) sampler.release = 0.6 + a * 2.4;
    this.electricPiano.set({ envelope: { release: 0.8 + a * 1.8 } });

    this.chordSynth.set({
      envelope: {
        // A slower attack lets the notes arrive as one swell.
        attack: 0.015 + a * 0.35,
        decay: 0.15 + a * 0.2,
        sustain: 0.7 + a * 0.2,
        release: 0.3 + a * 1.2,
      },
      // Detuning the stacked saws smears the boundaries between notes.
      oscillator: { spread: Math.round(a * 45) } as Partial<Tone.OmniOscillatorOptions>,
    });
    // Shared reverb: more of it puts every note in the same room.
    this.reverb.wet.rampTo(0.15 + a * 0.35, 0.2);
  }

  /** Tilt in [-1,1] -> filter cutoff. Left dark, right bright. */
  setTilt(tilt: number): void {
    if (!this.started) return;
    const t = (Math.max(-1, Math.min(tilt, 1)) + 1) / 2;
    const hz = CUTOFF_MIN_HZ * Math.pow(CUTOFF_MAX_HZ / CUTOFF_MIN_HZ, t);
    if (Math.abs(hz - this.lastCutoff) < 1) return;
    this.lastCutoff = hz;
    this.filter.frequency.rampTo(hz, PARAM_RAMP);
  }

  get cutoffHz(): number {
    return this.lastCutoff;
  }

  /**
   * Commit a chord. Attacks only when the note set actually changed; every
   * other per-frame parameter modulates the sustained voices instead.
   *
   * @returns true if this call produced an attack, for latency measurement.
   */
  setChord(notes: readonly number[]): boolean {
    if (!this.started) return false;
    this.currentChord = [...notes];

    // With the arpeggiator running, the chord is played one note at a time by
    // the loop, so nothing should be sustained underneath it.
    const change = this.arp.active ? this.voices.releaseAll() : this.voices.set(notes);

    this.bass.setRoot(notes.length ? Math.min(...notes) : null);
    return change.attacked.length > 0 || (this.arp.active && notes.length > 0);
  }

  /** The fist gesture, and anything else that means "silence now". */
  releaseChord(): void {
    if (!this.started) return;
    this.currentChord = [];
    this.voices.releaseAll();
    this.bass.setRoot(null);
  }

  setArp(rate: ArpRate): void {
    if (!this.started || rate === this.arpRate) return;
    this.arpRate = rate;
    // Switching into arp mode leaves the sustained chord ringing forever if
    // it is not explicitly dropped here.
    if (rate !== "off") this.voices.releaseAll();
    this.arp.setRate(rate);
    this.syncTransport();
    if (rate === "off" && this.currentChord.length) this.voices.set(this.currentChord);
  }

  setBass(enabled: boolean, volume: number): void {
    if (!this.started) return;
    this.bass.setVolume(volume);
    this.bass.setEnabled(enabled);
  }

  setMetronome(settings: MetronomeSettings): void {
    if (!this.started) return;
    this.metronome.configure({
      bpm: settings.bpm,
      timeSignature: settings.timeSignature,
      barLimit: settings.barLimit,
      sound: settings.sound,
      volume: settings.volume,
      enabled: settings.enabled,
      tala: settings.tala ?? null,
    });
    this.syncTransport();
  }

  set onMetronomeBarLimit(cb: (() => void) | null) {
    if (this.started) this.metronome.onBarLimitReached = cb;
  }

  /** Fires on each beat with its 1-based position in the cycle. */
  set onMetronomeBeat(cb: ((matra: number) => void) | null) {
    if (this.started) this.metronome.onBeat = cb;
  }

  /** The transport only needs to run when something is using it. */
  private syncTransport(): void {
    const transport = Tone.getTransport();
    const needed =
      this.arpRate !== "off" || this.metronome.running || this.tanpura.isEnabled;
    if (needed && transport.state !== "started") transport.start();
    else if (!needed && transport.state === "started") transport.stop();
  }

  /* ---------------- Theremin mode ---------------- */

  setThereminPitch(midi: number | null): void {
    if (!this.started) return;
    if (midi === null) return;
    this.theremin.frequency.rampTo(midiToFrequency(midi), PARAM_RAMP);
  }

  setThereminVolume(v: number): void {
    if (!this.started) return;
    const target = clamp01(v) * this.masterVolume;
    this.thereminGain.gain.rampTo(target, PARAM_RAMP);
  }

  thereminOn(): void {
    if (this.started) this.theremin.triggerAttack(this.theremin.frequency.value);
  }

  thereminOff(): void {
    if (this.started) this.theremin.triggerRelease();
  }

  /* ---------------- Raga mode ---------------- */

  /**
   * @param saMidi    where Sa sits
   * @param companion semitones above Sa for the tanpura's companion string
   */
  setTanpura(enabled: boolean, volume: number, saMidi: number, companion: number): void {
    if (!this.started) return;
    this.tanpura.tune(saMidi, companion);
    this.tanpura.setVolume(volume);
    this.tanpura.setEnabled(enabled);
    // The tanpura runs on the shared transport, so it has to be able to start
    // it even with the arpeggiator and metronome both off.
    this.syncTransport();
  }

  /** Meend: seconds taken to glide between swaras. 0 is a fretted jump. */
  setMeend(seconds: number): void {
    if (!this.started) return;
    this.lead.portamento = Math.max(0, Math.min(seconds, 0.6));
  }

  /** Glide the melodic voice to a pitch. Attacks on first use, then glides. */
  setLeadPitch(midi: number): void {
    if (!this.started) return;
    this.lead.setNote(midiToNoteName(midi));
  }

  leadOn(midi: number, velocity = 0.85): void {
    if (!this.started) return;
    this.lead.triggerAttack(midiToNoteName(midi), undefined, velocity);
  }

  leadOff(): void {
    if (this.started) this.lead.triggerRelease();
  }

  setLeadVolume(v: number): void {
    if (!this.started) return;
    this.leadGain.gain.rampTo(clamp01(v) * this.masterVolume, PARAM_RAMP);
  }

  /** Gamak-ish: deepen the vibrato as the expression hand tilts. */
  setLeadVibrato(depth: number): void {
    if (!this.started) return;
    this.leadVibrato.depth.rampTo(clamp01(depth) * 0.35, 0.08);
  }

  /* ---------------- Mono piano mode ---------------- */

  strikePiano(midi: number, velocity = 0.9): void {
    if (!this.started) return;
    this.monoPiano.triggerAttackRelease(midiToNoteName(midi), "2n", undefined, velocity);
  }

  setPianoVolume(v: number): void {
    if (!this.started) return;
    this.pianoGain.gain.rampTo(clamp01(v) * this.masterVolume, PARAM_RAMP);
  }

  /**
   * Drop every voice. Called on mode changes and by the panic key, so a note
   * can never be left stuck by a transition.
   */
  panic(): void {
    if (!this.started) return;
    this.currentChord = [];
    this.voices.panic();
    this.bass.panic();
    this.theremin.triggerRelease();
    this.monoPiano.triggerRelease();
    this.lead.triggerRelease();
    this.lastGain = -1;
  }

}
