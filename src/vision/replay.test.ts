import { describe, expect, it } from "vitest";
import { LandmarkRecorder, ReplayPlayer, parseClip, type ReplayClip } from "./replay.ts";
import { HARMONY_GESTURES, makeHand } from "./fixtures/handShapes.ts";

function makeClip(frameCount: number, stepMs = 33): ReplayClip {
  return {
    version: 1,
    fps: 30,
    durationMs: (frameCount - 1) * stepMs,
    frames: Array.from({ length: frameCount }, (_, i) => ({
      t: i * stepMs,
      hands: [{ label: "Right", score: 1, landmarks: makeHand(HARMONY_GESTURES.three) }],
    })),
  };
}

describe("ReplayPlayer", () => {
  it("returns frames in order as the clock advances", () => {
    const player = new ReplayPlayer(makeClip(5));
    player.start(1000);
    expect(player.frameAt(1000)?.t).toBe(0);
    expect(player.frameAt(1035)?.t).toBe(33);
    expect(player.frameAt(1070)?.t).toBe(66);
  });

  it("returns null when no new frame is due yet", () => {
    const player = new ReplayPlayer(makeClip(5));
    player.start(1000);
    expect(player.frameAt(1000)?.t).toBe(0);
    expect(player.frameAt(1010)).toBeNull();
  });

  it("skips to the newest due frame rather than replaying stale ones", () => {
    const player = new ReplayPlayer(makeClip(10));
    player.start(1000);
    // A long stall: we want where the clip is *now*, not a backlog.
    expect(player.frameAt(1150)?.t).toBe(132);
  });

  // The clip used to play exactly once and then go silent: the cursor ran off
  // the end and the wrap check read `frames[index]` as undefined.
  it("loops indefinitely instead of stopping after one pass", () => {
    const clip = makeClip(6);
    const player = new ReplayPlayer(clip);
    player.start(1000);

    let delivered = 0;
    // Four full clip lengths, stepped at roughly the frame rate.
    for (let t = 1000; t < 1000 + clip.durationMs * 4; t += 33) {
      if (player.frameAt(t)) delivered++;
    }
    expect(delivered).toBeGreaterThan(clip.frames.length * 3);
  });

  it("keeps delivering frames long after the clip duration", () => {
    const clip = makeClip(6);
    const player = new ReplayPlayer(clip);
    player.start(0);
    for (let t = 0; t < 5000; t += 33) player.frameAt(t);
    // Well past the end; must still be producing.
    let seen = 0;
    for (let t = 5000; t < 5500; t += 33) if (player.frameAt(t)) seen++;
    expect(seen).toBeGreaterThan(0);
  });

  it("handles an empty clip without throwing", () => {
    const player = new ReplayPlayer({ version: 1, fps: 30, durationMs: 0, frames: [] });
    player.start(0);
    expect(player.frameAt(100)).toBeNull();
  });
});

describe("LandmarkRecorder", () => {
  it("copies landmarks so pooled frames cannot mutate the recording", () => {
    const recorder = new LandmarkRecorder();
    const landmarks = makeHand(HARMONY_GESTURES.one);
    recorder.start(0);
    recorder.capture(33, [{ label: "Right", score: 1, landmarks }]);

    const originalX = landmarks[0].x;
    landmarks[0].x = 0.999; // the tracker reusing its pool

    const clip = recorder.stop();
    expect(clip.frames[0].hands[0].landmarks[0].x).toBeCloseTo(originalX, 4);
  });

  it("ignores captures before start and after stop", () => {
    const recorder = new LandmarkRecorder();
    recorder.capture(0, [{ label: "Right", score: 1, landmarks: makeHand(HARMONY_GESTURES.one) }]);
    expect(recorder.frameCount).toBe(0);

    recorder.start(0);
    recorder.capture(10, [{ label: "Right", score: 1, landmarks: makeHand(HARMONY_GESTURES.one) }]);
    recorder.stop();
    recorder.capture(20, [{ label: "Right", score: 1, landmarks: makeHand(HARMONY_GESTURES.one) }]);
    expect(recorder.frameCount).toBe(1);
  });

  it("round-trips through parseClip", () => {
    const recorder = new LandmarkRecorder();
    recorder.start(0);
    recorder.capture(0, [{ label: "Right", score: 1, landmarks: makeHand(HARMONY_GESTURES.five) }]);
    const json = JSON.stringify(recorder.stop());
    expect(parseClip(json).frames).toHaveLength(1);
  });

  it("rejects something that is not a clip", () => {
    expect(() => parseClip('{"version":99}')).toThrow();
  });
});
