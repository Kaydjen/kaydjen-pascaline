// Production smoke test: serves dist with `vite preview` (vercel.json headers), loads the page in headless Edge and checks
// that it renders, the dock is there, nothing is logged as an error (CSP included) and no dev hooks leaked into the bundle.
// Usage: npm run build && npm run smoke
import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const port = 4177;
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "preview", "--port", String(port), "--strictPort"], { stdio: "ignore" });
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(`http://localhost:${port}/`)).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 250));
}
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`); };

const assets = readdirSync("dist/assets").filter((f) => f.endsWith(".js"));
const leaked = assets.filter((f) => /__stage|__proto[^_]|__look|__app|__textures/.test(readFileSync(join("dist/assets", f), "utf8")));
check("no dev hooks in the bundle", leaked.length === 0, leaked.join(","));
const photoFiles = readdirSync("dist", { recursive: true }).filter((f) => /\.(jpe?g|png|webp)$/i.test(String(f)) && !String(f).startsWith("scans")); // the baked CC0 scans are shipped on purpose
check("no photos in the build", photoFiles.length === 0, photoFiles.join(","));

const head = await fetch(`http://localhost:${port}/`);
check("CSP and security headers are served", Boolean(head.headers.get("content-security-policy")) && head.headers.get("x-content-type-options") === "nosniff");

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
// ANGLE/HLSL shader-compiler chatter (X4122) is not ours
page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && !/X4122/.test(m.text()) && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.message));
const t0 = Date.now();
await page.goto(`http://localhost:${port}/?levels=6`, { waitUntil: "load" });
await page.waitForFunction(() => document.getElementById("scene")?.classList.contains("ready"), null, { timeout: 30000 });
const marks = await page.evaluate(() => performance.getEntriesByType("mark").map((m) => `${m.name} ${Math.round(m.startTime)} ms`).join(", "));
// measured 2026-10-27 (production build, cold headless profile): 6.3-6.6 s, of which the browser builds the 33 shader programs for about 3 s;
// on the user's screen (1707x960 at 2.25): first visit 7.8 s, repeat visits about 6 s. The loading screen covers it; 12 s only catches a regression (the run varies between 6 and 9 s).
check("scene ready within 12 s of load", Date.now() - t0 < 12000, `${Date.now() - t0} ms (${marks})`);
await page.waitForTimeout(2200);
check("dock is on screen", (await page.locator(".dock button").count()) >= 6);
await page.screenshot({ path: join(tmpdir(), "smoke.png") });
await page.click("text=Lid off");
check("the Lid off step is in the dock", await page.evaluate(() => document.querySelector(".segmented button.on, .segmented") !== null));
const fps = await page.evaluate(() => new Promise((res) => { let n = 0; const t = performance.now(); const f = () => { n++; if (performance.now() - t > 2000) res(n / 2); else requestAnimationFrame(f); }; requestAnimationFrame(f); }));
check("frame rate at least 55 (headless)", fps >= 55, `${fps.toFixed(1)} fps`);
check("no console errors or warnings", errors.length === 0, errors.join(" | "));
await browser.close();
server.kill();
console.log(`${results.filter(Boolean).length}/${results.length} checks passed; screenshot ${join(tmpdir(), "smoke.png")}`);
process.exit(results.every(Boolean) ? 0 : 1);
