// Crown = thick dark ring + thin numeral plate (off-centre): shape and plate tone against the photos, whole lid first.
const tone = (tint) => ({ "steel-ring": { scan: { tint } } });
export default {
  views: [
    { name: "whole", pos: [0, 300, 190], target: [0, 40, -10], fov: 30, photo: "docs/reference/photos/cnam-823-1-front-user.png" },
    { name: "top", pos: [0, 330, 1], target: [0, 45, -10], fov: 38, photo: "docs/reference/photos/cnam-823-1-front-user.png" },
    { name: "brackets", pos: [-35, 190, 45], target: [-35, 60, -5], fov: 30, photo: "docs/reference/photos/cnam-823-1-front-user.png" },
    { name: "close-front", pos: [100, 100, 75], target: [100, 75, 22], fov: 30, photo: "docs/reference/photos/user-wheel-macro-2.png" },
  ],
  variants: [
    { name: "cool-light", note: "#9a94a6 (best so far)", materials: tone("#9a94a6") },
    { name: "middle", note: "#8d879a", materials: tone("#8d879a") },
  ],
};
