// Interaction test in headless Edge with real mouse events: pick up the stylus, dial a digit, dial across a carry,
// the same while apart (gear 45), the click behaviours and no console errors.
// Usage: npm run interact   (starts its own dev server on port 5195; exits with 1 on a failed check)
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const out = join(tmpdir(), "interact");
mkdirSync(out, { recursive: true });
const port = 5195;
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--port", String(port), "--strictPort"], { stdio: "ignore" });
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(`http://localhost:${port}/`)).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 250));
}
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`http://localhost:${port}/?levels=6`, { waitUntil: "load" });
await page.waitForFunction(() => window.__app && window.__proto && window.__stage, null, { timeout: 30000 });
await page.waitForTimeout(2200);
await page.evaluate(() => {
  const d = document.getElementById("debug");
  if (d) d.style.display = "none";
});

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
};

/** Client pixels of a point given in machine (spec) coordinates. */
const project = (x, y, z) =>
  page.evaluate(([px, py, pz]) => {
    const THREE_Vector3 = window.__proto.assembly.machine.position.constructor;
    const v = window.__proto.assembly.machine.localToWorld(new THREE_Vector3(px, py, pz));
    v.project(window.__stage.camera);
    const rect = document.getElementById("scene").getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  }, [x, y, z]);
const mech = (fn) => page.evaluate(fn);
const digits = () => mech(() => window.__proto.mechanism.levels.map((_, i) => window.__proto.mechanism.digit(i)));
const settle = async (ms = 1400) => { await page.waitForTimeout(ms); };

const LID_TOP = 46.8;
const levelX = (i) => (2.5 - i) * 40;
const rad = (d) => (d * Math.PI) / 180;

/** Dials `digit` on `level` while assembled: insert at the gap that stands at numeral `digit`, drag clockwise to the stop. */
async function dialWheel(level, digit) {
  const u = await mech(() => window.__proto.mechanism.levels.map((l) => l.u));
  const cx = levelX(level);
  const cy = -14;
  const numeral = ((180 - digit * 36) % 360 + 360) % 360;
  const gap = Math.round(numeral / 36 - u[level]);
  const startAngle = (((gap + u[level]) * 36) % 360 + 360) % 360;
  const at = (angle, r = 11) => project(cx + r * Math.sin(rad(angle)), cy + r * Math.cos(rad(angle)), LID_TOP);
  const start = await at(startAngle);
  await page.mouse.move(start.x, start.y, { steps: 12 });
  await settle(900);
  await page.mouse.down();
  const total = digit * 36;
  for (let k = 1; k <= 24; k++) {
    const p = await at(startAngle + (total * k) / 24);
    await page.mouse.move(p.x, p.y);
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(600);
  await page.mouse.up();
  await settle(1800);
}

/** Dials `steps` on gear 45 of `level` while apart: insert in a gap on the top of the pin ring, drag clockwise. */
async function dialGear(level, steps) {
  const frameZ = await mech(() => window.__proto.assembly.frame.position.z);
  const cx = levelX(level);
  const cz = frameZ;
  const u = await mech(() => window.__proto.mechanism.levels.map((l) => l.u));
  const gap = Math.round(0 / 36 - 0.5 - u[level]);
  const startAngle = (((gap + 0.5 + u[level]) * 36) % 360 + 360) % 360;
  const at = (angle, r = 14) => project(cx + r * Math.sin(rad(angle)), 2, cz + r * Math.cos(rad(angle)));
  const start = await at(startAngle);
  await page.mouse.move(start.x, start.y, { steps: 12 });
  await settle(1000);
  await page.mouse.down();
  const total = steps * 36;
  for (let k = 1; k <= 30; k++) {
    const p = await at(startAngle + (total * k) / 30);
    await page.mouse.move(p.x, p.y);
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(500);
  await page.mouse.up();
  await settle(2200);
}

// 1. stylus pick-up
check("the stylus starts on its stand", (await page.evaluate(() => window.__app.stylus.state)) === "slot");
const standSpot = await page.evaluate(() => {
  const p = window.__proto.assembly.stylus.position;
  return { x: p.x, y: p.y - 22, z: p.z };
});
const standPoint = await project(standSpot.x, standSpot.y, standSpot.z);
await page.mouse.move(standPoint.x, standPoint.y, { steps: 8 });
await settle(400);
check("hovering the stand shows the grab cursor", (await page.evaluate(() => document.querySelector("canvas").style.cursor)) === "grab");
await page.mouse.click(standPoint.x, standPoint.y);
await settle(300);
check("a click on the stand takes the stylus", (await page.evaluate(() => window.__app.stylus.state)) === "hand");
await page.mouse.move(800, 400, { steps: 4 });
await settle(300);
check("no system cursor over the scene while the stylus is in the hand", (await page.evaluate(() => document.getElementById("scene").style.cursor)) === "none");
const dockButton = await page.evaluate(() => {
  const r = document.querySelector(".dock button").getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
await page.mouse.move(dockButton.x, dockButton.y - 40, { steps: 10 });
await settle(300);
check("the cursor is back 40 px above a dock button", (await page.evaluate(() => document.getElementById("scene").style.cursor)) === "default");
await page.mouse.move(800, 400, { steps: 6 });
check("six wheels by default", await page.evaluate(() => window.__proto.levelCount === 6));

// 2. dial 3 on the units wheel
await dialWheel(0, 3);
let d = await digits();
check("dial 3 on wheel 0 -> units shows 3", d[0] === 3, JSON.stringify(d));
await page.screenshot({ path: join(out, "01-dialled-3.png") });

// 3. across a carry: add 7 -> 10
await dialWheel(0, 7);
d = await digits();
check("dial 7 more on wheel 0 -> units 0, tens 1 (carry)", d[0] === 0 && d[1] === 1, JSON.stringify(d));

// 4. apart (s = 0.4 and 1): dial through gear 45
for (const s of [0.4, 1]) {
  await page.evaluate((v) => window.__proto.setTeardown(v), s);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: join(out, `02-apart-${s}.png`) });
  const before = await digits();
  await dialGear(0, 2);
  const after = await digits();
  const ok = (before[0] + 2) % 10 === after[0];
  check(`apart s=${s}: two steps on gear 45 of level 0 -> units ${before[0]} -> ${after[0]}`, ok, JSON.stringify(after));
  const slaved = await page.evaluate(() => {
    const m = window.__proto.mechanism;
    const w = window.__proto.assembly.root.getObjectByName("wheel:0");
    const d = (w.rotation.z + m.levels[0].u * ((36 * Math.PI) / 180)) % (2 * Math.PI);
    return Math.abs(d) < 1e-3 || Math.abs(Math.abs(d) - 2 * Math.PI) < 1e-3;
  });
  check(`apart s=${s}: the lid wheel follows the level angle`, slaved);
}
await page.evaluate(() => window.__proto.setTeardown(0));
await page.waitForTimeout(2500);

// 5. the view steps in the dock and the arrow keys
await page.click("text=Lid off");
await page.waitForTimeout(3500);
let s = await page.evaluate(() => window.__proto.teardown);
check("Lid off raises the lid (s -> 0.4)", Math.abs(s - 0.4) < 0.02, `s=${s.toFixed(2)}`);
await page.click("text=Apart");
await page.waitForTimeout(4000);
s = await page.evaluate(() => window.__proto.teardown);
check("Apart takes it fully apart", s > 0.98, `s=${s.toFixed(2)}`);
await page.click("text=Closed");
await page.waitForTimeout(4500);
s = await page.evaluate(() => window.__proto.teardown);
check("Closed puts it back together", s < 0.02, `s=${s.toFixed(2)}`);
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(2500);
s = await page.evaluate(() => window.__proto.teardown);
check("right arrow steps to Lid off", Math.abs(s - 0.4) < 0.02, `s=${s.toFixed(2)}`);
await page.keyboard.press("ArrowLeft");
await page.waitForTimeout(2500);
// add / subtract
await page.click("text=Subtract");
check("Subtract shows the descending row", await page.evaluate(() => window.__proto.visibleRow === "descending"));
await page.click("text=Add");
check("Add shows the ascending row", await page.evaluate(() => window.__proto.visibleRow === "ascending"));
// a left drag on the background orbits the camera
const camBefore = await page.evaluate(() => window.__stage.camera.position.toArray());
await page.mouse.move(200, 300);
await page.mouse.down();
await page.mouse.move(420, 280, { steps: 8 });
await page.mouse.up();
const camAfter = await page.evaluate(() => window.__stage.camera.position.toArray());
check("a left drag on the background orbits the camera", camBefore.some((v, i) => Math.abs(v - camAfter[i]) > 1));
await page.keyboard.press("3");
check("key 3 selects 0.05x", (await page.evaluate(() => window.__proto.clock.timeScale)) === 0.05);
await page.keyboard.press("1");

// 7. UI: the rest state shows only the dock; hints, chip, credits
await page.evaluate(() => window.__proto.reset());
await page.waitForTimeout(1500);
await page.mouse.move(800, 900);
await page.waitForTimeout(300);
const dockOnly = await page.evaluate(() => {
  const visible = [...document.body.children].filter((e) => !["SCRIPT", "CANVAS"].includes(e.tagName) && e.id !== "veil" && getComputedStyle(e).display !== "none" && !e.classList.contains("sr-only") && getComputedStyle(e).opacity !== "0" && e.getBoundingClientRect().width > 2);
  return visible.map((e) => e.className || e.id || e.tagName);
});
check("rest state shows only the dock and the hint line", dockOnly.every((c) => c === "dock" || c === "hint visible"), JSON.stringify(dockOnly));
await page.screenshot({ path: join(out, "03-rest.png") });
const label = await project(-20, 21.7, 48.2);
await page.mouse.move(label.x, label.y);
await page.waitForTimeout(900);
const chip = await page.evaluate(() => ({ text: document.querySelector(".chip").textContent, shown: document.querySelector(".chip").classList.contains("visible") }));
check("hovering the label shows the English chip", chip.shown && chip.text.length > 3, JSON.stringify(chip));
const live = await page.evaluate(() => document.querySelector("[aria-live]").textContent);
check("aria-live region reports the value", /^Value \d{6}$/.test(live), live);

// 8. demo and zero, assembled and apart, and cancelling
const waitIdle = (ms = 90000) => page.waitForFunction(() => window.__app.ghost.running === null, null, { timeout: ms });
await page.evaluate(() => window.__proto.reset([3, 7, 2, 9, 0, 5]));
await page.waitForTimeout(500);
await page.click("text=Demo");
await waitIdle();
await page.waitForTimeout(1500);
d = await digits();
check("demo (assembled) ends at 000000", d.every((x) => x === 0), JSON.stringify(d));
await page.evaluate(() => window.__proto.reset([3, 7, 2, 9, 0, 5]));
await page.click("text=Reset");
await waitIdle();
await page.waitForTimeout(1500);
d = await digits();
check("zero from 372905 ends at 000000", d.every((x) => x === 0), JSON.stringify(d));
await page.evaluate(() => window.__proto.setTeardown(0.4));
await page.waitForTimeout(3000);
await page.evaluate(() => window.__proto.reset([8, 4, 0, 1, 6, 2]));
await page.click("text=Reset");
await waitIdle();
await page.waitForTimeout(1500);
d = await digits();
check("zero while apart (s = 0.4, gear 45) ends at 000000", d.every((x) => x === 0), JSON.stringify(d));
await page.screenshot({ path: join(out, "04-zero-apart.png") });
await page.evaluate(() => window.__proto.setTeardown(0));
await page.waitForTimeout(2500);
await page.click("text=Demo");
await page.waitForTimeout(4000);
check("demo is running (the word turns accent)", await page.evaluate(() => document.querySelector(".dock button.accent")?.textContent === "Demo"));
await page.mouse.click(300, 600);
await page.waitForTimeout(400);
check("a click cancels the demo", await page.evaluate(() => window.__app.ghost.running === null));
await page.keyboard.press("Escape");
await page.waitForTimeout(2000);

check("no console errors", errors.length === 0, errors.join(" | "));
await browser.close();
server.kill();
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} checks passed; screenshots in ${out}`);
process.exit(failed.length ? 1 : 0);
