import * as Tone from "tone";
import type { AudioEngine } from "../audio/AudioEngine.ts";
import type { Conductor } from "../engine/Conductor.ts";
import type { AspectRatio, CaptureType } from "../state/store.ts";
import { telemetry } from "../state/telemetry.ts";
import { CanvasComposer } from "./canvasComposer.ts";

/** Hard cap, per the spec. */
export const MAX_DURATION_MS = 30_000;
export const COUNTDOWN_SECONDS = 3;
const CAPTURE_FPS = 30;

export interface MimeChoice {
  mimeType: string;
  /** What the user is actually getting, in plain language. */
  label: string;
  extension: string;
}

/**
 * Probe in the spec's order and report honestly.
 *
 * MP4 out of MediaRecorder is not available everywhere -- Chrome has it,
 * Firefox generally does not -- so the UI states the format rather than
 * promising MP4 and quietly handing over a .webm.
 */
export function pickSupportedMime(kind: "video" | "audio"): MimeChoice {
  const candidates: MimeChoice[] =
    kind === "video"
      ? [
          { mimeType: "video/mp4;codecs=avc1,mp4a.40.2", label: "MP4 (H.264 + AAC)", extension: "mp4" },
          { mimeType: "video/webm;codecs=vp9,opus", label: "WebM (VP9 + Opus)", extension: "webm" },
          { mimeType: "video/webm", label: "WebM", extension: "webm" },
        ]
      : [
          { mimeType: "audio/mp4", label: "M4A (AAC)", extension: "m4a" },
          { mimeType: "audio/webm;codecs=opus", label: "WebM (Opus)", extension: "webm" },
          { mimeType: "audio/webm", label: "WebM", extension: "webm" },
        ];

  if (typeof MediaRecorder !== "undefined") {
    for (const candidate of candidates) {
      if (MediaRecorder.isTypeSupported(candidate.mimeType)) return candidate;
    }
  }
  // Let the browser choose, and say so.
  return { mimeType: "", label: "browser default", extension: kind === "video" ? "webm" : "webm" };
}

export type RecorderPhase = "idle" | "countdown" | "recording" | "preview";

export interface RecordingResult {
  url: string;
  blob: Blob;
  format: MimeChoice;
  durationMs: number;
  captureType: CaptureType;
}

export interface RecorderCallbacks {
  onPhase: (phase: RecorderPhase) => void;
  onCountdown: (secondsLeft: number) => void;
  onElapsed: (ms: number) => void;
  onResult: (result: RecordingResult) => void;
  onError: (message: string) => void;
}

/**
 * Orchestrates MediaRecorder over a tap of the master audio bus and, for video
 * captures, a canvas composited from the shared rAF loop.
 */
export class Recorder {
  private readonly composer: CanvasComposer;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private phase: RecorderPhase = "idle";
  private startedAt = 0;
  private countdownTimer: number | null = null;
  private tickTimer: number | null = null;
  private stopTimer: number | null = null;
  private audioTap: MediaStreamAudioDestinationNode | null = null;
  private micStream: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private hiResStream: MediaStream | null = null;
  private hiResVideo: HTMLVideoElement | null = null;
  private lastUrl: string | null = null;
  private format: MimeChoice = { mimeType: "", label: "", extension: "webm" };
  private captureType: CaptureType = "skeleton";
  /** Bumped by every begin() and by stop(). If it changes while the countdown
   *  is running, that take was cancelled or superseded and must not start. */
  private runToken = 0;

  constructor(
    private readonly conductor: Conductor,
    private readonly audio: AudioEngine,
    private readonly callbacks: RecorderCallbacks,
  ) {
    this.composer = new CanvasComposer(conductor.overlay.sharedRenderer);
  }

  get currentPhase(): RecorderPhase {
    return this.phase;
  }

  get canvas(): HTMLCanvasElement {
    return this.composer.canvas;
  }

  /** Countdown, then record. */
  async begin(opts: { captureType: CaptureType; aspect: AspectRatio; micMix: boolean }): Promise<void> {
    if (this.phase !== "idle" && this.phase !== "preview") return;
    this.discardResult();
    this.captureType = opts.captureType;
    this.composer.resize(opts.aspect);

    const token = ++this.runToken;
    this.setPhase("countdown");
    let left = COUNTDOWN_SECONDS;
    this.callbacks.onCountdown(left);
    await new Promise<void>((resolve) => {
      this.countdownTimer = window.setInterval(() => {
        left -= 1;
        this.callbacks.onCountdown(left);
        if (left <= 0) {
          if (this.countdownTimer !== null) window.clearInterval(this.countdownTimer);
          this.countdownTimer = null;
          resolve();
        }
      }, 1000);
    });

    if (token !== this.runToken) return; // cancelled during the countdown
    await this.startRecording(opts);
  }

  private async startRecording(opts: {
    captureType: CaptureType;
    aspect: AspectRatio;
    micMix: boolean;
  }): Promise<void> {
    try {
      const rawContext = Tone.getContext().rawContext as unknown as AudioContext;
      this.audioTap = rawContext.createMediaStreamDestination();
      // Tap the master bus, after the limiter, so the recording matches what
      // the player hears.
      this.audio.masterTap.connect(this.audioTap);

      if (opts.micMix) await this.attachMicrophone(rawContext);

      const wantsVideo = opts.captureType !== "audio";
      let stream: MediaStream;

      if (wantsVideo) {
        if (opts.captureType === "video") await this.acquireHiResVideo();
        this.conductor.onFrameRendered = (dt) => this.composeFrame(dt);
        // Prime the canvas so the very first captured frame is not blank.
        this.composeFrame(1 / CAPTURE_FPS);
        const canvasStream = this.composer.canvas.captureStream(CAPTURE_FPS);
        stream = new MediaStream([
          ...canvasStream.getVideoTracks(),
          ...this.audioTap.stream.getAudioTracks(),
        ]);
        this.format = pickSupportedMime("video");
      } else {
        stream = new MediaStream(this.audioTap.stream.getAudioTracks());
        this.format = pickSupportedMime("audio");
      }

      this.chunks = [];
      this.recorder = new MediaRecorder(
        stream,
        this.format.mimeType ? { mimeType: this.format.mimeType } : undefined,
      );
      this.recorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.chunks.push(e.data);
      };
      this.recorder.onstop = () => this.finalize();
      this.recorder.onerror = () => {
        this.callbacks.onError("Recording failed. Try a different capture type.");
        this.cleanup();
        this.setPhase("idle");
      };

      this.recorder.start(250);
      this.startedAt = performance.now();
      this.setPhase("recording");

      this.tickTimer = window.setInterval(() => {
        this.callbacks.onElapsed(performance.now() - this.startedAt);
      }, 100);
      this.stopTimer = window.setTimeout(() => this.stop(), MAX_DURATION_MS);
    } catch (err) {
      console.error("[recorder] failed to start", err);
      this.callbacks.onError(
        err instanceof Error ? err.message : "Recording could not be started.",
      );
      this.cleanup();
      this.setPhase("idle");
    }
  }

  /**
   * Video capture upgrades to a higher-resolution stream, so the recording is
   * not limited to the 640x480 the tracker needs. It goes to a second video
   * element: swapping the tracking element's source mid-session would stall
   * MediaPipe's timestamps.
   */
  private async acquireHiResVideo(): Promise<void> {
    try {
      this.hiResStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      const video = document.createElement("video");
      video.playsInline = true;
      video.muted = true;
      video.srcObject = this.hiResStream;
      await video.play();
      this.hiResVideo = video;
    } catch {
      // Many devices refuse a second stream from the same camera. The tracking
      // feed still records fine, just at its own resolution.
      this.hiResStream = null;
      this.hiResVideo = null;
    }
  }

  private async attachMicrophone(rawContext: AudioContext): Promise<void> {
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      this.micSource = rawContext.createMediaStreamSource(this.micStream);
      // Into the recording tap only, never back into the speakers -- routing
      // the mic to the output is a feedback loop.
      if (this.audioTap) this.micSource.connect(this.audioTap);
    } catch (err) {
      console.warn("[recorder] microphone unavailable", err);
      this.callbacks.onError("Microphone unavailable, recording without it.");
    }
  }

  private composeFrame(dt: number): void {
    this.composer.render({
      video: this.captureType === "video" ? (this.hiResVideo ?? this.conductor.tracker.video) : null,
      hands: this.conductor.visibleHands,
      degree: telemetry.degree,
      mirrored: true,
      captureType: this.captureType,
      dt,
    });
  }

  stop(): void {
    this.runToken++;
    if (this.phase === "countdown") {
      if (this.countdownTimer !== null) window.clearInterval(this.countdownTimer);
      this.countdownTimer = null;
      this.setPhase("idle");
      return;
    }
    if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
  }

  private finalize(): void {
    const durationMs = performance.now() - this.startedAt;
    const blob = new Blob(this.chunks, { type: this.format.mimeType || undefined });
    this.cleanup();

    if (blob.size === 0) {
      this.callbacks.onError("Nothing was captured. Try again.");
      this.setPhase("idle");
      return;
    }

    const url = URL.createObjectURL(blob);
    this.lastUrl = url;
    this.setPhase("preview");
    this.callbacks.onResult({
      url,
      blob,
      format: this.format,
      durationMs,
      captureType: this.captureType,
    });
  }

  private cleanup(): void {
    this.conductor.onFrameRendered = null;
    if (this.tickTimer !== null) window.clearInterval(this.tickTimer);
    if (this.stopTimer !== null) window.clearTimeout(this.stopTimer);
    if (this.countdownTimer !== null) window.clearInterval(this.countdownTimer);
    this.tickTimer = this.stopTimer = this.countdownTimer = null;

    if (this.audioTap) {
      try {
        this.audio.masterTap.disconnect(this.audioTap);
      } catch {
        // Already torn down; nothing to do.
      }
    }
    this.micSource?.disconnect();
    this.micSource = null;
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micStream = null;
    this.hiResStream?.getTracks().forEach((t) => t.stop());
    this.hiResStream = null;
    this.hiResVideo = null;
    this.audioTap = null;
    this.recorder = null;
  }

  /** Free the previous blob URL. Called before a new take and on unmount. */
  discardResult(): void {
    if (this.lastUrl) {
      URL.revokeObjectURL(this.lastUrl);
      this.lastUrl = null;
    }
  }

  reset(): void {
    this.discardResult();
    this.setPhase("idle");
  }

  dispose(): void {
    this.stop();
    this.cleanup();
    this.discardResult();
  }

  private setPhase(phase: RecorderPhase): void {
    this.phase = phase;
    this.callbacks.onPhase(phase);
  }
}
