/** Keys, scales, degrees, and note naming. Pure data and pure functions --
 *  no Tone.js import, so this layer is testable in plain node. */

export const NOTE_NAMES = [
  "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
] as const;

export type NoteName = (typeof NOTE_NAMES)[number];

/** Pitch class 0-11, C = 0. */
export type PitchClass = number;

export const KEYS: readonly NoteName[] = NOTE_NAMES;

export type ScaleName = "major" | "minor";

/** Semitone offsets from the tonic. */
export const SCALES: Record<ScaleName, readonly number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10], // natural minor
};

export type TriadQuality = "major" | "minor" | "diminished";

/** Diatonic triad quality per degree: I ii iii IV V vi vii(dim). */
export const DIATONIC_QUALITIES: Record<ScaleName, readonly TriadQuality[]> = {
  major: ["major", "minor", "minor", "major", "major", "minor", "diminished"],
  minor: ["minor", "diminished", "major", "minor", "minor", "major", "major"],
};

/** Roman numerals for display, case-carrying so the HUD reads musically. */
export const ROMAN: Record<ScaleName, readonly string[]> = {
  major: ["I", "ii", "iii", "IV", "V", "vi", "vii°"],
  minor: ["i", "ii°", "III", "iv", "v", "VI", "VII"],
};

/** Default octave for chord roots. C4 is MIDI 60. */
export const BASE_OCTAVE = 4;
export const MIDDLE_C = 60;

export function midiFor(pitchClass: PitchClass, octave: number): number {
  return (octave + 1) * 12 + ((pitchClass % 12) + 12) % 12;
}

export function pitchClassOf(midi: number): PitchClass {
  return ((midi % 12) + 12) % 12;
}

export function octaveOf(midi: number): number {
  return Math.floor(midi / 12) - 1;
}

/** "F#4" style name, which is what Tone.js wants. */
export function midiToNoteName(midi: number): string {
  const rounded = Math.round(midi);
  return `${NOTE_NAMES[pitchClassOf(rounded)]}${octaveOf(rounded)}`;
}

export function noteNameToMidi(name: string): number {
  const m = /^([A-G]#?)(-?\d+)$/.exec(name.trim());
  if (!m) throw new Error(`Unparseable note name: ${name}`);
  const pc = NOTE_NAMES.indexOf(m[1] as NoteName);
  if (pc < 0) throw new Error(`Unknown pitch class: ${m[1]}`);
  return midiFor(pc, Number(m[2]));
}

export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function frequencyToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440);
}

/**
 * Semitone offset of a scale degree above the tonic. Degrees are 1-based;
 * degrees past 7 wrap into the next octave, which is what the 9th chords need.
 */
export function degreeOffset(scale: ScaleName, degree: number): number {
  const intervals = SCALES[scale];
  const idx = degree - 1;
  const octaves = Math.floor(idx / intervals.length);
  const within = ((idx % intervals.length) + intervals.length) % intervals.length;
  return intervals[within] + 12 * octaves;
}

/** MIDI note of a degree's root in a given key. */
export function degreeRoot(
  keyPitchClass: PitchClass,
  scale: ScaleName,
  degree: number,
  octave: number = BASE_OCTAVE,
): number {
  return midiFor(keyPitchClass, octave) + degreeOffset(scale, degree);
}

export function triadQuality(scale: ScaleName, degree: number): TriadQuality {
  return DIATONIC_QUALITIES[scale][(degree - 1) % 7];
}

export function romanNumeral(scale: ScaleName, degree: number): string {
  return ROMAN[scale][(degree - 1) % 7];
}

/** Quantize an arbitrary (possibly fractional) MIDI value to the nearest note
 *  in the key. Used by Theremin mode's optional snap-to-scale. */
export function snapToScale(midi: number, keyPitchClass: PitchClass, scale: ScaleName): number {
  const intervals = SCALES[scale];
  const target = Math.round(midi);
  let best = target;
  let bestDist = Infinity;
  // Search a couple of octaves either side of the target for the closest
  // scale tone; the set is tiny so this is cheaper than any clever modulo.
  const baseOct = octaveOf(target);
  for (let oct = baseOct - 1; oct <= baseOct + 1; oct++) {
    const root = midiFor(keyPitchClass, oct);
    for (const iv of intervals) {
      const candidate = root + iv;
      const d = Math.abs(candidate - midi);
      if (d < bestDist) {
        bestDist = d;
        best = candidate;
      }
    }
  }
  return best;
}
