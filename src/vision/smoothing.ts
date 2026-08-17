/**
 * Two different problems, two different tools.
 *
 * Continuous values (height, tilt) drive audio parameters and need low-latency
 * smoothing that does not visibly lag -- One Euro.
 *
 * Discrete gestures (finger count, chord choice) must not flicker -- hysteresis
 * with asymmetric frame counts.
 *
 * Using one for the other is the classic way to end up with an instrument that
 * either feels rubbery or retriggers constantly.
 */

/** Simple first-order lowpass. Building block for One Euro. */
class LowPass {
  private y = 0;
  private started = false;

  filter(x: number, alpha: number): number {
    this.y = this.started ? alpha * x + (1 - alpha) * this.y : x;
    this.started = true;
    return this.y;
  }

  get value(): number {
    return this.y;
  }

  get hasValue(): boolean {
    return this.started;
  }

  reset(): void {
    this.started = false;
    this.y = 0;
  }
}

function alphaFor(cutoffHz: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dt);
}

export interface OneEuroConfig {
  /** Baseline cutoff. Lower = smoother when the hand is still. */
  minCutoff: number;
  /** How aggressively the cutoff opens up as the hand moves faster. */
  beta: number;
  /** Cutoff for the speed estimate itself. */
  dCutoff: number;
}

export const DEFAULT_ONE_EURO: OneEuroConfig = { minCutoff: 1.0, beta: 0.007, dCutoff: 1.0 };

/**
 * One Euro filter. Adapts its cutoff to hand speed: heavy smoothing when the
 * hand is nearly still (kills jitter), light smoothing when it moves fast
 * (kills lag). An EMA cannot do both -- pick an alpha and you get one or the
 * other.
 */
export class OneEuroFilter {
  private readonly xFilter = new LowPass();
  private readonly dxFilter = new LowPass();
  private lastX = 0;
  private primed = false;

  constructor(private cfg: OneEuroConfig = DEFAULT_ONE_EURO) {}

  configure(cfg: Partial<OneEuroConfig>): void {
    this.cfg = { ...this.cfg, ...cfg };
  }

  /** @param dt seconds since the previous sample. */
  filter(x: number, dt: number): number {
    if (dt <= 0) dt = 1 / 60;

    // Rate of change, itself lowpassed so a single noisy frame does not blow
    // the cutoff wide open.
    const dx = this.primed ? (x - this.lastX) / dt : 0;
    this.lastX = x;
    this.primed = true;
    const dxHat = this.dxFilter.filter(dx, alphaFor(this.cfg.dCutoff, dt));

    const cutoff = this.cfg.minCutoff + this.cfg.beta * Math.abs(dxHat);
    return this.xFilter.filter(x, alphaFor(cutoff, dt));
  }

  reset(): void {
    this.xFilter.reset();
    this.dxFilter.reset();
    this.primed = false;
    this.lastX = 0;
  }
}

/** Exponential moving average. Kept for the cheap cases (fps readout, meters)
 *  where adaptivity buys nothing. */
export class EMA {
  private y = 0;
  private started = false;

  constructor(private alpha: number) {}

  filter(x: number): number {
    this.y = this.started ? this.alpha * x + (1 - this.alpha) * this.y : x;
    this.started = true;
    return this.y;
  }

  get value(): number {
    return this.y;
  }

  reset(): void {
    this.started = false;
    this.y = 0;
  }
}

export interface DebounceConfig {
  /** Consecutive frames of agreement before a new value is committed. */
  enterFrames: number;
  /** Consecutive frames before falling back to the idle value. */
  exitFrames: number;
}

export const DEFAULT_DEBOUNCE: DebounceConfig = { enterFrames: 3, exitFrames: 6 };

/**
 * Hysteresis debouncer for discrete classifications.
 *
 * Asymmetric on purpose: entering a new gesture is quick (3 frames, ~100ms at
 * 30fps) so the instrument feels responsive, but falling back to "nothing"
 * is slow (6 frames) so a single dropped detection never releases a chord the
 * player is still holding.
 *
 * This is the single biggest factor in whether the instrument is playable.
 */
export class Debouncer<T> {
  private committed: T;
  private candidate: T;
  private streak = 0;

  constructor(
    private readonly idle: T,
    private cfg: DebounceConfig = DEFAULT_DEBOUNCE,
    private readonly equals: (a: T, b: T) => boolean = Object.is,
  ) {
    this.committed = idle;
    this.candidate = idle;
  }

  configure(cfg: Partial<DebounceConfig>): void {
    this.cfg = { ...this.cfg, ...cfg };
  }

  /** Feed one frame's raw classification; returns the currently committed one. */
  push(raw: T): T {
    if (this.equals(raw, this.committed)) {
      // Already there. Cancel any pending change.
      this.candidate = this.committed;
      this.streak = 0;
      return this.committed;
    }

    if (this.equals(raw, this.candidate)) {
      this.streak++;
    } else {
      this.candidate = raw;
      this.streak = 1;
    }

    const needed = this.equals(raw, this.idle) ? this.cfg.exitFrames : this.cfg.enterFrames;
    if (this.streak >= needed) {
      this.committed = this.candidate;
      this.streak = 0;
    }
    return this.committed;
  }

  get value(): T {
    return this.committed;
  }

  reset(): void {
    this.committed = this.idle;
    this.candidate = this.idle;
    this.streak = 0;
  }
}

/**
 * Bridges brief tracking dropouts. A hand that vanishes for under `graceMs`
 * (a blink of the tracker, a moment of occlusion) keeps its last state; only a
 * longer absence counts as the hand really being gone.
 */
export class PresenceGate {
  private lastSeen = -Infinity;
  private held = false;

  constructor(private graceMs = 250) {}

  /** @returns true while the hand should be treated as present. */
  update(detected: boolean, now: number): boolean {
    if (detected) {
      this.lastSeen = now;
      this.held = true;
    } else if (this.held && now - this.lastSeen > this.graceMs) {
      this.held = false;
    }
    return this.held;
  }

  /** Milliseconds since the hand was genuinely last seen. */
  since(now: number): number {
    return now - this.lastSeen;
  }

  reset(): void {
    this.lastSeen = -Infinity;
    this.held = false;
  }
}

/**
 * Deadband around a centre point, for the tilt-selects-major/minor switch.
 * Once past `enter` the state flips; it only flips back after crossing all the
 * way to the other side of `exit`, so a hand hovering at the boundary does not
 * chatter between scales.
 */
export class SchmittTrigger {
  private state: -1 | 0 | 1 = 0;

  constructor(
    private readonly enter = 0.35,
    private readonly exit = 0.2,
  ) {}

  update(v: number): -1 | 0 | 1 {
    if (this.state === 0) {
      if (v >= this.enter) this.state = 1;
      else if (v <= -this.enter) this.state = -1;
    } else if (this.state === 1) {
      if (v < this.exit) this.state = v <= -this.enter ? -1 : 0;
    } else {
      if (v > -this.exit) this.state = v >= this.enter ? 1 : 0;
    }
    return this.state;
  }

  get value(): -1 | 0 | 1 {
    return this.state;
  }

  reset(): void {
    this.state = 0;
  }
}
