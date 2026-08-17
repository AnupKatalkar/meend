import { useEffect, useRef } from "react";
import { CHORD_INSTRUMENTS } from "../audio/instruments.ts";
import type { Conductor } from "../engine/Conductor.ts";
import { SELECTABLE_STYLES, type ChordStyleId } from "../music/chords.ts";
import { RAGAS } from "../music/raga.ts";
import { TALAS } from "../music/tala.ts";
import { NOTE_NAMES } from "../music/theory.ts";
import {
  type ArpRate,
  type AspectRatio,
  type ClickSound,
  type ExpressionSubmode,
  type HarmonySubmode,
  type PlayMode,
  type TimeSignature,
  useStore,
} from "../state/store.ts";
import DevPanel from "./DevPanel.tsx";
import { Button, Field, SectionTitle, Segmented, Select, Slider, Toggle } from "./controls.tsx";

const KEY_OPTIONS = NOTE_NAMES.map((n, i) => ({ value: i, label: n }));
const STYLE_OPTIONS = SELECTABLE_STYLES.map((s) => ({ value: s.id, label: s.label }));

/**
 * A slide-over rather than a modal, on purpose: the player can change key or
 * turn on the arpeggiator without stopping playing.
 */
export default function SettingsPanel({ conductor }: { conductor: Conductor }) {
  const s = useStore();
  const raga = RAGAS.find((r) => r.id === s.raga);
  const ragaHint = raga ? `${raga.samay}. ${raga.mood}` : undefined;
  const tala = TALAS.find((t) => t.id === s.tala);
  const talaHint = tala
    ? `${tala.note} Sam on beat 1, khali on ${tala.khali.join(", ")}.`
    : undefined;
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (s.settingsOpen) closeRef.current?.focus();
  }, [s.settingsOpen]);

  useEffect(() => {
    if (!s.settingsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape") s.setLive({ settingsOpen: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [s.settingsOpen, s]);

  return (
    <aside
      ref={panelRef}
      aria-label="Settings"
      aria-hidden={!s.settingsOpen}
      className={[
        "gs-panel-scroll fixed right-0 top-0 z-40 flex h-full w-full max-w-sm flex-col",
        "border-l border-[var(--color-edge)] bg-[var(--color-panel)]/97 backdrop-blur-md",
        "transition-transform duration-300",
        s.settingsOpen ? "translate-x-0" : "translate-x-full",
      ].join(" ")}
      // Keep the panel out of the tab order entirely when it is closed.
      inert={!s.settingsOpen}
    >
      <header className="flex items-center justify-between border-b border-[var(--color-edge)] px-5 py-4">
        <h2 className="text-sm font-semibold tracking-wide">Settings</h2>
        <button
          ref={closeRef}
          type="button"
          onClick={() => s.setLive({ settingsOpen: false })}
          className="rounded-lg px-3 py-1.5 text-sm text-[var(--color-muted)] transition-colors hover:text-[var(--color-text)]"
        >
          Close
        </button>
      </header>

      <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
        <section className="space-y-4">
          <SectionTitle>Play mode</SectionTitle>
          <Field
            label="Mode"
            group
            info={
              "Gesture: both hands play chords. Theremin: right hand is pitch, left is volume, " +
              "sliding freely between notes. Piano: left hand picks a note, a right-hand pinch strikes it. " +
              "Raga: one melodic line over a tanpura drone, for Indian classical. " +
              "Keys: play from the keyboard with no camera at all."
            }
          >
            {(labelId) => (
          <Segmented<PlayMode>
            label="Play mode"
            labelledBy={labelId}
            value={s.playMode}
            onChange={(v) => s.set("playMode", v)}
            options={[
              { value: "gesture", label: "Gesture" },
              { value: "theremin", label: "Theremin" },
              { value: "monoPiano", label: "Piano" },
              { value: "raga", label: "Raga" },
              { value: "keyboard", label: "Keys" },
            ]}
          />
            )}
          </Field>
          {s.playMode === "keyboard" && (
            <p className="text-[11px] text-[var(--color-muted)]">
              Camera tracking is paused. Open Help for the full key map.
            </p>
          )}
        </section>

        {s.playMode === "raga" && (
          <section className="space-y-4">
            <SectionTitle>Raga</SectionTitle>
            <Field
              label="Raga"
              hint={ragaHint}
              info={
                "A raga is more than a scale: it sets which notes are available, and many use " +
                "different notes going up than coming down. Each one carries a mood and a " +
                "traditional time of day. Start with Yaman or Bhupali — both are forgiving."
              }
            >
              {(id) => (
                <Select
                  id={id}
                  value={s.raga}
                  onChange={(v) => s.set("raga", v)}
                  options={RAGAS.map((r) => ({ value: r.id, label: `${r.name} — ${r.thaat}` }))}
                />
              )}
            </Field>
            <Field
              label="Sa"
              hint="Everything is heard relative to this pitch."
              info={
                "Sa is the tonic — the note the drone holds and everything else is heard against. " +
                "Indian classical has no fixed pitch for it: singers put Sa wherever their voice sits. " +
                "Move it to suit yours."
              }
            >
              {(id) => (
                <Select id={id} value={s.key} onChange={(v) => s.set("key", v)} options={KEY_OPTIONS} />
              )}
            </Field>
            <Toggle
              label="Tanpura drone"
              hint="Four plucked strings cycling underneath, tuned to Sa."
              info={
                "The continuous drone under all Indian classical music. It is what makes a raga " +
                "sound like a raga rather than a scale — every note you play is heard in relation " +
                "to it. Turning it off is like removing the ground under the melody."
              }
              checked={s.tanpuraOn}
              onChange={(v) => s.set("tanpuraOn", v)}
            />
            {s.tanpuraOn && (
              <Field
                label="Tanpura volume"
                info="How loud the drone sits. It should sit under the melody, present but never competing with it."
              >
                {(id) => (
                  <Slider
                    id={id}
                    value={s.tanpuraVolume}
                    min={0}
                    max={1}
                    step={0.01}
                    onChange={(v) => s.set("tanpuraVolume", v)}
                    format={(v) => `${Math.round(v * 100)}%`}
                  />
                )}
              </Field>
            )}
            <Field
              label="Meend"
              hint="How long the glide between swaras takes."
              info={
                "Meend is the slide between two notes, and it carries as much of a raga as the " +
                "notes themselves. At zero the pitch jumps like a fretted instrument; higher " +
                "values slide like a voice. Around 80 ms is a natural starting point."
              }
            >
              {(id) => (
                <Slider
                  id={id}
                  value={s.meendMs}
                  min={0}
                  max={400}
                  step={10}
                  onChange={(v) => s.set("meendMs", v)}
                  format={(v) => (v === 0 ? "off" : `${v} ms`)}
                />
              )}
            </Field>
          </section>
        )}

        <section className="space-y-4">
          <SectionTitle>Harmony</SectionTitle>
          <Field
            label="Key"
            info={
              "Which note the chords are built from. Every gesture stays the same; the whole set " +
              "shifts up or down. Change this to match a song you are playing along to, or to fit " +
              "your singing range."
            }
          >
            {(id) => (
              <Select id={id} value={s.key} onChange={(v) => s.set("key", v)} options={KEY_OPTIONS} />
            )}
          </Field>
          <Field
            label="Scale"
            group
            info={
              "Major sounds bright and settled, minor darker and more wistful. Most Bollywood " +
              "ballads sit in minor. This changes the character of all seven chords at once."
            }
          >
            {(labelId) => (
              <Segmented
                label="Scale"
                labelledBy={labelId}
                value={s.scale}
                onChange={(v) => s.set("scale", v)}
                options={[
                  { value: "major", label: "Major" },
                  { value: "minor", label: "Minor" },
                ]}
              />
            )}
          </Field>
          <Field
            label="Harmony hand"
            group
            info={
              "Scale only keeps the scale fixed at your choice above. Scale + tilt hands that " +
              "choice to your left wrist: tilt left for minor, right for major, so you can change " +
              "the mood mid-phrase without touching a menu."
            }
            hint={
              s.harmonySubmode === "scaleTilt"
                ? "Tilt the harmony hand left for minor, right for major."
                : "Scale is locked to the choice above."
            }
          >
            {(labelId) => (
              <Segmented<HarmonySubmode>
                label="Harmony hand submode"
                labelledBy={labelId}
                value={s.harmonySubmode}
                onChange={(v) => s.set("harmonySubmode", v)}
                options={[
                  { value: "scaleOnly", label: "Scale only" },
                  { value: "scaleTilt", label: "Scale + tilt" },
                ]}
              />
            )}
          </Field>
        </section>

        <section className="space-y-4">
          <SectionTitle>Expression</SectionTitle>
          <Field
            label="Expression hand"
            group
            info={
              "Fixed style locks every chord to the shape you pick below, and your right hand only " +
              "shapes volume, tone and octave. Finger layout hands the chord's richness to your " +
              "right hand too: one finger for a plain triad up to four for a ninth."
            }
            hint={
              s.expressionSubmode === "fingerLayout"
                ? "Finger count picks triad, 1st inversion, 7th or 9th."
                : "Chord style is fixed; the hand controls volume, filter and octave."
            }
          >
            {(labelId) => (
              <Segmented<ExpressionSubmode>
                label="Expression hand submode"
                labelledBy={labelId}
                value={s.expressionSubmode}
                onChange={(v) => s.set("expressionSubmode", v)}
                options={[
                  { value: "fixedStyle", label: "Fixed style" },
                  { value: "fingerLayout", label: "Finger layout" },
                ]}
              />
            )}
          </Field>
          {s.expressionSubmode === "fixedStyle" && (
            <Field
              label="Chord style"
              info={
                "The flavour of every chord. Diatonic follows the key, so each degree gets its " +
                "natural quality — the safe default. The others force one shape everywhere: " +
                "sevenths sound jazzy, sus chords unresolved, diminished tense."
              }
            >
              {(id) => (
                <Select
                  id={id}
                  value={s.chordStyle}
                  onChange={(v) => s.set("chordStyle", v)}
                  options={STYLE_OPTIONS}
                />
              )}
            </Field>
          )}
        </section>

        <section className="space-y-4">
          <SectionTitle>Sound</SectionTitle>
          <Field
            label="Master volume"
            info="Overall output level. Your right hand's height still controls volume within this ceiling."
          >
            {(id) => (
              <Slider
                id={id}
                value={s.masterVolume}
                min={0}
                max={1}
                step={0.01}
                onChange={(v) => s.set("masterVolume", v)}
                format={(v) => `${Math.round(v * 100)}%`}
              />
            )}
          </Field>
          <Field
            label="Instrument"
            group
            info={
              "Synth is a sustaining pad that rings for as long as you hold the gesture. Both " +
              "pianos decay and fade like a real key instead. Grand piano is genuine recorded " +
              "audio and downloads about 2 MB the first time you choose it."
            }
            hint={
              s.instrumentLoading
                ? "Downloading piano samples…"
                : CHORD_INSTRUMENTS.find((i) => i.id === s.chordInstrument)?.hint
            }
          >
            {(labelId) => (
              <Segmented
                label="Chord instrument"
                labelledBy={labelId}
                value={s.chordInstrument}
                onChange={(v) => s.set("chordInstrument", v)}
                options={CHORD_INSTRUMENTS.map((i) => ({ value: i.id, label: i.label }))}
              />
            )}
          </Field>
          <Field
            label="Chord blend"
            hint="Low is crisp and separate; high fuses the notes into one pad."
            info={
              "How much the notes of a chord melt together. Low gives a sharp attack where you " +
              "hear each note; high slows the attack, detunes the layers slightly and adds room, " +
              "so the chord arrives as one sound. Push it up for singing over."
            }
          >
            {(id) => (
              <Slider
                id={id}
                value={s.chordBlend}
                min={0}
                max={1}
                step={0.01}
                onChange={(v) => s.set("chordBlend", v)}
                format={(v) => (v < 0.2 ? "crisp" : v > 0.7 ? "pad" : "smooth")}
              />
            )}
          </Field>
          <Field
            label="Arpeggiator"
            group
            info={
              "Off plays every note of the chord at once, which is what you want for singing over. " +
              "The other settings play the notes one at a time in a repeating pattern, at three " +
              "speeds against the tempo below."
            }
            hint={
              s.arp === "off"
                ? "Off plays every note of the chord together."
                : "On plays the chord one note at a time."
            }
          >
            {(labelId) => (
              <Segmented<ArpRate>
                label="Arpeggiator"
                labelledBy={labelId}
                value={s.arp}
                onChange={(v) => s.set("arp", v)}
                options={[
                  { value: "off", label: "Off" },
                  { value: "slow", label: "Slow" },
                  { value: "normal", label: "Normal" },
                  { value: "fast", label: "Fast" },
                ]}
              />
            )}
          </Field>
          <Toggle
            label="Auto bass"
            hint="Plays the chord root two octaves down."
            info={
              "Adds a bass note under every chord, two octaves below, on its own synth. It fills " +
              "out a thin sound considerably and follows your chord changes automatically."
            }
            checked={s.autoBass}
            onChange={(v) => s.set("autoBass", v)}
          />
          {s.autoBass && (
            <Field label="Bass volume" info="How loud the automatic bass note sits under the chords.">
              {(id) => (
                <Slider
                  id={id}
                  value={s.bassVolume}
                  min={0}
                  max={1}
                  step={0.01}
                  onChange={(v) => s.set("bassVolume", v)}
                  format={(v) => `${Math.round(v * 100)}%`}
                />
              )}
            </Field>
          )}
          {s.playMode === "theremin" && (
            <Toggle
              label="Snap to scale"
              hint="Quantizes the glide to the selected key."
              info={
                "Off, the theremin slides freely between any pitch, like the real instrument — " +
                "expressive but easy to play out of tune. On, it pulls to the nearest note of your " +
                "key, so everything stays in tune at the cost of the true glide."
              }
              checked={s.thereminSnap}
              onChange={(v) => s.set("thereminSnap", v)}
            />
          )}
        </section>

        <section className="space-y-4">
          <SectionTitle>Metronome</SectionTitle>
          <Toggle
            label="Metronome"
            info={
              "A click to play in time to. It shares its clock with the arpeggiator, so the two " +
              "stay locked together."
            }
            checked={s.metronomeOn}
            onChange={(v) => s.set("metronomeOn", v)}
          />
          <Field
            label="Tempo"
            info="Speed in beats per minute. Bollywood ballads mostly sit between 70 and 90; it also sets the arpeggiator's rate."
          >
            {(id) => (
              <Slider
                id={id}
                value={s.bpm}
                min={40}
                max={240}
                onChange={(v) => s.set("bpm", v)}
                format={(v) => `${v} BPM`}
              />
            )}
          </Field>
          <Field
            label="Cycle"
            hint={talaHint}
            info={
              "A Western time signature counts a short repeating bar. A tala is an Indian rhythmic " +
              "cycle, longer and with named beats: sam is beat one where the cycle resolves, and " +
              "khali is a deliberately lighter beat rather than a louder one."
            }
          >
            {(id) => (
              <Select
                id={id}
                value={s.tala}
                onChange={(v) => s.set("tala", v)}
                options={[
                  { value: "", label: "Western time signature" },
                  ...TALAS.map((tl) => ({ value: tl.id, label: `${tl.name} — ${tl.matras} matras` })),
                ]}
              />
            )}
          </Field>
          {!s.tala && (
            <Field
              label="Time signature"
              group
              info="How many beats in a bar. 4/4 covers most pop; 3/4 is a waltz; 6/8 has a rolling lilt."
            >
              {(labelId) => (
                <Segmented<TimeSignature>
                  label="Time signature"
                  labelledBy={labelId}
                  value={s.timeSignature}
                  onChange={(v) => s.set("timeSignature", v)}
                  options={[
                    { value: "4/4", label: "4/4" },
                    { value: "3/4", label: "3/4" },
                    { value: "6/8", label: "6/8" },
                  ]}
                />
              )}
            </Field>
          )}
          <Field
            label="Stop after"
            hint="0 bars runs until you turn it off."
            info="Stops the metronome automatically after a set number of cycles — useful for practising a fixed-length phrase."
          >
            {(id) => (
              <Slider
                id={id}
                value={s.barLimit}
                min={0}
                max={64}
                onChange={(v) => s.set("barLimit", v)}
                format={(v) => (v === 0 ? "∞" : `${v} ${s.tala ? "cycles" : "bars"}`)}
              />
            )}
          </Field>
          <Field
            label="Click sound"
            info="The metronome's voice. Tabla suits talas: it gives sam, tali and khali audibly different strokes."
          >
            {(id) => (
              <Select<ClickSound>
                id={id}
                value={s.clickSound}
                onChange={(v) => s.set("clickSound", v)}
                options={[
                  { value: "click", label: "Click" },
                  { value: "woodblock", label: "Woodblock" },
                  { value: "beep", label: "Beep" },
                  { value: "tabla", label: "Tabla" },
                ]}
              />
            )}
          </Field>
          <Field label="Click volume" info="How loud the metronome sits against your playing.">
            {(id) => (
              <Slider
                id={id}
                value={s.metronomeVolume}
                min={0}
                max={1}
                step={0.01}
                onChange={(v) => s.set("metronomeVolume", v)}
                format={(v) => `${Math.round(v * 100)}%`}
              />
            )}
          </Field>
        </section>

        <section className="space-y-4">
          <SectionTitle>Camera &amp; display</SectionTitle>
          <Field
            label="Camera quality"
            group
            hint="Hand tracking always runs at 640 wide, so a sharper picture costs bandwidth and memory, not frame rate."
            info={
              "How sharp the video preview is. Detection always runs on a downscaled copy, so " +
              "raising this makes you look better without slowing tracking down. Drop it if your " +
              "machine is struggling."
            }
          >
            {(labelId) => (
              <Segmented
                label="Camera quality"
                labelledBy={labelId}
                value={s.cameraQuality}
                onChange={(v) => s.set("cameraQuality", v)}
                options={[
                  { value: "480p" as const, label: "480p" },
                  { value: "720p" as const, label: "720p" },
                  { value: "1080p" as const, label: "1080p" },
                ]}
              />
            )}
          </Field>
          <Toggle
            label="Mirror preview"
            hint="On feels natural, like a mirror."
            info={
              "Flips the picture so raising your left hand moves the hand on the left of the screen, " +
              "the way a mirror does. Off shows the raw camera image, which feels backwards to play into."
            }
            checked={s.mirror}
            onChange={(v) => s.set("mirror", v)}
          />
          <Toggle
            label="Swap hands"
            hint="For left-handed players, or if the hands are detected the wrong way round."
            info={
              "Trades the two hands' jobs, so your right hand picks chords and your left shapes them. " +
              "Turn it on if you are left-handed, or if the Harmony and Expression pills light up for " +
              "the wrong hands."
            }
            checked={s.swapHands}
            onChange={(v) => s.set("swapHands", v)}
          />
          <Toggle
            label="Show skeleton"
            info={
              "Draws the glowing outline over your hands. Purely visual — tracking works the same " +
              "either way — but it is the quickest way to see whether the camera can actually see you."
            }
            checked={s.showSkeleton}
            onChange={(v) => s.set("showSkeleton", v)}
          />
        </section>

        <section className="space-y-4">
          <SectionTitle>Recording</SectionTitle>
          <Field
            label="Aspect ratio"
            group
            info="Shape of recorded video. 9:16 is upright for phones and stories, 16:9 is widescreen, 1:1 is square."
          >
            {(labelId) => (
              <Segmented<AspectRatio>
                label="Aspect ratio"
                labelledBy={labelId}
                value={s.aspectRatio}
                onChange={(v) => s.set("aspectRatio", v)}
                options={[
                  { value: "9:16", label: "9:16" },
                  { value: "16:9", label: "16:9" },
                  { value: "1:1", label: "1:1" },
                ]}
              />
            )}
          </Field>
        </section>

        <section className="space-y-4">
          <SectionTitle>Keyboard style slots</SectionTitle>
          <p className="text-[11px] text-[var(--color-muted)]">
            What the 8, 9, 0 and − keys select in keyboard mode.
          </p>
          {s.keyboardSlots.map((slot, i) => (
            <Field
              key={i}
              label={`Slot ${["8", "9", "0", "−"][i]}`}
              info="Which chord style this number key selects while playing in keyboard mode. Four keys, so rebind them to reach all nine styles."
            >
              {(id) => (
                <Select<ChordStyleId>
                  id={id}
                  value={slot}
                  onChange={(v) => {
                    const next = [...s.keyboardSlots];
                    next[i] = v;
                    s.set("keyboardSlots", next);
                  }}
                  options={STYLE_OPTIONS}
                />
              )}
            </Field>
          ))}
        </section>

        <section className="space-y-3">
          <SectionTitle>Advanced</SectionTitle>
          <Toggle
            label="Developer panel"
            hint="Live tracking readouts, threshold tuning and landmark replay."
            info={
              "Opens frame rate, latency and per-finger readouts, plus sliders for how straight a " +
              "finger must be to count as extended. Useful if a gesture is being misread; safe to " +
              "ignore otherwise."
            }
            checked={s.devPanel}
            onChange={(v) => s.set("devPanel", v)}
          />
          {s.devPanel && <DevPanel conductor={conductor} />}
          <Button variant="danger" onClick={() => s.resetSettings()}>
            Reset all settings
          </Button>
        </section>
      </div>
    </aside>
  );
}
