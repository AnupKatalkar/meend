import { create } from "zustand";
import { persist } from "zustand/middleware";
import { SETTINGS_KEY, migrateLegacyKey } from "./storageKeys.ts";
import type { ChordInstrumentId } from "../audio/instruments.ts";
import type { ChordStyleId } from "../music/chords.ts";
import type { CameraQuality } from "../vision/HandTracker.ts";
import type { PitchClass, ScaleName } from "../music/theory.ts";
import { NOTE_NAMES } from "../music/theory.ts";
import { DEFAULT_THRESHOLDS, type FingerThresholds } from "../vision/fingers.ts";
import { DEFAULT_DEBOUNCE, DEFAULT_ONE_EURO } from "../vision/smoothing.ts";
import type { DebounceConfig, OneEuroConfig } from "../vision/smoothing.ts";

export type PlayMode = "gesture" | "theremin" | "monoPiano" | "raga" | "keyboard";
export type HarmonySubmode = "scaleOnly" | "scaleTilt";
export type ExpressionSubmode = "fixedStyle" | "fingerLayout";
export type ArpRate = "off" | "slow" | "normal" | "fast";
export type TimeSignature = "4/4" | "3/4" | "6/8";
export type ClickSound = "click" | "woodblock" | "beep" | "tabla";
export type AspectRatio = "9:16" | "16:9" | "1:1";
export type CaptureType = "audio" | "video" | "skeleton";
export type AppStatus = "idle" | "loading" | "ready" | "error";

export interface CameraError {
  /** The DOMException name, kept for diagnostics. */
  code: string;
  /** A sentence a non-technical player can act on. */
  message: string;
  /** Whether keyboard mode is worth offering as the way out. */
  offerKeyboard: boolean;
}

export interface Settings {
  key: PitchClass;
  scale: ScaleName;
  playMode: PlayMode;
  harmonySubmode: HarmonySubmode;
  expressionSubmode: ExpressionSubmode;
  chordStyle: ChordStyleId;
  /** What the four keyboard style-slot keys (8 9 0 -) select. Rebindable so
   *  all eight styles stay reachable from four keys. */
  keyboardSlots: ChordStyleId[];

  masterVolume: number; // 0..1
  /** Timbre chords play on. The sampled piano downloads on first use. */
  chordInstrument: ChordInstrumentId;
  /** 0 = crisp and separate, 1 = fused into a pad. */
  chordBlend: number;
  arp: ArpRate;
  autoBass: boolean;
  bassVolume: number; // 0..1

  metronomeOn: boolean;
  bpm: number;
  timeSignature: TimeSignature;
  /** 0 = run forever. */
  barLimit: number;
  clickSound: ClickSound;
  metronomeVolume: number;
  /** Empty string = Western time signature; otherwise a tala id. */
  tala: string;

  /** Raga mode. `key` doubles as the pitch of Sa. */
  raga: string;
  tanpuraOn: boolean;
  tanpuraVolume: number;
  /** Glide between swaras, in milliseconds. 0 is a fretted jump. */
  meendMs: number;

  /** Capture resolution. Detection always runs at 640 wide regardless. */
  cameraQuality: CameraQuality;
  /** Preview is mirrored by default; playing into an unmirrored image feels
   *  wrong. See HandTracker for how this interacts with handedness. */
  mirror: boolean;
  /** For left-handed players, and for when handedness detection flips. */
  swapHands: boolean;
  showSkeleton: boolean;
  thereminSnap: boolean;

  aspectRatio: AspectRatio;
  captureType: CaptureType;
  micMix: boolean;

  /** Hidden dev panel: tuning constants, replay mode, fps overlay. */
  devPanel: boolean;
  thresholds: FingerThresholds;
  debounce: DebounceConfig;
  oneEuro: OneEuroConfig;

  onboardingSeen: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  key: NOTE_NAMES.indexOf("A"),
  scale: "major",
  playMode: "gesture",
  harmonySubmode: "scaleOnly",
  expressionSubmode: "fixedStyle",
  chordStyle: "diatonic",
  keyboardSlots: ["diatonic", "minor", "maj7", "dom7"],

  masterVolume: 0.8,
  chordInstrument: "synth",
  chordBlend: 0.35,
  arp: "off",
  autoBass: false,
  bassVolume: 0.6,

  metronomeOn: false,
  bpm: 100,
  timeSignature: "4/4",
  barLimit: 0,
  clickSound: "click",
  metronomeVolume: 0.5,
  tala: "",

  raga: "yaman",
  tanpuraOn: true,
  tanpuraVolume: 0.5,
  meendMs: 80,

  cameraQuality: "720p",
  mirror: true,
  swapHands: false,
  showSkeleton: true,
  thereminSnap: false,

  aspectRatio: "9:16",
  captureType: "skeleton",
  micMix: false,

  devPanel: false,
  thresholds: DEFAULT_THRESHOLDS,
  debounce: DEFAULT_DEBOUNCE,
  oneEuro: DEFAULT_ONE_EURO,

  onboardingSeen: false,
};

/**
 * Live readouts that React is allowed to own.
 *
 * Everything here changes rarely -- a chord change, a hand appearing -- so
 * putting it through setState is fine. Per-frame values (fps, level, raw
 * landmarks) deliberately live in state/telemetry.ts instead, outside React.
 */
interface LiveState {
  status: AppStatus;
  loadProgress: number; // 0..1
  loadLabel: string;
  audioStarted: boolean;
  cameraError: CameraError | null;
  trackingDelegate: "GPU" | "CPU" | null;
  /** Set while the sampled piano is downloading. */
  instrumentLoading: boolean;
  /** Set when we fell back to CPU or the frame rate is poor. */
  performanceWarning: string | null;

  chordName: string;
  romanLabel: string;
  harmonyPresent: boolean;
  expressionPresent: boolean;

  settingsOpen: boolean;
  helpOpen: boolean;
  onboardingOpen: boolean;
}

interface Actions {
  set<K extends keyof Settings>(key: K, value: Settings[K]): void;
  patch(partial: Partial<Settings>): void;
  resetSettings(): void;
  setLive(partial: Partial<LiveState>): void;
}

export type Store = Settings & LiveState & Actions;

const INITIAL_LIVE: LiveState = {
  status: "idle",
  loadProgress: 0,
  loadLabel: "",
  audioStarted: false,
  cameraError: null,
  trackingDelegate: null,
  instrumentLoading: false,
  performanceWarning: null,

  chordName: "—",
  romanLabel: "",
  harmonyPresent: false,
  expressionPresent: false,

  settingsOpen: false,
  helpOpen: false,
  onboardingOpen: false,
};

// Runs before the store reads storage, so a player renamed from the old
// build keeps their settings.
migrateLegacyKey(SETTINGS_KEY);

export const useStore = create<Store>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      ...INITIAL_LIVE,

      set: (key, value) => set({ [key]: value } as Partial<Store>),
      patch: (partial) => set(partial as Partial<Store>),
      resetSettings: () => set({ ...DEFAULT_SETTINGS }),
      setLive: (partial) => set(partial as Partial<Store>),
    }),
    {
      name: SETTINGS_KEY,
      version: 1,
      // Only settings persist. Live readouts would restore stale and confusing.
      partialize: (s) => {
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>) {
          out[key] = s[key];
        }
        return out as unknown as Settings;
      },
      merge: (persisted, current) => {
        // Guard against a settings blob written by an older build: unknown
        // keys are dropped and missing ones fall back to the default, so a
        // stale localStorage entry can never leave the app unstartable.
        const safe: Partial<Settings> = {};
        const incoming = (persisted ?? {}) as Record<string, unknown>;
        for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>) {
          if (!(key in incoming)) continue;
          const value = incoming[key];
          const fallback = DEFAULT_SETTINGS[key];
          if (typeof value !== typeof fallback) continue;
          // Arrays must keep their shape too, or a truncated slot list would
          // leave keyboard keys silently dead.
          if (Array.isArray(fallback) && (!Array.isArray(value) || value.length !== fallback.length)) {
            continue;
          }
          safe[key] = value as never;
        }
        return { ...current, ...safe };
      },
    },
  ),
);

/** Non-reactive read, for the per-frame code that must not subscribe. */
export const readSettings = (): Settings => useStore.getState();
