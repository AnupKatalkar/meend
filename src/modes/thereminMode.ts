import { midiToNoteName, snapToScale } from "../music/theory.ts";
import { telemetry } from "../state/telemetry.ts";
import { OneEuroFilter, PresenceGate } from "../vision/smoothing.ts";
import type { ModeContext, PlayModeHandler } from "./types.ts";

/** Pitch range swept by the expression hand: C3 to C6, three octaves. */
const PITCH_LOW = 48;
const PITCH_HIGH = 84;

/**
 * Theremin mode. The expression hand's height is pitch, the harmony hand's
 * height is volume, and pitch is continuous by default -- freeform is what a
 * theremin actually does. Snap-to-scale is available for anyone who would
 * rather stay in key.
 *
 * The glide comes from the synth's portamento rather than from filtering, so
 * large jumps still slide instead of stepping.
 */
export class ThereminMode implements PlayModeHandler {
  readonly id = "theremin";

  private readonly pitchPresence = new PresenceGate(250);
  private readonly volumePresence = new PresenceGate(250);
  private readonly pitchFilter = new OneEuroFilter();
  private readonly volumeFilter = new OneEuroFilter();
  private sounding = false;
  private lastNote = "";

  reset(): void {
    this.pitchPresence.reset();
    this.volumePresence.reset();
    this.pitchFilter.reset();
    this.volumeFilter.reset();
    this.sounding = false;
    this.lastNote = "";
  }

  update(ctx: ModeContext): void {
    const { audio, settings, frame } = ctx;
    const { harmony, expression, timestamp, dt } = frame;

    this.pitchFilter.configure(settings.oneEuro);
    this.volumeFilter.configure(settings.oneEuro);

    const pitchLive = this.pitchPresence.update(expression.present, timestamp);
    const volumeLive = this.volumePresence.update(harmony.present, timestamp);

    if (!pitchLive && !volumeLive) {
      if (this.sounding) {
        audio.thereminOff();
        audio.setThereminVolume(0);
        this.sounding = false;
        ctx.publish({ chordName: "—", romanLabel: "theremin" });
        this.lastNote = "";
      }
      telemetry.degree = null;
      return;
    }

    if (!this.sounding) {
      audio.thereminOn();
      this.sounding = true;
    }

    // Pitch: expression hand height across the three-octave range.
    if (pitchLive) {
      const h = this.pitchFilter.filter(expression.height, dt);
      let midi = PITCH_LOW + h * (PITCH_HIGH - PITCH_LOW);
      if (settings.thereminSnap) midi = snapToScale(midi, settings.key, settings.scale);
      audio.setThereminPitch(midi);

      const label = midiToNoteName(midi);
      if (label !== this.lastNote) {
        this.lastNote = label;
        ctx.publish({ chordName: label, romanLabel: settings.thereminSnap ? "snapped" : "theremin" });
      }
    }

    // Volume: harmony hand height. With no volume hand in frame, sit at a
    // usable level so the pitch hand alone still sounds.
    const rawVolume = volumeLive ? harmony.height : 0.6;
    const volume = this.volumeFilter.filter(rawVolume, dt);
    audio.setThereminVolume(volume);
    telemetry.volume = volume;
  }
}
