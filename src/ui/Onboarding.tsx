import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store.ts";
import { Button } from "./controls.tsx";

interface Card {
  title: string;
  body: string;
  rows?: Array<[string, string]>;
  cta: string;
}

const CARDS: Card[] = [
  {
    title: "Play chords with your hands",
    body: "Meend needs your camera to see your hands. Everything happens inside this tab — camera frames and hand positions are processed on your device and never uploaded. There is no server to upload them to.",
    cta: "Enable camera",
  },
  {
    title: "Left hand picks the chord",
    body: "Hold up fingers. The count chooses the scale degree; a closed fist mutes.",
    rows: [
      ["1 finger", "I"],
      ["2 fingers", "ii"],
      ["3 fingers", "iii"],
      ["4 fingers", "IV"],
      ["5 fingers", "V"],
      ["Index + pinky", "vi"],
      ["Index + pinky + thumb", "vii°"],
      ["Fist", "Mute"],
    ],
    cta: "Next",
  },
  {
    title: "Right hand shapes the sound",
    body: "Move it around while the left hand holds a chord.",
    rows: [
      ["Raise and lower", "Volume"],
      ["Tilt right", "Brighter"],
      ["Tilt left", "Darker"],
      ["Thumb out", "Drop an octave"],
    ],
    cta: "Start playing",
  },
];

/**
 * Three cards over a dimmed camera preview. The first is also the permission
 * prompt and the audio-start gesture, so a stranger gets from cold load to
 * sound in one click.
 */
export default function Onboarding({ onEnable }: { onEnable: () => void | Promise<void> }) {
  const onboardingOpen = useStore((s) => s.onboardingOpen);
  const setLive = useStore((s) => s.setLive);
  const set = useStore((s) => s.set);
  const cameraError = useStore((s) => s.cameraError);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (onboardingOpen) headingRef.current?.focus();
  }, [onboardingOpen, index]);

  if (!onboardingOpen) return null;
  const card = CARDS[index];
  const isLast = index === CARDS.length - 1;

  const finish = () => {
    set("onboardingSeen", true);
    setLive({ onboardingOpen: false });
    setIndex(0);
  };

  const advance = async () => {
    if (index === 0) {
      setBusy(true);
      try {
        await onEnable();
      } finally {
        setBusy(false);
      }
      setIndex(1);
      return;
    }
    if (isLast) finish();
    else setIndex((i) => i + 1);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-ink)]/78 px-5 backdrop-blur-sm"
    >
      <div className="w-full max-w-md rounded-2xl border border-[var(--color-edge)] bg-[var(--color-panel)] p-6 shadow-2xl">
        <div className="mb-4 flex gap-1.5" aria-hidden="true">
          {CARDS.map((_, i) => (
            <span
              key={i}
              className={[
                "h-1 flex-1 rounded-full transition-colors",
                i <= index ? "bg-[var(--color-neon)]" : "bg-[var(--color-edge)]",
              ].join(" ")}
            />
          ))}
        </div>

        <h2
          id="onboarding-title"
          ref={headingRef}
          tabIndex={-1}
          className="text-xl font-semibold tracking-tight outline-none"
        >
          {card.title}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--color-muted)]">{card.body}</p>

        {card.rows && (
          <div className="mt-4 space-y-0.5">
            {card.rows.map(([l, r]) => (
              <div
                key={l}
                className="flex items-baseline justify-between border-b border-[var(--color-edge)]/50 py-1.5 last:border-0"
              >
                <span className="text-sm">{l}</span>
                <span className="text-sm font-medium text-[var(--color-neon)]">{r}</span>
              </div>
            ))}
          </div>
        )}

        {index === 0 && cameraError && (
          <p className="mt-4 rounded-lg border border-[#ff6b6b]/40 bg-[#ff6b6b]/10 p-3 text-xs leading-relaxed text-[#ffc4c4]">
            {cameraError.message}
          </p>
        )}

        <div className="mt-6 flex items-center justify-between gap-3">
          <Button variant="ghost" onClick={finish}>
            Skip
          </Button>
          <div className="flex gap-2">
            {index > 0 && <Button onClick={() => setIndex((i) => i - 1)}>Back</Button>}
            {index === 0 && cameraError && (
              <Button
                onClick={() => {
                  set("playMode", "keyboard");
                  finish();
                }}
              >
                Use keyboard
              </Button>
            )}
            <Button variant="primary" onClick={() => void advance()} disabled={busy}>
              {busy ? "Starting…" : cameraError && index === 0 ? "Try again" : card.cta}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
