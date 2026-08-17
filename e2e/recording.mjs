/** Recording, and the transport-driven extras (arpeggiator, bass, metronome). */
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

// Hold a chord so there is something to record.
const playThree = () =>
  page.evaluate(async () => {
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
          landmarks: makeHand(fingers("index", "middle"), { wrist: { x: 0.7, y: 0.5 } }),
        },
      ],
    }));
    window.__meend.conductor.playClip({ version: 1, fps: 30, durationMs: 1320, frames });
  });

await playThree();
await sleep(800);

// ------------------------------------------------- transport extras
await page.evaluate(() => {
  const s = window.__meend.store.getState();
  s.patch({ arp: "normal", autoBass: true, metronomeOn: true, bpm: 120, timeSignature: "6/8" });
});
await sleep(2500);
report("arpeggiator, bass and metronome run together without errors", errors.length === 0,
  errors.slice(0, 3).join(" | "));

const transportState = await page.evaluate(() => window.__meend.conductor.audio.isStarted);
report("audio engine still alive after enabling the transport", transportState === true);

// Bar limit should stop the metronome on its own.
await page.evaluate(() => {
  window.__meend.store.getState().patch({ barLimit: 1, bpm: 240 });
});
await sleep(3000);
const metronomeOff = await page.evaluate(
  () => window.__meend.store.getState().metronomeOn === false,
);
report("metronome stops itself at the bar limit", metronomeOff);

await page.evaluate(() => {
  window.__meend.store.getState().patch({ arp: "off", autoBass: false, metronomeOn: false });
});
await sleep(500);

// ------------------------------------------------- recording
const mimeSupport = await page.evaluate(() => ({
  mp4: MediaRecorder.isTypeSupported("video/mp4;codecs=avc1,mp4a.40.2"),
  vp9: MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus"),
  webm: MediaRecorder.isTypeSupported("video/webm"),
}));
console.log(`      MediaRecorder support: ${JSON.stringify(mimeSupport)}`);

await click("Record");
await sleep(500);
const panelOpen = await page.evaluate(
  () => !!document.querySelector('[role="dialog"][aria-label="Recording"]'),
);
report("recording panel opens", panelOpen);

await playThree();
const began = await click("Record up to 30s");
report("recording starts from the panel", began);

// 3s countdown, then capture for ~3s.
await sleep(3500);
const isRecording = await page.evaluate(() =>
  [...document.querySelectorAll("*")].some((el) => el.textContent?.trim() === "Recording"),
);
report("countdown finishes and capture begins", isRecording);

await playThree();
await sleep(3000);
await click("Stop");
await sleep(1500);

const preview = await page.evaluate(() => {
  const v = document.querySelector('[role="dialog"][aria-label="Recording"] video');
  const a = document.querySelector('[role="dialog"][aria-label="Recording"] a[download]');
  return { hasVideo: !!v, src: v?.getAttribute("src")?.slice(0, 5), download: a?.getAttribute("download") };
});
report(
  "preview and download appear after stopping",
  preview.hasVideo && preview.src === "blob:" && !!preview.download,
  JSON.stringify(preview),
);

const blobSize = await page.evaluate(async () => {
  const v = document.querySelector('[role="dialog"][aria-label="Recording"] video');
  if (!v) return 0;
  const res = await fetch(v.src);
  return (await res.blob()).size;
});
report("recorded file has real content", blobSize > 10000, `${blobSize} bytes`);

report("no console errors across recording", errors.length === 0, errors.slice(0, 4).join(" | "));

await browser.close();
