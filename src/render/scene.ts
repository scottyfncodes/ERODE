import {
  ACESFilmicToneMapping,
  BackSide,
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  Mesh,
  PCFShadowMap,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { LevelDef } from '../levels/types';

export interface Quality {
  pixelRatio: number;
  shadowSize: number;
  shadows: boolean;
  trees: number;
  far: boolean;
}

export function detectQuality(): Quality {
  const ua = navigator.userAgent;
  const mobile = /iPhone|iPad|iPod|Android/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
  const dpr = window.devicePixelRatio || 1;
  const small = Math.min(window.innerWidth, window.innerHeight) < 600;
  if (mobile || small) {
    return { pixelRatio: Math.min(dpr, 1.75), shadowSize: 1024, shadows: true, trees: 0.6, far: true };
  }
  return { pixelRatio: Math.min(dpr, 2), shadowSize: 2048, shadows: true, trees: 1, far: true };
}

export interface SceneRig {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  sun: DirectionalLight;
  hemi: HemisphereLight;
  sunDir: Vector3;
  fogColor: Color;
  quality: Quality;
  resize(): void;
  /** keep the shadow frustum centred on what the camera is looking at */
  focusShadows(target: Vector3, radius: number): void;
  /** dynamic resolution: call every frame with the frame time */
  adapt(dt: number): void;
  /** blend the air and light toward the stretch of mountain at course position z */
  setAtmosphere(z: number, dt: number): void;
}

/** Light and air for each stretch of the descent, keyed by course z. */
const ATMOS: { z: number; fog: [number, number, number]; density: number; sky: [number, number, number]; zenith: [number, number, number]; ground: [number, number, number]; sun: [number, number, number]; sunI: number; hemiI: number; exposure: number }[] = [
  // high alpine: thin, cold, crystal clear
  { z: -40, fog: [0.8, 0.88, 0.98], density: 0.0011, sky: [0.8, 0.9, 1.0], zenith: [0.14, 0.42, 0.95], ground: [0.5, 0.52, 0.58], sun: [1.0, 0.97, 0.93], sunI: 2.9, hemiI: 1.0, exposure: 0.92 },
  { z: 200, fog: [0.78, 0.85, 0.92], density: 0.0014, sky: [0.8, 0.88, 0.97], zenith: [0.2, 0.5, 0.95], ground: [0.48, 0.42, 0.34], sun: [1.0, 0.95, 0.85], sunI: 2.7, hemiI: 1.0, exposure: 0.95 },
  // forest: green, humid haze
  { z: 380, fog: [0.6, 0.72, 0.6], density: 0.0026, sky: [0.72, 0.84, 0.8], zenith: [0.25, 0.5, 0.8], ground: [0.32, 0.38, 0.22], sun: [1.0, 0.9, 0.72], sunI: 2.4, hemiI: 1.05, exposure: 0.98 },
  // the falls and gorge: cool spray, deep shade
  { z: 500, fog: [0.7, 0.8, 0.84], density: 0.0034, sky: [0.75, 0.85, 0.92], zenith: [0.22, 0.46, 0.8], ground: [0.3, 0.34, 0.36], sun: [0.95, 0.95, 1.0], sunI: 2.0, hemiI: 1.15, exposure: 1.0 },
  { z: 680, fog: [0.74, 0.82, 0.8], density: 0.0022, sky: [0.8, 0.88, 0.92], zenith: [0.22, 0.5, 0.9], ground: [0.38, 0.4, 0.28], sun: [1.0, 0.92, 0.78], sunI: 2.5, hemiI: 1.0, exposure: 0.97 },
  // lower valley: warm, broad, afternoon
  { z: 900, fog: [0.92, 0.84, 0.7], density: 0.0017, sky: [0.95, 0.88, 0.78], zenith: [0.28, 0.52, 0.88], ground: [0.5, 0.42, 0.28], sun: [1.0, 0.86, 0.62], sunI: 2.7, hemiI: 0.95, exposure: 1.0 },
  // the coast: golden hour over the sea
  { z: 1080, fog: [0.98, 0.8, 0.62], density: 0.0012, sky: [1.0, 0.82, 0.62], zenith: [0.3, 0.46, 0.82], ground: [0.6, 0.48, 0.32], sun: [1.0, 0.76, 0.5], sunI: 3.0, hemiI: 0.9, exposure: 1.02 },
];

export function createSceneRig(canvas: HTMLCanvasElement, level: LevelDef, quality: Quality): SceneRig {
  const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(quality.pixelRatio);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.shadowMap.enabled = quality.shadows;
  renderer.shadowMap.type = PCFShadowMap;

  const scene = new Scene();
  const camera = new PerspectiveCamera(50, 1, 0.3, 2400);

  const az = level.look.sunAzimuth;
  const el = level.look.sunElevation;
  const sunDir = new Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).normalize();

  // Late-afternoon light: warm sun, cool sky fill.
  const horizon = new Color(0.78, 0.9, 1.0);
  const zenith = new Color(0.2, 0.52, 0.98);
  const fogColor = new Color(0.74, 0.86, 0.97);
  scene.background = fogColor.clone();
  scene.fog = new FogExp2(fogColor.getHex(), 0.0016);

  const skyMat = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uHorizon: { value: horizon },
      uZenith: { value: zenith },
      uSun: { value: sunDir },
      uFog: { value: fogColor },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uHorizon; uniform vec3 uZenith; uniform vec3 uSun; uniform vec3 uFog;
      varying vec3 vDir;
      float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      float n(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
      void main() {
        vec3 d = normalize(vDir);
        float y = max(d.y, 0.0);
        vec3 col = mix(uHorizon, uZenith, pow(y, 0.55));
        float s = max(dot(d, normalize(uSun)), 0.0);
        col += vec3(1.0, 0.86, 0.62) * (pow(s, 6.0) * 0.28 + pow(s, 64.0) * 0.6 + pow(s, 900.0) * 4.0);
        // soft high cloud bands
        vec2 cp = d.xz / max(d.y, 0.08) * 1.4;
        float c = n(cp * 0.8) * 0.6 + n(cp * 2.1) * 0.3 + n(cp * 5.0) * 0.1;
        c = smoothstep(0.55, 0.85, c) * smoothstep(0.02, 0.25, d.y);
        col = mix(col, vec3(1.0, 0.97, 0.93) * (0.9 + s * 0.2), c * 0.55);
        // below the horizon: haze
        col = mix(col, uFog, smoothstep(0.08, -0.05, d.y));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const sky = new Mesh(new SphereGeometry(2000, 32, 16), skyMat);
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  scene.add(sky);

  const hemi = new HemisphereLight(new Color(0.7, 0.82, 1.0), new Color(0.42, 0.34, 0.22), 1.05);
  scene.add(hemi);

  const sun = new DirectionalLight(new Color(1.0, 0.94, 0.8), 2.6);
  sun.position.copy(sunDir).multiplyScalar(120);
  sun.castShadow = quality.shadows;
  sun.shadow.mapSize.set(quality.shadowSize, quality.shadowSize);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  const sc = sun.shadow.camera;
  sc.near = 1;
  sc.far = 320;
  scene.add(sun);
  scene.add(sun.target);

  // Environment reflections from the sky (cheap: generated once).
  const pmrem = new PMREMGenerator(renderer);
  const envScene = new Scene();
  envScene.add(new Mesh(new SphereGeometry(10, 32, 16), skyMat));
  const env = pmrem.fromScene(envScene, 0.04);
  scene.environment = env.texture;
  scene.environmentIntensity = 0.22;
  pmrem.dispose();

  const tmpA = new Color(),
    tmpB = new Color();
  const fog = scene.fog as FogExp2;
  const lerp3 = (out: Color, a: [number, number, number], b: [number, number, number], u: number) => out.setRGB(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u);
  let atmosZ = -40;
  const rig: SceneRig = {
    adapt: () => {},
    setAtmosphere(z: number, dt: number) {
      atmosZ += (z - atmosZ) * Math.min(1, dt * 1.5);
      let i = 0;
      while (i < ATMOS.length - 2 && ATMOS[i + 1].z < atmosZ) i++;
      const a = ATMOS[i],
        b = ATMOS[i + 1];
      const u = Math.max(0, Math.min(1, (atmosZ - a.z) / (b.z - a.z)));
      const s2 = u * u * (3 - 2 * u);
      lerp3(fogColor, a.fog, b.fog, s2);
      fog.color.copy(fogColor);
      (scene.background as Color).copy(fogColor);
      fog.density = a.density + (b.density - a.density) * s2;
      lerp3(horizon, a.sky, b.sky, s2);
      lerp3(zenith, a.zenith, b.zenith, s2);
      lerp3(tmpA, a.sun, b.sun, s2);
      sun.color.copy(tmpA);
      sun.intensity = a.sunI + (b.sunI - a.sunI) * s2;
      hemi.intensity = a.hemiI + (b.hemiI - a.hemiI) * s2;
      lerp3(tmpB, a.ground, b.ground, s2);
      hemi.groundColor.copy(tmpB);
      renderer.toneMappingExposure = a.exposure + (b.exposure - a.exposure) * s2;
    },
    renderer,
    scene,
    camera,
    sun,
    hemi,
    sunDir,
    fogColor,
    quality,
    resize() {
      const w = canvas.clientWidth || window.innerWidth;
      const h = canvas.clientHeight || window.innerHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      // keep the mountain in frame on tall phone screens
      camera.fov = camera.aspect < 0.8 ? 62 : 50;
      camera.updateProjectionMatrix();
    },
    focusShadows(target: Vector3, radius: number) {
      const r = Math.max(18, Math.min(90, radius));
      sc.left = -r;
      sc.right = r;
      sc.top = r;
      sc.bottom = -r;
      sc.updateProjectionMatrix();
      // snap to texel grid to avoid shimmering
      const texel = (2 * r) / quality.shadowSize;
      const tx = Math.round(target.x / texel) * texel;
      const tz = Math.round(target.z / texel) * texel;
      sun.target.position.set(tx, target.y, tz);
      sun.position.set(tx, target.y, tz).addScaledVector(sunDir, 150);
    },
  };
  // Dynamic resolution keeps weaker phones smooth: measure, then step the pixel ratio.
  let acc = 0;
  let frames = 0;
  let ratio = quality.pixelRatio;
  rig.adapt = (dt: number) => {
    acc += dt;
    frames++;
    if (acc < 2) return;
    const avg = acc / frames;
    acc = 0;
    frames = 0;
    let next = ratio;
    if (avg > 1 / 38 && ratio > 1) next = Math.max(1, ratio - 0.25);
    else if (avg < 1 / 57 && ratio < quality.pixelRatio) next = Math.min(quality.pixelRatio, ratio + 0.25);
    if (next !== ratio) {
      ratio = next;
      renderer.setPixelRatio(ratio);
      rig.resize();
    }
    // last resort on very slow devices: drop shadows
    if (avg > 1 / 22 && ratio <= 1 && renderer.shadowMap.enabled) {
      renderer.shadowMap.enabled = false;
      sun.castShadow = false;
    }
  };
  rig.resize();
  return rig;
}
