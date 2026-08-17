import { describe, expect, it } from "vitest";
import {
  RAGAS,
  SWARA_NAMES,
  positionCount,
  ragaById,
  snapToRaga,
  swaraAt,
  swaraName,
  tanpuraCompanion,
} from "./raga.ts";
import { NOTE_NAMES, midiToNoteName, noteNameToMidi } from "./theory.ts";

describe("swara naming", () => {
  it("names the twelve positions, komal in lowercase", () => {
    expect(swaraName(0)).toBe("Sa");
    expect(swaraName(1)).toBe("re"); // komal Rishabh
    expect(swaraName(2)).toBe("Re");
    expect(swaraName(6)).toBe("Ma'"); // tivra Madhyam
    expect(swaraName(7)).toBe("Pa");
    expect(swaraName(11)).toBe("Ni");
  });

  it("wraps into the octave above", () => {
    expect(swaraName(12)).toBe("Sa");
    expect(swaraName(16)).toBe("Ga");
  });
});

describe("raga definitions", () => {
  it("every raga starts on Sa in both directions", () => {
    for (const raga of RAGAS) {
      expect(raga.aroha[0], `${raga.name} aroha`).toBe(0);
      expect(raga.avaroha[0], `${raga.name} avaroha`).toBe(0);
    }
  });

  it("every raga stays within one octave and ascends", () => {
    for (const raga of RAGAS) {
      for (const line of [raga.aroha, raga.avaroha]) {
        expect(Math.max(...line), raga.name).toBeLessThan(12);
        const sorted = [...line].sort((a, b) => a - b);
        expect(line, `${raga.name} must be stored ascending`).toEqual(sorted);
        expect(new Set(line).size, `${raga.name} has duplicates`).toBe(line.length);
      }
    }
  });

  it("has at least five notes in each direction", () => {
    // Fewer than five would not be a functioning raga.
    for (const raga of RAGAS) {
      expect(raga.aroha.length, raga.name).toBeGreaterThanOrEqual(5);
      expect(raga.avaroha.length, raga.name).toBeGreaterThanOrEqual(5);
    }
  });

  it("places vadi and samvadi inside the raga", () => {
    for (const raga of RAGAS) {
      const all = new Set([...raga.aroha, ...raga.avaroha]);
      expect(all.has(raga.vadi), `${raga.name} vadi`).toBe(true);
      expect(all.has(raga.samvadi), `${raga.name} samvadi`).toBe(true);
    }
  });

  it("knows Yaman by its tivra Ma", () => {
    const yaman = ragaById("yaman");
    expect(yaman.aroha).toContain(6); // Ma'
    expect(yaman.aroha).not.toContain(5); // no shuddha Ma
  });

  it("knows Malkauns omits Re and Pa", () => {
    const malkauns = ragaById("malkauns");
    expect(malkauns.aroha).not.toContain(2);
    expect(malkauns.aroha).not.toContain(7);
    expect(malkauns.aroha).toHaveLength(5);
  });

  it("falls back to the first raga for an unknown id", () => {
    expect(ragaById("not-a-raga").id).toBe(RAGAS[0].id);
  });
});

describe("aroha and avaroha", () => {
  it("Des takes five notes up and seven down", () => {
    const des = ragaById("des");
    expect(positionCount(des, "aroha")).toBe(5);
    expect(positionCount(des, "avaroha")).toBe(7);
  });

  // The whole reason direction is tracked: the same gesture is a different
  // note depending on which way the phrase is moving.
  it("gives a different note for the same position depending on direction", () => {
    const des = ragaById("des");
    expect(swaraAt(des, 3, "aroha")).toBe(5); // Ma
    expect(swaraAt(des, 3, "avaroha")).toBe(4); // Ga
  });

  it("Khamaj skips Re going up but uses it coming down", () => {
    const khamaj = ragaById("khamaj");
    expect(khamaj.aroha).not.toContain(2);
    expect(khamaj.avaroha).toContain(2);
  });

  it("is symmetric for ragas that are", () => {
    const bhairav = ragaById("bhairav");
    for (let position = 1; position <= 7; position++) {
      expect(swaraAt(bhairav, position, "aroha")).toBe(swaraAt(bhairav, position, "avaroha"));
    }
  });
});

describe("swaraAt", () => {
  it("walks the raga in order", () => {
    const bhairav = ragaById("bhairav");
    const walked = [1, 2, 3, 4, 5, 6, 7].map((p) => swaraAt(bhairav, p, "aroha"));
    expect(walked).toEqual([0, 1, 4, 5, 7, 8, 11]);
  });

  // Pentatonic ragas have only five notes, but the gesture vocabulary offers
  // seven positions. They must continue upward rather than going dead.
  it("continues into the next octave past the end of a pentatonic raga", () => {
    const bhupali = ragaById("bhupali"); // [0,2,4,7,9]
    expect(swaraAt(bhupali, 5, "aroha")).toBe(9);
    expect(swaraAt(bhupali, 6, "aroha")).toBe(12); // Sa, octave up
    expect(swaraAt(bhupali, 7, "aroha")).toBe(14); // Re, octave up
  });

  it("clamps positions below one rather than reading off the front", () => {
    const yaman = ragaById("yaman");
    expect(swaraAt(yaman, 0, "aroha")).toBe(0);
    expect(swaraAt(yaman, -3, "aroha")).toBe(0);
  });
});

describe("tanpuraCompanion", () => {
  it("uses Pa when the raga has it", () => {
    expect(tanpuraCompanion(ragaById("yaman"))).toBe(7);
    expect(tanpuraCompanion(ragaById("bhairav"))).toBe(7);
  });

  // A drone sounding a note the raga excludes fights everything over it.
  it("retunes to Ma for Marwa, which has no Pa", () => {
    const marwa = ragaById("marwa");
    expect(marwa.aroha).not.toContain(7);
    expect(tanpuraCompanion(marwa)).not.toBe(7);
    expect(marwa.aroha).toContain(tanpuraCompanion(marwa));
  });

  it("always picks a note the raga actually contains", () => {
    for (const raga of RAGAS) {
      const all = new Set([...raga.aroha, ...raga.avaroha]);
      expect(all.has(tanpuraCompanion(raga)), raga.name).toBe(true);
    }
  });
});

describe("snapToRaga", () => {
  const C = NOTE_NAMES.indexOf("C");

  it("leaves notes of the raga alone", () => {
    const bhairav = ragaById("bhairav"); // Sa re Ga Ma Pa dha Ni
    for (const semitone of bhairav.aroha) {
      const midi = noteNameToMidi("C4") + semitone;
      expect(snapToRaga(midi, C, bhairav)).toBe(midi);
    }
  });

  it("pulls notes outside the raga to the nearest one inside it", () => {
    const bhupali = ragaById("bhupali"); // C D E G A
    // F (65) is not in Bhupali; E (64) and G (67) are, and E is nearer.
    expect(snapToRaga(65, C, bhupali)).toBe(64);
    expect(snapToRaga(66, C, bhupali)).toBe(67);
  });

  it("respects the direction's note set", () => {
    const des = ragaById("des");
    // Ga (E4 = 64) exists coming down but not going up.
    expect(snapToRaga(64, C, des, "avaroha")).toBe(64);
    expect(snapToRaga(64, C, des, "aroha")).not.toBe(64);
  });

  it("follows Sa to another pitch class", () => {
    const bhupali = ragaById("bhupali");
    const D = NOTE_NAMES.indexOf("D");
    // With Sa on D, D is in the raga and C# is not.
    expect(midiToNoteName(snapToRaga(noteNameToMidi("D4"), D, bhupali))).toBe("D4");
    expect(snapToRaga(noteNameToMidi("C#4"), D, bhupali)).toBe(noteNameToMidi("D4"));
  });

  it("works across octave boundaries", () => {
    const bhairav = ragaById("bhairav");
    expect(Number.isFinite(snapToRaga(83.6, C, bhairav))).toBe(true);
    expect(Number.isFinite(snapToRaga(36.2, C, bhairav))).toBe(true);
  });
});

describe("swara name coverage", () => {
  it("names every note of every raga", () => {
    for (const raga of RAGAS) {
      for (const note of [...raga.aroha, ...raga.avaroha]) {
        expect(SWARA_NAMES[note], `${raga.name} note ${note}`).toBeTruthy();
      }
    }
  });
});
