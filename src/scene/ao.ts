import { HalfFloatType, Mesh, type MeshBasicMaterial, NoBlending, type Object3D, PlaneGeometry, Scene, ShaderMaterial, type Sprite, Vector2, WebGLRenderTarget, type WebGLRenderer } from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import type { StageDebug } from "./stage";

export interface AoSettings {
  radius: number;
  intensity: number;
  distanceExponent: number;
  thickness: number;
  /** How much of the occlusion stays on bright, directly lit pixels (1 = the same as everywhere; 0 = none). Occlusion belongs to the ambient light, so on lit metal it reads as a shadow. */
  directStrength?: number;
  /** Scene luminance (linear, before tone mapping) where the occlusion starts to fade and where it has faded completely. */
  fadeFrom?: number;
  fadeTo?: number;
}

/** The tunable parts of an installed pass. */
export interface AoHandle {
  gtao: GTAOPass;
  blend: ShaderMaterial;
  /** Resolves when the occlusion shaders are built and the pass is switched on. */
  ready: Promise<void>;
}

/** Multiplies the frame by the occlusion, less so where the frame is bright (the stock blend cannot see the frame, so this one reads it). */
const BLEND_FRAGMENT = /* glsl */ `
uniform sampler2D tDiffuse;
uniform sampler2D tScene;
uniform float intensity;
uniform float directStrength;
uniform vec2 fade;
varying vec2 vUv;
void main() {
  vec4 scene = texture2D(tScene, vUv);
  float occlusion = texture2D(tDiffuse, vUv).r;
  float luma = dot(scene.rgb, vec3(0.2126, 0.7152, 0.0722));
  float weight = mix(1.0, directStrength, smoothstep(fade.x, fade.y, luma));
  gl_FragColor = vec4(scene.rgb * mix(1.0, occlusion, intensity * weight), scene.a);
}`;

/** The additive pool under the machine is tone mapped when the frame goes through the composer, so it is dimmed then. */
const POOL_OPACITY_AO = 0.22;
/**
 * Quality step from which the frame is rendered plainly again. Never: the plain render goes to the screen, whose shader programs
 * differ from the composer's and are not built up front, so the switch froze the page for seconds on a slow machine. Slower machines
 * only lose pixel ratio and shadow size.
 */
const PLAIN_FROM_QUALITY = Infinity;

/** The render target of the occlusion composer (also given to the stage so that the shaders are compiled for it). */
export function createAoTarget(renderer: WebGLRenderer): WebGLRenderTarget {
  const size = renderer.getSize(new Vector2());
  return new WebGLRenderTarget(size.x * renderer.getPixelRatio(), size.y * renderer.getPixelRatio(), { type: HalfFloatType, samples: 4 });
}

/** Ambient occlusion (GTAO) through a composer, drawn instead of the plain render; a slow machine falls back to the plain render. */
export function installAo(debug: StageDebug, settings: AoSettings, target: WebGLRenderTarget): AoHandle {
  const { renderer, scene, camera, pool } = debug;
  const size = renderer.getSize(new Vector2());
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const gtao = new GTAOPass(scene, camera, size.x, size.y);
  gtao.blendIntensity = settings.intensity;
  gtao.updateGtaoMaterial({ radius: settings.radius, distanceExponent: settings.distanceExponent, thickness: settings.thickness, scale: 1, samples: 16 });
  const blend = new ShaderMaterial({
    uniforms: { tDiffuse: { value: null }, tScene: { value: null }, intensity: { value: settings.intensity }, directStrength: { value: settings.directStrength ?? 1 }, fade: { value: new Vector2(settings.fadeFrom ?? 0.15, settings.fadeTo ?? 0.8) } },
    vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: BLEND_FRAGMENT,
    blending: NoBlending,
    depthTest: false,
    depthWrite: false,
  });
  gtao.blendMaterial = blend;
  // the stock pass hands its blend only the occlusion: give it the frame it is blending into as well
  const render = gtao.render.bind(gtao);
  gtao.render = (r, writeBuffer, readBuffer, delta, mask) => {
    blend.uniforms.tScene!.value = readBuffer.texture;
    blend.uniforms.intensity!.value = gtao.blendIntensity;
    render(r, writeBuffer, readBuffer, delta, mask);
  };
  // the glow sprites (stand, contact lamps, hover, windows) are light, not surfaces: left in the occlusion pass they were drawn as flat quads
  // and cleared the occlusion in a square around them (the pass already leaves out points and lines the same way)
  const hooks = gtao as unknown as { _overrideVisibility(): void; _visibilityCache: Object3D[] };
  const hideLines = hooks._overrideVisibility.bind(gtao);
  hooks._overrideVisibility = () => {
    hideLines();
    scene.traverse((o) => {
      if ((o as Sprite).isSprite && o.visible) {
        o.visible = false;
        hooks._visibilityCache.push(o);
      }
    });
  };
  composer.addPass(gtao);
  composer.addPass(new OutputPass());
  const poolMaterial = pool?.material as MeshBasicMaterial | undefined;

  let pixelRatio = renderer.getPixelRatio();
  const current = new Vector2(size.x, size.y);
  debug.postRender = (delta) => {
    if (debug.quality >= PLAIN_FROM_QUALITY) {
      if (poolMaterial) poolMaterial.opacity = 1;
      renderer.render(scene, camera);
      return;
    }
    if (poolMaterial) poolMaterial.opacity = POOL_OPACITY_AO;
    renderer.getSize(size);
    if (renderer.getPixelRatio() !== pixelRatio || !size.equals(current)) {
      pixelRatio = renderer.getPixelRatio();
      current.copy(size);
      composer.setPixelRatio(pixelRatio);
      composer.setSize(size.x, size.y);
    }
    composer.render(delta);
  };
  // the occlusion shaders are heavy (seconds to compile on a cold GPU cache): until they are built in the background the frame goes through the composer without the pass
  gtao.enabled = false;
  const probe = new Scene();
  for (const material of [gtao.gtaoMaterial, gtao.pdMaterial, gtao.blendMaterial, gtao.copyMaterial]) probe.add(new Mesh(new PlaneGeometry(2, 2), material));
  renderer.setRenderTarget(target);
  const compiled = renderer.compileAsync(probe, camera);
  renderer.setRenderTarget(null);
  const ready = compiled.then(() => {
    gtao.enabled = true;
  });
  return { gtao, blend, ready };
}
