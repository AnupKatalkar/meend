// `vitest/config` re-exports Vite's defineConfig with the `test` block typed.
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // getUserMedia needs a secure context; localhost counts, so plain http is
    // fine for dev. Set `--host` + a cert if you want to test from a phone.
    port: 5173,
  },
  build: {
    target: "es2022",
    rollupOptions: {
      output: {
        // Tone and MediaPipe are both large and independently cacheable, so
        // they get their own chunks rather than riding along with app code.
        manualChunks(id) {
          if (id.includes("node_modules/tone")) return "tone";
          if (id.includes("@mediapipe/tasks-vision")) return "vision";
          return undefined;
        },
      },
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
