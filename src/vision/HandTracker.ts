import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import type { HandLandmarkerResult } from "@mediapipe/tasks-vision";
import { LANDMARK_COUNT, makeLandmarkArray } from "./landmarks.ts";
import {
  DEFAULT_THRESHOLDS,
  type FingerThresholds,
  classifyFingers,
  countFingers,
  handHeight,
  pinchDistance,
  wristTilt,
} from "./fingers.ts";
import { LM, palmLength } from "./landmarks.ts";
import { HandednessCalibrator } from "./handedness.ts";
import type { HandFrame, HandRole, Point } from "./types.ts";
import type { CameraError } from "../state/store.ts";

export interface LoadProgress {
  /** 0..1 across the whole load. */
  progress: number;
  label: string;
}

interface AssetManifest {
  assets: Array<{ path: string; bytes: number }>;
}

/** Fetch with a determinate progress callback, falling back to an
 *  indeterminate crawl if the server withholds a content length. */
async function fetchWithProgress(
  url: string,
  expectedBytes: number | undefined,
  onBytes: (loaded: number, total: number) => void,
): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);

  const headerLength = Number(res.headers.get("content-length")) || 0;
  const total = headerLength || expectedBytes || 0;

  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    onBytes(buf.byteLength, buf.byteLength);
    return buf;
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onBytes(loaded, total || loaded);
  }

  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

function emptyHand(role: HandRole): HandFrame {
  return {
    role,
    present: false,
    landmarks: makeLandmarkArray(),
    fingers: { thumb: false, index: false, middle: false, ring: false, pinky: false },
    fingerCount: 0,
    tilt: 0,
    height: 0,
    pinch: Number.POSITIVE_INFINITY,
    palmSize: 0,
    score: 0,
  };
}

export interface CameraOptions {
  width: number;
  height: number;
  frameRate: number;
  deviceId?: string;
}

export const DEFAULT_CAMERA: CameraOptions = { width: 1280, height: 720, frameRate: 30 };

/** Named capture sizes offered in settings. */
export const CAMERA_QUALITIES = {
  "480p": { width: 640, height: 480, frameRate: 30 },
  "720p": { width: 1280, height: 720, frameRate: 30 },
  "1080p": { width: 1920, height: 1080, frameRate: 30 },
} as const;

export type CameraQuality = keyof typeof CAMERA_QUALITIES;

/**
 * Detection resolution, independent of capture resolution.
 *
 * Hand landmarks need far less detail than a person wants to look at. Running
 * detection on a 1080p frame costs roughly nine times the pixels of a 640-wide
 * one and buys nothing, so a larger frame is drawn down to this width first.
 * Landmarks come back normalized to 0..1, so the downscale does not shift a
 * single coordinate.
 */
const TRACK_WIDTH = 640;

/**
 * Owns the MediaPipe lifecycle and the camera stream, and turns raw landmark
 * output into the two role-tagged `HandFrame`s the rest of the app consumes.
 *
 * Hand frames are pooled and mutated in place -- there is no allocation in the
 * per-frame path. Do not retain a HandFrame across frames.
 */
export class HandTracker {
  readonly video: HTMLVideoElement;
  readonly harmony = emptyHand("harmony");
  readonly expression = emptyHand("expression");

  private landmarker: HandLandmarker | null = null;
  private stream: MediaStream | null = null;
  private lastVideoTime = -1;
  private lastTimestamp = -1;
  private thresholds: FingerThresholds = DEFAULT_THRESHOLDS;
  private trackingCanvas: HTMLCanvasElement | null = null;
  private trackingCtx: CanvasRenderingContext2D | null = null;
  private mirrored = true;
  private swapHands = false;

  /** What MediaPipe last called each hand, purely for the dev calibration
   *  readout. Nothing functional reads this. */
  readonly rawLabels: string[] = [];

  /**
   * Learns which way MediaPipe's handedness labels run on this setup. See
   * vision/handedness.ts: the labels are documented to assume mirrored input
   * and we feed raw frames, but that is checked against hand position rather
   * than taken on faith.
   */
  readonly handedness = new HandednessCalibrator();

  delegate: "GPU" | "CPU" | null = null;

  constructor() {
    this.video = document.createElement("video");
    this.video.playsInline = true;
    this.video.muted = true;
    this.video.autoplay = true;
    // Never render this element directly; CameraView draws it, mirrored.
    this.video.setAttribute("aria-hidden", "true");
  }

  configure(opts: { thresholds?: FingerThresholds; mirrored?: boolean; swapHands?: boolean }): void {
    if (opts.thresholds) this.thresholds = opts.thresholds;
    if (opts.mirrored !== undefined) this.mirrored = opts.mirrored;
    if (opts.swapHands !== undefined) this.swapHands = opts.swapHands;
  }

  get isLoaded(): boolean {
    return this.landmarker !== null;
  }

  get hasCamera(): boolean {
    return this.stream !== null;
  }

  /**
   * Load the vendored wasm runtime and hand landmark model.
   *
   * The model is fetched as a buffer so the progress bar is determinate rather
   * than a spinner over tens of megabytes. The wasm binary is pre-fetched for
   * the same reason: FilesetResolver offers no progress hook, so we warm the
   * HTTP cache first and let it read from cache.
   */
  async load(onProgress: (p: LoadProgress) => void): Promise<void> {
    if (this.landmarker) return;

    let manifest: AssetManifest = { assets: [] };
    try {
      const res = await fetch("/asset-manifest.json");
      if (res.ok) manifest = (await res.json()) as AssetManifest;
    } catch {
      // Manifest is an optimisation for the progress bar, not a requirement.
    }
    const sizeOf = (path: string) => manifest.assets.find((a) => a.path === path)?.bytes;

    const WASM_PATH = "/wasm/vision_wasm_internal.wasm";
    const MODEL_PATH = "/models/hand_landmarker.task";
    const wasmBytes = sizeOf(WASM_PATH) ?? 11_000_000;
    const modelBytes = sizeOf(MODEL_PATH) ?? 7_800_000;
    const totalBytes = wasmBytes + modelBytes;

    let wasmLoaded = 0;
    let modelLoaded = 0;
    const report = (label: string) =>
      onProgress({
        // Reserve the last 5% for MediaPipe's own initialisation, which is
        // not instant and would otherwise leave the bar stuck at 100%.
        progress: Math.min((wasmLoaded + modelLoaded) / totalBytes, 1) * 0.95,
        label,
      });

    // Warm the cache for the wasm binary. A failure here is not fatal --
    // FilesetResolver will simply fetch it itself, without progress.
    try {
      await fetchWithProgress(WASM_PATH, wasmBytes, (loaded) => {
        wasmLoaded = loaded;
        report("Loading hand tracking runtime");
      });
    } catch {
      wasmLoaded = wasmBytes;
    }

    const modelBuffer = await fetchWithProgress(MODEL_PATH, modelBytes, (loaded) => {
      modelLoaded = loaded;
      report("Loading hand model");
    });

    onProgress({ progress: 0.96, label: "Starting hand tracking" });
    const vision = await FilesetResolver.forVisionTasks("/wasm");

    const options = {
      baseOptions: { modelAssetBuffer: modelBuffer, delegate: "GPU" as const },
      runningMode: "VIDEO" as const,
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    };

    try {
      this.landmarker = await HandLandmarker.createFromOptions(vision, options);
      this.delegate = "GPU";
    } catch (gpuError) {
      // No WebGL, a blocklisted driver, or a headless GPU. CPU still works,
      // just slower -- the caller surfaces that to the player.
      console.warn("[vision] GPU delegate unavailable, falling back to CPU", gpuError);
      this.landmarker = await HandLandmarker.createFromOptions(vision, {
        ...options,
        // The buffer is consumed by the failed attempt, so hand over a copy.
        baseOptions: { modelAssetBuffer: modelBuffer.slice(), delegate: "CPU" },
      });
      this.delegate = "CPU";
    }

    onProgress({ progress: 1, label: "Ready" });
  }

  async startCamera(opts: CameraOptions = DEFAULT_CAMERA): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw describeCameraError(new DOMException("unsupported", "NotSupportedError"));
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: opts.width },
          height: { ideal: opts.height },
          frameRate: { ideal: opts.frameRate },
          ...(opts.deviceId ? { deviceId: { exact: opts.deviceId } } : {}),
        },
        audio: false,
      });
    } catch (err) {
      throw describeCameraError(err);
    }

    this.video.srcObject = this.stream;
    await this.video.play();
    // A camera unplugged mid-session ends its track rather than throwing.
    for (const track of this.stream.getVideoTracks()) {
      track.addEventListener("ended", () => this.onTrackEnded?.());
    }
  }

  /** Set by the engine to surface a mid-session camera disappearance. */
  onTrackEnded: (() => void) | null = null;

  stopCamera(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.lastVideoTime = -1;
    this.harmony.present = false;
    this.expression.present = false;
  }

  /**
   * Run detection for the current video frame.
   *
   * @returns true when a fresh result was produced. False means the video has
   *   not advanced since last call -- MediaPipe rejects duplicate timestamps,
   *   and running anyway just burns GPU time.
   */
  detect(nowMs: number): boolean {
    const lm = this.landmarker;
    if (!lm || !this.stream) return false;
    if (this.video.readyState < 2) return false;
    if (this.video.currentTime === this.lastVideoTime) return false;
    this.lastVideoTime = this.video.currentTime;

    // detectForVideo demands a strictly increasing timestamp.
    const timestamp = nowMs > this.lastTimestamp ? nowMs : this.lastTimestamp + 1;
    this.lastTimestamp = timestamp;

    let result: HandLandmarkerResult;
    try {
      result = lm.detectForVideo(this.detectionSource(), timestamp);
    } catch (err) {
      console.warn("[vision] detect failed", err);
      return false;
    }

    this.ingest(result);
    return true;
  }

  /**
   * What actually gets handed to MediaPipe.
   *
   * The video element itself when it is already small enough; otherwise a
   * downscaled copy, so the preview can be sharp without making detection
   * proportionally more expensive.
   */
  private detectionSource(): HTMLVideoElement | HTMLCanvasElement {
    const video = this.video;
    if (video.videoWidth <= TRACK_WIDTH || video.videoWidth === 0) return video;

    if (!this.trackingCanvas) {
      this.trackingCanvas = document.createElement("canvas");
      this.trackingCtx = this.trackingCanvas.getContext("2d", {
        alpha: false,
        // The frame is read once per detection and never composited.
        willReadFrequently: false,
      });
    }
    const canvas = this.trackingCanvas;
    const ctx = this.trackingCtx;
    if (!ctx) return video;

    const height = Math.round((video.videoHeight / video.videoWidth) * TRACK_WIDTH);
    if (canvas.width !== TRACK_WIDTH || canvas.height !== height) {
      canvas.width = TRACK_WIDTH;
      canvas.height = height;
    }
    ctx.drawImage(video, 0, 0, TRACK_WIDTH, height);
    return canvas;
  }

  /** The capture size actually negotiated with the camera. */
  get captureSize(): { width: number; height: number } {
    return { width: this.video.videoWidth, height: this.video.videoHeight };
  }

  /** Feed landmarks from somewhere other than a camera (replay dev mode). */
  ingestRaw(hands: Array<{ landmarks: Point[]; label: string; score: number }>): void {
    this.rawLabels.length = 0;
    this.harmony.present = false;
    this.expression.present = false;
    for (const hand of hands) {
      this.rawLabels.push(hand.label);
      const role = this.handedness.roleFor(hand.label, this.swapHands);
      this.fill(role === "harmony" ? this.harmony : this.expression, hand.landmarks, hand.score);
    }
  }

  /** The label MediaPipe would have used for a hand doing this job, given the
   *  polarity currently in force. Landmark clips store labels, not roles. */
  labelForRole(role: HandRole): string {
    return this.handedness.labelFor(role, this.swapHands);
  }

  private ingest(result: HandLandmarkerResult): void {
    this.rawLabels.length = 0;
    this.harmony.present = false;
    this.expression.present = false;

    const count = Math.min(result.landmarks.length, 2);

    // Both hands in frame is the one moment the label polarity can be checked
    // against something independent of MediaPipe. Do it before assigning
    // roles, so a correction takes effect on the frame that earns it.
    if (count === 2) {
      const wristA = (result.landmarks[0] as unknown as Point[])[LM.WRIST];
      const wristB = (result.landmarks[1] as unknown as Point[])[LM.WRIST];
      if (wristA && wristB) {
        this.handedness.observe(
          result.handedness[0]?.[0]?.categoryName ?? "",
          wristA.x,
          result.handedness[1]?.[0]?.categoryName ?? "",
          wristB.x,
        );
      }
    }

    for (let i = 0; i < count; i++) {
      const category = result.handedness[i]?.[0];
      const label = category?.categoryName ?? "Right";
      this.rawLabels.push(label);

      const role = this.handedness.roleFor(label, this.swapHands);
      const target = role === "harmony" ? this.harmony : this.expression;
      // Two hands can occasionally be labelled the same. Keep the more
      // confident one rather than letting the second overwrite the first.
      if (target.present && (category?.score ?? 0) < target.score) continue;
      this.fill(target, result.landmarks[i] as unknown as Point[], category?.score ?? 1);
    }
  }

  /** Copy landmarks into the pooled frame and derive everything from them. */
  private fill(frame: HandFrame, source: readonly Point[], score: number): void {
    if (source.length < LANDMARK_COUNT) return;
    for (let i = 0; i < LANDMARK_COUNT; i++) {
      const src = source[i];
      const dst = frame.landmarks[i];
      dst.x = src.x;
      dst.y = src.y;
      dst.z = src.z;
    }

    frame.present = true;
    frame.score = score;
    frame.fingers = classifyFingers(frame.landmarks, this.thresholds);
    frame.fingerCount = countFingers(frame.fingers);
    frame.height = handHeight(frame.landmarks);
    frame.pinch = pinchDistance(frame.landmarks);
    frame.palmSize = palmLength(frame.landmarks);

    // Landmarks stay in raw camera space, but tilt is reported the way the
    // player perceives it in the mirrored preview: tilt right, brighter.
    const rawTilt = wristTilt(frame.landmarks);
    frame.tilt = this.mirrored ? -rawTilt : rawTilt;
  }

  dispose(): void {
    this.stopCamera();
    this.landmarker?.close();
    this.landmarker = null;
  }
}

/** Turn a getUserMedia rejection into a sentence a player can act on. */
export function describeCameraError(err: unknown): CameraError {
  const name = err instanceof DOMException ? err.name : (err as { name?: string })?.name ?? "Error";
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return {
        code: name,
        message:
          "Camera permission was denied. Click the lock icon in the address bar to allow it, then reload. Or switch to keyboard mode.",
        offerKeyboard: true,
      };
    case "NotFoundError":
    case "DevicesNotFoundError":
      return {
        code: name,
        message: "No camera found. Keyboard mode works without one.",
        offerKeyboard: true,
      };
    case "NotReadableError":
    case "TrackStartError":
      return {
        code: name,
        message: "Another app is using the camera. Close it and try again.",
        offerKeyboard: true,
      };
    case "NotSupportedError":
    case "SecurityError":
      return {
        code: name,
        message: "This page needs HTTPS to reach the camera.",
        offerKeyboard: true,
      };
    case "OverconstrainedError":
      return {
        code: name,
        message: "This camera cannot provide the requested video size. Try a lower resolution in settings.",
        offerKeyboard: true,
      };
    default:
      return {
        code: name,
        message: `The camera could not be started (${name}). Keyboard mode works without one.`,
        offerKeyboard: true,
      };
  }
}
