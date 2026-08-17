/**
 * Manual utility: captures the app's key states to PNGs for visual review.
 * Not part of `npm run test:e2e` -- there is nothing here to pass or fail.
 *
 *   npm run dev
 *   OUT=./shots node e2e/shots.mjs
 */
import puppeteer from "puppeteer-core";

const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = process.env.APP_URL ?? "http://localhost:5173";
const OUT = process.env.OUT ?? ".";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });
await page.goto(URL, { waitUntil: "networkidle2", timeout: 60000 });

const click = (label) =>
  page.evaluate((l) => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === l);
    b?.click();
    return !!b;
  }, label);

await page.screenshot({ path: `${OUT}/01-onboarding.png` });

await click("Skip");
await sleep(400);
await click("Start camera");
await sleep(1500);
await page.screenshot({ path: `${OUT}/02-loading.png` });

for (let i = 0; i < 90; i++) {
  if (!(await page.$('[role="progressbar"]'))) break;
  await sleep(1000);
}
await sleep(1200);
await page.screenshot({ path: `${OUT}/03-idle.png` });

// Play a chord through replay so the scope has something to draw.
await page.evaluate(async () => {
  const { makeHand, HARMONY_GESTURES, fingers } = await import(
    "/src/vision/fixtures/handShapes.ts"
  );
  const frames = Array.from({ length: 40 }, (_, i) => ({
    t: i * 33,
    hands: [
      { label: "Right", score: 0.99, landmarks: makeHand(HARMONY_GESTURES.three) },
      {
        label: "Left",
        score: 0.99,
        landmarks: makeHand(fingers("index", "middle", "ring"), { wrist: { x: 0.74, y: 0.42 } }),
      },
    ],
  }));
  window.__meend.conductor.playClip({ version: 1, fps: 30, durationMs: 1320, frames });
});
await sleep(1500);
await page.screenshot({ path: `${OUT}/04-playing.png` });
await sleep(400);
await page.screenshot({ path: `${OUT}/05-playing-b.png` });

// Settings open, to check the slide-over against the new layout.
await click("Settings");
await sleep(600);
await page.screenshot({ path: `${OUT}/06-settings.png` });

console.log("captured");
await browser.close();
