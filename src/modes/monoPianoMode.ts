import { degreeRoot, midiToNoteName } from "../music/theory.ts";
import { telemetry } from "../state/telemetry.ts";
import { Debouncer, PresenceGate } from "../vision/smoothing.ts";
import type { ModeContext, PlayModeHandler } from "./types.ts";

/** Harmony-hand finger count -> interval above the key's root, in semitones:
 *  root, major third, fifth, octave, ninth. */
const INTERVALS = [0, 4, 7, 12, 14];

/**
 * Pinch hysteresis. Triggering on the way in at 0.42 and only re-arming once
 * the fingers open past 0.55 stops a hand hovering at the threshold from
 * machine-gunning the note.
 */
const PINCH_ON = 0.42;
const PINCH_OFF = 0.55;

/**
 * Mono Piano mode. The harmony hand picks an interval, the expression hand
 * triggers it with a pinch.
 *
 * The spec offers a downward flick as an alternative trigger; pinch is
 * implemented because it is far more reliable -- flick needs a velocity
 * estimate that MediaPipe's frame-to-frame jitter makes unreadable at 30fps
 * without adding latency that defeats the point of a percussive trigger.
 */
export class MonoPianoMode implements PlayModeHandler {
  readonly id = "monoPiano";

  private readonly intervalGate = new Debouncer<number>(1);
  private readonly harmonyPresence = new PresenceGate(250);
  private readonly triggerPresence = new PresenceGate(250);
  private armed = true;
  private lastNote = "";

  reset(): void {
    this.intervalGate.reset();
    this.harmonyPresence.reset();
    this.triggerPresence.reset();
    this.armed = true;
    this.lastNote = "";
  }

  update(ctx: ModeContext): void {
    const { audio, settings, frame } = ctx;
    const { harmony, expression, timestamp } = frame;

    this.intervalGate.configure(settings.debounce);

    const harmonyLive = this.harmonyPresence.update(harmony.present, timestamp);
    const triggerLive = this.triggerPresence.update(expression.present, timestamp);

    if (harmonyLive && harmony.present) {
      this.intervalGate.push(Math.min(Math.max(harmony.fingerCount, 1), 5));
    }
    const step = this.intervalGate.value;
    telemetry.degree = step;

    const root = degreeRoot(settings.key, settings.scale, 1);
    const note = root + INTERVALS[step - 1];

    const label = midiToNoteName(note);
    if (label !== this.lastNote) {
      this.lastNote = label;
      ctx.publish({ chordName: label, romanLabel: `pinch to play` });
    }

    // Volume is not gestural here; the piano voice has its own envelope.
    audio.setPianoVolume(1);

    if (!triggerLive || !expression.present) {
      this.armed = true;
      return;
    }

    const pinch = expression.pinch;
    if (this.armed && pinch < settings.thresholds.pinchThreshold) {
      audio.strikePiano(note);
      this.armed = false;
      telemetry.latencyMs = performance.now() - timestamp + audio.outputLatencyMs;
      ctx.publish({ chordName: label, romanLabel: "struck" });
      this.lastNote = label;
    } else if (!this.armed && pinch > PINCH_OFF) {
      this.armed = true;
    }
  }
}

export const PINCH_THRESHOLDS = { on: PINCH_ON, off: PINCH_OFF };
