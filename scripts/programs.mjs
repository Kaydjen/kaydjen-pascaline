// Shader program count and cold-start time of the real app (dev server, fresh browser profile = cold shader cache).
// Usage: npm run programs [-- --plain] [--runs=2]   report, and the change against docs/golden/programs.json
//        npm run programs -- --update                write the numbers as the new baseline
// "wear" programs are the per-material wear shaders (one per distinct feature set); the rest are the stock three.js and the occlusion composer.
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const plain = args.includes("--plain");
const runs = Number(flag("runs") ?? 2);
const BASELINE = "docs/golden/programs.json";

const port = 5197;
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--port", String(port), "--strictPort"], { stdio: "ignore" });
process.on("exit", () => server.kill());
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(`http://localhost:${port}/`)).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 250));
}

const results = [];
for (let run = 0; run < runs; run++) {
  const browser = await chromium.launch({ channel: "msedge", headless: true }); // a new launch = a new temporary profile
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const t0 = Date.now();
  await page.goto(`http://localhost:${port}/?levels=6${plain ? "&plain" : ""}`, { waitUntil: "load" });
  await page.waitForFunction(() => document.getElementById("scene")?.classList.contains("ready"), null, { timeout: 120000 });
  const readyMs = Date.now() - t0;
  await page.waitForTimeout(3000); // the occlusion shaders are built at the first frames
  await page.waitForFunction(() => window.__tune || new URLSearchParams(location.search).has("plain"), null, { timeout: 30000 });
  const data = await page.evaluate(() => ({
    marks: performance.getEntriesByType("mark").map((m) => [m.name, Math.round(m.startTime)]),
    programs: window.__tune ? window.__tune.programs() : window.__stage.renderer.info.programs.map((p) => ({ name: p.name, key: p.cacheKey, used: p.usedTimes })),
  }));
  await browser.close();
  const wear = data.programs.filter((p) => p.key.includes("wear-"));
  results.push({ readyMs, marks: data.marks, total: data.programs.length, wear: wear.length, other: data.programs.length - wear.length, features: wear.map((p) => (p.key.match(/wear-\d+:([^\s]*)/)?.[1] ?? "").split(",").length) });
}
server.kill();

const med = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const summary = { mode: plain ? "plain" : "look", programs: results[0].total, wearPrograms: results[0].wear, otherPrograms: results[0].other, readyMs: med(results.map((r) => r.readyMs)), readyRuns: results.map((r) => r.readyMs) };
console.log(`${summary.mode}: ${summary.programs} programs (${summary.wearPrograms} wear, ${summary.otherPrograms} other), ready after ${summary.readyMs} ms (runs: ${summary.readyRuns.join(", ")})`);
console.log(`marks: ${results[0].marks.map(([n, t]) => `${n} ${t} ms`).join(", ")}`);
console.log(`wear programs by number of features: ${results[0].features.sort((a, b) => a - b).join(" ")}`);

const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : {};
if (args.includes("--update")) {
  baseline[summary.mode] = summary;
  writeFileSync(BASELINE, JSON.stringify(baseline, null, 2) + "\n");
  console.log(`baseline written to ${BASELINE}`);
} else if (baseline[summary.mode]) {
  const b = baseline[summary.mode];
  const d = (x, y) => `${x} (${x - y >= 0 ? "+" : ""}${x - y})`;
  console.log(`against the baseline: programs ${d(summary.programs, b.programs)}, wear ${d(summary.wearPrograms, b.wearPrograms)}, ready ${d(summary.readyMs, b.readyMs)} ms`);
} else console.log("no baseline yet (run with --update)");
