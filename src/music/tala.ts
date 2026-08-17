/**
 * Hindustani tala cycles.
 *
 * A tala is not a time signature. It is a fixed cycle of beats (matras)
 * divided into groups (vibhags), where individual beats carry roles:
 *
 *   sam   — beat one, the point of resolution the whole cycle pulls toward
 *   tali  — a clapped beat, marking the start of a vibhag
 *   khali — an "empty" beat, marked by a wave rather than a clap
 *
 * Rendering a tala as an accent on beat one, the way a Western metronome
 * would, loses the thing that makes it a tala. Khali in particular is a
 * negative accent -- it has to sound lighter than its neighbours, not louder.
 */

export type BeatRole = "sam" | "tali" | "khali" | "beat";

export interface Tala {
  id: string;
  name: string;
  /** Total beats in the cycle. */
  matras: number;
  /** Group sizes; they sum to `matras`. */
  vibhags: readonly number[];
  /** 1-based beats that are clapped. Beat 1 is sam unless listed in khali. */
  tali: readonly number[];
  /** 1-based beats that are waved rather than clapped. */
  khali: readonly number[];
  /** The spoken drum syllables, one per beat. */
  theka: readonly string[];
  note: string;
}

export const TALAS: readonly Tala[] = [
  {
    id: "teental",
    name: "Teental",
    matras: 16,
    vibhags: [4, 4, 4, 4],
    tali: [1, 5, 13],
    khali: [9],
    theka: [
      "Dha", "Dhin", "Dhin", "Dha",
      "Dha", "Dhin", "Dhin", "Dha",
      "Dha", "Tin", "Tin", "Ta",
      "Ta", "Dhin", "Dhin", "Dha",
    ],
    note: "The most common tala; 16 beats in four equal vibhags.",
  },
  {
    id: "jhaptal",
    name: "Jhaptal",
    matras: 10,
    vibhags: [2, 3, 2, 3],
    tali: [1, 3, 8],
    khali: [6],
    theka: ["Dhi", "Na", "Dhi", "Dhi", "Na", "Ti", "Na", "Dhi", "Dhi", "Na"],
    note: "10 beats grouped 2-3-2-3.",
  },
  {
    id: "ektal",
    name: "Ektal",
    matras: 12,
    vibhags: [2, 2, 2, 2, 2, 2],
    tali: [1, 5, 9, 11],
    khali: [3, 7],
    theka: [
      "Dhin", "Dhin", "Dha", "Ge", "Ti", "Ra",
      "Kat", "Ta", "Dha", "Ge", "Dhin", "Na",
    ],
    note: "12 beats; common in slower vocal forms.",
  },
  {
    id: "rupak",
    name: "Rupak",
    matras: 7,
    vibhags: [3, 2, 2],
    // Rupak is unusual: its sam is khali, not a clap.
    tali: [4, 6],
    khali: [1],
    theka: ["Tin", "Tin", "Na", "Dhin", "Na", "Dhin", "Na"],
    note: "7 beats, and the only common tala whose sam is khali.",
  },
  {
    id: "keherwa",
    name: "Keherwa",
    matras: 8,
    vibhags: [4, 4],
    tali: [1],
    khali: [5],
    theka: ["Dha", "Ge", "Na", "Ti", "Na", "Ka", "Dhi", "Na"],
    note: "8 beats; ubiquitous in light and folk music.",
  },
  {
    id: "dadra",
    name: "Dadra",
    matras: 6,
    vibhags: [3, 3],
    tali: [1],
    khali: [4],
    theka: ["Dha", "Dhi", "Na", "Dha", "Ti", "Na"],
    note: "6 beats; the light-classical waltz.",
  },
];

export function talaById(id: string): Tala {
  return TALAS.find((t) => t.id === id) ?? TALAS[0];
}

/** Role of a 1-based beat within the cycle. */
export function beatRole(tala: Tala, beat: number): BeatRole {
  const matra = ((beat - 1) % tala.matras) + 1;
  if (tala.khali.includes(matra)) return "khali";
  if (matra === 1) return "sam";
  if (tala.tali.includes(matra)) return "tali";
  return "beat";
}

/** 1-based beats that begin a vibhag, for the beat display. */
export function vibhagStarts(tala: Tala): number[] {
  const starts: number[] = [];
  let beat = 1;
  for (const size of tala.vibhags) {
    starts.push(beat);
    beat += size;
  }
  return starts;
}

export function thekaFor(tala: Tala, beat: number): string {
  return tala.theka[((beat - 1) % tala.matras + tala.matras) % tala.matras] ?? "";
}
