#!/usr/bin/env node
/**
 * Vendors third-party runtime assets into public/ so the app never touches a
 * CDN at runtime: the MediaPipe wasm bundle is copied out of node_modules, and
 * the hand landmark model plus the piano samples are downloaded once and
 * cached on disk.
 *
 * Runs on postinstall. Failures here are warnings, not errors -- a fresh clone
 * with no network still installs, it just cannot track hands until `npm run
 * vendor` succeeds.
 */
import { cp, mkdir, stat, writeFile, readdir } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WASM_SRC = path.join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const WASM_DEST = path.join(root, "public", "wasm");
const MODEL_DIR = path.join(root, "public", "models");
const MODEL_DEST = path.join(MODEL_DIR, "hand_landmarker.task");
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const exists = (p) => stat(p).then(() => true, () => false);

async function vendorWasm() {
  if (!(await exists(WASM_SRC))) {
    console.warn(`[vendor] wasm source missing at ${WASM_SRC} -- is @mediapipe/tasks-vision installed?`);
    return false;
  }
  await mkdir(WASM_DEST, { recursive: true });
  await cp(WASM_SRC, WASM_DEST, { recursive: true });
  const files = await readdir(WASM_DEST);
  console.log(`[vendor] wasm -> public/wasm (${files.length} files)`);
  return true;
}

async function vendorModel() {
  if (await exists(MODEL_DEST)) {
    const { size } = await stat(MODEL_DEST);
    if (size > 1_000_000) {
      console.log(`[vendor] model already present (${(size / 1e6).toFixed(1)} MB), skipping download`);
      return true;
    }
  }
  await mkdir(MODEL_DIR, { recursive: true });
  console.log(`[vendor] downloading hand_landmarker.task ...`);
  try {
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(MODEL_DEST));
    const { size } = await stat(MODEL_DEST);
    console.log(`[vendor] model -> public/models/hand_landmarker.task (${(size / 1e6).toFixed(1)} MB)`);
    return true;
  } catch (err) {
    console.warn(`[vendor] model download failed: ${err.message}`);
    console.warn(`[vendor] fetch it manually into public/models/hand_landmarker.task from:\n  ${MODEL_URL}`);
    return false;
  }
}

/**
 * Salamander Grand Piano, sampled every minor third across the playable range.
 *
 * A synthesized piano never quite convinces -- the attack transient and the
 * way partials decay at different rates are what the ear listens for. Samples
 * are the only honest way to answer "can it sound like an actual piano".
 *
 * Spaced a minor third apart so the Sampler never pitch-shifts a note by more
 * than a tone, which is where interpolation starts sounding synthetic.
 */
const PIANO_DIR = path.join(root, "public", "samples", "piano");
const PIANO_BASE = "https://tonejs.github.io/audio/salamander/";
const PIANO_NOTES = [
  "C1", "Ds1", "Fs1", "A1",
  "C2", "Ds2", "Fs2", "A2",
  "C3", "Ds3", "Fs3", "A3",
  "C4", "Ds4", "Fs4", "A4",
  "C5", "Ds5", "Fs5", "A5",
  "C6", "Ds6", "Fs6", "A6",
  "C7",
];

async function vendorPiano() {
  await mkdir(PIANO_DIR, { recursive: true });
  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const note of PIANO_NOTES) {
    const dest = path.join(PIANO_DIR, `${note}.mp3`);
    if (await exists(dest)) {
      const { size } = await stat(dest);
      if (size > 5000) {
        skipped++;
        continue;
      }
    }
    try {
      const res = await fetch(`${PIANO_BASE}${note}.mp3`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
      downloaded++;
    } catch (err) {
      failed++;
      console.warn(`[vendor] piano sample ${note} failed: ${err.message}`);
    }
  }

  // CC-BY requires attribution to travel with the files.
  await writeFile(
    path.join(PIANO_DIR, "LICENSE.txt"),
    [
      "Salamander Grand Piano",
      "Copyright Alexander Holm.",
      "Licensed under Creative Commons Attribution 3.0 (CC-BY 3.0):",
      "  https://creativecommons.org/licenses/by/3.0/",
      "",
      "Samples obtained via the Tone.js sample set at",
      `  ${PIANO_BASE}`,
      "",
      "Attribution is also shown in the app's help panel.",
      "",
    ].join("\n"),
  );

  console.log(
    `[vendor] piano -> public/samples/piano (${downloaded} downloaded, ${skipped} cached, ${failed} failed)`,
  );
  return failed === 0;
}

/**
 * The app shows a determinate progress bar while loading, which needs the byte
 * sizes up front. Emitting them at vendor time keeps the client from having to
 * rely on Content-Length headers the host may not send.
 */
async function writeManifest() {
  const entries = [];
  for (const rel of ["models/hand_landmarker.task"]) {
    const abs = path.join(root, "public", rel);
    if (await exists(abs)) entries.push({ path: `/${rel}`, bytes: (await stat(abs)).size });
  }
  const wasmBinary = path.join(WASM_DEST, "vision_wasm_internal.wasm");
  if (await exists(wasmBinary)) {
    entries.push({ path: "/wasm/vision_wasm_internal.wasm", bytes: (await stat(wasmBinary)).size });
  }
  await writeFile(
    path.join(root, "public", "asset-manifest.json"),
    JSON.stringify({ assets: entries }, null, 2) + "\n",
  );
  console.log(`[vendor] manifest -> public/asset-manifest.json (${entries.length} entries)`);
}

const ok = (await vendorWasm()) && (await vendorModel()) && (await vendorPiano());
await writeManifest().catch((e) => console.warn(`[vendor] manifest failed: ${e.message}`));
if (!ok) console.warn("[vendor] incomplete -- run `npm run vendor` once you have network access.");
