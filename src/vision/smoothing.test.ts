import { describe, expect, it } from "vitest";
import {
  DEFAULT_DEBOUNCE,
  Debouncer,
  EMA,
  OneEuroFilter,
  PresenceGate,
  SchmittTrigger,
} from "./smoothing.ts";

const DT = 1 / 30; // one frame at the tracking rate

/** Deterministic pseudo-noise, so a flaky seed can never make CI lie. */
function noise(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296 - 0.5;
  };
}

describe("OneEuroFilter", () => {
  it("settles on a constant input", () => {
    const f = new OneEuroFilter();
    let out = 0;
    for (let i = 0; i < 120; i++) out = f.filter(0.75, DT);
    expect(out).toBeCloseTo(0.75, 4);
  });

  it("adopts the first sample rather than ramping up from zero", () => {
    const f = new OneEuroFilter();
    expect(f.filter(0.9, DT)).toBeCloseTo(0.9, 6);
  });

  it("substantially reduces jitter on a still hand", () => {
    const rand = noise(7);
    const f = new OneEuroFilter();
    let rawEnergy = 0;
    let filteredEnergy = 0;
    let prevRaw = 0.5;
    let prevOut = f.filter(0.5, DT);
    for (let i = 0; i < 300; i++) {
      const raw = 0.5 + rand() * 0.06;
      const out = f.filter(raw, DT);
      rawEnergy += Math.abs(raw - prevRaw);
      filteredEnergy += Math.abs(out - prevOut);
      prevRaw = raw;
      prevOut = out;
    }
    // Frame-to-frame movement is what you hear as zipper noise.
    expect(filteredEnergy).toBeLessThan(rawEnergy * 0.25);
  });

  it("tracks a fast sweep without falling far behind", () => {
    // A hand sweeping bottom to top in half a second.
    const f = new OneEuroFilter();
    let out = 0;
    let value = 0;
    for (let i = 0; i < 15; i++) {
      value = i / 14;
      out = f.filter(value, DT);
    }
    // Holding still afterwards, it must arrive quickly.
    for (let i = 0; i < 10; i++) out = f.filter(1, DT);
    expect(out).toBeGreaterThan(0.9);
  });

  it("lags less on fast movement than a fixed lowpass would", () => {
    // The adaptive cutoff is the whole point: compare against its own
    // behaviour at a crawl, where it should smooth much harder.
    const fast = new OneEuroFilter();
    const slow = new OneEuroFilter();
    let fastOut = 0;
    let slowOut = 0;
    for (let i = 1; i <= 10; i++) {
      fastOut = fast.filter(i * 0.1, DT); // 3.0 units/sec
      slowOut = slow.filter(i * 0.002, DT); // 0.06 units/sec
    }
    const fastLag = (10 * 0.1 - fastOut) / (10 * 0.1);
    const slowLag = (10 * 0.002 - slowOut) / (10 * 0.002);
    expect(fastLag).toBeLessThan(slowLag);
  });

  it("survives a zero or negative dt without producing NaN", () => {
    const f = new OneEuroFilter();
    expect(Number.isFinite(f.filter(0.5, 0))).toBe(true);
    expect(Number.isFinite(f.filter(0.5, -1))).toBe(true);
  });

  it("forgets its history on reset", () => {
    const f = new OneEuroFilter();
    for (let i = 0; i < 50; i++) f.filter(1, DT);
    f.reset();
    expect(f.filter(0, DT)).toBeCloseTo(0, 6);
  });
});

describe("EMA", () => {
  it("adopts the first sample then converges", () => {
    const e = new EMA(0.2);
    expect(e.filter(10)).toBe(10);
    for (let i = 0; i < 200; i++) e.filter(0);
    expect(e.value).toBeCloseTo(0, 4);
  });
});

describe("Debouncer", () => {
  const make = () => new Debouncer<number>(0, DEFAULT_DEBOUNCE);

  it("requires 3 consecutive frames to commit a new gesture", () => {
    const d = make();
    expect(d.push(3)).toBe(0);
    expect(d.push(3)).toBe(0);
    expect(d.push(3)).toBe(3); // third frame commits
  });

  it("requires 6 consecutive frames to fall back to idle", () => {
    const d = make();
    for (let i = 0; i < 3; i++) d.push(3);
    expect(d.value).toBe(3);
    for (let i = 0; i < 5; i++) expect(d.push(0)).toBe(3);
    expect(d.push(0)).toBe(0); // sixth frame releases
  });

  it("ignores a single-frame misread", () => {
    const d = make();
    for (let i = 0; i < 3; i++) d.push(3);
    expect(d.push(4)).toBe(3); // one bad frame
    expect(d.push(3)).toBe(3);
    expect(d.value).toBe(3);
  });

  it("ignores alternating noise that never forms a streak", () => {
    const d = make();
    for (let i = 0; i < 3; i++) d.push(3);
    for (let i = 0; i < 60; i++) d.push(i % 2 === 0 ? 4 : 3);
    expect(d.value).toBe(3);
  });

  // Acceptance criterion: a steady 3-finger hand for 10 seconds must produce
  // exactly one chord attack, not a stream of retriggers.
  it("commits once across 10 seconds of a held gesture with realistic misreads", () => {
    const rand = noise(42);
    const d = make();
    const commits: number[] = [];
    let last = d.value;
    for (let frame = 0; frame < 300; frame++) {
      // 8% of frames misread the finger count, as a real tracker does.
      const raw = rand() + 0.5 < 0.08 ? (rand() + 0.5 < 0.5 ? 2 : 4) : 3;
      const committed = d.push(raw);
      if (committed !== last) {
        commits.push(committed);
        last = committed;
      }
    }
    expect(commits).toEqual([3]);
  });

  it("still switches promptly on a deliberate change", () => {
    const d = make();
    for (let i = 0; i < 3; i++) d.push(3);
    for (let i = 0; i < 3; i++) d.push(5);
    expect(d.value).toBe(5);
  });

  it("uses the supplied equality for structural values", () => {
    const d = new Debouncer<number[]>(
      [],
      DEFAULT_DEBOUNCE,
      (a, b) => a.length === b.length && a.every((v, i) => v === b[i]),
    );
    for (let i = 0; i < 3; i++) d.push([60, 64, 67]);
    expect(d.value).toEqual([60, 64, 67]);
    // A structurally identical array must not read as a change.
    expect(d.push([60, 64, 67])).toEqual([60, 64, 67]);
  });
});

describe("PresenceGate", () => {
  it("holds through a brief dropout", () => {
    const g = new PresenceGate(250);
    expect(g.update(true, 1000)).toBe(true);
    expect(g.update(false, 1100)).toBe(true); // 100ms gap: keep the note
    expect(g.update(false, 1240)).toBe(true); // 240ms: still holding
    expect(g.update(true, 1260)).toBe(true);
  });

  it("releases once the hand is really gone", () => {
    const g = new PresenceGate(250);
    g.update(true, 1000);
    expect(g.update(false, 1300)).toBe(false);
  });

  it("starts absent", () => {
    expect(new PresenceGate().update(false, 0)).toBe(false);
  });
});

describe("SchmittTrigger", () => {
  it("does not chatter for a hand hovering on the boundary", () => {
    const t = new SchmittTrigger(0.35, 0.2);
    const rand = noise(11);
    t.update(0.5); // commit to the positive side
    expect(t.value).toBe(1);
    let flips = 0;
    let last = t.value;
    for (let i = 0; i < 200; i++) {
      const v = 0.3 + rand() * 0.1; // wobbling just under the enter threshold
      const s = t.update(v);
      if (s !== last) flips++;
      last = s;
    }
    expect(flips).toBe(0);
  });

  it("switches when the hand genuinely crosses over", () => {
    const t = new SchmittTrigger(0.35, 0.2);
    expect(t.update(0.6)).toBe(1);
    expect(t.update(0.1)).toBe(0);
    expect(t.update(-0.6)).toBe(-1);
    expect(t.update(0.6)).toBe(1);
  });
});
