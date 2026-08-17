import { useEffect, useRef, useState } from "react";
import type { Conductor } from "../engine/Conductor.ts";
import { SELECTABLE_STYLES } from "../music/chords.ts";
import { SWARA_NAMES, notesFor, ragaById } from "../music/raga.ts";
import { talaById } from "../music/tala.ts";
import { KEY_MAP } from "../modes/keyboardMode.ts";
import { useStore } from "../state/store.ts";
import { Button, SectionTitle } from "./controls.tsx";

const HARMONY_ROWS: Array<[string, string]> = [
  ["Any 1 finger", "I"],
  ["Any 2 fingers", "ii"],
  ["Any 3 fingers", "iii"],
  ["Any 4 fingers", "IV"],
  ["All 5 fingers", "V"],
  ["Index + pinky (horns)", "vi"],
  ["Index + pinky + thumb", "vii°"],
  ["Closed fist", "Mute"],
];

const EXPRESSION_ROWS: Array<[string, string]> = [
  ["Hand height", "Volume — higher is louder"],
  ["Wrist tilt", "Filter — right brighter, left darker"],
  ["Thumb out", "Drop one octave"],
  ["Finger count", "Chord complexity (Finger Layout submode)"],
];

/** On-screen key map. Each cap carries the `event.code`s that light it, so a
 *  single label like Shift can cover both physical shift keys. */
interface KeyCap {
  label: string;
  codes: string[];
}
const cap = (label: string, ...codes: string[]): KeyCap => ({ label, codes });

const KEY_ROWS: Array<{ caps: KeyCap[]; action: string }> = [
  {
    caps: KEY_MAP.degrees.map((code, i) => cap(String(i + 1), code)),
    action: "Scale degrees I–VII (hold to sustain)",
  },
  { caps: [cap("[", KEY_MAP.minor), cap("]", KEY_MAP.major)], action: "Minor / major" },
  {
    caps: KEY_MAP.styleSlots.map((code, i) => cap(["8", "9", "0", "−"][i], code)),
    action: "Chord style slots",
  },
  { caps: [cap("Shift", ...KEY_MAP.octaveDown)], action: "Octave down (hold)" },
  { caps: [cap("↑", KEY_MAP.volumeUp), cap("↓", KEY_MAP.volumeDown)], action: "Volume" },
  { caps: [cap("←", KEY_MAP.filterDown), cap("→", KEY_MAP.filterUp)], action: "Filter sweep" },
  { caps: [cap("Space", KEY_MAP.panic)], action: "Panic — release all voices" },
];

/** Shown only in raga mode: what the current raga actually contains, rather
 *  than a generic table that would be wrong for whichever raga is loaded. */
function RagaHelp({ ragaId, talaId }: { ragaId: string; talaId: string }) {
  const raga = ragaById(ragaId);
  const tala = talaId ? talaById(talaId) : null;
  const asymmetric =
    raga.aroha.length !== raga.avaroha.length ||
    raga.aroha.some((n, i) => n !== raga.avaroha[i]);

  const line = (notes: readonly number[]) => notes.map((n) => SWARA_NAMES[n]).join(" ");

  return (
    <section>
      <SectionTitle>Raga — {raga.name}</SectionTitle>
      <p className="mt-2 text-sm leading-relaxed text-[var(--color-muted)]">
        {raga.mood} Traditionally {raga.samay.toLowerCase()}; thaat {raga.thaat}.
      </p>

      <div className="mt-3 space-y-1.5">
        <div className="flex items-baseline gap-3">
          <span className="w-20 shrink-0 text-xs text-[var(--color-muted)]">Aroha</span>
          <span className="text-sm text-[var(--color-neon)]">{line(raga.aroha)}</span>
        </div>
        <div className="flex items-baseline gap-3">
          <span className="w-20 shrink-0 text-xs text-[var(--color-muted)]">Avaroha</span>
          <span className="text-sm text-[var(--color-neon)]">
            {line([...raga.avaroha].reverse())}
          </span>
        </div>
        <div className="flex items-baseline gap-3">
          <span className="w-20 shrink-0 text-xs text-[var(--color-muted)]">Vadi</span>
          <span className="text-sm">
            {SWARA_NAMES[raga.vadi]} · samvadi {SWARA_NAMES[raga.samvadi]}
          </span>
        </div>
      </div>

      {asymmetric && (
        <p className="mt-3 rounded-lg border border-[var(--color-neon)]/25 bg-[var(--color-neon)]/5 p-2.5 text-[11px] leading-snug text-[var(--color-muted)]">
          This raga takes different notes going up and coming down, so the same gesture can sound
          a different swara depending on which way your last move went.
        </p>
      )}

      <p className="mt-3 text-[11px] leading-snug text-[var(--color-muted)]">
        Finger count picks a position in the raga
        {" "}({notesFor(raga, "aroha").length} going up). Your right hand sets volume by height,
        deepens the oscillation as you tilt, and drops to the lower octave with the thumb out.
        A closed left fist is silence.
      </p>

      {tala && (
        <p className="mt-3 text-[11px] leading-snug text-[var(--color-muted)]">
          <span className="text-[var(--color-text)]">{tala.name}</span> — {tala.matras} matras in{" "}
          {tala.vibhags.join("-")}. {tala.note} Khali falls on beat{tala.khali.length > 1 ? "s" : ""}{" "}
          {tala.khali.join(", ")} and sounds lighter, not louder.
        </p>
      )}
    </section>
  );
}

function Row({ left, right }: { left: string; right: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-[var(--color-edge)]/60 py-1.5 last:border-0">
      <span className="text-sm text-[var(--color-text)]">{left}</span>
      <span className="shrink-0 text-sm font-medium text-[var(--color-neon)]">{right}</span>
    </div>
  );
}

export default function HelpPanel({ conductor }: { conductor: Conductor }) {
  const helpOpen = useStore((s) => s.helpOpen);
  const setLive = useStore((s) => s.setLive);
  const keyboardSlots = useStore((s) => s.keyboardSlots);
  const playMode = useStore((s) => s.playMode);
  const ragaId = useStore((s) => s.raga);
  const talaId = useStore((s) => s.tala);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [pressed, setPressed] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    if (helpOpen) closeRef.current?.focus();
  }, [helpOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape" && helpOpen) setLive({ helpOpen: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [helpOpen, setLive]);

  // Live highlighting of the on-screen map, fed by the keyboard mode itself so
  // it reflects the same event.code matching the instrument uses.
  useEffect(() => {
    conductor.keyboard.onPressedChange = (next) => setPressed(new Set(next));
    return () => {
      conductor.keyboard.onPressedChange = null;
    };
  }, [conductor]);

  const styleLabel = (id: string) => SELECTABLE_STYLES.find((s) => s.id === id)?.label ?? id;

  return (
    <aside
      aria-label="Help"
      aria-hidden={!helpOpen}
      inert={!helpOpen}
      className={[
        "gs-panel-scroll fixed left-0 top-0 z-40 flex h-full w-full max-w-md flex-col",
        "border-r border-[var(--color-edge)] bg-[var(--color-panel)]/97 backdrop-blur-md",
        "transition-transform duration-300",
        helpOpen ? "translate-x-0" : "-translate-x-full",
      ].join(" ")}
    >
      <header className="flex items-center justify-between border-b border-[var(--color-edge)] px-5 py-4">
        <h2 className="text-sm font-semibold tracking-wide">How to play</h2>
        <button
          ref={closeRef}
          type="button"
          onClick={() => setLive({ helpOpen: false })}
          className="rounded-lg px-3 py-1.5 text-sm text-[var(--color-muted)] hover:text-[var(--color-text)]"
        >
          Close
        </button>
      </header>

      <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
        <section>
          <SectionTitle>Left hand — harmony</SectionTitle>
          <div className="mt-2">
            {HARMONY_ROWS.map(([l, r]) => (
              <Row key={l} left={l} right={r} />
            ))}
          </div>
        </section>

        <section>
          <SectionTitle>Right hand — expression</SectionTitle>
          <div className="mt-2">
            {EXPRESSION_ROWS.map(([l, r]) => (
              <Row key={l} left={l} right={r} />
            ))}
          </div>
        </section>

        {playMode === "raga" && <RagaHelp ragaId={ragaId} talaId={talaId} />}

        <section>
          <SectionTitle>Keyboard</SectionTitle>
          <p className="mb-2 mt-2 text-[11px] text-[var(--color-muted)]">
            Works with no camera. Keys highlight as you press them.
          </p>
          <div className="space-y-2">
            {KEY_ROWS.map((row) => (
              <div key={row.action} className="flex items-center justify-between gap-3">
                <div className="flex flex-wrap gap-1">
                  {row.caps.map((keyCap) => {
                    const isDown = keyCap.codes.some((code) => pressed.has(code));
                    return (
                      <kbd
                        key={keyCap.label}
                        className={[
                          "min-w-7 rounded border px-1.5 py-1 text-center text-[11px] font-medium transition-colors",
                          isDown
                            ? "border-[var(--color-neon)] bg-[var(--color-neon)]/25 text-[var(--color-neon)]"
                            : "border-[var(--color-edge)] bg-[var(--color-ink-soft)] text-[var(--color-muted)]",
                        ].join(" ")}
                      >
                        {keyCap.label}
                      </kbd>
                    );
                  })}
                </div>
                <span className="shrink-0 text-right text-xs text-[var(--color-muted)]">
                  {row.action}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-[var(--color-muted)]">
            Style slots: {keyboardSlots.map(styleLabel).join(" · ")}
          </p>
        </section>

        <section>
          <SectionTitle>Privacy</SectionTitle>
          <p className="mt-2 text-sm leading-relaxed text-[var(--color-muted)]">
            Everything runs in this tab. Camera frames and hand positions are processed on your
            device and never uploaded — there is no server to upload them to.
          </p>
        </section>

        <section>
          <SectionTitle>Credits</SectionTitle>
          <p className="mt-2 text-[11px] leading-relaxed text-[var(--color-muted)]">
            Piano samples: Salamander Grand Piano by Alexander Holm, licensed under{" "}
            <a
              href="https://creativecommons.org/licenses/by/3.0/"
              target="_blank"
              rel="noreferrer"
              className="text-[var(--color-neon)] underline"
            >
              CC-BY 3.0
            </a>
            . Hand tracking by MediaPipe; audio by Tone.js.
          </p>
        </section>

        <Button
          onClick={() => setLive({ helpOpen: false, onboardingOpen: true })}
          className="w-full"
        >
          Replay the walkthrough
        </Button>
      </div>
    </aside>
  );
}
