/**
 * Hindustani raga definitions.
 *
 * Pure data and pure functions, like the rest of `music/` -- no Tone.js here.
 *
 * A raga is not a scale. Two things this models that a Western scale does not:
 *
 *  - The ascending line (aroha) and descending line (avaroha) can use
 *    different notes. Des takes five notes going up and seven coming down;
 *    playing the descending set on the way up is simply wrong.
 *  - Notes are positions relative to Sa, the tonic drone, rather than absolute
 *    pitches. Sa is wherever the player sets it, and everything is heard
 *    against it.
 *
 * What is deliberately *not* modelled: pakad (characteristic phrases), chalan
 * (movement), the microtonal placement of individual shrutis, and ornament
 * grammar. Those are the difference between "the right notes" and "the raga",
 * and they are not something a finger-count interface can carry.
 */

import type { PitchClass } from "./theory.ts";

/**
 * The twelve swara positions, indexed by semitones above Sa.
 *
 * Lowercase marks a komal (flattened) swara and `Ma'` marks tivra (sharpened)
 * Ma -- the standard shorthand, and compact enough for a HUD.
 */
export const SWARA_NAMES = [
  "Sa", "re", "Re", "ga", "Ga", "Ma", "Ma'", "Pa", "dha", "Dha", "ni", "Ni",
] as const;

/** Long forms, for the help panel. */
export const SWARA_FULL_NAMES = [
  "Shadja", "Komal Rishabh", "Rishabh", "Komal Gandhar", "Gandhar",
  "Madhyam", "Tivra Madhyam", "Pancham", "Komal Dhaivat", "Dhaivat",
  "Komal Nishad", "Nishad",
] as const;

export function swaraName(semitonesAboveSa: number): string {
  return SWARA_NAMES[((semitonesAboveSa % 12) + 12) % 12];
}

export type Direction = "aroha" | "avaroha";

export interface Raga {
  id: string;
  name: string;
  /** Parent thaat, the ten-way classification ragas are grouped under. */
  thaat: string;
  /** Ascending notes, semitones above Sa. Always starts at 0. */
  aroha: readonly number[];
  /** Descending notes, semitones above Sa, given ascending for convenience. */
  avaroha: readonly number[];
  /** Vadi: the most prominent note. Samvadi: the second. Semitones above Sa. */
  vadi: number;
  samvadi: number;
  /** Traditional time of day, which is part of how a raga is understood. */
  samay: string;
  /** One line on what the raga sounds like, for the picker. */
  mood: string;
}

/**
 * A working set of common ragas, spanning several thaats and both symmetric
 * and asymmetric shapes. Not exhaustive -- there are hundreds -- but enough
 * that the mode is worth playing.
 */
export const RAGAS: readonly Raga[] = [
  {
    id: "yaman",
    name: "Yaman",
    thaat: "Kalyan",
    aroha: [0, 2, 4, 6, 7, 9, 11],
    avaroha: [0, 2, 4, 6, 7, 9, 11],
    vadi: 4,
    samvadi: 11,
    samay: "Early night",
    mood: "Serene and expansive; the tivra Ma is its signature.",
  },
  {
    id: "bhairav",
    name: "Bhairav",
    thaat: "Bhairav",
    aroha: [0, 1, 4, 5, 7, 8, 11],
    avaroha: [0, 1, 4, 5, 7, 8, 11],
    vadi: 8,
    samvadi: 1,
    samay: "Dawn",
    mood: "Grave and still, with komal Re and komal Dha.",
  },
  {
    id: "bhairavi",
    name: "Bhairavi",
    thaat: "Bhairavi",
    aroha: [0, 1, 3, 5, 7, 8, 10],
    avaroha: [0, 1, 3, 5, 7, 8, 10],
    vadi: 5,
    samvadi: 0,
    samay: "Morning",
    mood: "All four komal swaras; plaintive, traditionally sung last.",
  },
  {
    id: "kafi",
    name: "Kafi",
    thaat: "Kafi",
    aroha: [0, 2, 3, 5, 7, 9, 10],
    avaroha: [0, 2, 3, 5, 7, 9, 10],
    vadi: 7,
    samvadi: 0,
    samay: "Late night",
    mood: "Warm and folk-adjacent; komal Ga and komal Ni.",
  },
  {
    id: "khamaj",
    name: "Khamaj",
    thaat: "Khamaj",
    // Re is skipped going up and komal Ni appears coming down.
    aroha: [0, 4, 5, 7, 9, 11],
    avaroha: [0, 2, 4, 5, 7, 9, 10],
    vadi: 4,
    samvadi: 11,
    samay: "Late evening",
    mood: "Light and romantic; asymmetric, with two different Ni.",
  },
  {
    id: "bhupali",
    name: "Bhupali",
    thaat: "Kalyan",
    aroha: [0, 2, 4, 7, 9],
    avaroha: [0, 2, 4, 7, 9],
    vadi: 4,
    samvadi: 9,
    samay: "Early night",
    mood: "Pentatonic and open; no Ma, no Ni.",
  },
  {
    id: "malkauns",
    name: "Malkauns",
    thaat: "Bhairavi",
    aroha: [0, 3, 5, 8, 10],
    avaroha: [0, 3, 5, 8, 10],
    vadi: 5,
    samvadi: 0,
    samay: "Late night",
    mood: "Deep and meditative; no Re, no Pa.",
  },
  {
    id: "des",
    name: "Des",
    thaat: "Khamaj",
    // Five going up, seven coming down.
    aroha: [0, 2, 5, 7, 11],
    avaroha: [0, 2, 4, 5, 7, 9, 10],
    vadi: 2,
    samvadi: 7,
    samay: "Late evening",
    mood: "Monsoon raga; strongly asymmetric.",
  },
  {
    id: "darbari",
    name: "Darbari Kanada",
    thaat: "Asavari",
    aroha: [0, 2, 3, 5, 7, 8, 10],
    avaroha: [0, 2, 3, 5, 7, 8, 10],
    vadi: 2,
    samvadi: 7,
    samay: "Late night",
    mood: "Stately and slow-moving, with heavy oscillation on komal Ga.",
  },
  {
    id: "todi",
    name: "Miyan ki Todi",
    thaat: "Todi",
    aroha: [0, 1, 3, 6, 7, 8, 11],
    avaroha: [0, 1, 3, 6, 7, 8, 11],
    vadi: 8,
    samvadi: 1,
    samay: "Late morning",
    mood: "Intense and unusual; komal Re, komal Ga, tivra Ma, komal Dha.",
  },
  {
    id: "marwa",
    name: "Marwa",
    thaat: "Marwa",
    // Pa is omitted entirely, which is why the tanpura retunes.
    aroha: [0, 1, 4, 6, 9, 11],
    avaroha: [0, 1, 4, 6, 9, 11],
    vadi: 1,
    samvadi: 9,
    samay: "Sunset",
    mood: "Unsettled and searching; no Pa at all.",
  },
  {
    id: "bageshri",
    name: "Bageshri",
    thaat: "Kafi",
    aroha: [0, 3, 5, 9, 10],
    avaroha: [0, 2, 3, 5, 9, 10],
    vadi: 5,
    samvadi: 0,
    samay: "Late night",
    mood: "Tender; Pa is largely avoided.",
  },
  {
    id: "charukeshi",
    name: "Charukeshi",
    thaat: "Charukeshi",
    aroha: [0, 2, 4, 5, 7, 8, 10],
    avaroha: [0, 2, 4, 5, 7, 8, 10],
    vadi: 7,
    samvadi: 0,
    samay: "Midday",
    mood: "Borrowed from Carnatic practice; bittersweet.",
  },
];

export function ragaById(id: string): Raga {
  return RAGAS.find((r) => r.id === id) ?? RAGAS[0];
}

/** The note set in play for the direction the phrase is moving. */
export function notesFor(raga: Raga, direction: Direction): readonly number[] {
  return direction === "aroha" ? raga.aroha : raga.avaroha;
}

/**
 * Resolve a 1-based gesture position to a pitch.
 *
 * Ragas have between five and seven notes, so a seven-position finger
 * vocabulary overshoots the pentatonic ones. Rather than leaving those
 * gestures dead, positions past the end continue into the next octave --
 * which is how a player would actually keep ascending.
 *
 * @param position 1-based, as produced by the harmony-hand gesture.
 * @returns semitones above Sa; may exceed 12.
 */
export function swaraAt(raga: Raga, position: number, direction: Direction): number {
  const notes = notesFor(raga, direction);
  const index = Math.max(1, Math.round(position)) - 1;
  const octave = Math.floor(index / notes.length);
  return notes[index % notes.length] + octave * 12;
}

/** How many distinct gesture positions the raga offers before it repeats. */
export function positionCount(raga: Raga, direction: Direction): number {
  return notesFor(raga, direction).length;
}

/**
 * The tanpura's second string.
 *
 * Normally Pa, the fifth. Ragas that omit Pa -- Marwa most obviously -- tune
 * it to Ma or, failing that, Ni instead, because a drone sounding a note the
 * raga excludes fights everything played over it.
 */
export function tanpuraCompanion(raga: Raga): number {
  const all = new Set([...raga.aroha, ...raga.avaroha]);
  if (all.has(7)) return 7; // Pa
  if (all.has(5)) return 5; // Ma
  if (all.has(6)) return 6; // tivra Ma
  if (all.has(11)) return 11; // Ni
  return 0; // Sa against Sa
}

/**
 * Quantize an arbitrary pitch to the nearest note of the raga, for the
 * theremin's snap option and for meend that should land in tune.
 *
 * @param midi may be fractional
 * @param saPitchClass which pitch class Sa sits on
 */
export function snapToRaga(
  midi: number,
  saPitchClass: PitchClass,
  raga: Raga,
  direction: Direction = "avaroha",
): number {
  const notes = notesFor(raga, direction);
  const sa = ((saPitchClass % 12) + 12) % 12;
  let best = Math.round(midi);
  let bestDistance = Infinity;
  // Sa can land in any octave, so search a couple either side of the target.
  const baseOctave = Math.floor(Math.round(midi) / 12);
  for (let octave = baseOctave - 1; octave <= baseOctave + 1; octave++) {
    for (const note of notes) {
      const candidate = octave * 12 + sa + note;
      const distance = Math.abs(candidate - midi);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = candidate;
      }
    }
  }
  return best;
}
