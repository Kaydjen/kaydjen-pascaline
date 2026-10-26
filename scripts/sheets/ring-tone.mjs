// Crown ring shape and tone against the photos: whole lid first (colours must work together), then a close view.
// The shape is switched in the page: "dome" = the shipped band (domed top, lips on both edges), "flat" = flat face, only a thin outer lip.
const shape = (mode) => `(() => {
  const crowns = [];
  window.__stage.scene.traverse((o) => o.name?.startsWith("crown:") && crowns.push(o));
  const band = crowns[0].children[0].geometry;
  const face = crowns[0].children[1].geometry;
  for (const g of [band, face]) {
    const p = g.attributes.position;
    g.userData.z0 ??= Float32Array.from(p.array.filter((_, i) => i % 3 === 2));
    for (let k = 0; k < p.count; k++) p.setZ(k, ${mode === "flat"} ? (g === band && g.userData.z0[k] < 0.1 ? 0 : 1.5 + (g === face ? 0.015 : 0)) : g.userData.z0[k]);
    p.needsUpdate = true;
    g.computeVertexNormals();
  }
  for (const c of crowns) {
    c.children[2].visible = ${mode !== "flat"};
    c.children[3].scale.set(1, 1, ${mode === "flat" ? 0.5 : 1});
    c.children[3].position.z = ${mode === "flat" ? 1.5 : 1.77};
  }
})()`;
const tone = (tint) => ({ "steel-ring": { scan: { tint } } });
export default {
  nomerge: true,
  views: [
    { name: "whole", pos: [0, 300, 190], target: [0, 40, -10], fov: 30, photo: "docs/reference/photos/cnam-823-1-front-user.png" },
    { name: "close", pos: [60, 120, 90], target: [60, 50, 15], fov: 30, photo: "docs/reference/photos/user-flickr-angled-wheels.png" },
  ],
  variants: [
    { name: "dome-warm", note: "shipped shape, #7e6a48", js: shape("dome"), materials: tone("#7e6a48") },
    { name: "flat-warm", note: "#7e6a48", js: shape("flat"), materials: tone("#7e6a48") },
    { name: "flat-dark", note: "#54432f", js: shape("flat"), materials: tone("#54432f") },
    { name: "flat-grey", note: "#7d7482 (whole-lid photo)", js: shape("flat"), materials: tone("#7d7482") },
  ],
};
