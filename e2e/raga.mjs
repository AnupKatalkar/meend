/**
 * Raga mode through the real pipeline: swaras, aroha/avaroha direction,
 * the tanpura drone and tala cycles.
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
await page.setViewport({ width: 1280, height: 900 });
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
await click("Start camera");
await sleep(1000);
for (let i = 0; i < 90; i++) {
  if (!(await page.$('[role="progressbar"]'))) break;
  await sleep(1000);
}
await sleep(500);

const setSettings = (patch) =>
  page.evaluate((p) => window.__meend.store.getState().patch(p), patch);

const playGesture = (name, { thumb = false } = {}) =>
  page.evaluate(
    async (gesture, useThumb) => {
      const { makeHand, HARMONY_GESTURES, fingers } = await import(
        "/src/vision/fixtures/handShapes.ts"
      );
      const expressionShape = useThumb
        ? fingers("thumb", "index", "middle")
        : fingers("index", "middle");
      const frames = Array.from({ length: 40 }, (_, i) => ({
        t: i * 33,
        hands: [
          { label: "Right", score: 0.99, landmarks: makeHand(HARMONY_GESTURES[gesture]) },
          {
            label: "Left",
            score: 0.99,
            landmarks: makeHand(expressionShape, { wrist: { x: 0.72, y: 0.5 } }),
          },
        ],
      }));
      window.__meend.conductor.playClip({ version: 1, fps: 30, durationMs: 1320, frames });
    },
    name,
    thumb,
  );

const readout = () =>
  page.$eval('[data-testid="chord-name"]', (el) => el.textContent.trim()).catch(() => "?");

await setSettings({ playMode: "raga", raga: "yaman", key: 0, tanpuraOn: true });
await sleep(800);

const mode = await page.evaluate(() => window.__meend.store.getState().playMode);
report("raga mode is selectable", mode === "raga");

// ------------------------------------------------- swaras of Yaman
// Yaman: Sa Re Ga Ma' Pa Dha Ni  (tivra Ma is its signature)
const EXPECTED = [
  ["one", "Sa"],
  ["two", "Re"],
  ["three", "Ga"],
  ["four", "Ma'"],
  ["five", "Pa"],
  ["horns", "Dha"],
  ["hornsThumb", "Ni"],
];
for (const [gesture, swara] of EXPECTED) {
  await playGesture(gesture);
  await sleep(700);
  const got = await readout();
  report(`${gesture} sounds ${swara}`, got === swara, got === swara ? "" : `got "${got}"`);
}

// Fist silences the melody.
await playGesture("fist");
await sleep(800);
report("closed fist silences the melody", (await readout()) === "muted", await readout());

// ------------------------------------------------- aroha vs avaroha
// Des takes five notes going up and seven coming down, so the same gesture is
// a different swara depending on the direction of travel.
await setSettings({ raga: "des" });
await sleep(600);

await playGesture("one");
await sleep(600);
await playGesture("three"); // moving up: aroha
await sleep(700);
const ascending = await readout();
report("Des ascending: position 3 is Ma", ascending === "Ma", `got "${ascending}"`);

await playGesture("five");
await sleep(600);
await playGesture("three"); // moving down: avaroha
await sleep(700);
const descending = await readout();
report("Des descending: the same gesture is Ga", descending === "Ga", `got "${descending}"`);

// ------------------------------------------------- octave
await playGesture("one", { thumb: true });
await sleep(800);
const lower = await readout();
report("thumb drops to the lower octave", lower.includes("lower"), `got "${lower}"`);

// ------------------------------------------------- melodic, not chordal
const chordSize = await page.evaluate(
  () => window.__meend.conductor.audio.chord.length,
);
report("raga mode never stacks a chord", chordSize === 0, `${chordSize} chord notes`);

// ------------------------------------------------- tanpura + tala
await setSettings({ metronomeOn: true, tala: "teental", clickSound: "tabla", bpm: 160 });
await playGesture("three");
await sleep(3000);

const strip = await page.evaluate(() => {
  const dots = document.querySelectorAll('[data-testid="tala-strip"] span[data-matra]');
  return dots.length;
});
report("the tala strip shows all 16 matras of Teental", strip === 16, `${strip} beats`);

const beating = await page.evaluate(() => window.__meend.telemetry.matra);
report("the tala cycle is running", beating >= 1 && beating <= 16, `matra ${beating}`);

// Marwa has no Pa, so the drone must retune rather than sound a note the raga
// excludes.
const companions = await page.evaluate(async () => {
  const { ragaById, tanpuraCompanion } = await import("/src/music/raga.ts");
  return {
    yaman: tanpuraCompanion(ragaById("yaman")),
    marwa: tanpuraCompanion(ragaById("marwa")),
  };
});
report(
  "the tanpura retunes for a raga without Pa",
  companions.yaman === 7 && companions.marwa !== 7,
  JSON.stringify(companions),
);

await setSettings({ metronomeOn: false, playMode: "gesture" });
await sleep(600);
const droneStopped = await page.evaluate(
  () => window.__meend.conductor.audio.isStarted === true,
);
report("leaving raga mode does not tear down the engine", droneStopped);

report("no console errors during raga playback", errors.length === 0, errors.slice(0, 4).join(" | "));

await browser.close();
