/**
 * The rename from Gesture Synth to Meend moved two localStorage keys.
 *
 * A returning player must keep their settings and their measured handedness,
 * and a first-time visitor must still get clean defaults. This runs once per
 * browser profile in real life, so it is exactly the kind of behaviour that
 * breaks silently — hence a test.
 *
 * Storage is seeded from a static asset on the same origin rather than from
 * the app itself: the app writes to storage continuously as it boots, so
 * seeding from a running page races it and the migration correctly declines
 * to overwrite what it finds.
 */
import puppeteer from "puppeteer-core";

const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = process.env.APP_URL ?? "http://localhost:5173";
const SEED_URL = `${URL}/asset-manifest.json`;
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
page.on("console", (m) => {
  if (m.type() !== "error") return;
  // Chrome asks every document for /favicon.ico. The static JSON page used to
  // seed storage carries no icon link, so it 404s — harness noise, not the app.
  if ((m.location()?.url ?? "").endsWith("/favicon.ico")) return;
  errors.push(m.text());
});
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

const LEGACY_SETTINGS = {
  state: {
    key: 3,
    scale: "minor",
    bpm: 137,
    chordInstrument: "piano",
    onboardingSeen: true,
  },
  version: 1,
};

// ---- a returning player keeps everything -------------------------------
await page.goto(SEED_URL, { waitUntil: "domcontentloaded" });
await page.evaluate((legacy) => {
  localStorage.clear();
  localStorage.setItem("gesture-synth.settings", JSON.stringify(legacy));
  localStorage.setItem("gesture-synth.handedness", JSON.stringify({ v: 1, inverted: false }));
}, LEGACY_SETTINGS);

await page.goto(URL, { waitUntil: "networkidle2", timeout: 60000 });
await sleep(1200);

const carried = await page.evaluate(() => {
  const s = window.__meend.store.getState();
  return {
    key: s.key,
    scale: s.scale,
    bpm: s.bpm,
    instrument: s.chordInstrument,
    onboardingSeen: s.onboardingSeen,
  };
});
report(
  "settings written under the old name are carried over",
  carried.key === 3 &&
    carried.scale === "minor" &&
    carried.bpm === 137 &&
    carried.instrument === "piano" &&
    carried.onboardingSeen === true,
  JSON.stringify(carried),
);

const handedness = await page.evaluate(() => localStorage.getItem("meend.handedness"));
report(
  "measured handedness is carried over, not re-learned",
  !!handedness && JSON.parse(handedness).inverted === false,
  String(handedness),
);

// Leaving the old keys in place means a rollback to the previous build still
// finds its data.
const legacyKept = await page.evaluate(() => !!localStorage.getItem("gesture-synth.settings"));
report("the old keys are left in place, so a rollback loses nothing", legacyKept);

// ---- the migration must not clobber a newer value ------------------------
await page.goto(SEED_URL, { waitUntil: "domcontentloaded" });
await page.evaluate((legacy) => {
  localStorage.clear();
  localStorage.setItem("gesture-synth.settings", JSON.stringify(legacy));
  // Something already under the new name: a player who has used this build.
  localStorage.setItem(
    "meend.settings",
    JSON.stringify({ state: { key: 7, bpm: 96 }, version: 1 }),
  );
}, LEGACY_SETTINGS);
await page.goto(URL, { waitUntil: "networkidle2" });
await sleep(1000);
const preferred = await page.evaluate(() => {
  const s = window.__meend.store.getState();
  return { key: s.key, bpm: s.bpm };
});
report(
  "an existing Meend setting wins over the legacy one",
  preferred.key === 7 && preferred.bpm === 96,
  JSON.stringify(preferred),
);

// ---- a first-time visitor gets defaults ---------------------------------
await page.goto(SEED_URL, { waitUntil: "domcontentloaded" });
await page.evaluate(() => localStorage.clear());
await page.goto(URL, { waitUntil: "networkidle2" });
await sleep(1000);
const fresh = await page.evaluate(() => {
  const s = window.__meend.store.getState();
  return { key: s.key, bpm: s.bpm, onboardingSeen: s.onboardingSeen };
});
report(
  "a first-time visitor still gets clean defaults",
  fresh.key === 9 && fresh.bpm === 100 && fresh.onboardingSeen === false,
  JSON.stringify(fresh),
);

report("no console errors during migration", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
