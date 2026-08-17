import { AudioEngine } from "../audio/AudioEngine.ts";
import { GestureMode } from "../modes/gestureMode.ts";
import { KeyboardMode } from "../modes/keyboardMode.ts";
import { MonoPianoMode } from "../modes/monoPianoMode.ts";
import { RagaMode } from "../modes/ragaMode.ts";
import { ThereminMode } from "../modes/thereminMode.ts";
import type { ChordReadout, PlayModeHandler } from "../modes/types.ts";
import { talaById } from "../music/tala.ts";
import { DEFAULT_SETTINGS, type PlayMode, type Settings, useStore } from "../state/store.ts";
import { telemetry } from "../state/telemetry.ts";
import { SkeletonOverlay } from "../ui/SkeletonOverlay.ts";
import { CAMERA_QUALITIES, HandTracker, describeCameraError } from "../vision/HandTracker.ts";
import { EMA } from "../vision/smoothing.ts";
import { LandmarkRecorder, ReplayPlayer, type ReplayClip } from "../vision/replay.ts";
import type { HandFrame, VisionFrame } from "../vision/types.ts";

/** Stop running detection flat out once both hands have been gone this long. */
const IDLE_AFTER_MS = 2000;
/** Detection interval while idle: enough to notice a hand, cheap enough to
 *  let the laptop's fans stop. */
const IDLE_INTERVAL_MS = 100;
/** Sustained frame rate below this earns a warning to the player. */
const LOW_FPS = 15;
const LOW_FPS_GRACE_MS = 3000;

/**
 * The single rAF loop, and the only thing that talks to every layer.
 *
 * One loop total: detection, mode update and skeleton drawing all happen here.
 * Nothing in this file touches React state per frame -- discrete readouts go
 * through `publish`, everything else through the telemetry singleton.
 */
export class Conductor {
  readonly tracker = new HandTracker();
  readonly audio = new AudioEngine();
  readonly overlay = new SkeletonOverlay();
  readonly keyboard: KeyboardMode;
  readonly landmarkRecorder = new LandmarkRecorder();

  private readonly gestureMode = new GestureMode();
  private readonly thereminMode = new ThereminMode();
  private readonly monoPianoMode = new MonoPianoMode();
  private readonly ragaMode = new RagaMode();

  private raf = 0;
  private running = false;
  private lastRafTime = 0;
  private lastDetectTime = 0;
  private lastHandSeenAt = 0;
  private lowFpsSince = 0;
  private readonly fps = new EMA(0.1);

  private currentMode: PlayMode = DEFAULT_SETTINGS.playMode;
  private settings: Settings = { ...DEFAULT_SETTINGS };
  private unsubscribe: (() => void) | null = null;
  private replay: ReplayPlayer | null = null;

  /** Reused per frame; never reallocated. */
  private readonly visionFrame: VisionFrame;
  private readonly handsForDraw: HandFrame[] = [];

  constructor() {
    this.keyboard = new KeyboardMode(this.audio);
    this.keyboard.onReadout = (r) => this.publish(r);
    // The first key press both starts the audio context and asks for a chord.
    // Replaying it once the graph exists is what stops that first note from
    // being swallowed by the boot.
    this.keyboard.onFirstInput = () => {
      if (this.audio.isStarted) return;
      void this.ensureAudio().then(() => this.keyboard.refreshAfterAudioStart());
    };
    this.visionFrame = {
      harmony: this.tracker.harmony,
      expression: this.tracker.expression,
      timestamp: 0,
      dt: 1 / 30,
    };
    this.tracker.onTrackEnded = () => this.handleCameraLost();
  }

  /* ------------------------------------------------------------------ *
   * Lifecycle
   * ------------------------------------------------------------------ */

  private loadPromise: Promise<void> | null = null;

  /** Load the tracking model. Safe to call before any user gesture, and safe
   *  to call twice -- React StrictMode does exactly that in development. */
  load(): Promise<void> {
    this.loadPromise ??= this.doLoad().catch((err) => {
      // Let a failed load be retried rather than caching the rejection.
      this.loadPromise = null;
      throw err;
    });
    return this.loadPromise;
  }

  private async doLoad(): Promise<void> {
    const { setLive } = useStore.getState();
    setLive({ status: "loading", loadProgress: 0, loadLabel: "Starting" });
    try {
      await this.tracker.load(({ progress, label }) =>
        setLive({ loadProgress: progress, loadLabel: label }),
      );
      setLive({
        status: "ready",
        trackingDelegate: this.tracker.delegate,
        performanceWarning:
          this.tracker.delegate === "CPU"
            ? "Running hand tracking on the CPU because this browser could not use the GPU. Tracking may be slower."
            : null,
      });
    } catch (err) {
      console.error("[conductor] model load failed", err);
      setLive({
        status: "error",
        cameraError: {
          code: "ModelLoadError",
          message:
            "The hand tracking model could not be loaded. Check your connection and retry, or switch to keyboard mode.",
          offerKeyboard: true,
        },
      });
      throw err;
    }
  }

  async startCamera(): Promise<void> {
    const { setLive } = useStore.getState();
    try {
      await this.tracker.startCamera(CAMERA_QUALITIES[useStore.getState().cameraQuality]);
      setLive({ cameraError: null });
    } catch (err) {
      const described = err && typeof err === "object" && "message" in err && "code" in err
        ? (err as ReturnType<typeof describeCameraError>)
        : describeCameraError(err);
      setLive({ cameraError: described });
      // Not fatal: keyboard mode is a first-class fallback, so the app stays
      // usable rather than dead-ending on an error screen.
      throw described;
    }
  }

  /** Reopen the camera at the current quality setting. */
  private async restartCamera(): Promise<void> {
    if (this.cameraRestarting) return;
    this.cameraRestarting = true;
    try {
      this.tracker.stopCamera();
      await this.startCamera();
    } catch {
      // startCamera has already surfaced the error to the store.
    } finally {
      this.cameraRestarting = false;
    }
  }

  private cameraRestarting = false;

  /** Build the audio graph. Must be reached from a real user gesture. */
  async ensureAudio(): Promise<void> {
    if (this.audio.isStarted) return;
    await this.audio.start();
    this.audio.onMetronomeBarLimit = () => useStore.getState().set("metronomeOn", false);
    // Straight to telemetry, not the store: the beat indicator redraws itself.
    this.audio.onMetronomeBeat = (matra) => {
      telemetry.matra = matra;
    };
    this.applySettings(useStore.getState(), true);
    useStore.getState().setLive({ audioStarted: true });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.settings = { ...useStore.getState() };
    // Wire up the starting mode exactly once, here, so applySettings never has
    // to switch modes just to bootstrap them.
    this.switchMode(this.settings.playMode);
    this.applySettings(this.settings, true);

    // Settings changes are rare, so a plain subscription that diffs is
    // cheaper and clearer than wiring selectors for each field.
    this.unsubscribe = useStore.subscribe((state) => {
      const next = state as Settings;
      this.applySettings(next, false);
    });

    this.lastRafTime = performance.now();
    this.lastDetectTime = this.lastRafTime;
    this.lastHandSeenAt = this.lastRafTime;
    this.raf = requestAnimationFrame(this.loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  dispose(): void {
    this.stop();
    this.keyboard.detach();
    this.tracker.dispose();
    this.audio.dispose();
  }

  /* ------------------------------------------------------------------ *
   * The one loop
   * ------------------------------------------------------------------ */

  private readonly loop = (now: number) => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);

    const rafDt = Math.min((now - this.lastRafTime) / 1000, 0.1);
    this.lastRafTime = now;

    const idle = now - this.lastHandSeenAt > IDLE_AFTER_MS;
    telemetry.idle = idle;

    // While no hands have been seen for a while, back off to 10fps. The camera
    // keeps running, but the laptop stops working hard for nothing.
    const dueForDetect = !idle || now - this.lastDetectTime >= IDLE_INTERVAL_MS;

    let fresh = false;
    if (dueForDetect) {
      const before = performance.now();
      fresh = this.replay ? this.pumpReplay(now) : this.tracker.detect(now);
      if (fresh) {
        telemetry.detectMs = performance.now() - before;
        const detectDt = Math.min((now - this.lastDetectTime) / 1000, 0.25);
        this.lastDetectTime = now;
        telemetry.fps = this.fps.filter(1 / Math.max(detectDt, 0.001));
        this.onFreshFrame(now, detectDt);
      }
    }

    this.trackPerformance(now);
    this.drawOverlay(rafDt);
    telemetry.level = this.audio.level;

    // The recorder composites from this same loop rather than starting a
    // second one -- one rAF loop total, as the performance budget requires.
    this.onFrameRendered?.(rafDt);
  };

  /** Set by the recorder while capturing. */
  onFrameRendered: ((dt: number) => void) | null = null;

  /** Hands currently in frame, for whoever needs to draw them. */
  get visibleHands(): readonly HandFrame[] {
    return this.handsForDraw;
  }

  private onFreshFrame(now: number, dt: number): void {
    const { harmony, expression } = this.tracker;
    if (harmony.present || expression.present) this.lastHandSeenAt = now;

    telemetry.harmony = harmony.present ? harmony : null;
    telemetry.expression = expression.present ? expression : null;

    if (this.landmarkRecorder.isRecording) {
      this.landmarkRecorder.capture(
        now,
        // Label by role, not by detection order. rawLabels is in MediaPipe's
        // order, which is not the [harmony, expression] order used here, so
        // indexing one with the other swapped hands in saved clips whenever
        // MediaPipe happened to report the expression hand first.
        [harmony, expression]
          .filter((h) => h.present)
          .map((h) => ({
            label: this.tracker.labelForRole(h.role),
            score: h.score,
            landmarks: h.landmarks,
          })),
      );
    }

    this.syncPresencePills(harmony.present, expression.present);

    // Keyboard mode is driven by key events, not frames.
    if (this.currentMode === "keyboard") return;
    if (!this.audio.isStarted) return;

    this.visionFrame.timestamp = now;
    this.visionFrame.dt = dt;
    this.activeHandler().update({
      audio: this.audio,
      settings: this.settings,
      frame: this.visionFrame,
      publish: (r) => this.publish(r),
    });
  }

  private drawOverlay(dt: number): void {
    // Kept up to date even when the overlay is hidden, because a recording in
    // progress still needs the hands.
    this.handsForDraw.length = 0;
    if (this.tracker.harmony.present) this.handsForDraw.push(this.tracker.harmony);
    if (this.tracker.expression.present) this.handsForDraw.push(this.tracker.expression);

    if (!this.settings.showSkeleton) {
      this.overlay.clear();
      return;
    }
    this.overlay.resize();
    this.overlay.draw(this.handsForDraw, telemetry.degree, this.settings.mirror, dt);
  }

  private pumpReplay(now: number): boolean {
    const frame = this.replay?.frameAt(now);
    if (!frame) return false;
    this.tracker.ingestRaw(frame.hands);
    return true;
  }

  private trackPerformance(now: number): void {
    if (!this.tracker.hasCamera || this.replay) return;
    const state = useStore.getState();
    if (telemetry.fps > 0 && telemetry.fps < LOW_FPS && !telemetry.idle) {
      if (this.lowFpsSince === 0) this.lowFpsSince = now;
      else if (now - this.lowFpsSince > LOW_FPS_GRACE_MS && !state.performanceWarning) {
        state.setLive({
          performanceWarning:
            `Hand tracking is running at about ${Math.round(telemetry.fps)} fps. ` +
            `Closing other apps or browser tabs usually helps.`,
        });
      }
    } else {
      this.lowFpsSince = 0;
    }
  }

  /* ------------------------------------------------------------------ *
   * Settings, modes, readouts
   * ------------------------------------------------------------------ */

  private activeHandler(): PlayModeHandler {
    switch (this.currentMode) {
      case "theremin":
        return this.thereminMode;
      case "monoPiano":
        return this.monoPianoMode;
      case "raga":
        return this.ragaMode;
      default:
        return this.gestureMode;
    }
  }

  private applySettings(next: Settings, force: boolean): void {
    const prev = this.settings;
    this.settings = { ...next };

    this.tracker.configure({
      thresholds: next.thresholds,
      mirrored: next.mirror,
      swapHands: next.swapHands,
    });

    // Deliberately not driven by `force`. Switching modes resets every
    // handler, and `force` is also used when the audio graph finishes
    // building -- which happens *while* the player is holding the key that
    // started it. Re-switching there would wipe that held note.
    if (next.playMode !== this.currentMode) {
      this.switchMode(next.playMode);
    }

    if (!this.audio.isStarted) return;

    if (force || next.masterVolume !== prev.masterVolume) {
      this.audio.setMasterVolume(next.masterVolume);
    }
    if (force || next.chordBlend !== prev.chordBlend) {
      this.audio.setChordBlend(next.chordBlend);
    }
    if (force || next.chordInstrument !== prev.chordInstrument) {
      void this.applyInstrument(next.chordInstrument);
    }
    if (force || next.arp !== prev.arp) this.audio.setArp(next.arp);
    if (force || next.autoBass !== prev.autoBass || next.bassVolume !== prev.bassVolume) {
      this.audio.setBass(next.autoBass, next.bassVolume);
    }
    if (
      force ||
      next.metronomeOn !== prev.metronomeOn ||
      next.bpm !== prev.bpm ||
      next.timeSignature !== prev.timeSignature ||
      next.barLimit !== prev.barLimit ||
      next.clickSound !== prev.clickSound ||
      next.metronomeVolume !== prev.metronomeVolume ||
      next.tala !== prev.tala
    ) {
      this.audio.setMetronome({
        enabled: next.metronomeOn,
        bpm: next.bpm,
        timeSignature: next.timeSignature,
        barLimit: next.barLimit,
        sound: next.clickSound,
        volume: next.metronomeVolume,
        tala: next.tala ? talaById(next.tala) : null,
      });
    }

    // The tanpura is owned by raga mode while it is running; outside it, the
    // drone must be silenced or it would keep cycling under the other modes.
    if (next.playMode !== "raga" && this.audio.isStarted) {
      this.audio.setTanpura(false, next.tanpuraVolume, 60, 7);
    }
    if (!next.metronomeOn) telemetry.matra = 0;

    // Changing key or scale mid-performance must not strand a voice. The mode
    // rebuilds the chord on its next frame; releasing here would click.
    if (next.key !== prev.key || next.scale !== prev.scale) {
      this.gestureMode.reset();
    }
    if (next.raga !== prev.raga) this.ragaMode.reset();

    // Capture resolution can only change by renegotiating the stream.
    if (next.cameraQuality !== prev.cameraQuality && this.tracker.hasCamera) {
      void this.restartCamera();
    }
  }

  /** Swapping the chord timbre can mean a download, so it reports progress
   *  and falls back rather than leaving the player on a silent instrument. */
  private async applyInstrument(id: Settings["chordInstrument"]): Promise<void> {
    if (!this.audio.isStarted || id === this.audio.chordInstrument) return;
    const { setLive } = useStore.getState();
    setLive({ instrumentLoading: true });
    try {
      await this.audio.setChordInstrument(id);
    } catch {
      setLive({
        performanceWarning:
          "The piano samples could not be loaded, so the synth is still playing. Check your connection and try again.",
      });
      useStore.getState().set("chordInstrument", this.audio.chordInstrument);
    } finally {
      setLive({ instrumentLoading: false });
    }
  }

  private switchMode(mode: PlayMode): void {
    this.currentMode = mode;
    // Panic first: no voice may survive a mode change.
    this.audio.panic();
    this.gestureMode.reset();
    this.thereminMode.reset();
    this.monoPianoMode.reset();
    this.ragaMode.reset();
    this.keyboard.reset();
    this.publish({ chordName: "—", romanLabel: "" });

    if (mode === "keyboard") this.keyboard.attach();
    else this.keyboard.detach();
  }

  private lastPublished = "";
  private publish(readout: ChordReadout): void {
    const key = `${readout.chordName}|${readout.romanLabel}`;
    if (key === this.lastPublished) return;
    this.lastPublished = key;
    useStore.getState().setLive(readout);
  }

  private lastPills = "";
  private syncPresencePills(harmony: boolean, expression: boolean): void {
    const key = `${harmony}|${expression}`;
    if (key === this.lastPills) return;
    this.lastPills = key;
    useStore.getState().setLive({ harmonyPresent: harmony, expressionPresent: expression });
  }

  private handleCameraLost(): void {
    this.audio.panic();
    useStore.getState().setLive({
      cameraError: {
        code: "CameraDisconnected",
        message:
          "The camera disconnected. Reconnect it and reload, or switch to keyboard mode to keep playing.",
        offerKeyboard: true,
      },
      harmonyPresent: false,
      expressionPresent: false,
    });
  }

  /* ------------------------------------------------------------------ *
   * Dev: landmark replay
   * ------------------------------------------------------------------ */

  playClip(clip: ReplayClip): void {
    this.replay = new ReplayPlayer(clip);
    this.replay.start(performance.now());
  }

  stopClip(): void {
    this.replay = null;
    this.tracker.harmony.present = false;
    this.tracker.expression.present = false;
  }

  get isReplaying(): boolean {
    return this.replay !== null;
  }
}

/**
 * One conductor per session.
 *
 * Deliberately a module singleton rather than a ref inside a component:
 * StrictMode mounts effects twice in development, and tearing down the audio
 * graph and re-downloading the model on every remount would be miserable.
 */
let instance: Conductor | null = null;

export function getConductor(): Conductor {
  instance ??= new Conductor();
  return instance;
}
