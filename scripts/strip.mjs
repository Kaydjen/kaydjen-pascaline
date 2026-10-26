// Frame strip of one carry: sim steps are advanced by hand and a screenshot is taken after each batch.
// Usage: npm run strip [-- --out=dir --frames=24 --steps=4 --level=1]   (digits: units 9, drive +1)
// Starts its own dev server (port 5196); inspect the PNGs by eye.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const out = flag("out") ?? join(tmpdir(), "strip");
const frames = Number(flag("frames") ?? 24);
const steps = Number(flag("steps") ?? 4);
const level = Number(flag("level") ?? 1);
mkdirSync(out, { recursive: true });

const port = 5196;
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--port", String(port), "--strictPort"], { stdio: "ignore" });
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(`http://localhost:${port}/`)).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 250));
}
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`http://localhost:${port}/?levels=3`, { waitUntil: "load" });
await page.waitForFunction(() => window.__proto && window.__stage, null, { timeout: 20000 });
await page.evaluate(([lvl]) => {
  const d = document.getElementById("debug");
  if (d) d.style.display = "none";
  const p = window.__proto;
  p.clock.timeScale = 0;
  p.assembly.lidAssembly.visible = false;
  p.setCover("wall:front", false);
  p.reset([9, 0, 0]);
  p.assembly.lidAssembly.visible = false;
  const x = (1 - lvl) * 40; // three levels: x of level i is (1 - i) * 40
  const st = window.__stage;
  st.camera.fov = 28;
  st.camera.updateProjectionMatrix();
  st.controls.target.set(x + 20, 32, -14);
  st.camera.position.set(x + 70, 120, 90);
  st.controls.update();
  const m = p.mechanism;
  m.setDrive(0, 9.2);
  for (let i = 0; i < 4000 && m.levels[0].u < 9.19; i++) p.advance(1);
}, [level]);
await page.evaluate(() => window.__proto.mechanism.setDrive(0, 10));
const log = [];
for (let f = 0; f < frames; f++) {
  const info = await page.evaluate((n) => {
    const p = window.__proto;
    p.advance(n);
    return { t: p.mechanism.time, u: p.mechanism.levels.map((l) => +l.u.toFixed(2)), carry: p.mechanism.carries.map((c) => `${c.phase}@${c.lift.toFixed(1)}`) };
  }, steps);
  if (info.u[0] >= 9.99 || info.u[0] < 5) await page.evaluate(() => window.__proto.mechanism.setDrive(0, null));
  await page.waitForTimeout(120);
  await page.screenshot({ path: join(out, `f${String(f).padStart(2, "0")}.png`) });
  log.push(`f${f} t=${info.t.toFixed(3)} u=${info.u} carries=${info.carry}`);
}
console.log(log.join("\n"));
console.log(`frames: ${out}`);
if (errors.length) console.log("errors:\n" + errors.join("\n"));
await browser.close();
server.kill();
process.exit(errors.length ? 1 : 0);
