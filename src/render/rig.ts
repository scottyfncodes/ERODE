import * as THREE from 'three';
import type { Conditions } from '../world/weather';
import { shared } from './materials';

export interface Quality {
  tier: 'low' | 'high';
  pixelRatio: number;
  shadowSize: number;
  trees: number;
  snowflakes: number;
}

export function detectQuality(force: 'auto' | 'low' | 'high' = 'auto'): Quality {
  const ua = navigator.userAgent;
  const mobile = /iPhone|iPad|iPod|Android/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
  const dpr = window.devicePixelRatio || 1;
  const low = force === 'low' || (force === 'auto' && (mobile || Math.min(window.innerWidth, window.innerHeight) < 600));
  return low
    ? { tier: 'low', pixelRatio: Math.min(dpr, 1.5), shadowSize: 1024, trees: 0.55, snowflakes: 1400 }
    : { tier: 'high', pixelRatio: Math.min(dpr, 2), shadowSize: 2048, trees: 1, snowflakes: 3000 };
}

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
  }
`;
const SKY_FRAG = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uGround;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uNight;
  uniform float uCloud;
  uniform float uTime;
  varying vec3 vDir;
  float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n2(vec2 x) {
    vec2 i = floor(x); vec2 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * n2(p); p *= 2.1; a *= 0.5; } return s; }
  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.55));
    col = mix(col, uGround, smoothstep(0.0, -0.08, h));
    float s = max(dot(d, uSunDir), 0.0);
    // the warm glow along the horizon on the sun's side: alpine air at golden hour
    float sideGlow = pow(max(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(uSunDir.x, 0.0, uSunDir.z))), 0.0), 4.0);
    col += uSunColor * sideGlow * exp(-max(h, 0.0) * 9.0) * 0.18 * (1.0 - uNight);
    // clouds: soft cumulus banks drifting with the wind, lit on the sun side, thicker in bad weather
    if (h > 0.0) {
      vec2 uv = d.xz / (h + 0.18) * 1.6 + vec2(uTime * 0.006, uTime * 0.002);
      float c = fbm(uv) * 0.75 + fbm(uv * 3.1 + 5.0) * 0.25;
      float cover = mix(0.62, 0.34, uCloud);
      float dens = smoothstep(cover, cover + 0.22, c) * smoothstep(0.0, 0.12, h);
      vec3 lit = mix(vec3(0.94, 0.95, 0.98), uSunColor * 1.1, 0.25 + 0.5 * pow(s, 3.0));
      vec3 shade = mix(uHorizon, uZenith, 0.35) * 0.82;
      vec3 cloudCol = mix(shade, lit, smoothstep(0.2, 0.9, c - cover + 0.5));
      cloudCol = mix(cloudCol, vec3(0.08, 0.1, 0.15), uNight * 0.85);
      col = mix(col, cloudCol, dens * 0.85);
    }
    col += uSunColor * (pow(s, 900.0) * 3.0 * (1.0 - uCloud) + pow(s, 12.0) * 0.28 + pow(s, 3.0) * 0.08);
    // stars
    if (uNight > 0.01 && h > 0.0) {
      vec3 q = floor(d * 280.0);
      float st = step(0.9965, hash(q)) * uNight * (1.0 - uCloud) * smoothstep(0.0, 0.25, h);
      col += vec3(st);
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class Rig {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly fog: THREE.Fog;
  private sky: THREE.Mesh;
  private skyU: Record<string, THREE.IUniform>;
  quality: Quality;
  private scale = 1;
  private slow = 0;
  private fast = 0;
  readonly sunDir = new THREE.Vector3(0.4, 0.7, 0.3).normalize();
  /** night-ness 0..1, for lamps and windows */
  night = 0;
  readonly fogColor = new THREE.Color();

  constructor(canvas: HTMLCanvasElement, q: Quality) {
    this.quality = q;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: q.tier === 'high', powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(q.pixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.25, 2600);
    this.fog = new THREE.Fog(0xcfe0ee, 300, 1700);
    this.scene.fog = this.fog;

    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
    const sc = this.sun.shadow.camera;
    sc.left = -55;
    sc.right = 55;
    sc.top = 55;
    sc.bottom = -55;
    sc.near = 1;
    sc.far = 500;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.4;
    this.scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xcfe6ff, 0xe9eef5, 1.1);
    this.scene.add(this.hemi);

    this.skyU = {
      uZenith: { value: new THREE.Color(0x3f7fc6) },
      uHorizon: { value: new THREE.Color(0xcfe3f2) },
      uGround: { value: new THREE.Color(0xdfe7ee) },
      uSunDir: { value: this.sunDir },
      uSunColor: { value: new THREE.Color(1, 0.9, 0.75) },
      uNight: { value: 0 },
      uCloud: { value: 0 },
      uTime: shared.time,
    };
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(2000, 32, 16),
      new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: this.skyU, side: THREE.BackSide, depthWrite: false, fog: false }),
    );
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;
    this.scene.add(this.sky);
    this.resize();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setPixelRatio(this.quality.pixelRatio * this.scale);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // narrow portrait screens get a wider lens so you still see around you
    this.camera.fov = w < h ? 68 : 55;
    this.camera.updateProjectionMatrix();
  }

  /** Keep the shadow map on what matters: the area around the player. */
  focus(target: THREE.Vector3, radius = 55) {
    const sc = this.sun.shadow.camera;
    if (sc.right !== radius) {
      sc.left = -radius;
      sc.right = radius;
      sc.top = radius;
      sc.bottom = -radius;
      sc.updateProjectionMatrix();
    }
    // snap to texels so shadows do not shimmer as you move
    const texel = (radius * 2) / this.quality.shadowSize;
    const x = Math.round(target.x / texel) * texel;
    const z = Math.round(target.z / texel) * texel;
    this.sun.target.position.set(x, target.y, z);
    this.sun.position.set(x + this.sunDir.x * 250, target.y + this.sunDir.y * 250, z + this.sunDir.z * 250);
    this.sky.position.copy(this.camera.position);
  }

  /** Lower the resolution when frames run long, raise it again when there is headroom. */
  adapt(dt: number) {
    if (dt > 1 / 40) {
      this.slow++;
      this.fast = 0;
    } else if (dt < 1 / 56) {
      this.fast++;
      this.slow = 0;
    }
    if (this.slow > 40 && this.scale > 0.6) {
      this.scale = Math.max(0.6, this.scale - 0.1);
      this.slow = 0;
      this.resize();
    } else if (this.fast > 240 && this.scale < 1) {
      this.scale = Math.min(1, this.scale + 0.1);
      this.fast = 0;
      this.resize();
    }
  }

  /** Paint the sky, the light and the air for the time of day and the weather. */
  setConditions(c: Conditions, indoors = 0) {
    const day = c.light;
    const golden = (1 - Math.min(1, Math.abs(c.sunEl) / 0.35)) * day;
    const cloud = c.cloud;
    this.night = 1 - day;
    const lerpC = (a: number, b: number, t: number) => new THREE.Color(a).lerp(new THREE.Color(b), t);
    // clear-sky colours across the day
    const zen = lerpC(0x0b1626, 0x3a78c0, day).lerp(new THREE.Color(0x5a6f9e), golden * 0.4);
    const hor = lerpC(0x1c2b44, 0xcfe3f2, day).lerp(new THREE.Color(0xf7c99a), golden * 0.7);
    // cloud flattens it toward grey
    const grey = lerpC(0x1a2230, 0xb9c4cf, day);
    zen.lerp(grey, cloud * 0.85);
    hor.lerp(grey.clone().multiplyScalar(1.05), cloud * 0.8);
    (this.skyU.uZenith.value as THREE.Color).copy(zen);
    (this.skyU.uHorizon.value as THREE.Color).copy(hor);
    (this.skyU.uGround.value as THREE.Color).copy(hor).multiplyScalar(0.92);
    this.skyU.uNight.value = this.night;
    this.skyU.uCloud.value = cloud;
    // the sun (or the moon at night)
    if (day > 0.05) this.sunDir.set(Math.cos(c.sunEl) * Math.sin(c.sunAz), Math.max(0.08, Math.sin(c.sunEl)), Math.cos(c.sunEl) * Math.cos(c.sunAz)).normalize();
    else this.sunDir.set(-0.3, 0.75, -0.5).normalize();
    const sunCol = lerpC(0x8aa4d8, 0xfff1dc, day).lerp(new THREE.Color(0xffb46e), golden * 0.6);
    this.sun.color.copy(sunCol);
    (this.skyU.uSunColor.value as THREE.Color).copy(sunCol);
    this.sun.intensity = (day > 0.05 ? 3.0 * day : 0.5) * (1 - cloud * 0.7) + 0.05;
    this.hemi.color.copy(lerpC(0x2a3b5c, 0xbcd6ff, day));
    this.hemi.groundColor.copy(lerpC(0x1d2638, 0xe8edf3, day));
    this.hemi.intensity = 0.55 + day * 0.5 + cloud * 0.45;
    // fog: visibility falls in snow and storms; indoors it pulls in a little
    const near = THREE.MathUtils.lerp(320, 25, c.fog);
    const far = THREE.MathUtils.lerp(1800, 230, c.fog);
    this.fog.near = near;
    this.fog.far = far * (1 - indoors * 0.2);
    this.fogColor.copy(hor).lerp(grey, c.fog * 0.6);
    this.fog.color.copy(this.fogColor);
    this.renderer.toneMappingExposure = 0.95 + (1 - day) * 0.35;
    shared.wind.value = 0.6 + c.wind * 2.2;
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
