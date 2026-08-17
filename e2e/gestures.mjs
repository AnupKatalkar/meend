/**
 * Drives synthetic hands through the real gesture pipeline via replay mode.
 *
 * The fake camera device has no hands in it, so this feeds landmarks straight
 * into the tracker instead. Everything downstream is the real thing: role
 * mapping, finger classification, hysteresis, chord building, voice leading,
 * the audio engine and the HUD.
 */
import puppeteer from "puppeteer-core";

const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = process.env.APP_URL ?? "http://localhost:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const errors = [];
function report(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "shell",
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
    "--enable-unsafe-swiftshader",
    "--use-gl=swiftshader",
    "--no-sandbox",
    "--mute-audio",
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(URL, { waitUntil: "networkidle2", timeout: 60000 });

const click = (label) =>
  page.evaluate((l) => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === l);
    b?.click();
    return !!b;
  }, label);

await click("Skip");
await sleep(300);
// One real click starts the audio context; gesture mode is the default.
await click("Start camera");
await sleep(1000);

// Wait for the model, which replay still needs (the tracker owns the frames).
for (let i = 0; i < 90; i++) {
  const loading = await page.$('[role="progressbar"]');
  if (!loading) break;
  await sleep(1000);
}
await sleep(1000);

/**
 * Build a looping clip of one held gesture and play it.
 * The harmony hand is labelled "Right" because MediaPipe's labels run
 * inverted relative to anatomy when fed raw frames -- the prior the app
 * starts from, in vision/handedness.ts. Replayed clips deliberately do not
 * feed the handedness calibrator (only live camera frames do), so these
 * labels stay authoritative here no matter where the hands sit.
 */
const playGesture = async (gestureName, { expressionThumb = false, tilt = 0 } = {}) =>
  page.evaluate(
    async (name, thumb, rotation) => {
      const { makeHand, HARMONY_GESTURES, fingers } = await import(
        "/src/vision/fixtures/handShapes.ts"
      );
      const harmonyShape = HARMONY_GESTURES[name];
      const expressionShape = thumb
        ? fingers("thumb", "index", "middle")
        : fingers("index", "middle");

      const frames = [];
      for (let i = 0; i < 40; i++) {
        frames.push({
          t: i * 33,
          hands: [
            {
              label: "Right", // the player's left hand -> harmony
              score: 0.99,
              landmarks: makeHand(harmonyShape, { rotation }),
            },
            {
              label: "Left", // the player's right hand -> expression
              score: 0.99,
              landmarks: makeHand(expressionShape, { wrist: { x: 0.7, y: 0.55 } }),
            },
          ],
        });
      }
      window.__meend.conductor.playClip({ version: 1, fps: 30, durationMs: 40 * 33, frames });
    },
    gestureName,
    expressionThumb,
    tilt,
  );

const chordName = () =>
  page.$eval('[data-testid="chord-name"]', (el) => el.textContent.trim()).catch(() => "?");
const readTelemetry = () =>
  page.evaluate(() => {
    const t = window.__meend.telemetry;
    return { fps: t.fps, detectMs: t.detectMs, latencyMs: t.latencyMs, attacks: t.attacks,
             degree: t.degree, octaveShift: t.octaveShift, volume: t.volume, cutoffHz: t.cutoffHz };
  });

// ---------------------------------------------------------------- gestures
// Key of A major, diatonic default.
const EXPECTED = [
  ["one", "A", "I"],
  ["two", "Bm", "ii"],
  ["three", "C#m", "iii"],
  ["four", "D", "IV"],
  ["five", "E", "V"],
  ["horns", "F#m", "vi"],
  ["hornsThumb", "G#dim", "vii°"],
];

const got = [];
for (const [gesture, expected] of EXPECTED) {
  await playGesture(gesture);
  await sleep(700);
  const name = await chordName();
  got.push(`${gesture}=${name}`);
  report(`${gesture} resolves to ${expected}`, name === expected, name === expected ? "" : `got "${name}"`);
}

// Fist mutes.
await playGesture("fist");
await sleep(800);
const muted = await chordName();
report("closed fist mutes", muted === "muted", `got "${muted}"`);

// Hands leaving frame releases.
await page.evaluate(() => {
  window.__meend.conductor.playClip({
    version: 1,
    fps: 30,
    durationMs: 660,
    frames: Array.from({ length: 20 }, (_, i) => ({ t: i * 33, hands: [] })),
  });
});
await sleep(900);
report("no hands releases the chord", (await chordName()) === "—");

// ------------------------------------------------- retrigger policy
// Acceptance criterion: a steady 3-finger hand for several seconds must
// produce exactly one attack.
await playGesture("fist");
await sleep(500);
const before = (await readTelemetry()).attacks;
await playGesture("three");
await sleep(4000);
const after = (await readTelemetry()).attacks;
report(
  "a held gesture attacks once, not repeatedly",
  after - before === 1,
  `${after - before} attacks over 4 seconds`,
);

// ------------------------------------------------- latency budget
const t = await readTelemetry();
report(
  "gesture-to-sound latency is under 100ms",
  t.latencyMs > 0 && t.latencyMs < 100,
  `${t.latencyMs.toFixed(1)} ms`,
);
console.log(`      measured fps: ${t.fps.toFixed(1)}, detect ${t.detectMs.toFixed(2)} ms`);

// ------------------------------------------------- expression hand
await playGesture("three", { expressionThumb: true });
await sleep(900);
const withThumb = await readTelemetry();
report("thumb on the expression hand drops an octave", withThumb.octaveShift === -1,
  `octaveShift ${withThumb.octaveShift}`);

// ------------------------------------------------- key change mid-play
await page.evaluate(() => {
  window.__meend.store.getState().set("key", 0); // C
});
await sleep(900);
const inC = await chordName();
report("changing key mid-performance retunes without sticking", inC === "Em", `got "${inC}"`);

report("no console errors during gesture playback", errors.length === 0, errors.slice(0, 4).join(" | "));

await browser.close();
