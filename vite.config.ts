import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

/** The global response headers of vercel.json also apply to `vite preview`, so the smoke test sees the same CSP as production. */
const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { headers: { source: string; headers: { key: string; value: string }[] }[] };
const globalHeaders = Object.fromEntries((vercel.headers.find((h) => h.source === "/(.*)")?.headers ?? []).map((h) => [h.key, h.value]));

export default defineConfig({
  preview: { headers: globalHeaders },
  build: {
    rollupOptions: {
      output: {
        // three.js in its own hashed chunk: app changes do not invalidate its cache
        manualChunks(id) {
          if (id.includes("node_modules/three/")) return "three";
          return undefined;
        },
      },
    },
    chunkSizeWarningLimit: 700,
  },
});
