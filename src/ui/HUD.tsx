import { useEffect, useRef, useState } from "react";
import type { Conductor } from "../engine/Conductor.ts";
import { ragaById } from "../music/raga.ts";
import { beatRole, talaById, vibhagStarts } from "../music/tala.ts";
import { NOTE_NAMES } from "../music/theory.ts";
import { useStore } from "../state/store.ts";
import { telemetry } from "../state/telemetry.ts";

const MODE_LABEL: Record<string, string> = {
  gesture: "Gesture",
  theremin: "Theremin",
  monoPiano: "Mono Piano",
  raga: "Raga",
  keyboard: "Keyboard",
};

/** Hue per scale degree, matching the skeleton overlay so the scope, the
 *  hands and the harmony all agree on a colour. */
const DEGREE_HUES = [190, 265, 300, 330, 20, 45, 90, 155];

/**
 * Oscilloscope of the master bus.
 *
 * Real samples, not a decorative animation: it sits flat and still when
 * nothing is sounding and moves only when the instrument does. Runs on its own
 * rAF and writes to the canvas directly -- never React state.
 */
function Waveform({ conductor }: { conductor: Conductor }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    // Eased so the trace swells and settles rather than snapping.
    let amplitude = 0;
    let hue = DEGREE_HUES[0];

    const draw = () => {
      raf = requestAnimationFrame(draw);

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      const w = Math.round(rect.width * dpr);
      const h = Math.round(rect.height * dpr);
      if (w === 0 || h === 0) return;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }

      const samples = conductor.audio.getWaveform();
      const target = telemetry.level;
      amplitude += (target - amplitude) * 0.2;

      const targetHue = DEGREE_HUES[(telemetry.degree ?? 0) % DEGREE_HUES.length];
      // Shortest way round the colour wheel, so a degree change slides rather
      // than sweeping through every hue in between.
      const delta = ((targetHue - hue + 540) % 360) - 180;
      hue += delta * 0.12;

      ctx.clearRect(0, 0, w, h);
      const mid = h / 2;
      const alive = amplitude > 0.002 && samples !== null;

      ctx.beginPath();
      if (alive && samples) {
        const step = samples.length / w;
        for (let x = 0; x < w; x++) {
          const sample = samples[Math.floor(x * step)] ?? 0;
          // Taper the ends so the trace fades into the card instead of being
          // clipped off at the edges.
          const edge = Math.min(x, w - x) / (w * 0.12);
          const taper = Math.min(edge, 1);
          const y = mid - sample * mid * 0.92 * taper;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      } else {
        ctx.moveTo(0, mid);
        ctx.lineTo(w, mid);
      }

      ctx.strokeStyle = alive ? `hsl(${hue} 100% 68%)` : "rgba(153,161,189,0.35)";
      ctx.lineWidth = (alive ? 2 : 1.25) * dpr;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.shadowBlur = alive ? 12 * dpr : 0;
      ctx.shadowColor = `hsl(${hue} 100% 60%)`;
      ctx.stroke();
      ctx.shadowBlur = 0;
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [conductor]);

  return (
    <canvas
      ref={canvasRef}
      // Decorative: the chord name next to it is the accessible readout.
      aria-hidden="true"
      className="h-10 w-full"
    />
  );
}

/**
 * Where the tala cycle currently is.
 *
 * Vibhag groups are spaced apart, sam is marked distinctly, and khali beats
 * are drawn hollow — the shape of the cycle is the information, so a plain row
 * of identical dots would not carry it.
 */
function TalaStrip({ talaId }: { talaId: string }) {
  const [matra, setMatra] = useState(0);
  const tala = talaById(talaId);

  useEffect(() => {
    let raf = 0;
    let shown = -1;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      // Polled rather than pushed, so the audio thread never touches React.
      if (telemetry.matra !== shown) {
        shown = telemetry.matra;
        setMatra(shown);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const starts = new Set(vibhagStarts(tala));

  return (
    <div
      data-testid="tala-strip"
      className="mt-2 flex flex-wrap items-center justify-center gap-x-1 gap-y-1.5"
    >
      {Array.from({ length: tala.matras }, (_, i) => {
        const beat = i + 1;
        const role = beatRole(tala, beat);
        const active = matra === beat;
        return (
          <span
            key={beat}
            data-matra={beat}
            className={[
              "h-2 rounded-full border transition-all duration-100",
              // A gap before each vibhag makes the grouping visible.
              starts.has(beat) && beat !== 1 ? "ml-2" : "",
              role === "sam" ? "w-3.5" : "w-2",
              active
                ? "border-[var(--color-neon)] bg-[var(--color-neon)] shadow-[0_0_10px_var(--color-neon)]"
                : role === "khali"
                  ? "border-white/25 bg-transparent"
                  : role === "sam"
                    ? "border-white/50 bg-white/40"
                    : "border-white/20 bg-white/15",
            ].join(" ")}
          />
        );
      })}
      <span className="ml-2 text-[10px] text-[var(--color-muted)]">
        {tala.name}
        {matra > 0 && ` · ${matra}`}
      </span>
    </div>
  );
}

function HandPill({ label, lit }: { label: string; lit: boolean }) {
  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
        lit
          ? "border-[var(--color-neon)]/70 bg-[var(--color-neon)]/15 text-[var(--color-neon)]"
          : "border-white/10 bg-white/5 text-[var(--color-muted)]",
      ].join(" ")}
    >
      <span
        className={[
          "h-1.5 w-1.5 rounded-full transition-colors",
          lit ? "bg-[var(--color-neon)]" : "bg-[var(--color-muted)]/40",
        ].join(" ")}
      />
      {label}
    </span>
  );
}

export default function HUD({ conductor }: { conductor: Conductor }) {
  const chordName = useStore((s) => s.chordName);
  const romanLabel = useStore((s) => s.romanLabel);
  const key = useStore((s) => s.key);
  const scale = useStore((s) => s.scale);
  const playMode = useStore((s) => s.playMode);
  const harmonyPresent = useStore((s) => s.harmonyPresent);
  const expressionPresent = useStore((s) => s.expressionPresent);
  const audioStarted = useStore((s) => s.audioStarted);
  const ragaId = useStore((s) => s.raga);
  const talaId = useStore((s) => s.tala);
  const metronomeOn = useStore((s) => s.metronomeOn);
  const isRaga = playMode === "raga";

  const idle = chordName === "—";
  const muted = chordName === "muted";

  // A bare em-dash floating over the video reads as a rendering glitch. When
  // nothing is sounding, say what to do instead.
  const hint = !audioStarted
    ? "Press Start to begin"
    : playMode === "keyboard"
      ? "Press 1–7 to play"
      : harmonyPresent
        ? "Open your hand"
        : isRaga
          ? "Hold up your left hand to sound a swara"
          : "Hold up your left hand";

  return (
    <div className="pointer-events-none flex w-full justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[var(--color-ink)]/72 px-5 py-4 shadow-[0_8px_40px_rgba(0,0,0,0.45)] backdrop-blur-xl">
        <div className="flex min-h-14 items-center justify-center gap-3">
          {idle || muted ? (
            <p
              className={[
                "text-center text-sm",
                muted ? "text-[var(--color-muted)]" : "text-[var(--color-muted)]/80",
              ].join(" ")}
              aria-live="polite"
            >
              {muted ? "Muted — open your hand" : hint}
            </p>
          ) : (
            <p
              className="flex items-baseline gap-2.5 text-center"
              aria-live="polite"
              aria-atomic="true"
            >
              <span
                data-testid="chord-name"
                className="text-5xl font-semibold leading-none tracking-tight"
              >
                {chordName}
              </span>
              {romanLabel && (
                <span className="text-lg font-normal text-[var(--color-muted)]">{romanLabel}</span>
              )}
            </p>
          )}
        </div>

        {/* Keeps the accessible chord readout present even in the empty state,
            so the aria-live region above never has to fight the layout. */}
        {(idle || muted) && (
          <span data-testid="chord-name" className="sr-only">
            {chordName}
          </span>
        )}

        <Waveform conductor={conductor} />

        {metronomeOn && talaId && <TalaStrip talaId={talaId} />}

        <div className="mt-2 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-2 text-[11px] text-[var(--color-muted)]">
          <span className="font-medium text-[var(--color-text)]">
            {isRaga ? `${ragaById(ragaId).name} · Sa = ${NOTE_NAMES[key]}` : `${NOTE_NAMES[key]} ${scale}`}
          </span>
          <span aria-hidden="true" className="opacity-40">
            ·
          </span>
          <span>{MODE_LABEL[playMode] ?? playMode}</span>
          {playMode !== "keyboard" && (
            <>
              <span aria-hidden="true" className="opacity-40">
                ·
              </span>
              <HandPill label="Harmony" lit={harmonyPresent} />
              <HandPill label="Expression" lit={expressionPresent} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
