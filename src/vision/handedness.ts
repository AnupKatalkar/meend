import type { HandRole } from "./types.ts";
import { HANDEDNESS_KEY, migrateLegacyKey } from "../state/storageKeys.ts";

/* ------------------------------------------------------------------ *
 * The mirror trap, measured rather than assumed.
 *
 * The preview must be mirrored or the instrument feels wrong to play: you
 * raise your left hand and the hand on the left of the screen must rise. We
 * mirror in CSS and canvas only. MediaPipe always receives raw, unmirrored
 * frames.
 *
 * MediaPipe's own documentation says handedness "is determined assuming the
 * input image is mirrored, i.e., taken with a front-facing/selfie camera with
 * images flipped horizontally. If it is not the case, please swap the
 * handedness output in the application." We feed raw frames, so the labels
 * should come out opposite to the player's anatomy: a hand it calls "Right"
 * is the player's left.
 *
 * That is a documented convention, not a guarantee about this camera and this
 * build, and getting it backwards silently swaps every control in the app. So
 * it is treated as a prior and then measured.
 *
 * The measurement needs no calibration step and no cooperation from the
 * player. Whenever both hands are in frame there is a second signal that owes
 * nothing to MediaPipe: in a raw, unmirrored camera image the player's left
 * hand sits on the right of the picture, exactly as it does in a photograph of
 * someone facing you. Compare that against the label on the same hand and the
 * polarity falls out. Evidence accumulates over frames, so a moment of crossed
 * arms cannot flip anything.
 * ------------------------------------------------------------------ */

/** What we believe before any evidence arrives, per MediaPipe's docs. */
export const ASSUMED_INVERTED = true;

/** Evidence needed before a polarity is treated as measured and stored. */
const COMMIT_VOTES = 12;

/** Ceiling on accumulated evidence, so a settled reading can still be
 *  overturned within a second or two of contrary frames rather than needing
 *  to unwind minutes of votes. */
const MAX_VOTES = 40;

/** Minimum horizontal gap between two wrists, normalized, before their
 *  left-right order means anything. Overlapping hands vote on noise. */
const MIN_SEPARATION = 0.08;

const STORAGE_KEY = HANDEDNESS_KEY;
// Carried over from the former project name before anything reads it.
migrateLegacyKey(STORAGE_KEY);
const STORAGE_VERSION = 1;

/**
 * Map a MediaPipe handedness label onto the job that hand does.
 *
 * Pure and total: the single place a raw label becomes a role. Nothing
 * downstream of the tracker ever sees "Left" or "Right".
 */
export function roleForLabel(label: string, swapHands: boolean, inverted: boolean): HandRole {
  const isPlayersLeftHand = inverted ? label === "Right" : label === "Left";
  // Left hand picks harmony, right hand shapes expression, unless swapped.
  return isPlayersLeftHand !== swapHands ? "harmony" : "expression";
}

/** The inverse of `roleForLabel`, for writing labels back out (landmark
 *  clips record labels, not roles, so a clip replays the same way it played). */
export function labelForRole(role: HandRole, swapHands: boolean, inverted: boolean): string {
  const isPlayersLeftHand = (role === "harmony") !== swapHands;
  if (inverted) return isPlayersLeftHand ? "Right" : "Left";
  return isPlayersLeftHand ? "Left" : "Right";
}

function readStored(): boolean | null {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { v?: number; inverted?: unknown };
    if (parsed.v !== STORAGE_VERSION) return null;
    return typeof parsed.inverted === "boolean" ? parsed.inverted : null;
  } catch {
    // Private browsing, disabled storage, or a corrupt blob. The prior stands.
    return null;
  }
}

function writeStored(inverted: boolean): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify({ v: STORAGE_VERSION, inverted }));
  } catch {
    // Not worth surfacing: the app re-measures within a second of two hands.
  }
}

function clearStored(): void {
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to do */
  }
}

/**
 * Learns whether MediaPipe's handedness labels run with or against the
 * player's anatomy on this setup, from live two-hand frames.
 *
 * Cheap enough for the per-frame path: two comparisons and an integer add.
 */
export class HandednessCalibrator {
  /** Current best answer. Read this, not the vote count. */
  inverted: boolean;

  /** True once enough evidence arrived to overrule the documented prior. */
  measured = false;

  /** Signed evidence. Positive supports inverted, negative supports direct. */
  private score = 0;

  constructor(opts: { persist?: boolean } = {}) {
    this.persist = opts.persist ?? true;
    const stored = this.persist ? readStored() : null;
    if (stored === null) {
      this.inverted = ASSUMED_INVERTED;
    } else {
      this.inverted = stored;
      this.measured = true;
      this.score = stored ? COMMIT_VOTES : -COMMIT_VOTES;
    }
  }

  private readonly persist: boolean;

  /** 0 while running on the prior, 1 once the reading is firmly held. */
  get confidence(): number {
    return Math.min(Math.abs(this.score) / COMMIT_VOTES, 1);
  }

  /** For diagnostics only. */
  get votes(): number {
    return this.score;
  }

  /**
   * Feed one frame in which MediaPipe reported two hands.
   *
   * `xA` and `xB` are wrist x coordinates in raw camera space, normalized to
   * 0..1 with 0 at the left edge of the unmirrored image.
   */
  observe(labelA: string, xA: number, labelB: string, xB: number): void {
    // Two hands given the same label carry no ordering information, and
    // MediaPipe does emit that occasionally when one hand is edge-on.
    if (labelA === labelB) return;
    if (!Number.isFinite(xA) || !Number.isFinite(xB)) return;
    if (Math.abs(xA - xB) < MIN_SEPARATION) return;

    // In an unmirrored frame the player's left hand is the one further right.
    const labelOnPlayersLeft = xA > xB ? labelA : labelB;
    const vote = labelOnPlayersLeft === "Right" ? 1 : -1;

    this.score = Math.max(-MAX_VOTES, Math.min(MAX_VOTES, this.score + vote));

    if (this.score >= COMMIT_VOTES) this.commit(true);
    else if (this.score <= -COMMIT_VOTES) this.commit(false);
  }

  private commit(inverted: boolean): void {
    if (this.measured && this.inverted === inverted) return;
    this.inverted = inverted;
    this.measured = true;
    if (this.persist) writeStored(inverted);
  }

  /** Throw away everything learned and fall back to the documented prior. */
  reset(): void {
    this.score = 0;
    this.measured = false;
    this.inverted = ASSUMED_INVERTED;
    if (this.persist) clearStored();
  }

  roleFor(label: string, swapHands: boolean): HandRole {
    return roleForLabel(label, swapHands, this.inverted);
  }

  labelFor(role: HandRole, swapHands: boolean): string {
    return labelForRole(role, swapHands, this.inverted);
  }
}
