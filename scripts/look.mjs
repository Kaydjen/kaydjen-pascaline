// Visual self-check: renders fixed camera views of the model in headless Edge and prints a few numeric checks.
// Usage: npm run look [-- --out=dir] [--levels=6] [--only=name,name]
// Starts its own dev server (port 5198). Open the PNGs and compare them with docs/reference/photos/.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const out = flag("out") ?? join(tmpdir(), "look");
const levels = flag("levels") ?? "6";
const only = flag("only")?.split(",");
mkdirSync(out, { recursive: true });

const port = 5198;
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--port", String(port), "--strictPort"], { stdio: "ignore" });
const stop = () => server.kill();
process.on("exit", stop);
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(`http://localhost:${port}/`)).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 250));
}

// Three coordinates: (x, z + 30, -y) of spec coordinates. Level 0 (units) is at +x.
const SHOTS = [
  { name: "01-default", camera: null },
  { name: "02-photo-front", pos: [0, 175, 215], target: [0, 45, -5], fov: 30 },
  { name: "03-top", pos: [0, 330, 1], target: [0, 45, -10], fov: 30 },
  { name: "04-wheels", pos: [60, 120, 90], target: [60, 50, 15] },
  { name: "05-lever", pos: [100, 100, 75], target: [100, 75, 22] },
  { name: "06-windows", pos: [60, 130, 20], target: [60, 78, -40] },
  { name: "06b-windows-nostrip", pos: [60, 130, 20], target: [60, 78, -40], js: "__proto.setCover('bar', false)" },
  { name: "07-strip-descending", pos: [60, 130, 20], target: [60, 78, -40], js: "__proto.setVisibleRow('descending')" },
  { name: "08-nolid", pos: [0, 300, 190], target: [0, 20, -10], js: "__proto.setCover('lid', false)" },
  { name: "09-nolid-top", pos: [0, 340, 1], target: [0, 20, -10], js: "__proto.setCover('lid', false)" },
  { name: "11-frame", pos: [60, 40, 230], target: [0, 15, 0], js: "__proto.setCover('lid', false); __proto.setCover('wall:front', false)" },
  { name: "12-output", pos: [125, 85, 20], target: [100, 58, -30], js: "__proto.setCover('lid', false); __proto.setCover('wall:front', false)" },
  { name: "13-output-side", pos: [175, 70, -30], target: [100, 55, -30], js: "__proto.setCover('lid', false); __proto.setCover('wall:right', false)" },
  { name: "20-stylus", pos: [135, 120, -40], target: [105, 50, 5] },
  { name: "14-strip-end", pos: [-95, 90, 40], target: [-112, 48, -35] },
  { name: "10-drums", pos: [90, 150, -90], target: [100, 28, -39], js: "__proto.setCover('lid', false)" },
];

// teardown sequences: s = 0.2, 0.4, 0.7, 1 from the rig's own camera (follows s) and two fixed ones
for (const s of [0.2, 0.4, 0.7, 1]) {
  const tag = `15-teardown-${String(Math.round(s * 100)).padStart(3, "0")}`;
  SHOTS.push({ name: `${tag}-rig`, camera: null, js: `__proto.setTeardown(${s})`, wait: 2200 });
  SHOTS.push({ name: `${tag}-front`, pos: [0, 150, 620], target: [0, 105, 0], fov: 30, js: `__proto.setTeardown(${s})`, wait: 600 });
  SHOTS.push({ name: `${tag}-side`, pos: [560, 190, 120], target: [0, 105, 0], fov: 30, js: `__proto.setTeardown(${s})`, wait: 600 });
}

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`http://localhost:${port}/?levels=${levels}`, { waitUntil: "load" });
await page.waitForFunction(() => window.__look && window.__stage, null, { timeout: 20000 });
await page.waitForFunction(() => document.getElementById("scene").classList.contains("ready"));
await page.waitForTimeout(1900);
await page.evaluate(() => {
  const d = document.getElementById("debug");
  if (d) d.style.display = "none";
});

const report = await page.evaluate(() => window.__look());
for (const shot of SHOTS) {
  if (only && !only.includes(shot.name)) continue;
  await page.evaluate((s) => {
    window.__proto.setVisibleRow("ascending");
    window.__proto.setTeardown(0);
    window.__stage.rig?.setPreset("default", { instant: true });
    for (const c of ["lid", "label", "bar", "wall:front", "wall:back", "wall:left", "wall:right"]) window.__proto.setCover(c, true);
    if (s.js) eval(s.js);
    if (s.pos) {
      const st = window.__stage;
      st.camera.fov = s.fov ?? 35;
      st.camera.updateProjectionMatrix();
      st.controls.target.set(...s.target);
      st.camera.position.set(...s.pos);
      st.controls.update();
    }
  }, shot);
  await page.waitForTimeout(shot.wait ?? 500);
  await page.screenshot({ path: join(out, `${shot.name}.png`) });
}
// luminance and accent checks: decoded in the browser from the saved PNGs
const metricsPage = await browser.newPage();
const stats = {};
for (const shot of SHOTS) {
  if (only && !only.includes(shot.name)) continue;
  const data = readFileSync(join(out, `${shot.name}.png`)).toString("base64");
  stats[shot.name] = await metricsPage.evaluate(async (src) => {
    const img = new Image();
    img.src = `data:image/png;base64,${src}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const n = d.length / 4;
    const lum = new Float32Array(n);
    let lit = 0, litSum = 0, clipped = 0, accent = 0;
    for (let i = 0; i < n; i++) {
      const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
      const y = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      lum[i] = y;
      if (y > 0.1) { lit++; litSum += y; }
      if (y > 0.98) clipped++;
      if (Math.abs(r - 0x5f) + Math.abs(g - 0xb3) + Math.abs(b - 0xa1) < 60) accent++;
    }
    const sorted = Float32Array.from(lum).sort();
    return { litMean: litSum / Math.max(lit, 1), clipped: clipped / n, accent: accent / n, dark20: sorted[Math.floor(n * 0.2)] };
  }, data);
}
await browser.close();
stop();

const warn = [];
for (const [name, m] of Object.entries(stats)) {
  if (m.accent > 0.005) warn.push(`${name}: accent coverage ${(m.accent * 100).toFixed(2)}% (limit 0.5%)`);
  if (m.clipped > 0.01) warn.push(`${name}: clipped pixels ${(m.clipped * 100).toFixed(1)}% (limit 1%)`);
  if (m.dark20 < 0.018) warn.push(`${name}: darkest 20% at ${m.dark20.toFixed(3)} (below the background)`);
}
if (stats["01-default"]) {
  const m = stats["01-default"];
  console.log(`default shot: lit mean luminance ${m.litMean.toFixed(2)} (target 0.25-0.45), clipped ${(m.clipped * 100).toFixed(2)}%, dark20 ${m.dark20.toFixed(3)}, accent ${(m.accent * 100).toFixed(3)}%`);
  if (m.litMean < 0.25 || m.litMean > 0.45) warn.push(`01-default: lit mean luminance ${m.litMean.toFixed(2)} outside 0.25-0.45`);
}
if (warn.length) for (const w of ["look warnings:", ...warn.map((x) => "  " + x)]) console.log(w);
const worst = Math.min(...report.digitVisibility.map((d) => d.seen));
console.log(`screenshots: ${out}`);
console.log(`floor coverage ${(report.floorCoverage * 100).toFixed(0)}%, largest empty strip: y ${report.largestGapY} mm, x ${report.largestGapX} mm`);
console.log(`digit visibility from the default camera: worst ${(worst * 100).toFixed(0)}%`);
for (const d of report.digitVisibility) if (d.seen < 0.9) console.log(`  level ${d.level} ${d.row}: ${(d.seen * 100).toFixed(0)}%${"  missed: " + d.missed.join("; ")}`);
if (errors.length) console.log("console errors:\n" + errors.join("\n"));
process.exit(errors.length ? 1 : 0);
