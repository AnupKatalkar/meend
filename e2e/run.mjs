/**
 * Runs the browser suites against a throwaway dev server.
 *
 * Deliberately the dev server rather than a production preview: the suites
 * reach the app's live singletons through the `import.meta.env.DEV` handle in
 * App.tsx, which production builds strip out.
 *
 * Requires a Chrome or Edge binary. Override with CHROME_PATH.
 */
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const PORT = Number(process.env.E2E_PORT ?? 5199);
const APP_URL = `http://localhost:${PORT}`;
const SUITES = ["smoke.mjs", "gestures.mjs", "raga.mjs", "recording.mjs", "migration.mjs"];

const server = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
  stdio: ["ignore", "pipe", "pipe"],
  env: process.env,
});

const shutdown = () => {
  if (!server.killed) server.kill("SIGTERM");
};
process.on("exit", shutdown);
process.on("SIGINT", () => {
  shutdown();
  process.exit(130);
});

// Wait for the server to answer rather than guessing at a sleep duration.
let ready = false;
for (let i = 0; i < 60; i++) {
  try {
    const res = await fetch(APP_URL);
    if (res.ok) {
      ready = true;
      break;
    }
  } catch {
    // Not up yet.
  }
  await delay(500);
}
if (!ready) {
  console.error(`Dev server did not come up on ${APP_URL}`);
  shutdown();
  process.exit(1);
}

let failed = 0;
for (const suite of SUITES) {
  console.log(`\n── ${suite} ${"─".repeat(Math.max(0, 50 - suite.length))}`);
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, [new URL(suite, import.meta.url).pathname], {
      stdio: "inherit",
      env: { ...process.env, APP_URL },
    });
    child.on("exit", resolve);
  });
  if (code !== 0) failed++;
}

shutdown();
console.log(failed === 0 ? "\nAll browser suites passed." : `\n${failed} suite(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
