import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  Object3D,
  MOUSE,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Raycaster,
  Scene,
  ShadowMaterial,
  SpotLight,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  type WebGLRenderTarget,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { createCameraRig, MAX_POLAR, type CameraRig, type MachineViews } from "./cameraRig";

const BACKGROUND = 0x0b0a09;
/** Quality steps: pixel ratio cap and shadow map size; the stage steps down after 2 s above 20 ms per frame and never up. */
const QUALITY = [
  { dpr: 2, shadow: 4096 },
  { dpr: 1.5, shadow: 2048 },
  { dpr: 1, shadow: 2048 },
] as const;

/** What a stage shows: one object plus how to frame it. Sizes are millimetres. */
export interface StageContent {
  object: Object3D;
  target: Vector3;
  cameraOffset: Vector3;
  /** Half-size of the area that needs shadows and the nearest allowed zoom. */
  extent: number;
  /** Called every frame with the real time delta in seconds, before rendering. */
  update?(realDelta: number): void;
  /** Camera views of the machine; without them the stage keeps the plain orbit camera (camera spike scene). */
  views?: MachineViews;
  /** When set, a left press on it locks the camera (camera spike). */
  lockObject?: Object3D;
}

export function boxContent(): StageContent {
  const object = new Mesh(
    new BoxGeometry(445, 105, 135),
    new MeshPhysicalMaterial({ color: 0xb8924a, roughness: 0.35, metalness: 1 }),
  );
  object.position.y = 105 / 2;
  object.castShadow = true;
  object.receiveShadow = true;
  return { object, target: new Vector3(0, 40, 0), cameraOffset: new Vector3(420, 340, 520), extent: 400, lockObject: object };
}

export interface Stage {
  /** Resolves when the shaders are compiled (in parallel, off the main thread where the browser allows) and the loop runs. */
  readonly ready: Promise<void>;
  /** Starts the loop when the stage was made with a `compileTarget` (otherwise it starts by itself once `ready`). */
  begin(): void;
  /** Camera presets and the teardown follow; null for the plain camera-spike scene. */
  readonly rig: CameraRig | null;
  dispose(): void;
  /** Camera spike hooks, used by the probe script. */
  readonly debug: StageDebug;
}

export interface StageDebug {
  camera: PerspectiveCamera;
  controls: OrbitControls;
  renderer: WebGLRenderer;
  rig: CameraRig | null;
  frames: number;
  /** True while a pointer-down on the test object has locked the camera. */
  locked: boolean;
  /** Index into the quality steps (0 = best). */
  quality: number;
  /** When set, it draws the frame instead of the plain render (the lab uses it for ambient occlusion). */
  postRender: ((delta: number) => void) | null;
  /** Scene and lights, for the lab. */
  scene: Scene;
  lights: { key: SpotLight; fill: DirectionalLight; rim: DirectionalLight };
  /** The faint additive pool of light on the ground (it is dimmed when the frame goes through the composer). */
  pool: Mesh | null;
}

/** Hidden mini-scene of emissive strips, filtered into the reflection environment of the brass (no room, no desk). */
function buildEnvironmentScene(): Scene {
  const scene = new Scene();
  scene.background = new Color(0x34291f);
  const strip = (width: number, height: number, color: number, power: number, position: Vector3): void => {
    const mesh = new Mesh(new PlaneGeometry(width, height), new MeshBasicMaterial({ color: new Color(color).multiplyScalar(power), toneMapped: false }));
    mesh.position.copy(position);
    mesh.lookAt(0, 0, 0);
    scene.add(mesh);
  };
  strip(16, 2.6, 0xffd9a6, 6, new Vector3(-6, 8, 6)); // warm long strip, above left, towards the viewer
  strip(1.4, 9, 0xa5b8d6, 2, new Vector3(9, 3, 1)); // thin cool strip on the right
  strip(5, 1.6, 0xffcf99, 3, new Vector3(0, 4, -9)); // small warm strip behind
  return scene;
}

/** Faint warm pool of light under the machine (the "pool"); additive, no hard edge. */
function poolTexture(): CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,190,120,0.16)");
  gradient.addColorStop(0.5, "rgba(255,170,100,0.05)");
  gradient.addColorStop(1, "rgba(255,160,90,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new CanvasTexture(canvas);
}

export interface StageOptions {
  /** A render target the frame will be drawn into (the occlusion composer): the shaders are compiled for it instead of for the screen. */
  compileTarget?: (renderer: WebGLRenderer) => WebGLRenderTarget;
}

export function createStage(canvas: HTMLCanvasElement, onFatal: (message: string) => void, content: StageContent, options: StageOptions = {}): Stage | null {
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  } catch {
    onFatal("WebGL2 is not available in this browser.");
    return null;
  }
  if (!renderer.capabilities.isWebGL2) {
    onFatal("WebGL2 is not available in this browser.");
    return null;
  }

  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.6;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;

  const scene = new Scene();
  scene.background = new Color(BACKGROUND);
  const pmrem = new PMREMGenerator(renderer);
  // size 128 = the size of the baked studio HDRI: both environments then compile to the same shader variants (a different size would build every shader twice)
  const environment = pmrem.fromScene(buildEnvironmentScene(), 0.02, 0.1, 100, { size: 128 }).texture;
  scene.environment = environment;
  scene.environmentIntensity = 1.1;

  // Units are millimetres. Key: warm spot from upper left front; fill: cool, weak, from the right; rim: small, warm, from behind.
  const e = content.extent;
  const key = new SpotLight(0xffe2bd, 4.2, 0, 0.62, 0.9, 0);
  key.position.set(-0.8 * e, 1.5 * e, 1.0 * e).add(content.target);
  key.target.position.copy(content.target);
  scene.add(key.target);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.camera.near = 0.5 * e;
  key.shadow.camera.far = 4 * e;
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.4;
  scene.add(key);
  const fill = new DirectionalLight(0x8895a8, 0.4);
  fill.position.set(1.4 * e, 0.8 * e, 0.4 * e).add(content.target);
  fill.target.position.copy(content.target);
  scene.add(fill, fill.target);
  const rim = new DirectionalLight(0xffc88a, 0.5);
  rim.position.set(0.2 * e, 0.5 * e, -1.6 * e).add(content.target);
  rim.target.position.copy(content.target);
  scene.add(rim, rim.target);

  // shadow-only ground just under the plinth, plus the faint pool of light
  const groundY = -4.6;
  const ground = new Mesh(new PlaneGeometry(4000, 4000), new ShadowMaterial({ opacity: 0.55 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = groundY;
  ground.receiveShadow = true;
  scene.add(ground);
  const poolMap = poolTexture();
  let pool: Mesh | null = null;
  if (poolMap) {
    pool = new Mesh(new PlaneGeometry(2.6 * e * 2, 2.0 * e * 2), new MeshBasicMaterial({ map: poolMap, transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false }));
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(content.target.x, groundY + 0.02, content.target.z);
    scene.add(pool);
  }

  scene.add(content.object);

  const camera = new PerspectiveCamera(35, 1, 1, 10000);
  camera.position.copy(content.target).add(content.cameraOffset);

  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(content.target);
  controls.enableDamping = true;
  controls.minDistance = Math.max(25, content.extent * 0.12);
  controls.maxDistance = 2000;
  controls.maxPolarAngle = MAX_POLAR;
  controls.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.ROTATE };
  controls.update();

  const rig = content.views ? createCameraRig(camera, controls, content.views) : null;
  rig?.setPreset("default", { instant: true });
  const keyOffset = key.position.clone().sub(content.target);
  const debug: StageDebug = { camera, controls, renderer, rig, frames: 0, locked: false, quality: 0, postRender: null, scene, lights: { key, fill, rim }, pool };

  // Camera spike (b): a capture-phase listener on the canvas runs before OrbitControls' own.
  const raycaster = new Raycaster();
  const pointer = new Vector2();
  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    const rect = canvas.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    if (!content.lockObject || raycaster.intersectObject(content.lockObject).length === 0) return;
    controls.enabled = false;
    debug.locked = true;
    canvas.setPointerCapture(event.pointerId);
  };
  const onPointerUp = (event: PointerEvent): void => {
    if (!debug.locked || event.button !== 0) return;
    controls.enabled = true;
    debug.locked = false;
  };
  const onContextMenu = (event: Event): void => event.preventDefault();
  canvas.addEventListener("pointerdown", onPointerDown, { capture: true });
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("contextmenu", onContextMenu);

  const resize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY[debug.quality]!.dpr));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener("resize", resize);

  const onContextLost = (event: Event): void => {
    event.preventDefault();
    onFatal("The graphics context was lost. Reload the page.");
  };
  const onContextRestored = (): void => location.reload();
  canvas.addEventListener("webglcontextlost", onContextLost);
  canvas.addEventListener("webglcontextrestored", onContextRestored);

  let last = performance.now();
  let handle = 0;
  let running = false;

  let frameTime = 1 / 60;
  let slowFor = 0;
  const frame = (now: number): void => {
    handle = requestAnimationFrame(frame);
    const delta = (now - last) / 1000;
    last = now;
    // adaptive quality: a smoothed frame time above 20 ms for 2 s lowers the pixel ratio and the shadow map one step
    frameTime += (Math.min(delta, 0.25) - frameTime) * 0.05;
    slowFor = frameTime > 0.02 ? slowFor + delta : 0;
    if (slowFor > 2 && debug.quality < QUALITY.length - 1) {
      debug.quality++;
      slowFor = 0;
      key.shadow.mapSize.set(QUALITY[debug.quality]!.shadow, QUALITY[debug.quality]!.shadow);
      key.shadow.map?.dispose();
      key.shadow.map = null;
      resize();
    }
    content.update?.(delta);

    // Near/far follow the orbit distance to keep depth precision at close-up zoom.
    const distance = camera.position.distanceTo(controls.target);
    camera.near = Math.max(0.5, distance * 0.02);
    camera.far = distance * 30 + 4000;
    camera.updateProjectionMatrix();

    rig?.update(delta);
    controls.update();
    // the key light follows what the camera looks at (the exploded stack, a close-up)
    key.target.position.copy(controls.target);
    key.position.copy(controls.target).add(keyOffset);
    if (debug.postRender) debug.postRender(delta);
    else renderer.render(scene, camera);
    if (debug.frames < 2) performance.mark(`frame${debug.frames + 1}`);
    debug.frames++;
  };

  const start = (): void => {
    if (running) return;
    running = true;
    last = performance.now();
    handle = requestAnimationFrame(frame);
  };
  const stop = (): void => {
    running = false;
    cancelAnimationFrame(handle);
  };
  const onVisibility = (): void => (document.hidden ? stop() : start());
  document.addEventListener("visibilitychange", onVisibility);
  // compile every program up front without blocking the page, then start the loop: the first frame is then cheap
  // the target is set only for the synchronous start of the compile: the shader variants depend on the output it implies
  if (options.compileTarget) renderer.setRenderTarget(options.compileTarget(renderer));
  const compiling = renderer.compileAsync(scene, camera);
  renderer.setRenderTarget(null);
  const ready = compiling.catch(() => undefined).then(() => {
    performance.mark("compiled");
    if (!document.hidden && !options.compileTarget) start(); // with a compile target the caller starts the loop once the occlusion pass is in place
  });

  return {
    ready,
    begin: () => {
      if (!document.hidden) start();
    },
    rig,
    debug,
    dispose(): void {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("pointerdown", onPointerDown, { capture: true });
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("contextmenu", onContextMenu);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      controls.dispose();
      environment.dispose();
      pmrem.dispose();
      renderer.dispose();
    },
  };
}
