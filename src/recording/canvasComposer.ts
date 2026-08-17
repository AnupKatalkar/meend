import type { AspectRatio, CaptureType } from "../state/store.ts";
import { SkeletonRenderer } from "../ui/SkeletonOverlay.ts";
import type { HandFrame } from "../vision/types.ts";

/** Output sizes per aspect ratio. */
export const ASPECT_SIZES: Record<AspectRatio, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1920, height: 1080 },
  "1:1": { width: 1080, height: 1080 },
};

export interface CoverRect {
  dx: number;
  dy: number;
  dw: number;
  dh: number;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * `object-fit: cover` semantics: fill the target, cropping the overflow,
 * never stretching. A 4:3 camera frame in a 9:16 output loses its sides, which
 * is the right trade -- a stretched face is far worse than a cropped one.
 */
export function coverRect(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): CoverRect {
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return { dx: 0, dy: 0, dw: targetWidth, dh: targetHeight, sx: 0, sy: 0, sw: 0, sh: 0 };
  }
  const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const sw = targetWidth / scale;
  const sh = targetHeight / scale;
  return {
    sx: (sourceWidth - sw) / 2,
    sy: (sourceHeight - sh) / 2,
    sw,
    sh,
    dx: 0,
    dy: 0,
    dw: targetWidth,
    dh: targetHeight,
  };
}

/**
 * Renders the recorded frame: mirrored camera plus neon skeleton, or skeleton
 * alone on black for the privacy-friendly share.
 */
export class CanvasComposer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly renderer: SkeletonRenderer;

  constructor(renderer?: SkeletonRenderer) {
    this.canvas = document.createElement("canvas");
    const ctx = this.canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Could not get a 2D context for recording");
    this.ctx = ctx;
    // Share the live renderer so particle bursts appear in the recording too.
    this.renderer = renderer ?? new SkeletonRenderer();
    this.resize("9:16");
  }

  resize(aspect: AspectRatio): void {
    const { width, height } = ASPECT_SIZES[aspect];
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  render(opts: {
    video: HTMLVideoElement | null;
    hands: readonly HandFrame[];
    degree: number | null;
    mirrored: boolean;
    captureType: CaptureType;
    dt: number;
  }): void {
    const { canvas, ctx } = this;
    const { width, height } = canvas;
    const showVideo = opts.captureType === "video" && opts.video && opts.video.readyState >= 2;

    ctx.fillStyle = "#05060a";
    ctx.fillRect(0, 0, width, height);

    let rect: CoverRect = { dx: 0, dy: 0, dw: width, dh: height, sx: 0, sy: 0, sw: 0, sh: 0 };

    if (showVideo && opts.video) {
      const v = opts.video;
      rect = coverRect(v.videoWidth, v.videoHeight, width, height);
      ctx.save();
      if (opts.mirrored) {
        ctx.translate(width, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(v, rect.sx, rect.sy, rect.sw, rect.sh, rect.dx, rect.dy, rect.dw, rect.dh);
      ctx.restore();
    }

    // Landmarks are normalized to the camera frame, so they have to travel
    // through the same crop as the video or the skeleton drifts off the hands.
    ctx.save();
    if (showVideo && opts.video) {
      const v = opts.video;
      const scaleX = rect.dw / rect.sw;
      const scaleY = rect.dh / rect.sh;
      ctx.translate(rect.dx - rect.sx * scaleX, rect.dy - rect.sy * scaleY);
      this.renderer.draw(
        ctx,
        v.videoWidth * scaleX,
        v.videoHeight * scaleY,
        opts.hands,
        { mirrored: opts.mirrored, degree: opts.degree, background: "none", scale: 2 },
        opts.dt,
      );
    } else {
      this.renderer.draw(
        ctx,
        width,
        height,
        opts.hands,
        { mirrored: opts.mirrored, degree: opts.degree, background: "none", scale: 2 },
        opts.dt,
      );
    }
    ctx.restore();
  }
}
