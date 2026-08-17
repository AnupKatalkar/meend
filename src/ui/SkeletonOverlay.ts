import { HAND_CONNECTIONS, LANDMARK_COUNT } from "../vision/landmarks.ts";
import type { HandFrame } from "../vision/types.ts";

/**
 * Neon hand skeleton, drawn imperatively on a canvas. Never a React component:
 * this runs 30 times a second inside the shared rAF loop.
 *
 * The hue shifts with the scale degree so what you see agrees with what you
 * hear -- a iii chord and a V chord are different colours.
 */

/** Hue per scale degree, walking the wheel so neighbouring degrees differ
 *  clearly. Index 0 is the muted/no-chord state. */
const DEGREE_HUES = [190, 265, 300, 330, 20, 45, 90, 155];

const HARMONY_HUE_OFFSET = 0;
/** Second hand gets a distinct hue so the two are never confused. */
const EXPRESSION_HUE_OFFSET = 45;

export interface DrawOptions {
  /** Flip horizontally to match the mirrored preview. */
  mirrored: boolean;
  /** Committed scale degree; drives the colour. */
  degree: number | null;
  /**
   * What to do with what is already on the canvas:
   *   "clear" -- wipe to transparent (the live overlay, layered over video)
   *   "fill"  -- paint the dark ground (skeleton-only recording)
   *   "none"  -- draw straight on top (compositing over a video frame)
   */
  background: "clear" | "fill" | "none";
  /** Scales line widths and dot radii for high-resolution capture canvases. */
  scale?: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  hue: number;
}

/** Fixed pool: the loop must not allocate. */
const PARTICLE_COUNT = 64;

export class SkeletonRenderer {
  private readonly particles: Particle[] = [];
  private cursor = 0;

  constructor() {
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      this.particles.push({ x: 0, y: 0, vx: 0, vy: 0, life: 0, hue: 0 });
    }
  }

  /** Burst from the fingertips on a chord attack. */
  burst(hand: HandFrame, degree: number | null): void {
    if (!hand.present) return;
    const hue = DEGREE_HUES[(degree ?? 0) % DEGREE_HUES.length];
    for (const tip of [4, 8, 12, 16, 20]) {
      const lm = hand.landmarks[tip];
      for (let i = 0; i < 2; i++) {
        const p = this.particles[this.cursor];
        this.cursor = (this.cursor + 1) % PARTICLE_COUNT;
        p.x = lm.x;
        p.y = lm.y;
        // Deterministic-ish spread; Math.random is fine here, it is visual only.
        p.vx = (Math.random() - 0.5) * 0.006;
        p.vy = -Math.random() * 0.008 - 0.001;
        p.life = 1;
        p.hue = hue;
      }
    }
  }

  private stepParticles(dt: number): void {
    for (const p of this.particles) {
      if (p.life <= 0) continue;
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.00018; // gentle gravity
      p.life -= dt * 1.1;
    }
  }

  draw(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    hands: readonly HandFrame[],
    opts: DrawOptions,
    dt = 1 / 60,
  ): void {
    const scale = opts.scale ?? 1;

    if (opts.background === "fill") {
      ctx.fillStyle = "#05060a";
      ctx.fillRect(0, 0, width, height);
    } else if (opts.background === "clear") {
      ctx.clearRect(0, 0, width, height);
    }

    ctx.save();
    if (opts.mirrored) {
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
    }

    this.stepParticles(dt);
    this.drawParticles(ctx, width, height, scale);

    for (const hand of hands) {
      if (!hand.present) continue;
      const base = DEGREE_HUES[(opts.degree ?? 0) % DEGREE_HUES.length];
      const hue =
        (base + (hand.role === "harmony" ? HARMONY_HUE_OFFSET : EXPRESSION_HUE_OFFSET)) % 360;
      this.drawHand(ctx, width, height, hand, hue, scale);
    }

    ctx.restore();
  }

  private drawParticles(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    scale: number,
  ): void {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const p of this.particles) {
      if (p.life <= 0) continue;
      ctx.globalAlpha = Math.max(p.life, 0) * 0.7;
      ctx.fillStyle = `hsl(${p.hue} 100% 70%)`;
      ctx.beginPath();
      ctx.arc(p.x * width, p.y * height, 2.5 * scale * p.life, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawHand(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    hand: HandFrame,
    hue: number,
    scale: number,
  ): void {
    const lm = hand.landmarks;

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowBlur = 16 * scale;
    ctx.shadowColor = `hsl(${hue} 100% 60%)`;

    // Bones.
    ctx.strokeStyle = `hsl(${hue} 95% 62%)`;
    ctx.lineWidth = 3.2 * scale;
    ctx.beginPath();
    for (const [a, b] of HAND_CONNECTIONS) {
      ctx.moveTo(lm[a].x * width, lm[a].y * height);
      ctx.lineTo(lm[b].x * width, lm[b].y * height);
    }
    ctx.stroke();

    // Joints. Fingertips read brighter and larger so gestures are legible.
    for (let i = 0; i < LANDMARK_COUNT; i++) {
      const isTip = i === 4 || i === 8 || i === 12 || i === 16 || i === 20;
      const extended = isTip && isFingerTipExtended(hand, i);
      ctx.fillStyle = extended
        ? `hsl(${hue} 100% 82%)`
        : isTip
          ? `hsl(${hue} 90% 62%)`
          : `hsl(${hue} 80% 72%)`;
      ctx.beginPath();
      ctx.arc(lm[i].x * width, lm[i].y * height, (isTip ? 5.5 : 3.4) * scale, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}

function isFingerTipExtended(hand: HandFrame, index: number): boolean {
  switch (index) {
    case 4:
      return hand.fingers.thumb;
    case 8:
      return hand.fingers.index;
    case 12:
      return hand.fingers.middle;
    case 16:
      return hand.fingers.ring;
    case 20:
      return hand.fingers.pinky;
    default:
      return false;
  }
}

/** Live overlay bound to a canvas element, sized to its display box. */
export class SkeletonOverlay {
  private readonly renderer = new SkeletonRenderer();
  private ctx: CanvasRenderingContext2D | null = null;
  private canvas: HTMLCanvasElement | null = null;

  get sharedRenderer(): SkeletonRenderer {
    return this.renderer;
  }

  attach(canvas: HTMLCanvasElement | null): void {
    this.canvas = canvas;
    this.ctx = canvas?.getContext("2d") ?? null;
  }

  /** Match the backing store to the CSS box so the neon stays crisp. */
  resize(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  draw(hands: readonly HandFrame[], degree: number | null, mirrored: boolean, dt: number): void {
    const ctx = this.ctx;
    const canvas = this.canvas;
    if (!ctx || !canvas) return;
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.draw(
      ctx,
      canvas.width,
      canvas.height,
      hands,
      { mirrored, degree, background: "clear", scale },
      dt,
    );
  }

  clear(): void {
    const ctx = this.ctx;
    const canvas = this.canvas;
    if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}
