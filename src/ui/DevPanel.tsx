import { useEffect, useRef, useState } from "react";
import type { Conductor } from "../engine/Conductor.ts";
import { parseClip } from "../vision/replay.ts";
import { useStore } from "../state/store.ts";
import { telemetry } from "../state/telemetry.ts";
import { Button, Field, Slider } from "./controls.tsx";

const FINGERS = ["thumb", "index", "middle", "ring", "pinky"] as const;

/**
 * Live tracking readouts and the threshold tuning the spec asks to keep
 * adjustable against real footage. Everything here reads telemetry on its own
 * rAF and writes to DOM refs -- no per-frame React state.
 */
export default function DevPanel({ conductor }: { conductor: Conductor }) {
  const thresholds = useStore((s) => s.thresholds);
  const debounce = useStore((s) => s.debounce);
  const set = useStore((s) => s.set);
  const readoutRef = useRef<HTMLPreElement>(null);
  const [replaying, setReplaying] = useState(false);
  const [recordingLandmarks, setRecordingLandmarks] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const el = readoutRef.current;
      if (!el) return;
      const h = telemetry.harmony;
      const e = telemetry.expression;
      const hand = conductor.tracker.handedness;
      const fmt = (hand: typeof h) =>
        hand
          ? [
              FINGERS.map((f) => `${f[0].toUpperCase()}${hand.fingers[f] ? "1" : "0"}`).join(" "),
              `count ${hand.fingerCount}`,
              `tilt ${hand.tilt.toFixed(2)}`,
              `height ${hand.height.toFixed(2)}`,
              `pinch ${Number.isFinite(hand.pinch) ? hand.pinch.toFixed(2) : "-"}`,
            ].join("  ")
          : "not detected";

      el.textContent = [
        `fps        ${telemetry.fps.toFixed(1)}${telemetry.idle ? "  (idle throttle)" : ""}`,
        `detect     ${telemetry.detectMs.toFixed(1)} ms`,
        `latency    ${telemetry.latencyMs.toFixed(1)} ms  (gesture -> sound)`,
        `degree     ${telemetry.degree ?? "-"}   octave ${telemetry.octaveShift}`,
        `cutoff     ${telemetry.cutoffHz > 0 ? `${Math.round(telemetry.cutoffHz)} Hz` : "-"}`,
        `volume     ${telemetry.volume.toFixed(2)}`,
        ``,
        `harmony    ${fmt(h)}`,
        `expression ${fmt(e)}`,
        ``,
        `raw labels ${conductor.tracker.rawLabels.join(", ") || "-"}`,
        `handedness ${hand.inverted ? "labels inverted" : "labels direct"}  ` +
          `${hand.measured ? "measured" : "assumed"}  ` +
          `confidence ${(hand.confidence * 100).toFixed(0)}%  votes ${hand.votes}`,
      ].join("\n");
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [conductor]);

  const downloadClip = () => {
    const clip = conductor.landmarkRecorder.stop();
    setRecordingLandmarks(false);
    const blob = new Blob([JSON.stringify(clip)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `landmarks-${clip.frames.length}f.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMessage(`Saved ${clip.frames.length} frames.`);
  };

  const loadClip = async (file: File) => {
    try {
      const clip = parseClip(await file.text());
      conductor.playClip(clip);
      setReplaying(true);
      setMessage(`Replaying ${clip.frames.length} frames on a loop.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not read that clip.");
    }
  };

  return (
    <div className="space-y-4 rounded-lg border border-[var(--color-edge)] bg-[var(--color-ink-soft)] p-3">
      <pre
        ref={readoutRef}
        className="overflow-x-auto whitespace-pre text-[10px] leading-relaxed text-[var(--color-muted)]"
        aria-live="off"
      />

      <div className="space-y-2 rounded border border-[var(--color-edge)]/60 p-2">
        <p className="text-[10px] leading-snug text-[var(--color-muted)]/80">
          Handedness is measured, not assumed. Hold both hands up for a second or two and the
          readout moves from &ldquo;assumed&rdquo; to &ldquo;measured&rdquo;: with two hands in
          frame the app can tell which label sits on which side and correct itself. Spot check by
          holding up only your left hand, which should light the Harmony pill.
        </p>
        <Button
          onClick={() => {
            conductor.tracker.handedness.reset();
            setMessage("Handedness reset. Show both hands to re-measure.");
          }}
        >
          Reset handedness
        </Button>
      </div>

      <Field label="Finger extension ratio" hint="Higher demands a straighter finger.">
        {(id) => (
          <Slider
            id={id}
            value={thresholds.extensionRatio}
            min={1.0}
            max={1.5}
            step={0.01}
            onChange={(v) => set("thresholds", { ...thresholds, extensionRatio: v })}
            format={(v) => v.toFixed(2)}
          />
        )}
      </Field>
      <Field label="Thumb ratio">
        {(id) => (
          <Slider
            id={id}
            value={thresholds.thumbRatio}
            min={1.0}
            max={1.5}
            step={0.01}
            onChange={(v) => set("thresholds", { ...thresholds, thumbRatio: v })}
            format={(v) => v.toFixed(2)}
          />
        )}
      </Field>
      <Field label="Pinch threshold">
        {(id) => (
          <Slider
            id={id}
            value={thresholds.pinchThreshold}
            min={0.15}
            max={0.8}
            step={0.01}
            onChange={(v) => set("thresholds", { ...thresholds, pinchThreshold: v })}
            format={(v) => v.toFixed(2)}
          />
        )}
      </Field>
      <Field label="Frames to enter a gesture">
        {(id) => (
          <Slider
            id={id}
            value={debounce.enterFrames}
            min={1}
            max={10}
            onChange={(v) => set("debounce", { ...debounce, enterFrames: v })}
          />
        )}
      </Field>
      <Field label="Frames to release">
        {(id) => (
          <Slider
            id={id}
            value={debounce.exitFrames}
            min={1}
            max={20}
            onChange={(v) => set("debounce", { ...debounce, exitFrames: v })}
          />
        )}
      </Field>

      <div className="flex flex-wrap gap-2">
        {recordingLandmarks ? (
          <Button variant="primary" onClick={downloadClip}>
            Stop &amp; save clip
          </Button>
        ) : (
          <Button
            onClick={() => {
              conductor.landmarkRecorder.start(performance.now());
              setRecordingLandmarks(true);
              setMessage("Recording landmarks…");
            }}
          >
            Record landmarks
          </Button>
        )}
        {replaying ? (
          <Button
            onClick={() => {
              conductor.stopClip();
              setReplaying(false);
              setMessage("Back to live camera.");
            }}
          >
            Stop replay
          </Button>
        ) : (
          <label className="cursor-pointer rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel)] px-4 py-2 text-sm">
            Load clip
            <input
              type="file"
              accept="application/json"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void loadClip(file);
              }}
            />
          </label>
        )}
      </div>
      {message && <p className="text-[11px] text-[var(--color-muted)]">{message}</p>}
    </div>
  );
}
