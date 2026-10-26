// Example sheet config (also the self-test of scripts/sheet.mjs): the front view beside the photo, the shipped look against a darker lid.
export default {
  views: [
    { name: "front", pos: [0, 270, 340], target: [0, 40, -5], fov: 30, photo: "docs/reference/photos/cnam-823-1-front-user.png" },
  ],
  variants: [
    { name: "now", note: "the shipped look" },
    { name: "dark-lid", note: "lid tint darker", materials: { "brass-lid": { scan: { tint: "#a08c6a" } } } },
  ],
};
