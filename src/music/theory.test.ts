import { describe, expect, it } from "vitest";
import {
  KEYS,
  NOTE_NAMES,
  SCALES,
  degreeOffset,
  degreeRoot,
  frequencyToMidi,
  midiToFrequency,
  midiToNoteName,
  noteNameToMidi,
  romanNumeral,
  snapToScale,
  triadQuality,
} from "./theory.ts";

describe("note naming", () => {
  it("maps middle C both ways", () => {
    expect(midiToNoteName(60)).toBe("C4");
    expect(noteNameToMidi("C4")).toBe(60);
  });

  it("round-trips every key across several octaves", () => {
    for (let midi = 24; midi <= 96; midi++) {
      expect(noteNameToMidi(midiToNoteName(midi))).toBe(midi);
    }
  });

  it("knows A4 is 440 Hz", () => {
    expect(midiToFrequency(69)).toBeCloseTo(440, 6);
    expect(frequencyToMidi(440)).toBeCloseTo(69, 6);
  });

  it("rejects nonsense names", () => {
    expect(() => noteNameToMidi("H4")).toThrow();
  });
});

describe("scales and degrees", () => {
  it("has twelve keys", () => {
    expect(KEYS).toHaveLength(12);
    expect(KEYS).toEqual(NOTE_NAMES);
  });

  it("uses the spec's interval sets", () => {
    expect(SCALES.major).toEqual([0, 2, 4, 5, 7, 9, 11]);
    expect(SCALES.minor).toEqual([0, 2, 3, 5, 7, 8, 10]);
  });

  it("wraps degrees past the seventh into the next octave", () => {
    expect(degreeOffset("major", 1)).toBe(0);
    expect(degreeOffset("major", 8)).toBe(12); // octave
    expect(degreeOffset("major", 9)).toBe(14); // ninth
    expect(degreeOffset("major", 11)).toBe(17); // eleventh
  });

  it("places degree roots in the key of A major", () => {
    const A = NOTE_NAMES.indexOf("A");
    // A major: A B C# D E F# G#
    expect(midiToNoteName(degreeRoot(A, "major", 1))).toBe("A4");
    expect(midiToNoteName(degreeRoot(A, "major", 2))).toBe("B4");
    expect(midiToNoteName(degreeRoot(A, "major", 3))).toBe("C#5");
    expect(midiToNoteName(degreeRoot(A, "major", 4))).toBe("D5");
    expect(midiToNoteName(degreeRoot(A, "major", 5))).toBe("E5");
    expect(midiToNoteName(degreeRoot(A, "major", 6))).toBe("F#5");
    expect(midiToNoteName(degreeRoot(A, "major", 7))).toBe("G#5");
  });

  it("gives the standard diatonic qualities", () => {
    const major = [1, 2, 3, 4, 5, 6, 7].map((d) => triadQuality("major", d));
    expect(major).toEqual([
      "major", "minor", "minor", "major", "major", "minor", "diminished",
    ]);
    const minor = [1, 2, 3, 4, 5, 6, 7].map((d) => triadQuality("minor", d));
    expect(minor).toEqual([
      "minor", "diminished", "major", "minor", "minor", "major", "major",
    ]);
  });

  it("labels degrees with roman numerals", () => {
    expect(romanNumeral("major", 7)).toBe("vii°");
    expect(romanNumeral("minor", 1)).toBe("i");
  });
});

describe("snapToScale", () => {
  const C = 0;

  it("leaves scale tones alone", () => {
    for (const midi of [60, 62, 64, 65, 67, 69, 71, 72]) {
      expect(snapToScale(midi, C, "major")).toBe(midi);
    }
  });

  it("pulls non-scale tones to the nearest neighbour", () => {
    expect(snapToScale(61, C, "major")).toBe(60); // C# -> C
    expect(snapToScale(61.6, C, "major")).toBe(62); // nearer D
    expect(snapToScale(66, C, "major")).toBe(65); // F# -> F
  });

  it("respects the chosen scale", () => {
    expect(snapToScale(63, C, "minor")).toBe(63); // Eb is diatonic in C minor
    expect(snapToScale(63.6, C, "major")).toBe(64); // ... but snaps to E in major
  });

  it("resolves exact ties downward, deterministically", () => {
    // D# sits one semitone from both D and E in C major. Either is defensible;
    // what matters for a glide is that it does not flip between them.
    expect(snapToScale(63, C, "major")).toBe(62);
    expect(snapToScale(63, C, "major")).toBe(62);
  });

  it("works across octave boundaries", () => {
    expect(snapToScale(59.4, C, "major")).toBe(59); // B3
    expect(snapToScale(71.9, C, "major")).toBe(72); // up to C5
  });
});
