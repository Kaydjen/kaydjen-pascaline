// Stylus stand: views of the right side, the stylus resting on it. Run once per shape: --query=stand=v|forks|saddle
// World frame: x right, y up, z towards the viewer; the stand sits near (144, 0, 10).
export default {
  views: [
    { name: "front", pos: [60, 150, 330], target: [60, 20, 0], fov: 34 },
    { name: "close", pos: [215, 45, 120], target: [144, 4, 8], fov: 22 },
    { name: "side", pos: [260, 30, -10], target: [144, 4, 8], fov: 22 },
    { name: "top", pos: [150, 160, 40], target: [144, 0, 8], fov: 22 },
  ],
  variants: [{ name: "now" }],
};
