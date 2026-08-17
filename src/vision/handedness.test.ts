import { describe, expect, it } from "vitest";
import {
  ASSUMED_INVERTED,
  HandednessCalibrator,
  labelForRole,
  roleForLabel,
} from "./handedness.ts";

/** Never touch real localStorage from a test: the calibrator would leak state
 *  between cases and, in a browser test runner, between runs. */
const fresh = () => new HandednessCalibrator({ persist: false });

/** One frame of two hands, positioned so the player's left is on the right of
 *  the raw image. `leftHandLabel` is what MediaPipe called that hand. */
function feed(cal: HandednessCalibrator, leftHandLabel: string, frames: number): void {
  const otherLabel = leftHandLabel === "Right" ? "Left" : "Right";
  for (let i = 0; i < frames; i++) {
    // x 0.75 is the player's left hand, x 0.25 is their right.
    cal.observe(leftHandLabel, 0.75, otherLabel, 0.25);
  }
}

describe("roleForLabel", () => {
  it("maps the player's left hand to harmony when labels are inverted", () => {
    expect(roleForLabel("Right", false, true)).toBe("harmony");
    expect(roleForLabel("Left", false, true)).toBe("expression");
  });

  it("maps the player's left hand to harmony when labels are direct", () => {
    expect(roleForLabel("Left", false, false)).toBe("harmony");
    expect(roleForLabel("Right", false, false)).toBe("expression");
  });

  it("swapHands exchanges the two roles under either polarity", () => {
    for (const inverted of [true, false]) {
      for (const label of ["Left", "Right"]) {
        expect(roleForLabel(label, true, inverted)).not.toBe(roleForLabel(label, false, inverted));
      }
    }
  });
});

describe("labelForRole", () => {
  it("round-trips with roleForLabel for every combination", () => {
    for (const inverted of [true, false]) {
      for (const swap of [true, false]) {
        for (const role of ["harmony", "expression"] as const) {
          const label = labelForRole(role, swap, inverted);
          expect(roleForLabel(label, swap, inverted)).toBe(role);
        }
      }
    }
  });
});

describe("HandednessCalibrator", () => {
  it("starts on the documented prior and reports itself unmeasured", () => {
    const cal = fresh();
    expect(cal.inverted).toBe(ASSUMED_INVERTED);
    expect(cal.measured).toBe(false);
    expect(cal.confidence).toBe(0);
  });

  it("confirms inverted labels when the right-of-frame hand is called Right", () => {
    const cal = fresh();
    feed(cal, "Right", 12);
    expect(cal.measured).toBe(true);
    expect(cal.inverted).toBe(true);
    expect(cal.confidence).toBe(1);
  });

  it("corrects itself to direct labels when the evidence says so", () => {
    const cal = fresh();
    feed(cal, "Left", 12);
    expect(cal.measured).toBe(true);
    expect(cal.inverted).toBe(false);
    // And the mapping follows immediately.
    expect(cal.roleFor("Left", false)).toBe("harmony");
  });

  it("ignores frames where both hands carry the same label", () => {
    const cal = fresh();
    for (let i = 0; i < 50; i++) cal.observe("Left", 0.75, "Left", 0.25);
    expect(cal.measured).toBe(false);
    expect(cal.votes).toBe(0);
  });

  it("ignores overlapping hands, whose left-right order is noise", () => {
    const cal = fresh();
    for (let i = 0; i < 50; i++) cal.observe("Left", 0.51, "Right", 0.5);
    expect(cal.measured).toBe(false);
  });

  it("ignores non-finite coordinates", () => {
    const cal = fresh();
    for (let i = 0; i < 50; i++) cal.observe("Left", Number.NaN, "Right", 0.2);
    expect(cal.votes).toBe(0);
  });

  it("does not flip on a brief spell of crossed arms", () => {
    const cal = fresh();
    feed(cal, "Right", 30); // settled: labels are inverted
    feed(cal, "Left", 8); // arms crossed for a quarter of a second
    expect(cal.inverted).toBe(true);
  });

  it("does flip when the contrary evidence is sustained", () => {
    const cal = fresh();
    feed(cal, "Right", 30);
    feed(cal, "Left", 60);
    expect(cal.inverted).toBe(false);
  });

  it("recovers within a bounded number of frames rather than unwinding history", () => {
    const cal = fresh();
    feed(cal, "Right", 5000);
    feed(cal, "Left", 60);
    expect(cal.inverted).toBe(false);
  });

  it("reset returns to the prior", () => {
    const cal = fresh();
    feed(cal, "Left", 20);
    expect(cal.inverted).toBe(false);
    cal.reset();
    expect(cal.inverted).toBe(ASSUMED_INVERTED);
    expect(cal.measured).toBe(false);
    expect(cal.votes).toBe(0);
  });

  it("keeps roleFor and labelFor consistent as polarity changes", () => {
    const cal = fresh();
    for (const label of ["Left", "Right"]) {
      const before = cal.roleFor(label, false);
      expect(cal.labelFor(before, false)).toBe(label);
    }
    feed(cal, "Left", 20);
    for (const label of ["Left", "Right"]) {
      const after = cal.roleFor(label, false);
      expect(cal.labelFor(after, false)).toBe(label);
    }
  });
});
