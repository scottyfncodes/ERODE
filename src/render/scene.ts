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
}

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

  const rig: SceneRig = {
    adapt: () => {},
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
