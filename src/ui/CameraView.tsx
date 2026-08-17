import { useEffect, useRef } from "react";
import type { Conductor } from "../engine/Conductor.ts";
import { useStore } from "../state/store.ts";

/**
 * The mirrored camera preview plus the skeleton canvas layered over it.
 *
 * The <video> element belongs to HandTracker, not React -- it is created once
 * and adopted here, so re-renders never disturb the stream.
 */
export default function CameraView({ conductor }: { conductor: Conductor }) {
  const holderRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mirror = useStore((s) => s.mirror);
  const playMode = useStore((s) => s.playMode);

  useEffect(() => {
    const holder = holderRef.current;
    const video = conductor.tracker.video;
    if (!holder) return;

    // Prepended, not appended: both the video and the skeleton canvas are
    // positioned, so paint order follows DOM order. Appending would put the
    // video on top and hide the overlay entirely.
    video.className = "absolute inset-0 z-0 h-full w-full object-cover";
    holder.prepend(video);
    return () => {
      if (video.parentElement === holder) holder.removeChild(video);
    };
  }, [conductor]);

  useEffect(() => {
    conductor.overlay.attach(canvasRef.current);
    const onResize = () => conductor.overlay.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      conductor.overlay.attach(null);
    };
  }, [conductor]);

  useEffect(() => {
    conductor.tracker.video.style.transform = mirror ? "scaleX(-1)" : "none";
  }, [conductor, mirror]);

  return (
    <div
      ref={holderRef}
      className="absolute inset-0 overflow-hidden bg-[var(--color-ink)]"
      data-testid="camera-view"
    >
      {/* Vignette sits under the skeleton so the neon stays crisp over it. */}
      <div
        className="pointer-events-none absolute inset-0 z-10"
        aria-hidden="true"
        style={{
          background:
            "radial-gradient(ellipse at 50% 45%, transparent 55%, rgba(5,6,10,0.28) 85%, rgba(5,6,10,0.62) 100%)",
        }}
      />
      {/* Purely decorative: the chord name and hand status are announced in
          the HUD, so a screen reader gains nothing from the skeleton. */}
      <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0 z-20 h-full w-full" />
      {playMode === "keyboard" && (
        <div className="absolute inset-0 z-30 bg-[var(--color-ink)]/80" aria-hidden="true" />
      )}
    </div>
  );
}
