import { describe, expect, it } from "vitest";
import {
  CHORD_STYLES,
  buildChord,
  buildVoicedChord,
  layoutForFingerCount,
  nameChord,
  sameNotes,
  voiceLead,
} from "./chords.ts";
import { NOTE_NAMES, midiToNoteName, noteNameToMidi } from "./theory.ts";

const C = NOTE_NAMES.indexOf("C");
const A = NOTE_NAMES.indexOf("A");
const names = (midi: number[]) => midi.map(midiToNoteName);

describe("chord styles", () => {
  it("carries all eight styles from the spec", () => {
    expect(CHORD_STYLES.map((s) => s.label)).toEqual([
      "Major Triad",
      "Minor Triad",
      "Diminished",
      "Sus2",
      "Sus4",
      "Major 7th",
      "Dominant 7th",
      "Major 1st Inv",
    ]);
  });

  it("applies a fixed style regardless of the scale degree's own quality", () => {
    // Degree ii in C is normally D minor; the fixed Major style overrides it.
    const chord = buildChord({ keyPitchClass: C, scale: "major", degree: 2, style: "major" });
    expect(names(chord.notes)).toEqual(["D4", "F#4", "A4"]);
    expect(chord.name).toBe("D");
  });

  it("builds the first-inversion style with the third in the bass", () => {
    const chord = buildChord({ keyPitchClass: C, scale: "major", degree: 1, style: "inv1" });
    expect(names(chord.notes)).toEqual(["E4", "G4", "C5"]);
    expect(chord.name).toBe("C/E");
  });

  it("drops an octave when asked", () => {
    const chord = buildChord({
      keyPitchClass: C, scale: "major", degree: 1, style: "major", octaveShift: -1,
    });
    expect(names(chord.notes)).toEqual(["C3", "E3", "G3"]);
  });
});

describe("finger layout mode", () => {
  it("maps finger counts to layouts", () => {
    expect(layoutForFingerCount(1)).toBe("triad");
    expect(layoutForFingerCount(2)).toBe("firstInversion");
    expect(layoutForFingerCount(3)).toBe("seventh");
    expect(layoutForFingerCount(4)).toBe("ninth");
    // Out-of-range counts clamp rather than crash.
    expect(layoutForFingerCount(0)).toBe("triad");
    expect(layoutForFingerCount(5)).toBe("ninth");
  });

  it("takes triad quality from the scale degree", () => {
    const two = buildChord({ keyPitchClass: C, scale: "major", degree: 2, layout: "triad" });
    expect(names(two.notes)).toEqual(["D4", "F4", "A4"]);
    expect(two.name).toBe("Dm");

    const seven = buildChord({ keyPitchClass: C, scale: "major", degree: 7, layout: "triad" });
    expect(seven.name).toBe("Bdim");
  });

  it("builds diatonic sevenths", () => {
    expect(buildChord({ keyPitchClass: C, scale: "major", degree: 1, layout: "seventh" }).name)
      .toBe("Cmaj7");
    expect(buildChord({ keyPitchClass: C, scale: "major", degree: 5, layout: "seventh" }).name)
      .toBe("G7");
    expect(buildChord({ keyPitchClass: C, scale: "major", degree: 2, layout: "seventh" }).name)
      .toBe("Dm7");
    expect(buildChord({ keyPitchClass: C, scale: "major", degree: 7, layout: "seventh" }).name)
      .toBe("Bm7b5");
  });

  it("builds diatonic ninths", () => {
    const ninth = buildChord({ keyPitchClass: C, scale: "major", degree: 1, layout: "ninth" });
    expect(names(ninth.notes)).toEqual(["C4", "E4", "G4", "B4", "D5"]);
    expect(ninth.name).toBe("Cmaj9");
    expect(buildChord({ keyPitchClass: C, scale: "major", degree: 5, layout: "ninth" }).name)
      .toBe("G9");
  });

  it("puts the third in the bass for the first inversion", () => {
    const inv = buildChord({ keyPitchClass: C, scale: "major", degree: 1, layout: "firstInversion" });
    expect(names(inv.notes)).toEqual(["E4", "G4", "C5"]);
  });
});

describe("nameChord", () => {
  const at = (root: string, offsets: number[]) => {
    const r = noteNameToMidi(root);
    return nameChord(r, offsets.map((o) => r + o));
  };

  it("names the common shapes", () => {
    expect(at("C4", [0, 4, 7])).toBe("C");
    expect(at("A4", [0, 3, 7])).toBe("Am");
    expect(at("B4", [0, 3, 6])).toBe("Bdim");
    expect(at("C4", [0, 2, 7])).toBe("Csus2");
    expect(at("C4", [0, 5, 7])).toBe("Csus4");
    expect(at("F#4", [0, 3, 7, 10])).toBe("F#m7");
    expect(at("G4", [0, 4, 7, 10])).toBe("G7");
    expect(at("C4", [0, 4, 7, 11])).toBe("Cmaj7");
  });

  it("handles the awkward ones Finger Layout can produce", () => {
    expect(at("B4", [0, 3, 6, 10])).toBe("Bm7b5");
    expect(at("C4", [0, 4, 8])).toBe("Caug");
    expect(at("D4", [0, 3, 7, 10, 14])).toBe("Dm9");
  });
});

describe("voiceLead", () => {
  const CMAJ = [60, 64, 67];

  it("passes the chord straight through when there is no previous chord", () => {
    const notes = [60, 64, 67];
    expect(voiceLead(notes, null)).toEqual([60, 64, 67]);
  });

  it("keeps the top voice near the previous chord's top voice", () => {
    // C major (top G4=67) into F major. Root position F would jump the top
    // voice to C5=72; the inversion topping out at A4=69 is closer.
    const f = [65, 69, 72];
    const led = voiceLead(f, CMAJ);
    const top = led[led.length - 1];
    expect(Math.abs(top - 67)).toBeLessThanOrEqual(Math.abs(72 - 67));
    expect(top).toBe(69);
  });

  it("breaks top-note ties by total voice movement", () => {
    // Both [57,60,65] and [60,65,69] move the top voice 2 semitones from G4.
    // The second barely moves the inner voices, so it should win.
    expect(voiceLead([65, 69, 72], CMAJ)).toEqual([60, 65, 69]);
  });

  it("preserves the chord's pitch classes", () => {
    const original = new Set([65, 69, 72].map((n) => n % 12));
    const led = voiceLead([65, 69, 72], CMAJ);
    expect(new Set(led.map((n) => n % 12))).toEqual(original);
  });

  it("keeps voicings inside the playable register over a long walk", () => {
    // Ascending degrees repeatedly would run off the keyboard without the
    // register clamp; check a long progression stays put.
    let prev: number[] | null = null;
    for (let i = 0; i < 200; i++) {
      const degree = (i % 7) + 1;
      const chord = buildVoicedChord(
        { keyPitchClass: A, scale: "major", degree, style: "maj7" },
        prev,
      );
      expect(Math.min(...chord.notes)).toBeGreaterThanOrEqual(36);
      expect(Math.max(...chord.notes)).toBeLessThanOrEqual(88);
      prev = chord.notes;
    }
  });

  it("never leaps the top voice more than a tritone between neighbours", () => {
    let prev: number[] | null = null;
    for (const degree of [1, 5, 6, 4, 1, 5, 6, 4, 2, 7, 3]) {
      const chord = buildVoicedChord({ keyPitchClass: C, scale: "major", degree, style: "major" }, prev);
      const next = chord.notes[chord.notes.length - 1];
      if (prev !== null) expect(Math.abs(next - prev[prev.length - 1])).toBeLessThanOrEqual(6);
      prev = chord.notes;
    }
  });
});

describe("sameNotes", () => {
  it("is the retrigger test: identical arrays only", () => {
    expect(sameNotes([60, 64, 67], [60, 64, 67])).toBe(true);
    expect(sameNotes([60, 64, 67], [60, 64, 68])).toBe(false);
    expect(sameNotes([60, 64], [60, 64, 67])).toBe(false);
  });
});
