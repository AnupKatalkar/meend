import * as Tone from "tone";

/**
 * The voice that plays chords, and the ability to swap it.
 *
 * `ChordVoices` and the arpeggiator only need attack/release, and both
 * `PolySynth` and `Sampler` provide them -- so the chord layer talks to this
 * interface and never cares which one is loaded.
 */
export interface PolyVoice {
  triggerAttack(notes: string[], time?: Tone.Unit.Time, velocity?: number): unknown;
  triggerRelease(notes: string[], time?: Tone.Unit.Time): unknown;
  triggerAttackRelease(
    notes: string | string[],
    duration: Tone.Unit.Time,
    time?: Tone.Unit.Time,
    velocity?: number,
  ): unknown;
  releaseAll(time?: Tone.Unit.Time): unknown;
}

export type ChordInstrumentId = "synth" | "epiano" | "piano";

export const CHORD_INSTRUMENTS: ReadonlyArray<{
  id: ChordInstrumentId;
  label: string;
  hint: string;
}> = [
  { id: "synth", label: "Synth", hint: "Detuned saw pad. Sustains for as long as you hold it." },
  { id: "epiano", label: "Electric piano", hint: "FM Rhodes. Warm, and decays like a real key." },
  {
    id: "piano",
    label: "Grand piano",
    hint: "Recorded acoustic piano. Downloads ~2 MB the first time you pick it.",
  },
];

/** Sample set on disk, one every minor third. Keys are the note each file was
 *  recorded at; Tone pitch-shifts between them. */
const PIANO_URLS: Record<string, string> = {};
for (const octave of [1, 2, 3, 4, 5, 6]) {
  for (const note of ["C", "D#", "F#", "A"]) {
    const file = `${note.replace("#", "s")}${octave}.mp3`;
    PIANO_URLS[`${note}${octave}`] = file;
  }
}
PIANO_URLS["C7"] = "C7.mp3";

/**
 * Loads the sampled grand piano on demand.
 *
 * Deliberately not loaded at startup: it is nearly 2 MB, and most players
 * never leave the default synth. The promise is cached so switching back and
 * forth does not re-fetch.
 */
export class PianoSampler {
  private sampler: Tone.Sampler | null = null;
  private loading: Promise<Tone.Sampler> | null = null;

  constructor(private readonly destination: Tone.InputNode) {}

  get loaded(): boolean {
    return this.sampler !== null;
  }

  get instance(): Tone.Sampler | null {
    return this.sampler;
  }

  load(): Promise<Tone.Sampler> {
    if (this.sampler) return Promise.resolve(this.sampler);
    this.loading ??= new Promise<Tone.Sampler>((resolve, reject) => {
      const sampler = new Tone.Sampler({
        urls: PIANO_URLS,
        baseUrl: "/samples/piano/",
        // A short release lets a chord change breathe rather than cutting off
        // like a key lifted mid-note.
        release: 1.2,
        onload: () => {
          this.sampler = sampler;
          resolve(sampler);
        },
        onerror: (err) => {
          this.loading = null;
          reject(err);
        },
      });
      sampler.connect(this.destination);
    }).catch((err) => {
      this.loading = null;
      throw err;
    });
    return this.loading;
  }

  dispose(): void {
    this.sampler?.dispose();
    this.sampler = null;
    this.loading = null;
  }
}

/**
 * FM electric piano.
 *
 * Cheap to build and instant, and FM is genuinely how the classic electric
 * pianos of the eighties made this sound -- so unlike a synthesized acoustic
 * grand, this is the real thing rather than an approximation of one.
 */
export function createElectricPiano(): Tone.PolySynth<Tone.FMSynth> {
  const synth = new Tone.PolySynth(Tone.FMSynth, {
    harmonicity: 3.01,
    modulationIndex: 8,
    oscillator: { type: "sine" },
    envelope: { attack: 0.005, decay: 1.6, sustain: 0.12, release: 1.4 },
    modulation: { type: "sine" },
    modulationEnvelope: { attack: 0.004, decay: 0.35, sustain: 0.06, release: 0.6 },
  });
  synth.maxPolyphony = 8;
  return synth;
}
