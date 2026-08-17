import type { AudioEngine } from "../audio/AudioEngine.ts";
import { buildVoicedChord, sameNotes } from "../music/chords.ts";
import type { ScaleName } from "../music/theory.ts";
import { romanNumeral } from "../music/theory.ts";
import { readSettings, useStore } from "../state/store.ts";
import { telemetry } from "../state/telemetry.ts";
import type { ChordReadout } from "./types.ts";

/**
 * Physical key -> action. `event.code` throughout, never `event.key`, so the
 * layout holds on AZERTY, Dvorak and everything else: Digit1 is the key in the
 * "1" position regardless of what it prints.
 */
export const KEY_MAP = {
  degrees: ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7"],
  minor: "BracketLeft",
  major: "BracketRight",
  styleSlots: ["Digit8", "Digit9", "Digit0", "Minus"],
  octaveDown: ["ShiftLeft", "ShiftRight"],
  volumeUp: "ArrowUp",
  volumeDown: "ArrowDown",
  filterDown: "ArrowLeft",
  filterUp: "ArrowRight",
  panic: "Space",
} as const;

/** Keys whose default browser action would fight the instrument: arrows and
 *  space scroll the page. */
const SWALLOW = new Set<string>([
  KEY_MAP.volumeUp,
  KEY_MAP.volumeDown,
  KEY_MAP.filterUp,
  KEY_MAP.filterDown,
  KEY_MAP.panic,
]);

const VOLUME_STEP = 0.08;
const FILTER_STEP = 0.12;

/** Don't hijack typing in the settings panel. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * Keyboard mode: full parity for anyone without a camera, not a stub.
 *
 * Runs on key events rather than the rAF loop, since there is nothing to
 * sample per frame. It writes to the same AudioEngine as the gesture modes.
 */
export class KeyboardMode {
  readonly id = "keyboard";

  /** Degree keys currently held, most recent last -- so rolling from 1 to 5
   *  without lifting plays V, the way a keyboard would. */
  private heldDegrees: number[] = [];
  private pressed = new Set<string>();
  private shiftHeld = false;
  private tilt = 0;
  private volume = 0.75;
  private previousChord: number[] | null = null;
  private sounding: number[] = [];
  private attached = false;

  /** Notifies the on-screen key map. Key events are human-rate, so React can
   *  own this without dropping anything. */
  onPressedChange: ((pressed: ReadonlySet<string>) => void) | null = null;
  onReadout: ((readout: ChordReadout) => void) | null = null;
  /** Called before any sound, so the first key press can start the audio
   *  context -- browsers require a user gesture. */
  onFirstInput: (() => void) | null = null;

  constructor(private readonly audio: AudioEngine) {}

  private readonly handleKeyDown = (e: KeyboardEvent) => {
    if (isTextEntry(e.target)) return;
    if (SWALLOW.has(e.code)) e.preventDefault();
    if (e.repeat) return;

    this.onFirstInput?.();
    this.pressed.add(e.code);
    this.onPressedChange?.(this.pressed);

    const settings = readSettings();
    const degreeIndex = KEY_MAP.degrees.indexOf(e.code as (typeof KEY_MAP.degrees)[number]);
    if (degreeIndex >= 0) {
      const degree = degreeIndex + 1;
      this.heldDegrees = [...this.heldDegrees.filter((d) => d !== degree), degree];
      this.refresh();
      return;
    }

    const slot = KEY_MAP.styleSlots.indexOf(e.code as (typeof KEY_MAP.styleSlots)[number]);
    if (slot >= 0) {
      const style = settings.keyboardSlots[slot];
      if (style) useStore.getState().set("chordStyle", style);
      this.refresh();
      return;
    }

    if ((KEY_MAP.octaveDown as readonly string[]).includes(e.code)) {
      this.shiftHeld = true;
      this.refresh();
      return;
    }

    switch (e.code) {
      case KEY_MAP.minor:
        useStore.getState().set("scale", "minor" satisfies ScaleName);
        this.refresh();
        break;
      case KEY_MAP.major:
        useStore.getState().set("scale", "major" satisfies ScaleName);
        this.refresh();
        break;
      case KEY_MAP.volumeUp:
        this.setVolume(this.volume + VOLUME_STEP);
        break;
      case KEY_MAP.volumeDown:
        this.setVolume(this.volume - VOLUME_STEP);
        break;
      case KEY_MAP.filterUp:
        this.setTilt(this.tilt + FILTER_STEP);
        break;
      case KEY_MAP.filterDown:
        this.setTilt(this.tilt - FILTER_STEP);
        break;
      case KEY_MAP.panic:
        this.panic();
        break;
    }
  };

  private readonly handleKeyUp = (e: KeyboardEvent) => {
    if (isTextEntry(e.target)) return;
    this.pressed.delete(e.code);
    this.onPressedChange?.(this.pressed);

    const degreeIndex = KEY_MAP.degrees.indexOf(e.code as (typeof KEY_MAP.degrees)[number]);
    if (degreeIndex >= 0) {
      this.heldDegrees = this.heldDegrees.filter((d) => d !== degreeIndex + 1);
      this.refresh();
      return;
    }
    if ((KEY_MAP.octaveDown as readonly string[]).includes(e.code)) {
      this.shiftHeld = false;
      this.refresh();
    }
  };

  /** Releasing everything on blur stops a chord hanging when the player
   *  alt-tabs away mid-hold. */
  private readonly handleBlur = () => {
    this.pressed.clear();
    this.heldDegrees = [];
    this.shiftHeld = false;
    this.onPressedChange?.(this.pressed);
    this.refresh();
  };

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    window.addEventListener("blur", this.handleBlur);
    this.audio.setExpression(this.volume);
    this.audio.setTilt(this.tilt);
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("blur", this.handleBlur);
    this.panic();
  }

  reset(): void {
    this.heldDegrees = [];
    this.pressed.clear();
    this.shiftHeld = false;
    this.previousChord = null;
    this.sounding = [];
    this.onPressedChange?.(this.pressed);
  }

  private setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(v, 1));
    this.audio.setExpression(this.volume);
    telemetry.volume = this.volume;
  }

  private setTilt(v: number): void {
    this.tilt = Math.max(-1, Math.min(v, 1));
    this.audio.setTilt(this.tilt);
    telemetry.cutoffHz = this.audio.cutoffHz;
  }

  private panic(): void {
    this.heldDegrees = [];
    this.sounding = [];
    this.audio.panic();
    telemetry.degree = null;
    this.onReadout?.({ chordName: "—", romanLabel: "" });
  }

  /**
   * Re-apply the held chord and the current expression settings.
   *
   * Called once the audio graph finishes building: the key press that started
   * it arrives before the engine exists, and without this replay that very
   * first chord -- the one that made the player press a key at all -- is
   * silently swallowed.
   */
  refreshAfterAudioStart(): void {
    this.audio.setExpression(this.volume);
    this.audio.setTilt(this.tilt);
    this.sounding = [];
    this.refresh();
  }

  /** Rebuild and commit the chord from whatever is currently held. */
  private refresh(): void {
    const settings = readSettings();
    const degree = this.heldDegrees[this.heldDegrees.length - 1];
    telemetry.degree = degree ?? null;
    telemetry.octaveShift = this.shiftHeld ? -1 : 0;

    if (degree === undefined) {
      if (this.sounding.length) {
        this.audio.releaseChord();
        this.sounding = [];
        this.onReadout?.({ chordName: "—", romanLabel: "" });
      }
      return;
    }

    const chord = buildVoicedChord(
      {
        keyPitchClass: settings.key,
        scale: settings.scale,
        degree,
        style: settings.chordStyle,
        octaveShift: this.shiftHeld ? -1 : 0,
      },
      this.previousChord,
    );

    if (sameNotes(this.sounding, chord.notes)) return;
    this.audio.setChord(chord.notes);
    this.sounding = chord.notes;
    this.previousChord = chord.notes;
    this.onReadout?.({ chordName: chord.name, romanLabel: romanNumeral(settings.scale, degree) });
  }
}
