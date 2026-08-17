import { describe, expect, it } from "vitest";
import {
  DEFAULT_THRESHOLDS,
  classifyDegree,
  classifyFingers,
  countFingers,
  handHeight,
  pinchDistance,
  wristTilt,
  wristTiltRadians,
} from "./fingers.ts";
import { HARMONY_GESTURES, fingers, makeHand } from "./fixtures/handShapes.ts";
import type { FingerState } from "./types.ts";

const deg = (d: number) => (d * Math.PI) / 180;

/** Every transform a real player produces: leaning, sitting near or far,
 *  standing off to one side of the frame. */
const TRANSFORMS = [
  { label: "upright, centred", t: {} },
  { label: "tilted left 30deg", t: { rotation: deg(-30) } },
  { label: "tilted right 30deg", t: { rotation: deg(30) } },
  { label: "tilted left 45deg", t: { rotation: deg(-45) } },
  { label: "tilted right 45deg", t: { rotation: deg(45) } },
  { label: "far from camera", t: { scale: 0.55 } },
  { label: "close to camera", t: { scale: 1.6 } },
  { label: "upper left of frame", t: { wrist: { x: 0.2, y: 0.35 } } },
  { label: "far + tilted", t: { scale: 0.6, rotation: deg(35) } },
];

describe("finger extension", () => {
  it("reads each canonical shape correctly", () => {
    for (const [name, spec] of Object.entries(HARMONY_GESTURES)) {
      const got = classifyFingers(makeHand(spec));
      expect(got, `gesture "${name}"`).toEqual(spec);
    }
  });

  // This is the whole reason for the wrist-distance test over `tip.y < pip.y`.
  it("is invariant to rotation, distance and position", () => {
    for (const [name, spec] of Object.entries(HARMONY_GESTURES)) {
      for (const { label, t } of TRANSFORMS) {
        const got = classifyFingers(makeHand(spec, t));
        expect(got, `gesture "${name}" @ ${label}`).toEqual(spec);
      }
    }
  });

  it("counts fingers", () => {
    expect(countFingers(HARMONY_GESTURES.fist)).toBe(0);
    expect(countFingers(HARMONY_GESTURES.three)).toBe(3);
    expect(countFingers(HARMONY_GESTURES.five)).toBe(5);
    expect(countFingers(HARMONY_GESTURES.hornsThumb)).toBe(3);
  });

  it("separates the thumb from the fingers it sits next to", () => {
    // Thumb-only is the shape most likely to be misread as a fist.
    const thumbOnly = classifyFingers(makeHand(fingers("thumb")));
    expect(thumbOnly.thumb).toBe(true);
    expect(countFingers(thumbOnly)).toBe(1);
  });
});

describe("classifyDegree", () => {
  it("maps the spec's eight gestures to the right degrees", () => {
    const table: Array<[FingerState, number, string]> = [
      [HARMONY_GESTURES.fist, 0, "closed fist -> mute"],
      [HARMONY_GESTURES.one, 1, "1 finger -> I"],
      [HARMONY_GESTURES.two, 2, "2 fingers -> ii"],
      [HARMONY_GESTURES.three, 3, "3 fingers -> iii"],
      [HARMONY_GESTURES.four, 4, "4 fingers -> IV"],
      [HARMONY_GESTURES.five, 5, "5 fingers -> V"],
      [HARMONY_GESTURES.horns, 6, "index+pinky -> vi"],
      [HARMONY_GESTURES.hornsThumb, 7, "index+pinky+thumb -> vii"],
    ];
    for (const [spec, expected, label] of table) {
      expect(classifyDegree(spec), label).toBe(expected);
    }
  });

  // The ordering bug the spec warns about: without the exact-combo tests
  // first, index+pinky falls through to "any 2 fingers" and reads as ii.
  it("tests the vi and vii combos before falling back to finger counts", () => {
    expect(classifyDegree(fingers("index", "pinky"))).toBe(6);
    expect(classifyDegree(fingers("index", "middle"))).toBe(2);
    expect(classifyDegree(fingers("index", "pinky", "thumb"))).toBe(7);
    expect(classifyDegree(fingers("index", "middle", "ring"))).toBe(3);
  });

  it("does not confuse other 2- and 3-finger shapes with vi and vii", () => {
    expect(classifyDegree(fingers("middle", "ring"))).toBe(2);
    expect(classifyDegree(fingers("thumb", "pinky"))).toBe(2);
    expect(classifyDegree(fingers("index", "middle", "pinky"))).toBe(3);
  });

  it("resolves every gesture through the full landmark pipeline, transformed", () => {
    const expected: Array<[keyof typeof HARMONY_GESTURES, number]> = [
      ["fist", 0], ["one", 1], ["two", 2], ["three", 3],
      ["four", 4], ["five", 5], ["horns", 6], ["hornsThumb", 7],
    ];
    for (const [name, degree] of expected) {
      for (const { label, t } of TRANSFORMS) {
        const lm = makeHand(HARMONY_GESTURES[name], t);
        expect(classifyDegree(classifyFingers(lm)), `${name} @ ${label}`).toBe(degree);
      }
    }
  });
});

describe("wrist tilt", () => {
  it("reads zero for an upright hand", () => {
    expect(wristTiltRadians(makeHand(HARMONY_GESTURES.five))).toBeCloseTo(0, 6);
  });

  it("recovers the applied rotation", () => {
    for (const d of [-45, -30, -10, 0, 10, 30, 45]) {
      const lm = makeHand(HARMONY_GESTURES.five, { rotation: deg(d) });
      expect(wristTiltRadians(lm), `${d} degrees`).toBeCloseTo(deg(d), 5);
    }
  });

  it("normalizes to [-1,1] across the usable range and clamps past it", () => {
    expect(wristTilt(makeHand(HARMONY_GESTURES.five, { rotation: deg(50) }))).toBeCloseTo(1, 4);
    expect(wristTilt(makeHand(HARMONY_GESTURES.five, { rotation: deg(-50) }))).toBeCloseTo(-1, 4);
    expect(wristTilt(makeHand(HARMONY_GESTURES.five, { rotation: deg(80) }))).toBe(1);
    expect(wristTilt(makeHand(HARMONY_GESTURES.five, { rotation: deg(-80) }))).toBe(-1);
    expect(wristTilt(makeHand(HARMONY_GESTURES.five, { rotation: deg(25) }))).toBeCloseTo(0.5, 2);
  });

  it("is unaffected by how far away the hand is", () => {
    const near = wristTilt(makeHand(HARMONY_GESTURES.five, { rotation: deg(20), scale: 1.5 }));
    const far = wristTilt(makeHand(HARMONY_GESTURES.five, { rotation: deg(20), scale: 0.5 }));
    expect(near).toBeCloseTo(far, 6);
  });
});

describe("pinch", () => {
  it("is well above the threshold with the hand open", () => {
    const open = pinchDistance(makeHand(fingers("thumb", "index")));
    expect(open).toBeGreaterThan(DEFAULT_THRESHOLDS.pinchThreshold);
  });

  it("drops below the threshold when the tips meet", () => {
    const pinched = pinchDistance(makeHand(fingers("thumb", "index"), { pinch: 1 }));
    expect(pinched).toBeLessThan(DEFAULT_THRESHOLDS.pinchThreshold);
  });

  it("uses the same threshold near and far from the camera", () => {
    for (const scale of [0.5, 1, 1.8]) {
      const pinched = pinchDistance(makeHand(fingers("thumb", "index"), { pinch: 1, scale }));
      const open = pinchDistance(makeHand(fingers("thumb", "index"), { scale }));
      expect(pinched, `pinched @ scale ${scale}`).toBeLessThan(DEFAULT_THRESHOLDS.pinchThreshold);
      expect(open, `open @ scale ${scale}`).toBeGreaterThan(DEFAULT_THRESHOLDS.pinchThreshold);
    }
  });
});

describe("hand height", () => {
  it("is 0 at the bottom of frame and 1 at the top", () => {
    const low = handHeight(makeHand(HARMONY_GESTURES.five, { wrist: { x: 0.5, y: 1.18 } }));
    const high = handHeight(makeHand(HARMONY_GESTURES.five, { wrist: { x: 0.5, y: 0.18 } }));
    expect(low).toBeLessThan(0.05);
    expect(high).toBeGreaterThan(0.95);
  });

  it("rises monotonically as the hand rises", () => {
    let previous = -Infinity;
    for (let y = 1.1; y >= 0.2; y -= 0.1) {
      const h = handHeight(makeHand(HARMONY_GESTURES.five, { wrist: { x: 0.5, y } }));
      expect(h).toBeGreaterThan(previous);
      previous = h;
    }
  });
});
