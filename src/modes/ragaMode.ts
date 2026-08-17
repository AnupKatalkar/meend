import {
  type Direction,
  ragaById,
  swaraAt,
  swaraName,
  tanpuraCompanion,
} from "../music/raga.ts";
import { midiFor } from "../music/theory.ts";
import { telemetry } from "../state/telemetry.ts";
import { classifyDegree } from "../vision/fingers.ts";
import { Debouncer, OneEuroFilter, PresenceGate } from "../vision/smoothing.ts";
import type { ModeContext, PlayModeHandler } from "./types.ts";

/** Octave Sa sits in by default: the middle register (madhya saptak). */
const SA_OCTAVE = 4;

/** Volume used when the expression hand is out of frame, so the raga hand
 *  alone still sounds. */
const DEFAULT_EXPRESSION = 0.7;

/**
 * Raga mode.
 *
 * The one place in this app that is not chordal. Indian classical music is a
 * single melodic line moving against a drone, so this mode plays exactly one
 * note at a time over a tanpura, and the interest lives in *how* it moves
 * between notes rather than in what is stacked on top.
 *
 *   harmony hand    finger count picks a swara position in the raga
 *   expression hand height is volume, tilt deepens the vibrato (gamak),
 *                   thumb drops to the lower octave (mandra saptak)
 *   closed fist     silence
 *
 * The direction of travel matters: many ragas take different notes ascending
 * (aroha) than descending (avaroha), so the note a gesture produces depends on
 * whether the phrase is going up or down. Des is the clearest case -- five
 * notes up, seven coming down.
 */
export class RagaMode implements PlayModeHandler {
  readonly id = "raga";

  private readonly harmonyPresence = new PresenceGate(250);
  private readonly expressionPresence = new PresenceGate(250);
  private readonly positionGate = new Debouncer<number | null>(null);
  private readonly heightFilter = new OneEuroFilter();
  private readonly tiltFilter = new OneEuroFilter();

  private sounding = false;
  private lastPosition: number | null = null;
  private direction: Direction = "aroha";
  private lastReadout = "";

  reset(): void {
    this.harmonyPresence.reset();
    this.expressionPresence.reset();
    this.positionGate.reset();
    this.heightFilter.reset();
    this.tiltFilter.reset();
    this.sounding = false;
    this.lastPosition = null;
    this.direction = "aroha";
    this.lastReadout = "";
  }

  update(ctx: ModeContext): void {
    const { audio, settings, frame } = ctx;
    const { harmony, expression, timestamp, dt } = frame;

    this.positionGate.configure(settings.debounce);
    this.heightFilter.configure(settings.oneEuro);
    this.tiltFilter.configure(settings.oneEuro);

    const raga = ragaById(settings.raga);
    const saMidi = midiFor(settings.key, SA_OCTAVE);

    // The drone is the ground everything else is heard against, so it runs
    // whether or not a hand is in frame.
    audio.setTanpura(settings.tanpuraOn, settings.tanpuraVolume, saMidi, tanpuraCompanion(raga));
    audio.setMeend(settings.meendMs / 1000);

    const harmonyLive = this.harmonyPresence.update(harmony.present, timestamp);
    const expressionLive = this.expressionPresence.update(expression.present, timestamp);

    const octaveShift = this.applyExpression(ctx, expressionLive, dt);

    const rawPosition = harmonyLive && harmony.present ? classifyDegree(harmony.fingers) : null;
    // Degree 0 is a deliberate fist; null is simply no hand. Both silence the
    // melody, but only the fist is worth announcing.
    const position = this.positionGate.push(rawPosition);
    telemetry.degree = position;

    if (position === null || position === 0) {
      if (this.sounding) {
        audio.leadOff();
        this.sounding = false;
      }
      this.lastPosition = null;
      this.publish(ctx, position === 0 ? "muted" : "—", raga.name);
      return;
    }

    // Which way the phrase is moving decides which note set is in play.
    if (this.lastPosition !== null && position !== this.lastPosition) {
      this.direction = position > this.lastPosition ? "aroha" : "avaroha";
    }
    this.lastPosition = position;

    const semitones = swaraAt(raga, position, this.direction);
    const midi = saMidi + semitones + octaveShift * 12;

    if (!this.sounding) {
      audio.leadOn(midi);
      this.sounding = true;
      telemetry.attacks++;
      telemetry.latencyMs = performance.now() - timestamp + audio.outputLatencyMs;
    } else {
      // Already sounding: glide rather than re-articulate. Re-attacking every
      // note would turn a meend into a series of separate plucks.
      audio.setLeadPitch(midi);
    }

    const name = swaraName(semitones);
    const octaveMark = octaveShift < 0 ? " ·lower" : semitones >= 12 ? " ·upper" : "";
    this.publish(ctx, `${name}${octaveMark}`, `${raga.name} · ${this.direction}`);
  }

  /** @returns octave shift for the melody. */
  private applyExpression(ctx: ModeContext, live: boolean, dt: number): number {
    const { audio, frame } = ctx;
    const expression = frame.expression;

    if (!live || !expression.present) {
      const eased = this.heightFilter.filter(DEFAULT_EXPRESSION, dt);
      audio.setLeadVolume(eased);
      audio.setLeadVibrato(this.tiltFilter.filter(0, dt));
      telemetry.volume = eased;
      telemetry.octaveShift = 0;
      return 0;
    }

    const height = this.heightFilter.filter(expression.height, dt);
    const tilt = this.tiltFilter.filter(expression.tilt, dt);
    audio.setLeadVolume(height);
    // Tilt either way deepens the oscillation; it is an intensity control here
    // rather than a left/right one.
    audio.setLeadVibrato(Math.abs(tilt));

    const octaveShift = expression.fingers.thumb ? -1 : 0;
    telemetry.volume = height;
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
