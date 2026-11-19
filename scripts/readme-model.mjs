// Builds the interactive 3D block for README.md: the "Apart" pose as ASCII STL inside a ```stl fence, which github.com
// renders as a rotatable viewer. GitHub stops rendering markdown files over 512 KB, so the model must fit a few thousand
// facets, and the viewer draws everything in one colour: parts read only through clean shapes and gaps.
// Every part belongs to a group with its own facet budget (GROUPS below). Parametric geometry (cylinder, extrusion,
// lathe, ring...) is rebuilt in the page with few segments and fitted onto the original. Where that pipeline breaks
// (output gears, input star wheels, crown rings, the inner mechanism) clean stand-ins are built by hand from the app's own data and placed with
// the world transform of the mesh they replace. Free-form geometry is simplified with meshoptimizer. Every outline that
// was thinned is checked for self-intersections (retried with less thinning, then the part is dropped), and the written
// mesh is validated: no degenerate facets, consistent winding, outward normals. A failed check stops the script.
// Usage: node scripts/readme-model.mjs [--facets=4820] [--levels=6] [--out=file.md] [--stl=file.stl] [--report]
// Starts its own dev server (port 5197) and headless Edge.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { MeshoptSimplifier } from "meshoptimizer";
import { chromium } from "playwright-core";

// Facet budget per group, most important first. The detail of each group is bisected to fit its own budget.
// box: case walls, liner, ledges, rim, plinth; lid: lid plate; wheels: input star wheels;
// crowns: numbered rings on the lid; gears: output gears (10 true teeth); drums: digit drums, shafts, hubs; frame: plates, arcades,
// ears, support bars, partition; mechanism: hand-made inner mechanism of every column (pin wheels of the accumulator with their
// pins, shaft, carry lever, sautoir and pawl levers, lantern wheel under the lid with its pins and shafts), built feature by
// feature in order of importance, so that a smaller budget drops the last features of all columns alike;
// secondary (best effort, parts dropped smallest first when over): brackets, strip, drum flanges.
const GROUPS = { box: 170, lid: 230, wheels: 540, crowns: 390, gears: 700, drums: 420, frame: 560, mechanism: 1690, secondary: 120 };
const TOTAL = 4820; // the README may hold about 4840 facets of this kind (512,000 bytes)
const IMPORTANT = ["box", "lid", "wheels", "crowns", "gears", "drums", "frame", "mechanism"];
const GROUP_NAMES = Object.keys(GROUPS);
// Share of a group's budget that free-form parts (simplified with meshoptimizer) may take.
const FREE_SHARE = 0.15;

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const budgetSum = Object.values(GROUPS).reduce((a, b) => a + b, 0);
const scale = Number(flag("facets") ?? budgetSum) / budgetSum;
const budget = Object.fromEntries(GROUP_NAMES.map((g) => [g, Math.round(GROUPS[g] * scale)]));
const out = flag("out") ?? "readme-model.md";
const stlOut = flag("stl");
const report = args.includes("--report");
const levels = Number(flag("levels") ?? 6);

// Flat decals, shadows and labels add facets and nothing to the shape; the small levers, springs and stops of the carry
// and the stylus with its stand cost a third of the budget and are lost among the wheels at README size. The accumulators,
// carry levers and the lantern wheels are not taken from the app's meshes but rebuilt by hand in mechanism() below.
const DROP =
  /^(leverShadow|labelText|stripSigns|label|windowBevel|floor|carryBody|carryContact|sautoir|sautoirTip|pawl|pawlTip|stopLever|stopTip|stop|level|nut|foot|standCradle|standSaddle|standBlock|stylusBody|stylusKnob|stylusPoint|lidClip|wheelPlate|accumulator)(:.*)?$/;
// Parts smaller than this (bounding-sphere radius, mm) are invisible in the README viewer.
const MIN_RADIUS = 2.5;
// Pin wheels carry hundreds of pins, more than the whole budget: keep every n-th pin of these parts, none where n is 0
// (the plates of a pin wheel stay whole, so it still reads as a pin wheel).
const PIN_EVERY = { wheel: 3 };
// Coarser outlines for the lantern wheels under the lid, which matter less than the lid and the box.
const COARSE = { wheel: 1.25 };
const isPin = (g) => g.type === "CylinderGeometry" && Math.max(g.parameters.radiusTop, g.parameters.radiusBottom) < 1.3 && g.parameters.height > 2;

const port = 5197;
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--port", String(port), "--strictPort"], { stdio: "ignore" });
process.on("exit", () => server.kill());
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(`http://localhost:${port}/`)).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 250));
}

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
await page.goto(`http://localhost:${port}/?levels=${levels}&still&nomerge`, { waitUntil: "load" });
await page.waitForFunction(() => window.__proto && window.__stage, null, { timeout: 30000 });
await page.waitForTimeout(1000);

// One entry per visible mesh (instances expanded): world-space triangle soup, its group, and whether it was rebuilt.
// `details` (group -> 0..1] scales segment counts, point counts and outline tolerance; with `countOnly` only the facet
// totals per group come back.
const collect = (details, countOnly) =>
  page.evaluate(
  async ({ dropSource, minRadius, details, countOnly, pinEvery, isPinSource, coarseBy }) => {
    const isPin = eval(isPinSource);
    let coarse = 1;
    let detail = 1;
    const pinCount = new Map();
    const T = await import("/node_modules/three/build/three.module.js");
    const Meshing = await import("/src/parts/meshing.ts");
    const Case = await import("/src/parts/case.ts");
    const Wheel = await import("/src/parts/wheelGroup.ts");
    const Dim = await import("/src/parts/dimensions.ts");
    const Carry = await import("/src/parts/carry.ts");
    const drop = new RegExp(dropSource);
    window.__proto.setTeardown(1);
    await new Promise((r) => setTimeout(r, 300));
    const scene = window.__stage.scene;
    scene.updateMatrixWorld(true);

    const BAD = { bad: true }; // an outline that cannot be thinned without self-intersections: the part is dropped
    const usedOutlines = new Set();
    const outlineLog = (window.__outlineLog ??= new Map());

    const seg = (radius, max) => Math.max(3, Math.min(Math.round(max * detail), Math.round(3 + radius * detail)));

    // ---- outline helpers
    const area2 = (pts) => pts.reduce((a, p, i) => a + p.x * pts[(i + 1) % pts.length].y - pts[(i + 1) % pts.length].x * p.y, 0);
    const orient = (pts, counterClockwise) => (area2(pts) > 0 === counterClockwise ? pts : pts.slice().reverse());
    const cross = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    const onSegment = (p, q, r) =>
      Math.abs(cross(p, q, r)) <= 1e-9 && Math.min(p.x, q.x) - 1e-9 <= r.x && r.x <= Math.max(p.x, q.x) + 1e-9 && Math.min(p.y, q.y) - 1e-9 <= r.y && r.y <= Math.max(p.y, q.y) + 1e-9;
    function segmentsMeet(a, b, c, d) {
      const o1 = cross(a, b, c), o2 = cross(a, b, d), o3 = cross(c, d, a), o4 = cross(c, d, b);
      if (((o1 > 1e-9 && o2 < -1e-9) || (o1 < -1e-9 && o2 > 1e-9)) && ((o3 > 1e-9 && o4 < -1e-9) || (o3 < -1e-9 && o4 > 1e-9))) return true;
      return onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
    }
    const inside = (p, poly) => {
      let c = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i];
        const b = poly[j];
        if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
      }
      return c;
    };
    /** True when no outline crosses, touches or doubles back on itself or on another one of the set. */
    function loopsValid(loops) {
      const edges = [];
      for (let l = 0; l < loops.length; l++) {
        const pts = loops[l];
        if (pts.length < 3 || Math.abs(area2(pts)) < 1e-9) return false;
        for (let i = 0; i < pts.length; i++) edges.push({ l, i, a: pts[i], b: pts[(i + 1) % pts.length], n: pts.length });
      }
      for (let i = 0; i < edges.length; i++) {
        for (let j = i + 1; j < edges.length; j++) {
          const e = edges[i], f = edges[j];
          if (e.l === f.l && (f.i === e.i + 1 || (e.i === 0 && f.i === e.n - 1))) continue; // neighbours share an end point
          if (segmentsMeet(e.a, e.b, f.a, f.b)) return false;
        }
      }
      return true;
    }

    /** Closed outline with points closer than `tolerance` to the simplified line removed (Douglas-Peucker), at most ~24 points. */
    function thin(points, factor = 1) {
      const pts = points.slice();
      if (pts.length > 1 && pts[0].distanceTo(pts[pts.length - 1]) < 1e-6) pts.pop();
      if (pts.length <= 6) return pts;
      let size = 0;
      for (const a of pts) size = Math.max(size, Math.hypot(a.x - pts[0].x, a.y - pts[0].y));
      const tolerance = factor * coarse * Math.min(Math.max(0.35, size * 0.025) / detail, Math.min(Math.max(1.5, size * 0.1), 4));
      const keep = new Uint8Array(pts.length);
      const far = pts.reduce((best, q, i) => (q.distanceTo(pts[0]) > pts[best].distanceTo(pts[0]) ? i : best), 0);
      const dp = (i, j) => {
        let index = -1;
        let dist = tolerance;
        const a = pts[i];
        const b = pts[j % pts.length];
        const len = a.distanceTo(b) || 1e-9;
        for (let k = i + 1; k < j; k++) {
          const q = pts[k % pts.length];
          const d = Math.abs((b.x - a.x) * (a.y - q.y) - (a.x - q.x) * (b.y - a.y)) / len;
          if (d > dist) (dist = d), (index = k);
        }
        if (index < 0) return;
        keep[index % pts.length] = 1;
        dp(i, index);
        dp(index, j);
      };
      keep[0] = keep[far] = 1;
      dp(0, far);
      dp(far, pts.length);
      return pts.filter((_, i) => keep[i]);
    }
    /** Thins a set of outlines; retries with less thinning when they self-intersect. Null when no setting gives a valid set. */
    function thinLoops(loops, accept = (l) => l) {
      for (const factor of [1, 0.5, 0.25, 0.1]) {
        const res = accept(loops.map((l) => thin(l, factor)));
        if (res.length && loopsValid(res)) return { res, retried: factor < 1 };
      }
      return null;
    }
    function cachedThin(key, loops) {
      if (!outlineLog.has(key)) outlineLog.set(key, thinLoops(loops));
      usedOutlines.add(key);
      return outlineLog.get(key);
    }

    // ---- hand-made stand-ins: closed prisms from clean polygons
    const circle = (cx, cy, r, n, phase = 0) => Array.from({ length: n }, (_, i) => new T.Vector2(cx + r * Math.cos(phase + (2 * Math.PI * i) / n), cy + r * Math.sin(phase + (2 * Math.PI * i) / n)));
    /**
     * Prism over the outline `outer` (holes `holes`) from c0 to c1 along the third axis, right-handed in (a, b, c), as a
     * triangle soup with outward normals: caps triangulated with earcut, side walls as quads. `bottom: false` leaves the
     * lower cap out (a part that lies on another one), `holeWalls: false` the walls of the holes.
     */
    function prism(outerIn, holesIn, c0, c1, bottom, holeWalls = true) {
      const outer = orient(outerIn, true);
      const holes = holesIn.map((h) => orient(h, false));
      const all = [outer, ...holes];
      const flat = all.flat();
      const faces = T.ShapeUtils.triangulateShape(outer.map((p) => p.clone()), holes.map((h) => h.map((p) => p.clone())));
      const soup = [];
      const put = (...v) => v.forEach((p) => soup.push(...p));
      const V = (p, c) => [p.x, p.y, c];
      for (const [i, j, k] of faces) {
        const a = flat[i];
        let b = flat[j];
        let c = flat[k];
        if ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) < 0) [b, c] = [c, b];
        put(V(a, c1), V(b, c1), V(c, c1));
        if (bottom) put(V(a, c0), V(c, c0), V(b, c0));
      }
      for (const loop of holeWalls ? all : [outer]) {
        for (let i = 0; i < loop.length; i++) {
          const p = loop[i];
          const q = loop[(i + 1) % loop.length];
          put(V(p, c0), V(q, c0), V(q, c1), V(p, c0), V(q, c1), V(p, c1));
        }
      }
      return soup;
    }
    /** Soup -> geometry in the part's own frame; `map` takes (a, b, c) to the part's axes and may mirror (the winding follows). */
    function mapped(soup, map) {
      const g = new T.BufferGeometry();
      const v = new T.Vector3();
      const mirrored = map.determinant() < 0;
      const out = new Float32Array(soup.length);
      for (let t = 0; t < soup.length; t += 9) {
        const order = mirrored ? [0, 2, 1] : [0, 1, 2];
        order.forEach((o, k) => {
          v.set(soup[t + o * 3], soup[t + o * 3 + 1], soup[t + o * 3 + 2]).applyMatrix4(map);
          out.set([v.x, v.y, v.z], t + k * 3);
        });
      }
      g.setAttribute("position", new T.BufferAttribute(out, 3));
      return g;
    }
    const identity = new T.Matrix4();

    /** Greedy polyline reduction: keeps the two ends and adds the point farthest from the current line until `count` points (end excluded) are kept. */
    function pickPoints(pts, count) {
      const chosen = [0, pts.length - 1];
      while (chosen.length < count + 1) {
        let best = -1;
        let far = 1e-6;
        for (let s = 0; s < chosen.length - 1; s++) {
          const a = pts[chosen[s]];
          const b = pts[chosen[s + 1]];
          const len = Math.hypot(b.x - a.x, b.y - a.y) || 1e-9;
          for (let i = chosen[s] + 1; i < chosen[s + 1]; i++) {
            const d = Math.abs((b.x - a.x) * (a.y - pts[i].y) - (a.x - pts[i].x) * (b.y - a.y)) / len;
            if (d > far) (far = d), (best = i);
          }
        }
        if (best < 0) break;
        chosen.push(best);
        chosen.sort((x, y) => x - y);
      }
      return chosen;
    }

    const standIns = (window.__readmeStandIns ??= new Map());
    const cachedStandIn = (key, build) => {
      key += "/" + detail;
      if (!standIns.has(key)) standIns.set(key, build());
      return standIns.get(key);
    };

    /**
     * Output wheel 56: the app's own tooth profile (10 teeth, star-shaped about the axis), one tooth reduced to a few points
     * and repeated round the wheel, so that all teeth are alike; three lightening holes as in the original. Axis y, thickness
     * `accPinSpanY`, centred on y = 0, profile in the xz plane.
     */
    function gearStandIn() {
      return cachedStandIn("gear", () => {
        const profile = (window.__toothProfile ??= Meshing.outputToothProfile());
        const teeth = Dim.DIM.pinCount;
        const per = profile.radius.length / teeth;
        const mean = Array.from({ length: per + 1 }, (_, i) => {
          let s = 0;
          for (let k = 0; k < teeth; k++) s += profile.radius[(i + k * per) % profile.radius.length];
          return s / teeth;
        });
        const at = (i, k) => {
          const phi = ((i * profile.stepDeg) / 180) * Math.PI + (k * 2 * Math.PI) / teeth;
          return new T.Vector2(mean[i] * Math.sin(phi), mean[i] * Math.cos(phi));
        };
        const sector = Array.from({ length: per + 1 }, (_, i) => at(i, 0));
        const kept = pickPoints(sector, Math.max(3, Math.round(2.5 + 5.5 * detail))).slice(0, -1);
        const outer = [];
        for (let k = 0; k < teeth; k++) for (const i of kept) outer.push(at(i, k));
        const sides = 6;
        const holes = [0, 1, 2].map((k) => {
          const a = ((k * 120 + 60) * Math.PI) / 180;
          return circle(8.6 * Math.sin(a), 8.6 * Math.cos(a), 3.3, sides, a);
        });
        const half = Dim.DIM.accPinSpanY / 2;
        const map = new T.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1); // (a, b, c) -> (x = a, y = c, z = b)
        const withHoles = detail >= 0.55 && loopsValid([outer, ...holes]); // the holes cost a third of a plain gear
        if (!loopsValid([outer])) return BAD;
        return mapped(prism(outer, withHoles ? holes : [], -half, half, true), map);
      });
    }

    /**
     * Input star wheel: hub disc and ten flat paddle spokes (hub radius, tip radius and half widths from the wheel code),
     * as one outline, flat on top and open underneath (it lies on the lid). Axis z, centred on z = 0.
     */
    function starStandIn(original) {
      return cachedStandIn("star", () => {
        original.computeBoundingBox();
        const thick = original.boundingBox.max.z - original.boundingBox.min.z;
        const HUB = 8.0; // the hub disc of the wheel code (HUB_DISC_RADIUS - 0.1; not exported)
        const half = (r) => Wheel.SPOKE_BASE_HALF_WIDTH + (Wheel.SPOKE_TIP_HALF_WIDTH - Wheel.SPOKE_BASE_HALF_WIDTH) * Math.min(Math.max((r - Wheel.SPOKE_HUB_RADIUS) / (Wheel.SPOKE_TIP_RADIUS - Wheel.SPOKE_HUB_RADIUS), 0), 1);
        const valley = HUB + 0.4;
        const outline = [];
        const n = Dim.DIM.pinCount;
        for (let k = 0; k < n; k++) {
          const phi = ((k + 0.5) * 2 * Math.PI) / n;
          const u = [Math.sin(phi), Math.cos(phi)]; // along the spoke
          const p = [Math.cos(phi), -Math.sin(phi)]; // across, towards growing angle
          const spot = (r, side) => new T.Vector2(r * u[0] + side * half(r) * p[0], r * u[1] + side * half(r) * p[1]);
          // two tip corners and one valley point on the bisector to the next spoke
          const vphi = phi + Math.PI / n;
          outline.push(spot(Wheel.SPOKE_TIP_RADIUS, -1), spot(Wheel.SPOKE_TIP_RADIUS, 1), new T.Vector2(valley * Math.sin(vphi), valley * Math.cos(vphi)));
        }
        if (!loopsValid([outline])) return BAD;
        return mapped(prism(outline, [], -thick / 2, thick / 2, false), identity);
      });
    }

    /** Crown ring: a flat 16-sided ring from the lid up to the numeral plate, radii read off the original ring; top and outer wall only. */
    function crownStandIn(original) {
      return cachedStandIn("crown/" + original.uuid, () => {
        const p = original.attributes.position;
        let rIn = Infinity;
        let rOut = 0;
        let z0 = Infinity;
        for (let i = 0; i < p.count; i++) {
          const r = Math.hypot(p.getX(i), p.getY(i));
          rIn = Math.min(rIn, r);
          rOut = Math.max(rOut, r);
          z0 = Math.min(z0, p.getZ(i));
        }
        const n = 16;
        return mapped(prism(circle(0, 0, rOut, n), [circle(0, 0, rIn, n)], z0, Case.CROWN_EDGE, false, false), identity);
      });
    }

    /** The same parametric geometry with few segments, null for free-form geometry, BAD when its outline cannot be kept valid. */
    function lowDetail(g, group) {
      const p = g.parameters;
      if (!p) return null;
      const round = group === "drums" ? 18 : 14;
      switch (g.type) {
        case "CylinderGeometry":
          // pins: a three-sided prism
          if (isPin(g)) return new T.CylinderGeometry(p.radiusTop, p.radiusBottom, p.height, 3, 1, false);
          return new T.CylinderGeometry(p.radiusTop, p.radiusBottom, p.height, seg(Math.max(p.radiusTop, p.radiusBottom), round), 1, p.openEnded, p.thetaStart, p.thetaLength);
        case "RingGeometry":
          return new T.RingGeometry(p.innerRadius, p.outerRadius, seg(p.outerRadius, 16), 1, p.thetaStart, p.thetaLength);
        case "CircleGeometry":
          return new T.CircleGeometry(p.radius, seg(p.radius, 16), p.thetaStart, p.thetaLength);
        case "SphereGeometry":
          return new T.SphereGeometry(p.radius, 6, 4, p.phiStart, p.phiLength, p.thetaStart, p.thetaLength);
        case "TorusGeometry":
          return new T.TorusGeometry(p.radius, p.tube, 4, seg(p.radius, 16), p.arc);
        case "BoxGeometry":
          return new T.BoxGeometry(p.width, p.height, p.depth);
        case "RoundedBoxGeometry":
          return new T.BoxGeometry(p.width, p.height, p.depth);
        case "LatheGeometry": {
          const step = Math.max(1, Math.floor(p.points.length / 5));
          const pts = p.points.filter((_, i) => i % step === 0 || i === p.points.length - 1);
          const r = Math.max(...p.points.map((v) => v.x));
          return new T.LatheGeometry(pts, seg(r, round), p.phiStart, p.phiLength);
        }
        case "ExtrudeGeometry": {
          // outlines are often long polylines (tooth profiles, sampled curves): thin them out, holes too
          const list = Array.isArray(p.shapes) ? p.shapes : [p.shapes];
          const shapes = [];
          for (let s = 0; s < list.length; s++) {
            const { shape, holes } = list[s].extractPoints(6);
            const thinned = cachedThin(`${g.uuid}/${s}/${detail}/${coarse}`, [shape, ...holes]);
            if (!thinned) return BAD;
            const outline = new T.Shape(thinned.res[0]);
            outline.holes = thinned.res.slice(1).map((h) => new T.Path(h));
            shapes.push(outline);
          }
          return new T.ExtrudeGeometry(shapes, { ...p.options, curveSegments: 3, steps: 1, bevelEnabled: false });
        }
        default:
          return null;
      }
    }

    /** The same geometry rebuilt from its parameters at full detail (used only to find where the original was moved). */
    function reference(g) {
      const p = g.parameters;
      if (g.type === "RoundedBoxGeometry") return new T.BoxGeometry(p.width, p.height, p.depth);
      return new T[g.type](...Object.values(p));
    }
    // The code that built the scene may have rotated or moved a geometry after creating it; its parameters do not say
    // so. Rebuild it at full detail, try the axis-aligned rotations, move the result onto the original's box, and accept
    // the transform only if the rebuilt vertices lie on the original ones (checked on a coarse grid). The low-detail
    // geometry then gets the same transform. Fits are cached per geometry: the bisection calls this page many times.
    const fits = (window.__readmeFits ??= new Map());
    function placed(original, low) {
      if (!fits.has(original.uuid)) fits.set(original.uuid, fit(original, reference(original)));
      const m = fits.get(original.uuid);
      return m ? low.applyMatrix4(m) : null;
    }
    const ROTATIONS = [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [2, 0, 0], [0, 2, 0], [0, 0, 2]];
    function fit(original, low) {
      original.computeBoundingBox();
      const ob = original.boundingBox;
      const osize = ob.getSize(new T.Vector3());
      const ocenter = ob.getCenter(new T.Vector3());
      const scale = Math.max(osize.x, osize.y, osize.z);
      const cell = Math.max(scale / 12, 0.5);
      const grid = new Map();
      const op = original.attributes.position;
      for (let i = 0; i < op.count; i++) {
        const k = `${Math.floor(op.getX(i) / cell)},${Math.floor(op.getY(i) / cell)},${Math.floor(op.getZ(i) / cell)}`;
        (grid.get(k) ?? grid.set(k, []).get(k)).push(i);
      }
      const nearest = (x, y, z) => {
        let best = Infinity;
        const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
          for (const i of grid.get(`${cx + a},${cy + b},${cz + c}`) ?? []) best = Math.min(best, Math.hypot(op.getX(i) - x, op.getY(i) - y, op.getZ(i) - z));
        }
        return best;
      };
      let bestMatrix = null;
      let bestScore = Infinity;
      for (const [rx, ry, rz] of ROTATIONS) {
        const g = low.clone();
        const m = new T.Matrix4().makeRotationX((rx * Math.PI) / 2).premultiply(new T.Matrix4().makeRotationY((ry * Math.PI) / 2)).premultiply(new T.Matrix4().makeRotationZ((rz * Math.PI) / 2));
        g.applyMatrix4(m);
        g.computeBoundingBox();
        const size = g.boundingBox.getSize(new T.Vector3());
        if (Math.abs(size.x - osize.x) + Math.abs(size.y - osize.y) + Math.abs(size.z - osize.z) > scale * 0.15 + 0.3) continue;
        const c = g.boundingBox.getCenter(new T.Vector3());
        g.translate(ocenter.x - c.x, ocenter.y - c.y, ocenter.z - c.z);
        m.premultiply(new T.Matrix4().makeTranslation(ocenter.x - c.x, ocenter.y - c.y, ocenter.z - c.z));
        const gp = g.attributes.position;
        let sum = 0;
        for (let i = 0; i < gp.count; i++) sum += Math.min(nearest(gp.getX(i), gp.getY(i), gp.getZ(i)), cell * 2);
        const score = sum / gp.count;
        if (score < bestScore) (bestScore = score), (bestMatrix = m);
      }
      return bestScore < Math.max(scale * 0.02, 0.15) ? bestMatrix : null;
    }

    /**
     * A flat free-form part (plate, spoked ring) rebuilt as an extrusion of its silhouette: the triangles are
     * rasterised onto a grid in the plate's plane, the outlines of the filled cells are traced (filled side on the left, so
     * outer outlines run counter-clockwise and holes clockwise), thinned and extruded to the plate's thickness.
     * Returns null for parts that are not flat, BAD when the thinned outlines intersect. Cached per geometry and detail.
     */
    const flats = (window.__readmeFlats ??= new Map());
    function flatStandIn(g) {
      const key = g.uuid + "/" + detail + "/" + coarse;
      if (!flats.has(key)) flats.set(key, buildFlat(g, key));
      usedOutlines.add("flat/" + key);
      const found = flats.get(key);
      return found && found !== BAD ? found.clone() : found;
    }
    function buildFlat(g, key) {
      g.computeBoundingBox();
      const lo = g.boundingBox.min.toArray();
      const size = g.boundingBox.getSize(new T.Vector3()).toArray();
      const t = size.indexOf(Math.min(...size));
      const [u, v] = [0, 1, 2].filter((a) => a !== t);
      if (size[t] > 0.3 * Math.min(size[u], size[v])) return null;
      const cell = Math.max(0.2, Math.max(size[u], size[v]) / 200);
      const nu = Math.ceil(size[u] / cell) + 2;
      const nv = Math.ceil(size[v] / cell) + 2;
      const filled = new Uint8Array(nu * nv);
      const pos = g.attributes.position;
      const idx = g.index ? g.index.array : null;
      const n = idx ? idx.length : pos.count;
      const P = (i) => {
        const k = idx ? idx[i] : i;
        const c = [pos.getX(k), pos.getY(k), pos.getZ(k)];
        return [(c[u] - lo[u]) / cell + 1, (c[v] - lo[v]) / cell + 1];
      };
      for (let i = 0; i < n; i += 3) {
        const [a, b, c] = [P(i), P(i + 1), P(i + 2)];
        const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
        if (Math.abs(area) < 1e-9) continue;
        const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
        const x1 = Math.min(nu - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
        const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
        const y1 = Math.min(nv - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            const px = x + 0.5;
            const py = y + 0.5;
            const w0 = ((b[0] - px) * (c[1] - py) - (c[0] - px) * (b[1] - py)) / area;
            const w1 = ((c[0] - px) * (a[1] - py) - (a[0] - px) * (c[1] - py)) / area;
            if (w0 >= -1e-6 && w1 >= -1e-6 && w0 + w1 <= 1 + 1e-6) filled[y * nu + x] = 1;
          }
        }
      }
      const at = (x, y) => x >= 0 && y >= 0 && x < nu && y < nv && filled[y * nu + x] === 1;
      // boundary edges of filled cells, filled cell on the left; keyed by start corner
      const edges = new Map();
      const add = (x0, y0, x1, y1) => {
        const k = x0 + "," + y0;
        (edges.get(k) ?? edges.set(k, []).get(k)).push([x1, y1]);
      };
      for (let y = 0; y < nv; y++) {
        for (let x = 0; x < nu; x++) {
          if (!at(x, y)) continue;
          if (!at(x, y - 1)) add(x, y, x + 1, y);
          if (!at(x + 1, y)) add(x + 1, y, x + 1, y + 1);
          if (!at(x, y + 1)) add(x + 1, y + 1, x, y + 1);
          if (!at(x - 1, y)) add(x, y + 1, x, y);
        }
      }
      const loops = [];
      for (const [startKey, list] of edges) {
        while (list.length) {
          const loop = [startKey.split(",").map(Number)];
          let [px, py] = loop[0];
          let next = list.pop();
          let dir = [next[0] - px, next[1] - py];
          for (let guard = 0; guard < 1e6; guard++) {
            [px, py] = next;
            const k = px + "," + py;
            if (k === startKey && !(edges.get(k)?.length)) break;
            loop.push([px, py]);
            const out = edges.get(k);
            if (!out?.length) break;
            // at a corner shared by two outlines, turn left first so outlines do not cross
            let pick = 0;
            if (out.length > 1) {
              const left = [-dir[1], dir[0]];
              const j = out.findIndex(([qx, qy]) => qx - px === left[0] && qy - py === left[1]);
              if (j >= 0) pick = j;
            }
            next = out.splice(pick, 1)[0];
            dir = [next[0] - px, next[1] - py];
            if (next[0] + "," + next[1] === startKey && !(edges.get(startKey)?.length)) break;
          }
          if (loop.length >= 4) loops.push(loop.map(([x, y]) => new T.Vector2((x - 1) * cell, (y - 1) * cell)));
        }
      }
      const raw = loops.map((l) => l.concat([l[0]]));
      const kept = (list) => list.filter((pts) => pts.length >= 3 && Math.abs(area2(pts) / 2) >= cell * cell * 6);
      const thinned = thinLoops(raw, kept);
      outlineLog.set("flat/" + key, thinned);
      if (!thinned) return BAD;
      const outers = [];
      const holes = [];
      for (const pts of thinned.res) (area2(pts) > 0 ? outers : holes).push(pts);
      if (!outers.length) return null;
      const shapes = outers.map((o) => new T.Shape(o));
      for (const h of holes) {
        const owner = outers.map((o, i) => [Math.abs(area2(o)), i]).sort((a, b) => a[0] - b[0]).find(([, i]) => inside(h[0], outers[i]));
        if (owner) shapes[owner[1]].holes.push(new T.Path(h.slice().reverse()));
      }
      const out = new T.ExtrudeGeometry(shapes, { depth: size[t], bevelEnabled: false, curveSegments: 1, steps: 1 });
      // shape x, y, extrusion z -> part axes u, v, t
      const m = new T.Matrix4();
      const e = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      e[u * 3 + 0] = 1;
      e[v * 3 + 1] = 1;
      e[t * 3 + 2] = 1;
      m.set(e[0], e[1], e[2], lo[0], e[3], e[4], e[5], lo[1], e[6], e[7], e[8], lo[2], 0, 0, 0, 1);
      return out.applyMatrix4(m);
    }

    const BOX = new Set(["wall", "liner", "ledge", "rim", "plinth"]);
    const FRAME = new Set(["frameArcade", "framePlate", "frameEar", "supportBar", "frame", "partition"]);
    function groupOf(name, g) {
      const p = name.split(":")[0];
      if (BOX.has(p)) return "box";
      if (p === "lidPlate") return "lid";
      if (p === "starWheel") return "wheels";
      if (p === "crown") return "crowns";
      if (p === "wheel") return "mechanism";
      if (p === "output") return g.type === "ExtrudeGeometry" ? "gears" : "drums";
      if (p === "drum") return g.type === "CylinderGeometry" && g.parameters.height < 6 ? "secondary" : "drums";
      if (FRAME.has(p)) return "frame";
      return "secondary";
    }

    const result = [];
    const totals = Object.fromEntries(Object.keys(details).map((g) => [g, { low: 0, free: [] }]));
    const stats = { lowered: 0, kept: 0, small: 0, standIns: 0, dropped: [] };
    /** Counts a geometry (placed with each of the matrices) into its group, or adds its world-space triangles to the result. */
    function commit(name, group, type, g, matrices, low, standIn) {
      const pos = g.attributes.position;
      const idx = g.index ? g.index.array : null;
      const count = idx ? idx.length : pos.count;
      const tris = count / 3;
      if (countOnly) {
        for (const _ of matrices) low ? (totals[group].low += tris) : totals[group].free.push(tris);
        return;
      }
      const v = new T.Vector3();
      for (const m of matrices) {
        const soup = [];
        const mirrored = m.determinant() < 0;
        for (let i = 0; i < count; i += 3) {
          const corners = [];
          for (let j = 0; j < 3; j++) {
            v.fromBufferAttribute(pos, idx ? idx[i + j] : i + j).applyMatrix4(m);
            corners.push([Math.round(v.x * 100) / 100, Math.round(v.y * 100) / 100, Math.round(v.z * 100) / 100]);
          }
          if (mirrored) corners.push(corners.splice(1, 1)[0]);
          soup.push(...corners.flat());
        }
        result.push({ name, group, type, low, standIn, soup });
      }
    }

    /**
     * The inner mechanism of every column as closed hand-made solids, built in the local frame of the object they replace and
     * placed with its world matrix. Features are added in order of importance as the group's detail grows (thresholds below).
     * Pin wheels: a ten-sided disc (the plate) with the pins as small pyramids standing on it; levers: plain bars.
     */
    function mechanism() {
      const m = details.mechanism ?? 0;
      const on = (t) => m >= t - 1e-9;
      const R = Dim.DIM.pinCircleRadius;
      const STEP = 36;
      const rad = (deg) => (deg * Math.PI) / 180;
      const shown = (o) => {
        for (let p = o; p; p = p.parent) if (!p.visible) return false;
        return true;
      };
      const find = (name) => {
        const o = scene.getObjectByName(name);
        return o && shown(o) ? o : null;
      };
      const SEND = new T.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1); // (a, b, c) -> (x = a, y = c, z = b): outline in xz, extruded along y
      const ZEND = new T.Matrix4().set(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1); // (a, b, c) -> (x = c, y = b, z = a): outline in zy, extruded along x
      const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
      /** Triangles of a convex solid, wound outwards. */
      function convex(faces) {
        const all = faces.flat();
        const c = [0, 1, 2].map((a) => all.reduce((s, p) => s + p[a], 0) / all.length);
        const soup = [];
        for (const [a, b, d] of faces) {
          const u = sub(b, a);
          const w = sub(d, a);
          const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
          const out = n[0] * ((a[0] + b[0] + d[0]) / 3 - c[0]) + n[1] * ((a[1] + b[1] + d[1]) / 3 - c[1]) + n[2] * ((a[2] + b[2] + d[2]) / 3 - c[2]);
          soup.push(...(out >= 0 ? [...a, ...b, ...d] : [...a, ...d, ...b]));
        }
        return soup;
      }
      /** Pins standing on a plate: base inside the plate (height h0), tip at h1; a pyramid, or a prism with a smaller top when `full`. place(x, v, h) gives the part's point. */
      function pins(spots, h0, h1, r, full, place) {
        const soup = [];
        for (const [cx, cy, a] of spots) {
          const tri = (h, rr) => [0, 1, 2].map((j) => place(cx + rr * Math.sin(a + (j * 2 * Math.PI) / 3), cy + rr * Math.cos(a + (j * 2 * Math.PI) / 3), h));
          const base = tri(h0, r);
          if (!full) {
            const tip = place(cx, cy, h1);
            soup.push(...convex([base, [base[0], base[1], tip], [base[1], base[2], tip], [base[2], base[0], tip]]));
          } else {
            const top = tri(h1, r * 0.8);
            const sides = [];
            for (let j = 0; j < 3; j++) {
              const k = (j + 1) % 3;
              sides.push([base[j], base[k], top[k]], [base[j], top[k], top[j]]);
            }
            soup.push(...convex([base, top, ...sides]));
          }
        }
        return mapped(soup, identity);
      }
      const rect = (x0, x1, y0, y1) => [new T.Vector2(x0, y0), new T.Vector2(x1, y0), new T.Vector2(x1, y1), new T.Vector2(x0, y1)];
      const decagon = (r, phase) => circle(0, 0, r, 10, phase);
      const put = (name, g, matrix, standIn = true) => commit(name, "mechanism", "BufferGeometry", g, [matrix], true, standIn);

      for (let i = 0; i < 12; i++) {
        const acc = find(`accumulator:${i}`);
        if (acc) {
          const plateHalf = 0.6;
          const y = Dim.DIM.y;
          const wheelAt = (yc, withDisc, withPins) => {
            const plate = yc + Dim.DIM.accPinSpanY / 2;
            if (withDisc) put(`accDisc:${i}`, mapped(prism(decagon(15.7, Math.PI / 2), [], plate - plateHalf, plate + plateHalf, true), SEND), acc.matrixWorld);
            if (withPins) {
              const spots = Array.from({ length: Dim.DIM.pinCount }, (_, k) => [R * Math.sin(rad(k * STEP)), R * Math.cos(rad(k * STEP)), rad(k * STEP)]);
              put(`accPins:${i}`, pins(spots, plate, yc - Dim.DIM.accPinSpanY / 2, 1.3, on(0.9), (x, z, h) => [x, h, z]), acc.matrixWorld, false);
            }
          };
          if (on(0.05)) wheelAt(y.gear45, true, true);
          if (on(0.25)) wheelAt(y.gear48, true, true);
          if (on(0.65)) wheelAt(y.gear50, true, false);
          if (on(0.8)) wheelAt(y.gear50, false, true);
          if (on(0.35)) put(`accShaft:${i}`, mapped(prism(rect(-1.2, 1.2, -1.2, 1.2), [], -7, 33, true), SEND), acc.matrixWorld);
        }

        const body = find(`carryBody:${i}`);
        if (body && on(0.15)) {
          let length = 0;
          body.traverse((o) => {
            if (o.userData.kind !== "leg") return;
            o.geometry.computeBoundingBox();
            length = o.geometry.boundingBox.getSize(new T.Vector3()).z;
          });
          const hub = Dim.DIM.y.hub;
          const legY = Dim.DIM.y.leg;
          // hub and arm in one outline (x across, z along the arm), then the drop and the leg as one L (z along, y up)
          const arm = [[0, 23], [-3.4, 23], [-3.4, 4.5], [-6, 0], [-3, -5.2], [3, -5.2], [6, 0], [3, 5.2], [0, 5.2]].map(([x, z]) => new T.Vector2(x, z));
          put(`carryArm:${i}`, mapped(prism(arm, [], hub - 1.5, hub + 1.5, true), SEND), body.matrixWorld);
          const leg = [[20, legY - 2], [20 + length, legY - 2], [20 + length, legY + 2], [23, legY + 2], [23, hub + 1], [20, hub + 1]].map(([z, yy]) => new T.Vector2(z, yy));
          put(`carryLeg:${i}`, mapped(prism(leg, [], -3.4, 0, true), ZEND), body.matrixWorld);
        }
        if (on(0.45)) {
          const lever = (name, o, length) => {
            if (o) put(`${name}:${i}`, mapped(prism(rect(0, length, -1.1, 1.1), [], -1.5, 1.5, true), SEND), o.matrixWorld);
          };
          lever("sautoirLever", find(`sautoir:${i}`), Carry.SAUTOIR_LEVER_LENGTH);
          lever("pawlLever", find(`pawl:${i}`), Carry.PAWL_LEVER_LENGTH);
        }

        const lantern = find(`wheel:${i}`);
        if (lantern && on(0.12)) {
          // shaft and upper pin of the wheel group as one square bar, from the bearing to the star wheel
          const top = lantern.children.find((c) => c.name === "starWheel")?.position.z ?? 20;
          put(`lanternShaft:${i}`, mapped(prism(rect(-1.4, 1.4, -1.4, 1.4), [], Wheel.INPUT_SHAFT_BOTTOM, top, true), identity), lantern.matrixWorld);
        }
        if (lantern && on(0.55)) {
          put(`lanternPlate:${i}`, mapped(prism(decagon(15.7, 0), [], 0, 1.2, true), identity), lantern.matrixWorld);
          if (on(0.75)) {
            const spots = Array.from({ length: Dim.DIM.pinCount / 2 }, (_, k) => {
              const a = rad(2 * k * STEP + Dim.DIM.inputPinPhaseDeg);
              return [R * Math.sin(a), R * Math.cos(a), a];
            });
            put(`lanternPins:${i}`, pins(spots, 0.6, -Dim.DIM.inputPinSpanZ, 1.3, on(0.9), (x, yy, h) => [x, yy, h]), lantern.matrixWorld, false);
          }
        }
      }
    }
    scene.traverseVisible((o) => {
      if (!o.isMesh || !o.geometry?.attributes.position || o.userData.hit !== undefined || o.userData.proxy === true) return;
      let owner = o;
      while (owner && !owner.name) owner = owner.parent;
      const name = owner?.name || "?";
      if (drop.test(name)) return;
      const g0 = o.geometry;
      if (name.startsWith("wheel:") && g0.type === "LatheGeometry") return; // the numeral plate on the star wheel: 0.3 mm, lost at README size
      // open surfaces (decals, the paper of the drums) have no inside: left out, every part of the model is a closed solid
      if (g0.type === "RingGeometry" || g0.type === "CircleGeometry" || (g0.type === "CylinderGeometry" && g0.parameters.openEnded)) return;
      if (name.startsWith("wheel:")) return; // plate, pins and shaft of the lantern wheel: hand-made below
      if (isPin(g0)) {
        const n = pinCount.get(name) ?? 0;
        pinCount.set(name, n + 1);
        const every = pinEvery[name.split(":")[0]] ?? 1;
        if (every === 0 || n % every !== 0) return;
      }
      const matrices = [];
      if (o.isInstancedMesh) {
        for (let i = 0; i < o.count; i++) {
          const im = new T.Matrix4();
          o.getMatrixAt(i, im);
          matrices.push(new T.Matrix4().multiplyMatrices(o.matrixWorld, im));
        }
      } else matrices.push(o.matrixWorld);
      g0.computeBoundingSphere();
      const worldScale = new T.Vector3();
      o.matrixWorld.decompose(new T.Vector3(), new T.Quaternion(), worldScale);
      if (g0.boundingSphere.radius * Math.max(worldScale.x, worldScale.y, worldScale.z) < minRadius) {
        stats.small++;
        return;
      }
      const group = groupOf(name, g0);
      detail = details[group];
      coarse = coarseBy[name.split(":")[0]] ?? 1;
      const base = name.split(":")[0];
      let low = null;
      let standIn = false;
      if (base === "output" && g0.type === "ExtrudeGeometry") (low = gearStandIn()), (standIn = true);
      else if (base === "starWheel") (low = starStandIn(g0)), (standIn = true);
      else if (base === "crown" && g0.type === "BufferGeometry") {
        g0.computeBoundingBox();
        if (g0.boundingBox.min.z > 0.5) return; // the numeral plate on the ring: part of the ring stand-in
        (low = crownStandIn(g0)), (standIn = true);
      }
      if (!standIn) {
        const lowRaw = lowDetail(g0, group);
        if (lowRaw !== BAD) low = (lowRaw ? placed(g0, lowRaw) : null) ?? flatStandIn(g0);
        else low = BAD;
      }
      if (low === BAD) {
        stats.dropped.push(name);
        return;
      }
      const g = low ?? g0;
      if (standIn) stats.standIns++;
      if (low) stats.lowered++;
      else stats.kept++;
      commit(name, group, g0.type, g, matrices, !!low, standIn);
    });
    mechanism();
    if (countOnly) return totals;
    let retried = 0;
    let rejected = 0;
    for (const key of usedOutlines) {
      const entry = outlineLog.get(key);
      if (key.startsWith("flat/") && entry === undefined) continue;
      if (entry === null) rejected++;
      else if (entry?.retried) retried++;
    }
    return { result, stats: { ...stats, outlines: { checked: usedOutlines.size, retried, rejected } } };
  },
  { dropSource: DROP.source, minRadius: MIN_RADIUS, details, countOnly, pinEvery: PIN_EVERY, isPinSource: isPin.toString(), coarseBy: COARSE },
);

// Free-form parts get a share of their group's budget; the detail of each group is bisected to fit the rest.
const freeWeight = (n) => Math.sqrt(n);
const freeCost = (list, share) => {
  const total = list.reduce((a, n) => a + freeWeight(n), 0);
  return list.reduce((a, n) => a + Math.min(n, Math.max(12, Math.floor((share * freeWeight(n)) / total))), 0);
};
const cost = (totals, g) => totals[g].low + freeCost(totals[g].free, budget[g] * FREE_SHARE);
const lo = Object.fromEntries(GROUP_NAMES.map((g) => [g, 0.05]));
const hi = Object.fromEntries(GROUP_NAMES.map((g) => [g, 1]));
const settled = {};
const first = await collect({ ...hi }, true);
for (const g of GROUP_NAMES) if (cost(first, g) <= budget[g]) (settled[g] = true), (lo[g] = 1);
for (let i = 0; i < 9 && GROUP_NAMES.some((g) => !settled[g]); i++) {
  const mid = Object.fromEntries(GROUP_NAMES.map((g) => [g, settled[g] ? 1 : (lo[g] + hi[g]) / 2]));
  const t = await collect(mid, true);
  for (const g of GROUP_NAMES) {
    if (settled[g]) continue;
    if (cost(t, g) > budget[g]) hi[g] = mid[g];
    else lo[g] = mid[g];
  }
}
const details = lo;
const meshes = await collect(details, false);
await browser.close();
server.kill();

await MeshoptSimplifier.ready;

/** Welds a triangle soup by position on a 0.05 mm grid into an indexed mesh; drops triangles that collapse. */
function weld(soup) {
  const map = new Map();
  const positions = [];
  const raw = new Uint32Array(soup.length / 3);
  for (let i = 0; i < soup.length; i += 3) {
    const key = `${Math.round(soup[i] * 20)},${Math.round(soup[i + 1] * 20)},${Math.round(soup[i + 2] * 20)}`;
    let k = map.get(key);
    if (k === undefined) {
      k = positions.length / 3;
      map.set(key, k);
      positions.push(soup[i], soup[i + 1], soup[i + 2]);
    }
    raw[i / 3] = k;
  }
  const kept = [];
  for (let t = 0; t < raw.length; t += 3) if (raw[t] !== raw[t + 1] && raw[t + 1] !== raw[t + 2] && raw[t] !== raw[t + 2]) kept.push(raw[t], raw[t + 1], raw[t + 2]);
  return { positions: new Float32Array(positions), indices: Uint32Array.from(kept) };
}

// the floor plane under the machine is not part of it
let parts = meshes.result
  .map((m) => ({ ...m, ...weld(m.soup) }))
  .filter((p) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const x of p.positions) (lo = Math.min(lo, x)), (hi = Math.max(hi, x));
    return hi - lo < 1000;
  });
const facets = (p) => p.indices.length / 3;
const sourceFacets = parts.reduce((n, p) => n + facets(p), 0);
const groupFacets = (g) => parts.filter((p) => p.group === g).reduce((n, p) => n + facets(p), 0);
const diagonal = (p) => {
  const a = [Infinity, Infinity, Infinity];
  const b = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.positions.length; i++) (a[i % 3] = Math.min(a[i % 3], p.positions[i])), (b[i % 3] = Math.max(b[i % 3], p.positions[i]));
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
};

// Rebuilt parts stay as they are; free-form parts share what is left of their group, in proportion to the square root of their size.
for (const g of GROUP_NAMES) {
  const mine = parts.filter((p) => p.group === g);
  const fixed = mine.filter((p) => p.low).reduce((n, p) => n + facets(p), 0);
  const free = mine.filter((p) => !p.low);
  const totalWeight = free.reduce((n, p) => n + Math.sqrt(facets(p)), 0);
  const left = Math.max(budget[g] - fixed, budget[g] * FREE_SHARE);
  for (const p of free) {
    const target = Math.max(12, Math.floor((left * Math.sqrt(facets(p))) / totalWeight));
    if (facets(p) <= target) continue;
    let [indices] = MeshoptSimplifier.simplify(p.indices, p.positions, 3, target * 3, 1e9, ["ErrorAbsolute", "Permissive"]);
    if (indices.length / 3 > target * 1.5) [indices] = MeshoptSimplifier.simplifySloppy(p.indices, p.positions, 3, null, target * 3, 1e9);
    p.indices = indices;
  }
}
// Secondary parts that still do not fit go, smallest first.
const droppedForBudget = [];
for (;;) {
  if (groupFacets("secondary") <= budget.secondary) break;
  const mine = parts.filter((p) => p.group === "secondary");
  const smallest = mine.reduce((a, b) => (diagonal(a) <= diagonal(b) ? a : b));
  droppedForBudget.push(smallest.name);
  parts = parts.filter((p) => p !== smallest);
}

// three.js is Y-up, STL viewers expect Z-up: (x, y, z) -> (x, -z, y). Ground the model at z = 0 and center x/y.
const zUp = (p, k) => [p.positions[k * 3], -p.positions[k * 3 + 2], p.positions[k * 3 + 1]];
const min = [Infinity, Infinity, Infinity];
const max = [-Infinity, -Infinity, -Infinity];
for (const p of parts) {
  for (let k = 0; k < p.positions.length / 3; k++) {
    const v = zUp(p, k);
    for (let a = 0; a < 3; a++) (min[a] = Math.min(min[a], v[a])), (max[a] = Math.max(max[a], v[a]));
  }
}
const offset = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, min[2]];
// integer coordinates in units of 0.4 mm: shorter than decimals and still far finer than the README viewer can show
const UNIT = 2.5;

// ---- quantise, weld again on the written grid, validate
const check = { collapsed: 0, flat: 0, flipped: 0, open: 0, closed: 0, nonManifold: [], badOrientation: [], droppedBad: [] };
const volumeOf = (tris) => {
  let s = 0;
  for (const [a, b, c] of tris) s += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  return s;
};
const finalParts = [];
for (const p of parts) {
  const ids = new Map();
  const verts = [];
  const id = (k) => {
    const v = zUp(p, k);
    const q = [Math.round((v[0] - offset[0]) * UNIT), Math.round((v[1] - offset[1]) * UNIT), Math.round((v[2] - offset[2]) * UNIT)];
    const key = q.join(",");
    if (!ids.has(key)) (ids.set(key, verts.length), verts.push(q));
    return ids.get(key);
  };
  let tris = [];
  for (let t = 0; t < p.indices.length; t += 3) {
    const [a, b, c] = [id(p.indices[t]), id(p.indices[t + 1]), id(p.indices[t + 2])];
    if (a === b || b === c || a === c) {
      check.collapsed++;
      continue;
    }
    const [A, B, C] = [verts[a], verts[b], verts[c]];
    const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
    const w = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    if (u[1] * w[2] - u[2] * w[1] === 0 && u[2] * w[0] - u[0] * w[2] === 0 && u[0] * w[1] - u[1] * w[0] === 0) {
      check.flat++;
      continue;
    }
    tris.push([a, b, c]);
  }
  if (!tris.length) continue;
  // winding: every edge must be used once in each direction by a closed solid
  const directed = new Map();
  for (const [a, b, c] of tris) for (const [x, y] of [[a, b], [b, c], [c, a]]) directed.set(`${x}>${y}`, (directed.get(`${x}>${y}`) ?? 0) + 1);
  let doubled = 0;
  let unpaired = 0;
  for (const [key, n] of directed) {
    if (n > 1) doubled++;
    const [x, y] = key.split(">");
    if (!directed.has(`${y}>${x}`)) unpaired++;
  }
  const corners = () => tris.map(([a, b, c]) => [verts[a], verts[b], verts[c]]);
  if (doubled && IMPORTANT.includes(p.group)) check.nonManifold.push(`${p.name} (${p.type}): ${doubled} edges used twice in one direction`);
  else if (doubled) {
    check.droppedBad.push(p.name);
    continue;
  }
  if (!unpaired) {
    check.closed++;
    const volume = volumeOf(corners());
    if (volume < 0) {
      tris = tris.map(([a, b, c]) => [a, c, b]);
      check.flipped++;
    } else if (volume === 0) check.badOrientation.push(`${p.name}: zero volume`);
  } else {
    // an open stand-in (lies on another part): the divergence sum about the middle of its box is positive when it faces outward
    check.open++;
    if (p.standIn) {
      const c0 = [0, 1, 2].map((a) => (Math.min(...verts.map((v) => v[a])) + Math.max(...verts.map((v) => v[a]))) / 2);
      let s = 0;
      for (const [a, b, c] of corners()) {
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
        s += n[0] * (a[0] - c0[0]) + n[1] * (a[1] - c0[1]) + n[2] * (a[2] - c0[2]);
      }
      if (s <= 0) check.badOrientation.push(`${p.name}: open stand-in faces inward`);
    }
  }
  finalParts.push({ ...p, tris: corners() });
}

const num = (x, d) => {
  const s = d > 0 ? x.toFixed(d).replace(/\.?0+$/, "") : x.toFixed(0);
  return s === "-0" || s === "" ? "0" : s;
};
const lines = ["solid pascaline"];
let facetCount = 0;
let degenerate = 0;
for (const p of finalParts) {
  for (const [a, b, c] of p.tris) {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const len = Math.hypot(...n);
    if (len === 0) {
      degenerate++;
      continue;
    }
    facetCount++;
    lines.push(`facet normal ${n.map((x) => num(x / len, 1)).join(" ")}`, "outer loop");
    for (const v of [a, b, c]) lines.push(`vertex ${v.map((x) => num(x, 0)).join(" ")}`);
    lines.push("endloop", "endfacet");
  }
}
lines.push("endsolid pascaline");

const errors = [];
if (degenerate) errors.push(`${degenerate} degenerate facets in the written mesh`);
errors.push(...check.nonManifold.map((e) => `inconsistent winding: ${e}`), ...check.badOrientation.map((e) => `normals: ${e}`));
if (meshes.stats.outlines.rejected && IMPORTANT.some((g) => meshes.stats.dropped.some((n) => finalGroup(n) === g))) errors.push("an outline of an important part could not be thinned without self-intersections");
function finalGroup(name) {
  return meshes.result.find((m) => m.name === name)?.group;
}
for (const g of IMPORTANT) if (groupFacets(g) > budget[g] * 1.1) errors.push(`group ${g}: ${groupFacets(g)} facets over its budget ${budget[g]}`);
const total = facetCount;
if (total > Math.round(TOTAL * scale)) errors.push(`${total} facets over the total of ${Math.round(TOTAL * scale)}`);

if (report) {
  const by = {};
  for (const p of finalParts) {
    const k = `${p.name.replace(/:-?\d+/g, ":N")} ${p.type}${p.standIn ? " (stand-in)" : p.low ? " (rebuilt)" : ""}`;
    by[k] = (by[k] ?? 0) + p.tris.length;
  }
  for (const [k, n] of Object.entries(by).sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(6)}  ${k}`);
  console.log("group        budget   facets  detail");
  for (const g of GROUP_NAMES) {
    const used = finalParts.filter((p) => p.group === g).reduce((n, p) => n + p.tris.length, 0);
    console.log(`${g.padEnd(11)} ${String(budget[g]).padStart(7)} ${String(used).padStart(8)}  ${details[g].toFixed(2)}`);
  }
  console.log(`total       ${String(budgetSum * scale).padStart(7)} ${String(total).padStart(8)}`);
}
const { lowered, kept, small, standIns, dropped, outlines } = meshes.stats;
console.log(`${sourceFacets} facets before simplifying; meshes rebuilt ${lowered} (hand-made stand-ins ${standIns}), simplified ${kept}, dropped as tiny ${small}`);
console.log(`outlines checked ${outlines.checked}, retried with less thinning ${outlines.retried}, rejected ${outlines.rejected}; parts dropped for a bad outline: ${dropped.length ? [...new Set(dropped)].join(", ") : "none"}`);
console.log(`validation: degenerate facets ${degenerate} (collapsed by the 0.4 mm grid and removed: ${check.collapsed}, zero-area removed: ${check.flat}); closed parts ${check.closed} (windings flipped ${check.flipped}), open parts ${check.open}; parts dropped for bad winding: ${check.droppedBad.length ? check.droppedBad.join(", ") : "none"}; secondary parts dropped for budget: ${droppedForBudget.length ? droppedForBudget.join(", ") : "none"}`);
if (errors.length) {
  console.error("VALIDATION FAILED:\n  " + errors.join("\n  "));
  process.exit(1);
}
const stl = lines.join("\n") + "\n";
writeFileSync(out, "```stl\n" + stl + "```\n");
if (stlOut) writeFileSync(stlOut, stl);
console.log(`result: ${total} facets, ${(Buffer.byteLength(stl) / 1024).toFixed(0)} KB; size ${(max[0] - min[0]).toFixed(0)} x ${(max[1] - min[1]).toFixed(0)} x ${(max[2] - min[2]).toFixed(0)} mm -> ${out}`);
process.exit(0);
