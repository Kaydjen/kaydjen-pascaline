// The lid with the sliding strip in both positions (add / subtract), looking for dirt that stays behind when the strip moves.
export default {
  views: [
    { name: "top", pos: [0, 330, 150], target: [0, 60, -5], fov: 30 },
    { name: "strip", pos: [0, 200, 90], target: [0, 105, -3], fov: 30 },
  ],
  variants: [
    { name: "add", js: `window.__proto.setVisibleRow("ascending", true);` },
    { name: "subtract", js: `window.__proto.setVisibleRow("descending", true);` },
  ],
};
