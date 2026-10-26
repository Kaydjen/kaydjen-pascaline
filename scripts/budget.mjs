// Render budget: draw calls, triangles, meshes, textures and an indicative FPS in headless Edge. Usage: npm run budget
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";

const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--port", "5197", "--strictPort"], { stdio: "ignore" });
for (let i = 0; i < 60; i++) { try { if ((await fetch("http://localhost:5197/")).ok) break; } catch {} await new Promise(r => setTimeout(r, 250)); }
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto("http://localhost:5197/?levels=6", { waitUntil: "load" });
await page.waitForFunction(() => window.__stage, null, { timeout: 20000 });
await page.waitForTimeout(1500);
const info = await page.evaluate(() => {
  const r = window.__stage.renderer ?? window.__stage.debug?.renderer;
  const i = r?.info;
  let meshes = 0, tris = 0, proxies = 0;
  window.__proto.content.object.traverse(o => { if (o.isMesh && o.userData.proxy) proxies++; else if (o.isMesh) { meshes++; const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; } });
  return { textures_ms: Math.round(window.__textures?.ms ?? 0), texture_mb: +(window.__textures?.megabytes ?? 0).toFixed(1), calls: i?.render.calls, triangles: i?.render.triangles, geometries: i?.memory.geometries, textures: i?.memory.textures, meshes, proxies, tris };
});
console.log(JSON.stringify(info));
const fps = await page.evaluate(() => new Promise(res => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 > 3000) res(n / 3); else requestAnimationFrame(f); }; requestAnimationFrame(f); }));
console.log("fps", fps);
await browser.close(); server.kill();
