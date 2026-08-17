import {
  BASE_OCTAVE,
  NOTE_NAMES,
  type PitchClass,
  type ScaleName,
  degreeOffset,
  degreeRoot,
  midiFor,
  pitchClassOf,
} from "./theory.ts";

/** The eight fixed chord styles, as semitone formulas from the chord root. */
export const CHORD_STYLES = [
  { id: "major", label: "Major Triad", formula: [0, 4, 7] },
  { id: "minor", label: "Minor Triad", formula: [0, 3, 7] },
  { id: "dim", label: "Diminished", formula: [0, 3, 6] },
  { id: "sus2", label: "Sus2", formula: [0, 2, 7] },
  { id: "sus4", label: "Sus4", formula: [0, 5, 7] },
  { id: "maj7", label: "Major 7th", formula: [0, 4, 7, 11] },
  { id: "dom7", label: "Dominant 7th", formula: [0, 4, 7, 10] },
  { id: "inv1", label: "Major 1st Inv", formula: [4, 7, 12] },
] as const;

/**
 * A ninth option, and the default.
 *
 * The eight styles above are fixed formulas, so choosing "Major Triad" makes
 * every scale degree major -- vi included. That leaves the HUD announcing
 * "vi" or "vii°" over a plainly major chord, and a newcomer holding up three
 * fingers hears a III rather than the iii the interface promises. "Diatonic"
 * takes the triad quality from the key instead, which is what makes the
 * default configuration sound like music. The eight fixed styles are
 * untouched and still selectable.
 */
export const DIATONIC_STYLE = { id: "diatonic", label: "Diatonic (follows key)" } as const;

export type ChordStyleId = (typeof CHORD_STYLES)[number]["id"] | typeof DIATONIC_STYLE.id;

/** What the settings dropdown and the keyboard slots offer. */
export const SELECTABLE_STYLES: ReadonlyArray<{ id: ChordStyleId; label: string }> = [
  DIATONIC_STYLE,
  ...CHORD_STYLES.map((s) => ({ id: s.id as ChordStyleId, label: s.label })),
];

export function styleById(id: ChordStyleId) {
  const found = CHORD_STYLES.find((s) => s.id === id);
  if (!found) throw new Error(`Unknown chord style: ${id}`);
  return found;
}

/** Finger Layout mode: right-hand finger count picks the chord's complexity,
 *  and the quality falls out of the scale rather than being chosen. */
export type FingerLayout = "triad" | "firstInversion" | "seventh" | "ninth";

export const FINGER_LAYOUTS: readonly FingerLayout[] = [
  "triad",
  "firstInversion",
  "seventh",
  "ninth",
];

export function layoutForFingerCount(count: number): FingerLayout {
  return FINGER_LAYOUTS[Math.min(Math.max(count, 1), 4) - 1];
}

export interface Chord {
  /** Voiced MIDI notes, ascending. */
  notes: number[];
  /** MIDI note of the chord root, even when the root is not the lowest note. */
  root: number;
  degree: number;
  scale: ScaleName;
  /** Display name, e.g. "F#m7" or "C/E". */
  name: string;
}

/**
 * Stacked diatonic thirds: degree, degree+2, degree+4, ... `size` notes.
 * Building the chord out of the scale rather than a fixed formula is what
 * makes Finger Layout mode's qualities track the key automatically.
 */
function diatonicStack(
  keyPc: PitchClass,
  scale: ScaleName,
  degree: number,
  size: number,
  octave: number,
): number[] {
  const base = midiFor(keyPc, octave);
  const notes: number[] = [];
  for (let i = 0; i < size; i++) {
    notes.push(base + degreeOffset(scale, degree + i * 2));
  }
  return notes;
}

export interface BuildChordOptions {
  keyPitchClass: PitchClass;
  scale: ScaleName;
  /** 1-7. */
  degree: number;
  /** Fixed Chord Style mode. Ignored when `layout` is set. */
  style?: ChordStyleId;
  /** Finger Layout mode. Takes precedence over `style`. */
  layout?: FingerLayout;
  /** Whole-chord transposition in octaves (thumb-down drops one). */
  octaveShift?: number;
}

/** Build the chord's raw (un-voice-led) notes plus its name. */
export function buildChord(opts: BuildChordOptions): Chord {
  const { keyPitchClass, scale, degree, style = "diatonic", octaveShift = 0 } = opts;
  // "Diatonic" is the triad layout wearing a style's clothes.
  const layout = opts.layout ?? (style === "diatonic" ? "triad" : undefined);
  const octave = BASE_OCTAVE + octaveShift;
  const root = degreeRoot(keyPitchClass, scale, degree, octave);

  let notes: number[];
  if (layout) {
    switch (layout) {
      case "triad":
        notes = diatonicStack(keyPitchClass, scale, degree, 3, octave);
        break;
      case "firstInversion": {
        // Same triad, root moved up an octave so the third sits in the bass.
        const triad = diatonicStack(keyPitchClass, scale, degree, 3, octave);
        notes = [triad[1], triad[2], triad[0] + 12];
        break;
      }
      case "seventh":
        notes = diatonicStack(keyPitchClass, scale, degree, 4, octave);
        break;
      case "ninth":
        notes = diatonicStack(keyPitchClass, scale, degree, 5, octave);
        break;
    }
  } else {
    notes = styleById(style).formula.map((semi) => root + semi);
  }

  notes = [...notes].sort((a, b) => a - b);
  return { notes, root, degree, scale, name: nameChord(root, notes) };
}

/**
 * Derive a chord name from its intervals rather than from a lookup table, so
 * the odd chords Finger Layout can produce (the ninth on vii, say) still get a
 * sensible label instead of falling off a table's edge.
 */
export function nameChord(root: number, notes: number[]): string {
  const rootName = NOTE_NAMES[pitchClassOf(root)];
  const iv = new Set(notes.map((n) => pitchClassOf(n - root)));

  const hasMaj3 = iv.has(4);
  const hasMin3 = iv.has(3);
  const hasP5 = iv.has(7);
  const hasD5 = iv.has(6);
  const hasA5 = iv.has(8);
  const hasMaj7 = iv.has(11);
  const hasMin7 = iv.has(10);
  const hasDim7 = iv.has(9) && hasD5 && !hasP5;
  const hasNinth = iv.has(2) && (hasMaj3 || hasMin3);
  const hasFlatNine = iv.has(1);

  let quality: string;
  if (!hasMaj3 && !hasMin3) {
    // No third at all: it is a suspension, or a bare fifth.
    quality = iv.has(2) ? "sus2" : iv.has(5) ? "sus4" : "5";
  } else if (hasMin3 && hasD5) {
    quality = hasMin7 ? "m7b5" : hasDim7 ? "dim7" : "dim";
  } else if (hasMin3) {
    quality = "m";
  } else if (hasA5 && !hasP5) {
    quality = "aug";
  } else {
    quality = "";
  }

  // Extensions. A ninth implies the seventh below it, so it replaces rather
  // than stacks onto the "7" marker.
  let ext = "";
  if (hasNinth) {
    if (hasMaj7) ext = "maj9";
    else if (hasMin7) ext = "9";
    else ext = "add9";
  } else if (hasMaj7) {
    ext = "maj7";
  } else if (hasMin7 && quality !== "m7b5") {
    ext = "7";
  } else if (hasFlatNine) {
    ext = "b9";
  }

  // "m" + "9" reads as m9; "m7b5" already carries its own seventh.
  let name = rootName + quality;
  if (ext && quality !== "m7b5" && quality !== "dim7") {
    name += ext === "7" && quality === "m" ? "7" : ext;
  }

  // Slash notation when something other than the root is in the bass.
  const bass = Math.min(...notes);
  if (pitchClassOf(bass) !== pitchClassOf(root)) {
    name += `/${NOTE_NAMES[pitchClassOf(bass)]}`;
  }
  return name;
}

/** Absolute MIDI bounds a voicing may never leave. Roughly C2..E6. */
const VOICE_LOW = 36;
const VOICE_HIGH = 88;

/**
 * Every rotation of a chord (each one moving the current lowest note up an
 * octave), plus the whole chord an octave down. These are the voicings that
 * preserve the chord's identity.
 */
function candidateVoicings(notes: number[]): number[][] {
  const sorted = [...notes].sort((a, b) => a - b);
  const out: number[][] = [];
  for (const shift of [-12, 0]) {
    let cur = sorted.map((n) => n + shift);
    for (let r = 0; r < sorted.length; r++) {
      out.push([...cur].sort((a, b) => a - b));
      cur = [...cur.slice(1), cur[0] + 12];
    }
  }
  return out;
}

/** Mean distance from each note of `cand` to the nearest note of `prev`. A
 *  rough "how far did the fingers move" measure that tolerates the two chords
 *  having different numbers of notes. */
function averageDisplacement(cand: readonly number[], prev: readonly number[]): number {
  let total = 0;
  for (const n of cand) {
    let nearest = Infinity;
    for (const p of prev) nearest = Math.min(nearest, Math.abs(n - p));
    total += nearest;
  }
  return total / cand.length;
}

/**
 * Pick the voicing whose top note sits closest to the previous chord's top
 * note. Cheap to implement, and it is the difference between finger-count
 * noodling that sounds intentional and one that leaps around at random.
 *
 * Top-note distance alone leaves frequent ties -- C major into F major has two
 * voicings whose top note moves by 2 semitones -- so total voice movement
 * breaks them. The tie-break term is capped below 1 semitone so it can only
 * ever separate equals, never override the primary rule.
 */
export function voiceLead(notes: number[], previous: readonly number[] | null): number[] {
  const ascending = [...notes].sort((a, b) => a - b);
  if (!previous || previous.length === 0) return ascending;

  const previousTop = previous[previous.length - 1];
  const inRange = (v: number[]) => v[0] >= VOICE_LOW && v[v.length - 1] <= VOICE_HIGH;

  let best: number[] | null = null;
  let bestScore = Infinity;
  for (const cand of candidateVoicings(ascending)) {
    if (!inRange(cand)) continue;
    const top = cand[cand.length - 1];
    // Light penalty on very wide spreads so the chord stays a chord rather
    // than smearing across three octaves.
    const spread = top - cand[0];
    const score =
      Math.abs(top - previousTop) +
      Math.max(0, spread - 19) * 0.25 +
      Math.min(averageDisplacement(cand, previous), 6) * 0.15;
    if (score < bestScore) {
      bestScore = score;
      best = cand;
    }
  }
  return best ?? ascending;
}

/** Build and voice-lead in one step. */
export function buildVoicedChord(opts: BuildChordOptions, previous: readonly number[] | null): Chord {
  const chord = buildChord(opts);
  return { ...chord, notes: voiceLead(chord.notes, previous) };
}

/** True when two chords are the same set of pitches -- the retrigger test. */
export function sameNotes(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
