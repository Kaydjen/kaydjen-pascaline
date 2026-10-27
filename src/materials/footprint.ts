import {
  Box3,
  Color,
  ClampToEdgeWrapping,
  DoubleSide,
  LinearFilter,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NoColorSpace,
  OrthographicCamera,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  WebGLRenderTarget,
  type Object3D,
  type WebGLRenderer,
} from "three";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import { lidFootprint } from "./wear";

/** Pixels per millimetre of the footprint map. */
const PX_PER_MM = 4;

const BLUR = /* glsl */ `
uniform sampler2D map;
uniform vec2 step;
uniform float sigma;
varying vec2 vUv;
void main() {
  float sum = 0.0;
  float weight = 0.0;
  for (int i = -32; i <= 32; i++) {
    float w = exp(-0.5 * float(i * i) / (sigma * sigma));
    sum += w * texture2D(map, vUv + step * float(i)).r;
    weight += w;
  }
  gl_FragColor = vec4(vec3(sum / weight), 1.0);
}`;

/**
 * Renders the parts that stand on the lid from above (the lid frame: x right, y away, z up), blurs the picture and hands it to the wear
 * shader: the grime around the parts then follows their real outline. `sigmaMm` is the blur, about the width of the grime.
 * Returns false when the lid cannot be found.
 */
export function bakeLidFootprint(renderer: WebGLRenderer, scene: Object3D, sigmaMm: number): boolean {
  let plate: Mesh | null = null;
  scene.traverse((o) => {
    if (o instanceof Mesh && !Array.isArray(o.material) && o.material.name === "brass-lid") plate = o;
  });
  if (!plate) return false;
  const lid = (plate as Mesh).parent!;
  const geometry = (plate as Mesh).geometry;
  geometry.computeBoundingBox();
  const bounds = new Box3().copy(geometry.boundingBox!).expandByScalar(1);
  const size = bounds.getSize(bounds.max.clone());

  // the same parts as white shapes on black, in the lid frame
  const white = new MeshBasicMaterial({ color: 0xffffff, side: DoubleSide, toneMapped: false });
  const shapes = new Scene();
  lid.updateWorldMatrix(true, true);
  const inverse = new Matrix4().copy(lid.matrixWorld).invert();
  // the label strip and the sliding strip are siblings of the lid: their grime follows their outline too (the strip is baked at rest)
  const roots = [lid, lid.parent?.getObjectByName("label"), lid.parent?.getObjectByName("slider")].filter((r): r is Object3D => !!r);
  for (const root of roots) {
    root.updateWorldMatrix(true, true);
    root.traverse((o) => {
      if (!(o instanceof Mesh) || o === plate || o.userData.hit !== undefined || o.userData.proxy === true || !o.visible) return;
      if (!Array.isArray(o.material) && (o.material.name === "brass-lid" || o.name === "labelText")) return;
      const shape = new Mesh(o.geometry, white);
      shape.matrixAutoUpdate = false;
      shape.matrix.multiplyMatrices(inverse, o.matrixWorld);
      shapes.add(shape);
    });
  }

  const width = Math.ceil(size.x * PX_PER_MM);
  const height = Math.ceil(size.y * PX_PER_MM);
  const options = { format: RGBAFormat, type: UnsignedByteType, minFilter: LinearFilter, magFilter: LinearFilter, wrapS: ClampToEdgeWrapping, wrapT: ClampToEdgeWrapping, depthBuffer: true };
  const a = new WebGLRenderTarget(width, height, options);
  const b = new WebGLRenderTarget(width, height, { ...options, depthBuffer: false });
  a.texture.colorSpace = b.texture.colorSpace = NoColorSpace;

  const camera = new OrthographicCamera(bounds.min.x, bounds.max.x, bounds.max.y, bounds.min.y, 1, 600);
  camera.position.set(0, 0, 300);
  camera.lookAt(0, 0, 0);

  const previousTarget = renderer.getRenderTarget();
  const previousClear = renderer.getClearColor(new Color());
  const previousAlpha = renderer.getClearAlpha();
  renderer.setClearColor(0x000000, 1);
  renderer.setRenderTarget(a);
  renderer.clear();
  renderer.render(shapes, camera);

  const sigma = sigmaMm * PX_PER_MM;
  const blur = new ShaderMaterial({
    uniforms: { map: { value: a.texture }, step: { value: [0, 0] }, sigma: { value: sigma } },
    vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
    fragmentShader: BLUR,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new FullScreenQuad(blur);
  blur.uniforms.step!.value = [1 / width, 0];
  renderer.setRenderTarget(b);
  quad.render(renderer);
  blur.uniforms.map!.value = b.texture;
  blur.uniforms.step!.value = [0, 1 / height];
  renderer.setRenderTarget(a);
  quad.render(renderer);

  renderer.setRenderTarget(previousTarget);
  renderer.setClearColor(previousClear, previousAlpha);
  quad.dispose();
  blur.dispose();
  b.dispose();
  white.dispose();

  lidFootprint.map.value = a.texture;
  lidFootprint.min.value.set(bounds.min.x, bounds.min.y);
  lidFootprint.size.value.set(size.x, size.y);
  return true;
}
