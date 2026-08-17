import { useCallback, useEffect, useState } from "react";
import { getConductor } from "./engine/Conductor.ts";
import { useStore } from "./state/store.ts";
import { telemetry } from "./state/telemetry.ts";
import CameraView from "./ui/CameraView.tsx";
import HUD from "./ui/HUD.tsx";
import HelpPanel from "./ui/HelpPanel.tsx";
import Onboarding from "./ui/Onboarding.tsx";
import RecordControls from "./ui/RecordControls.tsx";
import SettingsPanel from "./ui/SettingsPanel.tsx";
import { Button } from "./ui/controls.tsx";

const conductor = getConductor();

// Development handle for the landmark replay workflow: load a clip and pump it
// through the real pipeline with no camera attached. Stripped from production
// builds by the `import.meta.env.DEV` guard.
//
// The live objects are exposed rather than re-imported by whoever needs them:
// after a hot update Vite serves the same module under a cache-busted URL, so
// an outside `import()` would get a second, inert copy of the singletons.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__meend = {
    conductor,
    store: useStore,
    telemetry,
  };
}

function LoadingBar() {
  const status = useStore((s) => s.status);
  const progress = useStore((s) => s.loadProgress);
  const label = useStore((s) => s.loadLabel);
  if (status !== "loading") return null;

  return (
    // Top-centre: the HUD owns the space above the controls.
    <div className="pointer-events-none absolute inset-x-0 top-16 z-20 flex justify-center px-6 sm:top-20">
      <div className="w-full max-w-sm space-y-2 rounded-xl border border-white/10 bg-[var(--color-ink)]/80 p-4 backdrop-blur-xl">
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-[var(--color-text)]">{label || "Loading"}</span>
          <span className="tabular-nums text-[var(--color-muted)]">
            {Math.round(progress * 100)}%
          </span>
        </div>
        <div
          className="h-1.5 overflow-hidden rounded-full bg-[var(--color-edge)]"
          role="progressbar"
          aria-label="Loading hand tracking"
          aria-valuenow={Math.round(progress * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-[var(--color-neon)] transition-[width] duration-200"
            style={{ width: `${Math.max(progress * 100, 2)}%` }}
          />
        </div>
      </div>
    </div>
  );
}

/** Camera problems are recoverable: every one of them offers keyboard mode
 *  rather than dead-ending on an error screen. */
function ErrorBanner({ onRetry }: { onRetry: () => void }) {
  const cameraError = useStore((s) => s.cameraError);
  const setLive = useStore((s) => s.setLive);
  const set = useStore((s) => s.set);
  const playMode = useStore((s) => s.playMode);
  if (!cameraError || playMode === "keyboard") return null;

  return (
    <div
      role="alert"
      className="absolute inset-x-0 top-0 z-30 flex justify-center px-4 pt-4"
    >
      <div className="w-full max-w-xl rounded-xl border border-[#ff6b6b]/40 bg-[#2a1418]/95 p-4 backdrop-blur-md">
        <p className="text-sm leading-relaxed text-[#ffd4d4]">{cameraError.message}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="primary" onClick={onRetry}>
            Try again
          </Button>
          {cameraError.offerKeyboard && (
            <Button
              onClick={() => {
                set("playMode", "keyboard");
                setLive({ cameraError: null });
              }}
            >
              Switch to keyboard mode
            </Button>
          )}
          <Button variant="ghost" onClick={() => setLive({ cameraError: null })}>
            Dismiss
          </Button>
        </div>
      </div>
    </div>
  );
}

function PerformanceBanner() {
  const warning = useStore((s) => s.performanceWarning);
  const setLive = useStore((s) => s.setLive);
  if (!warning) return null;
  return (
    <div className="absolute inset-x-0 top-0 z-20 flex justify-center px-4 pt-4">
      <div className="flex max-w-xl items-start gap-3 rounded-xl border border-[var(--color-edge)] bg-[var(--color-panel)]/95 p-3 backdrop-blur-md">
        <p className="text-xs leading-relaxed text-[var(--color-muted)]">{warning}</p>
        <button
          type="button"
          onClick={() => setLive({ performanceWarning: null })}
          className="shrink-0 text-xs text-[var(--color-muted)] hover:text-[var(--color-text)]"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const playMode = useStore((s) => s.playMode);
  const onboardingSeen = useStore((s) => s.onboardingSeen);
  const settingsOpen = useStore((s) => s.settingsOpen);
  const helpOpen = useStore((s) => s.helpOpen);
  const setLive = useStore((s) => s.setLive);
  const [started, setStarted] = useState(false);

  // Show the walkthrough on a first visit; returning players go straight in.
  useEffect(() => {
    if (!onboardingSeen) setLive({ onboardingOpen: true });
  }, [onboardingSeen, setLive]);

  useEffect(() => {
    conductor.start();
    return () => conductor.stop();
  }, []);

  /**
   * The one place the session actually begins. Called from a real click, which
   * is what both the AudioContext and getUserMedia require.
   */
  const enable = useCallback(async () => {
    await conductor.ensureAudio();
    setStarted(true);
    if (useStore.getState().playMode === "keyboard") return;
    try {
      // Camera first: the permission prompt appears immediately and the player
      // sees themselves while the model downloads behind it.
      await conductor.startCamera();
    } catch {
      // Already surfaced as a cameraError in the store; keyboard mode remains.
      return;
    }
    await conductor.load().catch(() => undefined);
  }, []);

  return (
    <main className="relative h-full w-full overflow-hidden">
      <CameraView conductor={conductor} />

      <ErrorBanner onRetry={() => void enable()} />
      <PerformanceBanner />
      <LoadingBar />

      {/* Privacy notice, kept out of the frame's centre where a face sits. */}
      <div className="pointer-events-none absolute left-4 top-4 z-20 sm:left-6 sm:top-6">
        <p className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-[var(--color-ink)]/70 px-3 py-1.5 text-[10px] text-[var(--color-muted)] backdrop-blur-md">
          <span aria-hidden="true">🔒</span>
          Runs entirely in your browser — nothing is uploaded
        </p>
      </div>

      {/* Scrim so the controls stay legible against a bright room. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-72 bg-gradient-to-t from-[var(--color-ink)] via-[var(--color-ink)]/75 to-transparent"
      />

      {/* Chord readout and scope, anchored above the controls rather than
          across the middle of the picture. */}
      <div className="absolute inset-x-0 bottom-24 z-20 sm:bottom-28">
        <HUD conductor={conductor} />
      </div>

      {/* Bottom control bar. */}
      <div className="absolute inset-x-0 bottom-0 z-20 flex items-center justify-between gap-3 p-4 sm:p-6">
        <Button onClick={() => setLive({ helpOpen: !helpOpen })}>Help</Button>

        {/* Session-scoped, not tied to `onboardingSeen`: a returning player
            skips the walkthrough but still needs one click to grant the
            camera and start the audio context. */}
        {!started && (
          <Button variant="primary" onClick={() => void enable()} className="px-6">
            {playMode === "keyboard" ? "Start audio" : "Start camera"}
          </Button>
        )}

        <div className="relative flex items-center gap-2">
          <RecordControls conductor={conductor} />
          <Button onClick={() => setLive({ settingsOpen: !settingsOpen })}>Settings</Button>
        </div>
      </div>

      <SettingsPanel conductor={conductor} />
      <HelpPanel conductor={conductor} />
      <Onboarding onEnable={enable} />
    </main>
  );
}
