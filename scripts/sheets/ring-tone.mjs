// Crown = thick dark ring + thin numeral plate (off-centre): shape and plate tone against the photos, whole lid first.
const tone = (tint) => ({ "steel-ring": { scan: { tint } } });
export default {
  views: [
    { name: "whole", pos: [0, 300, 190], target: [0, 40, -10], fov: 30, photo: "docs/reference/photos/cnam-823-1-front-user.png" },
    { name: "close", pos: [60, 120, 90], target: [60, 50, 15], fov: 30, photo: "docs/reference/photos/user-flickr-angled-wheels.png" },
    { name: "close-front", pos: [100, 100, 75], target: [100, 75, 22], fov: 30, photo: "docs/reference/photos/user-wheel-macro-2.png" },
  ],
  variants: [
    { name: "warm-dark", note: "plate #7e6a48", materials: tone("#7e6a48") },
    { name: "between", note: "plate #69573c", materials: tone("#69573c") },
    { name: "grey", note: "plate #7d7482", materials: tone("#7d7482") },
  ],
};
