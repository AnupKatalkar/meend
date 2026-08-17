import { describe, expect, it } from "vitest";
import { TALAS, beatRole, talaById, thekaFor, vibhagStarts } from "./tala.ts";

describe("tala definitions", () => {
  it("has vibhags that sum to the matra count", () => {
    for (const tala of TALAS) {
      const sum = tala.vibhags.reduce((a, b) => a + b, 0);
      expect(sum, tala.name).toBe(tala.matras);
    }
  });

  it("has one theka syllable per matra", () => {
    for (const tala of TALAS) {
      expect(tala.theka.length, tala.name).toBe(tala.matras);
    }
  });

  it("keeps tali and khali inside the cycle and disjoint", () => {
    for (const tala of TALAS) {
      for (const beat of [...tala.tali, ...tala.khali]) {
        expect(beat, tala.name).toBeGreaterThanOrEqual(1);
        expect(beat, tala.name).toBeLessThanOrEqual(tala.matras);
      }
      const overlap = tala.tali.filter((b) => tala.khali.includes(b));
      expect(overlap, `${tala.name} cannot clap and wave the same beat`).toEqual([]);
    }
  });

  it("starts every vibhag on a tali or khali beat", () => {
    // A vibhag boundary that is neither clapped nor waved would be unmarked,
    // which is not how any of these talas work.
    for (const tala of TALAS) {
      for (const start of vibhagStarts(tala)) {
        const marked = tala.tali.includes(start) || tala.khali.includes(start);
        expect(marked, `${tala.name} beat ${start}`).toBe(true);
      }
    }
  });

  it("falls back to Teental for an unknown id", () => {
    expect(talaById("nonsense").id).toBe("teental");
  });
});

describe("beatRole", () => {
  it("marks sam, tali and khali in Teental", () => {
    const teental = talaById("teental");
    expect(beatRole(teental, 1)).toBe("sam");
    expect(beatRole(teental, 5)).toBe("tali");
    expect(beatRole(teental, 9)).toBe("khali");
    expect(beatRole(teental, 13)).toBe("tali");
    expect(beatRole(teental, 2)).toBe("beat");
  });

  // Rupak is the odd one out: its sam is a wave, not a clap. Treating beat one
  // as always accented would get this tala backwards.
  it("treats Rupak's sam as khali", () => {
    const rupak = talaById("rupak");
    expect(beatRole(rupak, 1)).toBe("khali");
    expect(beatRole(rupak, 4)).toBe("tali");
    expect(beatRole(rupak, 6)).toBe("tali");
  });

  it("wraps around the cycle", () => {
    const keherwa = talaById("keherwa"); // 8 matras
    expect(beatRole(keherwa, 9)).toBe(beatRole(keherwa, 1));
    expect(beatRole(keherwa, 13)).toBe(beatRole(keherwa, 5));
  });

  it("gives every beat of every tala a role", () => {
    for (const tala of TALAS) {
      for (let beat = 1; beat <= tala.matras; beat++) {
        expect(["sam", "tali", "khali", "beat"]).toContain(beatRole(tala, beat));
      }
    }
  });
});

describe("vibhagStarts", () => {
  it("groups Teental into four fours", () => {
    expect(vibhagStarts(talaById("teental"))).toEqual([1, 5, 9, 13]);
  });

  it("groups Jhaptal 2-3-2-3", () => {
    expect(vibhagStarts(talaById("jhaptal"))).toEqual([1, 3, 6, 8]);
  });
});

describe("thekaFor", () => {
  it("returns the syllable for the beat", () => {
    expect(thekaFor(talaById("teental"), 1)).toBe("Dha");
    expect(thekaFor(talaById("teental"), 10)).toBe("Tin");
  });

  it("wraps past the end of the cycle", () => {
    const teental = talaById("teental");
    expect(thekaFor(teental, 17)).toBe(thekaFor(teental, 1));
  });
});
