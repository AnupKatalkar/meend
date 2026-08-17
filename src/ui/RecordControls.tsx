import { useEffect, useMemo, useRef, useState } from "react";
import type { Conductor } from "../engine/Conductor.ts";
import {
  MAX_DURATION_MS,
  Recorder,
  type RecorderPhase,
  type RecordingResult,
  pickSupportedMime,
} from "../recording/Recorder.ts";
import { type CaptureType, useStore } from "../state/store.ts";
import { Button, Segmented, Toggle } from "./controls.tsx";

const CAPTURE_LABEL: Record<CaptureType, string> = {
  skeleton: "Skeleton only",
  video: "Full video",
  audio: "Audio only",
};

export default function RecordControls({ conductor }: { conductor: Conductor }) {
  const captureType = useStore((s) => s.captureType);
  const aspectRatio = useStore((s) => s.aspectRatio);
  const micMix = useStore((s) => s.micMix);
  const set = useStore((s) => s.set);

  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<RecorderPhase>("idle");
  const [countdown, setCountdown] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<RecordingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<Recorder | null>(null);

  useEffect(() => {
    const recorder = new Recorder(conductor, conductor.audio, {
      onPhase: setPhase,
      onCountdown: setCountdown,
      onElapsed: setElapsed,
      onResult: setResult,
      onError: setError,
    });
    recorderRef.current = recorder;
    return () => {
      // Revokes the object URL and tears down the media stream tap.
      recorder.dispose();
      recorderRef.current = null;
    };
  }, [conductor]);

  // Be honest about what the browser will actually produce, before recording.
  const format = useMemo(
    () => pickSupportedMime(captureType === "audio" ? "audio" : "video"),
    [captureType],
  );

  const begin = async () => {
    setError(null);
    setResult(null);
    await conductor.ensureAudio();
    await recorderRef.current?.begin({ captureType, aspect: aspectRatio, micMix });
  };

  const secondsLeft = Math.max(0, Math.ceil((MAX_DURATION_MS - elapsed) / 1000));
  const busy = phase === "countdown" || phase === "recording";

  return (
    <>
      <Button onClick={() => setOpen((v) => !v)} variant={busy ? "primary" : "secondary"}>
        {phase === "recording" ? `● ${secondsLeft}s` : "Record"}
      </Button>

      {open && (
        <div
          role="dialog"
          aria-label="Recording"
          className="absolute bottom-16 right-0 z-30 w-80 space-y-4 rounded-xl border border-[var(--color-edge)] bg-[var(--color-panel)]/97 p-4 backdrop-blur-md"
        >
          {phase === "idle" && (
            <>
              <Segmented<CaptureType>
                label="What to capture"
                value={captureType}
                onChange={(v) => set("captureType", v)}
                options={[
                  { value: "skeleton", label: "Skeleton" },
                  { value: "video", label: "Video" },
                  { value: "audio", label: "Audio" },
                ]}
              />
              <p className="text-[11px] leading-snug text-[var(--color-muted)]">
                {captureType === "skeleton"
                  ? "Neon skeleton on black — no camera imagery, safe to share anywhere."
                  : captureType === "video"
                    ? "Your mirrored camera feed with the skeleton drawn over it."
                    : "Sound only, no picture."}
              </p>

              <Toggle
                label="Mix in microphone"
                hint="Sing or narrate over the take."
                checked={micMix}
                onChange={(v) => set("micMix", v)}
              />

              <div className="flex items-center justify-between text-[11px] text-[var(--color-muted)]">
                <span>
                  {captureType === "audio" ? "Audio" : `${aspectRatio} · ${CAPTURE_LABEL[captureType]}`}
                </span>
                <span>{format.label}</span>
              </div>

              <Button variant="primary" onClick={() => void begin()} className="w-full">
                Record up to 30s
              </Button>
            </>
          )}

          {phase === "countdown" && (
            <div className="space-y-3 text-center">
              <p className="text-5xl font-semibold tabular-nums" aria-live="assertive">
                {countdown}
              </p>
              <Button onClick={() => recorderRef.current?.stop()} className="w-full">
                Cancel
              </Button>
            </div>
          )}

          {phase === "recording" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 font-medium text-[#ff6b6b]">
                  <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[#ff6b6b]" />
                  Recording
                </span>
                <span className="tabular-nums text-[var(--color-muted)]">
                  {(elapsed / 1000).toFixed(1)}s / 30s
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-edge)]">
                <div
                  className="h-full rounded-full bg-[#ff6b6b] transition-[width] duration-100"
                  style={{ width: `${Math.min((elapsed / MAX_DURATION_MS) * 100, 100)}%` }}
                />
              </div>
              <Button variant="primary" onClick={() => recorderRef.current?.stop()} className="w-full">
                Stop
              </Button>
            </div>
          )}

          {phase === "preview" && result && (
            <div className="space-y-3">
              {result.captureType === "audio" ? (
                <audio src={result.url} controls className="w-full" />
              ) : (
                <video
                  src={result.url}
                  controls
                  playsInline
                  className="max-h-64 w-full rounded-lg bg-black"
                />
              )}
              <p className="text-[11px] text-[var(--color-muted)]">
                {(result.durationMs / 1000).toFixed(1)}s · {format.label}
              </p>
              <div className="flex gap-2">
                <a
                  href={result.url}
                  download={`meend.${format.extension}`}
                  className="flex-1 rounded-lg bg-[var(--color-neon)] px-4 py-2 text-center text-sm font-semibold text-[#04121a] hover:brightness-110"
                >
                  Download
                </a>
                <Button
                  onClick={() => {
                    recorderRef.current?.reset();
                    setResult(null);
                  }}
                  className="flex-1"
                >
                  Record again
                </Button>
              </div>
            </div>
          )}

          {error && <p className="text-[11px] text-[#ff9d9d]">{error}</p>}
        </div>
      )}
    </>
  );
}
