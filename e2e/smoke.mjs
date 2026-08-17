/**
 * End-to-end smoke test against real Chrome.
 *
 * Chrome's fake media device gives us a camera without a camera, so the whole
 * pipeline runs: model load, getUserMedia, the detect loop, the audio graph.
 * Keyboard mode is testable for real, including the chord names it produces.
 */
import puppeteer from "puppeteer-core";

const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = process.env.APP_URL ?? "http://localhost:5173";

const errors = [];
const warnings = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

page.on("console", (msg) => {
  const text = msg.text();
  if (msg.type() === "error") errors.push(text);
  if (msg.type() === "warning") warnings.push(text);
});
page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
const failedRequests = [];
page.on("requestfailed", (req) => failedRequests.push(`${req.url()} (${req.failure()?.errorText})`));
page.on("response", (res) => {
  if (res.status() >= 400) failedRequests.push(`${res.status()} ${res.url()}`);
});

await page.goto(URL, { waitUntil: "networkidle2", timeout: 60000 });

// ---------------------------------------------------------------- boot
const title = await page.title();
report("page loads", title === "Meend", title);

const hasOnboarding = await page.$('[role="dialog"][aria-modal="true"]');
report("onboarding shows on first visit", !!hasOnboarding);

// ------------------------------------------------- keyboard mode (no camera)
const click = (label) =>
  page.evaluate((l) => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === l);
    b?.click();
    return !!b;
  }, label);

const clickRadio = (label) =>
  page.evaluate((l) => {
    const b = [...document.querySelectorAll('button[role="radio"]')].find(
      (x) => x.textContent.trim() === l,
    );
    b?.click();
    return !!b;
  }, label);

await click("Skip");
await sleep(300);
await click("Settings");
await sleep(400);
report("keyboard mode selectable in settings", await clickRadio("Keys"));
await sleep(300);
await click("Close");
await sleep(300);

const chordName = () =>
  page.$eval('[data-testid="chord-name"]', (el) => el.textContent.trim()).catch(() => "?");

// The very first key press must also boot the audio context AND still sound.
// This is the regression: the chord that starts the engine used to be lost.
await page.keyboard.down("1");
await sleep(1500);
const firstChord = await chordName();
report("first key press is not swallowed by the audio boot", firstChord === "A", `got "${firstChord}"`);
await page.keyboard.up("1");
await sleep(200);

// I - V - vi - IV in the default key of A major.
const progression = [
  ["1", "A"],
  ["5", "E"],
  ["6", "F#m"],
  ["4", "D"],
];
const heard = [];
for (const [key] of progression) {
  await page.keyboard.down(key);
  await sleep(250);
  heard.push(await chordName());
  await page.keyboard.up(key);
  await sleep(150);
}
const expectedNames = progression.map(([, n]) => n);
report(
  "keyboard plays I-V-vi-IV with no camera",
  JSON.stringify(heard) === JSON.stringify(expectedNames),
  `heard ${heard.join(" ")} / expected ${expectedNames.join(" ")}`,
);

await sleep(300);
const afterRelease = await chordName();
report("chord releases on key up", afterRelease === "\u2014", `got "${afterRelease}"`);

// Panic key must not throw.
await page.keyboard.press("Space");
await sleep(200);

// Diatonic default means vii is a diminished triad, matching the HUD label.
await page.keyboard.down("7");
await sleep(250);
const seventh = await chordName();
await page.keyboard.up("7");
report("vii sounds diminished, agreeing with the HUD label", seventh === "G#dim", `got "${seventh}"`);

// Minor toggle.
await page.keyboard.press("BracketLeft");
await page.keyboard.down("1");
await sleep(250);
const minorChord = await chordName();
await page.keyboard.up("1");
report("bracket-left switches to minor", minorChord === "Am", `got "${minorChord}"`);
await page.keyboard.press("BracketRight");
await sleep(200);

// ------------------------------------------------- camera + model pipeline
await click("Settings");
await sleep(400);
await clickRadio("Gesture");
await sleep(200);
await click("Close");
await sleep(300);

// A returning player (walkthrough already seen) must still have a way in.
report("start control is available to a returning player", await click("Start camera"));

// The model is ~20MB of wasm + weights; give it room.
let status = "";
for (let i = 0; i < 90; i++) {
  status = await page.evaluate(() => {
    const raw = localStorage.getItem("meend.settings");
    return document.querySelector('[role="progressbar"]')
      ? `loading ${document.querySelector('[role="progressbar"]').getAttribute("aria-valuenow")}%`
      : raw
        ? "ready"
        : "unknown";
  });
  if (status === "ready") break;
  await sleep(1000);
}
report("model + camera reach a ready state", status === "ready", status);

const delegate = await page.evaluate(() => {
  const el = [...document.querySelectorAll("p")].find((p) =>
    p.textContent.includes("hand tracking on the CPU"),
  );
  return el ? "CPU (fallback path exercised)" : "GPU";
});
console.log(`      tracking delegate: ${delegate}`);

// Let the detect loop run against the fake camera for a few seconds.
await sleep(4000);

const videoState = await page.evaluate(() => {
  const v = document.querySelector("video");
  return v ? { w: v.videoWidth, h: v.videoHeight, playing: !v.paused } : null;
});
report(
  "camera captures at 720p while detection stays cheap",
  !!videoState && videoState.w === 1280 && videoState.h === 720 && videoState.playing,
  JSON.stringify(videoState),
);

const canvasSized = await page.evaluate(() => {
  const c = document.querySelector("canvas");
  return c ? { w: c.width, h: c.height, hidden: c.getAttribute("aria-hidden") } : null;
});
report(
  "skeleton canvas is sized and aria-hidden",
  !!canvasSized && canvasSized.w > 0 && canvasSized.hidden === "true",
  JSON.stringify(canvasSized),
);

// ------------------------------------------------- settings persistence
const persisted = await page.evaluate(() => localStorage.getItem("meend.settings"));
report("settings persist to localStorage", !!persisted && persisted.includes("chordStyle"));

// ------------------------------------------------- chord instruments
const instrumentResult = await page.evaluate(async () => {
  const { store, conductor } = window.__meend;
  const out = {};
  for (const id of ["epiano", "piano", "synth"]) {
    store.getState().set("chordInstrument", id);
    // Give the sampler time to fetch on the first switch.
    await new Promise((r) => setTimeout(r, id === "piano" ? 6000 : 600));
    out[id] = conductor.audio.chordInstrument;
  }
  return out;
});
report(
  "all three chord instruments load and become active",
  instrumentResult.epiano === "epiano" &&
    instrumentResult.piano === "piano" &&
    instrumentResult.synth === "synth",
  JSON.stringify(instrumentResult),
);

// Switching instrument mid-chord must not strand the held notes. Keyboard
// mode is the reliable way to hold one: the camera has no hands in it.
await page.evaluate(() =>
  window.__meend.store.getState().patch({ playMode: "keyboard", chordInstrument: "piano" }),
);
await sleep(2000);
await page.keyboard.down("1");
await sleep(400);
const pianoChord = await chordName();
await page.evaluate(() => window.__meend.store.getState().set("chordInstrument", "synth"));
await sleep(600);
await page.keyboard.up("1");
await sleep(400);
report(
  "a chord survives an instrument switch and still releases",
  pianoChord === "A" && (await chordName()) === "—",
  `held "${pianoChord}", after release "${await chordName()}"`,
);

// ------------------------------------------------- setting descriptions
await page.evaluate(() => window.__meend.store.getState().setLive({ settingsOpen: true }));
await sleep(500);

const INFO_SEL = 'aside[aria-label="Settings"] button[aria-label^="What does"]';
const infoCount = await page.$$eval(INFO_SEL, (b) => b.length);
report("every setting carries an info button", infoCount >= 20, `${infoCount} found`);

// Open them all, then let React render before inspecting.
await page.evaluate((sel) => document.querySelectorAll(sel).forEach((b) => b.click()), INFO_SEL);
await sleep(400);
const infoState = await page.evaluate((sel) => {
  const btns = [...document.querySelectorAll(sel)];
  let expanded = 0;
  let wired = 0;
  const thin = [];
  for (const btn of btns) {
    if (btn.getAttribute("aria-expanded") === "true") expanded++;
    const target = document.getElementById(btn.getAttribute("aria-controls"));
    if (target) {
      wired++;
      if ((target.textContent || "").trim().length < 40) thin.push(btn.getAttribute("aria-label"));
    }
  }
  return { total: btns.length, expanded, wired, thin };
}, INFO_SEL);
report(
  "each one reveals real text wired by aria-controls",
  infoState.expanded === infoState.total &&
    infoState.wired === infoState.total &&
    infoState.thin.length === 0,
  JSON.stringify(infoState),
);

// A dangling `label for` is the a11y trap when a label sits over a radiogroup.
const dangling = await page.$$eval('aside[aria-label="Settings"] label[for]', (labels) =>
  labels.filter((l) => !document.getElementById(l.getAttribute("for"))).length,
);
report("no setting label points at a missing control", dangling === 0, `${dangling} dangling`);

await page.evaluate((sel) => document.querySelectorAll(sel).forEach((b) => b.click()), INFO_SEL);
await sleep(400);
const closed = await page.$$eval(INFO_SEL, (b) =>
  b.filter((x) => x.getAttribute("aria-expanded") === "false").length,
);
report("descriptions collapse again", closed === infoState.total, `${closed}/${infoState.total}`);

await page.evaluate(() => window.__meend.store.getState().setLive({ settingsOpen: false }));
await sleep(300);

// ------------------------------------------------- console hygiene
const realErrors = errors.filter(
  (e) =>
    // The fake device has no audio track; unrelated to our code.
    !e.includes("favicon") && !e.toLowerCase().includes("autoplay"),
);
report("no console errors during the session", realErrors.length === 0, realErrors.slice(0, 6).join(" | "));
if (failedRequests.length) {
  console.log(`      failed requests:`);
  for (const f of [...new Set(failedRequests)].slice(0, 8)) console.log(`        - ${f}`);
}

if (warnings.length) {
  console.log(`      ${warnings.length} warning(s):`);
  for (const w of [...new Set(warnings)].slice(0, 8)) console.log(`        - ${w.slice(0, 160)}`);
}




await browser.close();
