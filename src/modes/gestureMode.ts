import { buildVoicedChord, layoutForFingerCount, sameNotes } from "../music/chords.ts";
import type { ScaleName } from "../music/theory.ts";
import { romanNumeral } from "../music/theory.ts";
import { telemetry } from "../state/telemetry.ts";
import { classifyDegree } from "../vision/fingers.ts";
import {
  Debouncer,
  OneEuroFilter,
  PresenceGate,
  SchmittTrigger,
} from "../vision/smoothing.ts";
import type { HandFrame } from "../vision/types.ts";
import type { ModeContext, PlayModeHandler } from "./types.ts";

/**
 * Volume used when the expression hand is not in frame.
 *
 * Without this the instrument is silent until both hands are up, and the
 * first-run experience -- hold up three fingers, hear a iii chord -- fails for
 * anyone who only raises one hand.
 */
const DEFAULT_EXPRESSION = 0.7;

/** Tilt deadband for the major/minor switch, in normalized tilt units. */
const SCALE_ENTER = 0.35;
const SCALE_EXIT = 0.2;

export class GestureMode implements PlayModeHandler {
  readonly id = "gesture";

  private readonly harmonyPresence = new PresenceGate(250);
  private readonly expressionPresence = new PresenceGate(250);

  /** Idle value is null: "no hand". Fist is degree 0, which is different --
   *  it means the player is deliberately muting. */
  private readonly degreeGate = new Debouncer<number | null>(null);
  private readonly layoutGate = new Debouncer<number>(1);
  private readonly thumbGate = new Debouncer<boolean>(false);

  private readonly heightFilter = new OneEuroFilter();
  private readonly tiltFilter = new OneEuroFilter();
  private readonly harmonyTiltFilter = new OneEuroFilter();
  private readonly scaleTrigger = new SchmittTrigger(SCALE_ENTER, SCALE_EXIT);

  private previousChord: number[] | null = null;
  private sounding: number[] = [];
  private tiltScale: ScaleName | null = null;
  private lastReadout = "";

  reset(): void {
    this.harmonyPresence.reset();
    this.expressionPresence.reset();
    this.degreeGate.reset();
    this.layoutGate.reset();
    this.thumbGate.reset();
    this.heightFilter.reset();
    this.tiltFilter.reset();
    this.harmonyTiltFilter.reset();
    this.scaleTrigger.reset();
    this.previousChord = null;
    this.sounding = [];
    this.tiltScale = null;
    this.lastReadout = "";
  }

  update(ctx: ModeContext): void {
    const { audio, settings, frame } = ctx;
    const { harmony, expression, timestamp, dt } = frame;

    this.degreeGate.configure(settings.debounce);
    this.layoutGate.configure(settings.debounce);
    this.thumbGate.configure(settings.debounce);
    this.heightFilter.configure(settings.oneEuro);
    this.tiltFilter.configure(settings.oneEuro);

    const harmonyLive = this.harmonyPresence.update(harmony.present, timestamp);
    const expressionLive = this.expressionPresence.update(expression.present, timestamp);

    const scale = this.resolveScale(settings, harmony, harmonyLive, dt);
    const octaveShift = this.applyExpression(ctx, expression, expressionLive, dt);

    // ---- Harmony: finger count -> scale degree -------------------------
    const rawDegree = harmonyLive && harmony.present ? classifyDegree(harmony.fingers) : null;
    const degree = this.degreeGate.push(rawDegree);
    telemetry.degree = degree;

    if (degree === null || degree === 0) {
      // No hand, or a closed fist: silence, and hold it.
      if (this.sounding.length) {
        audio.releaseChord();
        this.sounding = [];
      }
      // Published unconditionally: a hand leaving frame after a fist must
      // update the readout from "muted" to "—", even though nothing was
      // sounding to release. publish() dedupes, so this is not chatty.
      this.publish(ctx, degree === 0 ? "muted" : "—", "");
      return;
    }

    // ---- Build the chord ------------------------------------------------
    const layout =
      settings.expressionSubmode === "fingerLayout" && expressionLive
        ? layoutForFingerCount(this.layoutGate.value)
        : undefined;

    const chord = buildVoicedChord(
      {
        keyPitchClass: settings.key,
        scale,
        degree,
        octaveShift,
        ...(layout ? { layout } : { style: settings.chordStyle }),
      },
      this.previousChord,
    );

    if (!sameNotes(this.sounding, chord.notes)) {
      const attacked = audio.setChord(chord.notes);
      this.sounding = chord.notes;
      this.previousChord = chord.notes;
      if (attacked) {
        telemetry.attacks++;
        // Honest end-to-end measurement: time since the frame was captured,
        // plus the audio path's own latency. Not an assumption.
        telemetry.latencyMs = performance.now() - timestamp + audio.outputLatencyMs;
      }
      this.publish(ctx, chord.name, romanNumeral(scale, degree));
    }
  }

  /** Scale Only locks to the settings choice; Scale + Tilt lets the harmony
   *  hand's wrist angle pick minor (left) or major (right). */
  private resolveScale(
    settings: ModeContext["settings"],
    harmony: HandFrame,
    live: boolean,
    dt: number,
  ): ScaleName {
    if (settings.harmonySubmode !== "scaleTilt") {
      this.tiltScale = null;
      return settings.scale;
    }
    if (live && harmony.present) {
      const tilt = this.harmonyTiltFilter.filter(harmony.tilt, dt);
      const side = this.scaleTrigger.update(tilt);
      // Inside the deadband, keep whatever was last chosen rather than
      // snapping back -- that chatter is exactly what the band is for.
      if (side === 1) this.tiltScale = "major";
      else if (side === -1) this.tiltScale = "minor";
    }
    return this.tiltScale ?? settings.scale;
  }

  /**
   * Expression hand: height -> volume, tilt -> filter, thumb -> octave down,
   * finger count -> chord complexity in Finger Layout submode.
   *
   * @returns the octave shift to apply to the chord.
   */
  private applyExpression(
    ctx: ModeContext,
    expression: HandFrame,
    live: boolean,
    dt: number,
  ): number {
    const { audio } = ctx;

    if (!live || !expression.present) {
      // Fall back to a usable level so one-handed play still sounds. Ramped,
      // not snapped, so a hand leaving frame fades rather than jumps.
      const eased = this.heightFilter.filter(DEFAULT_EXPRESSION, dt);
      audio.setExpression(eased);
      audio.setTilt(this.tiltFilter.filter(0, dt));
      telemetry.volume = eased;
      telemetry.cutoffHz = audio.cutoffHz;
      telemetry.octaveShift = 0;
      return 0;
    }

    const height = this.heightFilter.filter(expression.height, dt);
    const tilt = this.tiltFilter.filter(expression.tilt, dt);
    audio.setExpression(height);
    audio.setTilt(tilt);

    // The thumb has its own job (octave), so the layout count deliberately
    // ignores it -- otherwise dropping an octave would also change the chord.
    const nonThumb =
      +expression.fingers.index +
      +expression.fingers.middle +
      +expression.fingers.ring +
      +expression.fingers.pinky;
    this.layoutGate.push(Math.max(nonThumb, 1));

    const thumbDown = this.thumbGate.push(expression.fingers.thumb);
    const octaveShift = thumbDown ? -1 : 0;

    telemetry.volume = height;
    telemetry.cutoffHz = audio.cutoffHz;
    telemetry.octaveShift = octaveShift;
    return octaveShift;
  }

  private publish(ctx: ModeContext, chordName: string, romanLabel: string): void {
    const key = `${chordName}|${romanLabel}`;
    if (key === this.lastReadout) return;
    this.lastReadout = key;
    ctx.publish({ chordName, romanLabel });
  }
}
