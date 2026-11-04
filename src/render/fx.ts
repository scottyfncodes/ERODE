import * as THREE from 'three';
import type { Terrain } from '../world/terrain';

/**
 * Snow in the air and on the ground: falling snow around the camera, one pooled particle system
 * for powder spray, smoke, blasts and the avalanche's powder cloud, and track ribbons pressed
 * into the snow behind the sled and the skis.
 */

const PARTICLE_VERT = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  attribute float aKind;
  attribute float aAge;
  varying float vAlpha;
  varying vec3 vColor;
  varying vec2 vCell;
  uniform float uScale;
  void main() {
    vAlpha = aAlpha;
    vColor = aColor;
    // which flipbook frame: a quadrant per kind, 4x4 frames each, played once over the particle's life
    float frame = min(15.0, floor(aAge * 16.0));
    vec2 quad = vec2(mod(aKind, 2.0), floor(aKind / 2.0));
    vCell = quad * 4.0 + vec2(mod(frame, 4.0), floor(frame / 4.0));
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(0.5, -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;
const PARTICLE_FRAG = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;
  varying vec2 vCell;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform sampler2D uAtlas;
  uniform float uUseAtlas;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d);
    if (r > 0.5) discard;
    vec3 col = vColor;
    float a;
    if (uUseAtlas > 0.5) {
      vec4 t = texture2D(uAtlas, (vCell + gl_PointCoord) / 8.0);
      col *= t.rgb;
      a = t.a * vAlpha;
    } else {
      a = smoothstep(0.5, 0.15, r) * vAlpha;
    }
    if (a < 0.01) discard;
    float depth = gl_FragCoord.z / gl_FragCoord.w;
    float f = smoothstep(uFogNear, uFogFar, depth);
    gl_FragColor = vec4(mix(col, uFogColor, f), a);
  }
`;

/** Flipbook quadrants in public/fx/kessel-fx.png (art/fx/build_fx.py). */
export const FX_KIND = { puff: 0, powder: 1, blast: 2, fire: 3 } as const;
export type FxKind = (typeof FX_KIND)[keyof typeof FX_KIND];

interface P {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  grow: number;
  alpha: number;
  r: number;
  g: number;
  b: number;
  drag: number;
  rise: number;
  kind: number;
}

type EmitOpts = { life?: number; size?: number; grow?: number; alpha?: number; color?: readonly [number, number, number]; drag?: number; rise?: number; kind?: FxKind };
const NO_OPTS: EmitOpts = {};
const WHITE = [0.97, 0.98, 1] as const;
const SMOKE = [0.78, 0.78, 0.8] as const;
const FLASH_TINT = [1, 0.92, 0.85] as const;
const FIRE = [1, 1, 1] as const;
const CLOUD = [0.95, 0.97, 1] as const;

export class Particles {
  readonly points: THREE.Points;
  private pool: P[] = [];
  private spare: P[] = [];
  private back: P[] = [];
  private oldest = 0;
  private pos: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private color: Float32Array;
  private kind: Float32Array;
  private age: Float32Array;
  private geo: THREE.BufferGeometry;
  private n = 0;
  readonly uniforms: Record<string, THREE.IUniform>;

  constructor(private max = 2400) {
    this.pos = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.color = new Float32Array(max * 3);
    this.kind = new Float32Array(max);
    this.age = new Float32Array(max);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aKind', new THREE.BufferAttribute(this.kind, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAge', new THREE.BufferAttribute(this.age, 1).setUsage(THREE.DynamicDrawUsage));
    this.uniforms = {
      uScale: { value: 400 },
      uAtlas: { value: null },
      uUseAtlas: { value: 0 },
      uFogColor: { value: new THREE.Color() },
      uFogNear: { value: 100 },
      uFogFar: { value: 1000 },
    };
    const m = new THREE.ShaderMaterial({ vertexShader: PARTICLE_VERT, fragmentShader: PARTICLE_FRAG, uniforms: this.uniforms, transparent: true, depthWrite: false });
    this.points = new THREE.Points(this.geo, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  get count() {
    return this.n;
  }

  /** Draw from the FXCraft flipbook atlas (null: back to the plain soft discs). */
  setAtlas(tex: THREE.Texture | null) {
    this.uniforms.uAtlas.value = tex;
    this.uniforms.uUseAtlas.value = tex ? 1 : 0;
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, opts: EmitOpts = NO_OPTS) {
    // a fixed pool: when it is full the oldest puff is recycled (no allocation, no array shifting
    // while an avalanche is throwing hundreds a second)
    let p: P;
    if (this.pool.length < this.max) {
      p = this.spare.pop() ?? ({} as P);
      this.pool.push(p);
    } else {
      p = this.pool[this.oldest];
      this.oldest = (this.oldest + 1) % this.pool.length;
    }
    const c = opts.color ?? WHITE;
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = vx;
    p.vy = vy;
    p.vz = vz;
    p.life = 0;
    p.max = opts.life ?? 1.2;
    p.size = opts.size ?? 1;
    p.grow = opts.grow ?? 1.5;
    p.alpha = opts.alpha ?? 0.8;
    p.r = c[0];
    p.g = c[1];
    p.b = c[2];
    p.drag = opts.drag ?? 1.5;
    p.rise = opts.rise ?? -4;
    p.kind = opts.kind ?? FX_KIND.puff;
  }

  /** A burst of powder (sled spray, a landing, a fall). */
  powder(x: number, y: number, z: number, n: number, spread: number, up: number, vx = 0, vz = 0, size = 1.2, kind: FxKind = FX_KIND.puff) {
    for (let i = 0; i < n; i++)
      this.emit(x, y, z, vx + (Math.random() - 0.5) * spread, up * (0.4 + Math.random()), vz + (Math.random() - 0.5) * spread, { life: 0.7 + Math.random() * 0.6, size: size * (0.6 + Math.random() * 0.8), grow: 1.8, alpha: 0.7, drag: 2.2, rise: -5, kind });
  }

  smoke(x: number, y: number, z: number, wind: number) {
    this.emit(x + (Math.random() - 0.5) * 0.3, y, z + (Math.random() - 0.5) * 0.3, wind * 1.2 + (Math.random() - 0.5) * 0.3, 0.9 + Math.random() * 0.4, (Math.random() - 0.5) * 0.3 + wind * 0.4, {
      life: 5 + Math.random() * 2,
      size: 1.4,
      grow: 4,
      alpha: 0.35,
      color: SMOKE,
      drag: 0.2,
      rise: 0.15,
    });
  }

  /** The charge going off: a flash of snow and smoke. */
  blast(x: number, y: number, z: number) {
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 6 + Math.random() * 16;
      this.emit(x, y + 1, z, Math.cos(a) * s * 0.6, 8 + Math.random() * 18, Math.sin(a) * s * 0.6, { life: 1.6 + Math.random() * 1.4, size: 4 + Math.random() * 5, grow: 3, alpha: 0.9, drag: 1.2, rise: -6 });
    }
    // the fireball and its smoke ring from the FXCraft explosion, staggered so no two frames match
    for (let i = 0; i < 9; i++)
      this.emit(x + (Math.random() - 0.5) * 3, y + 1 + Math.random() * 2.5, z + (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 5, 3 + Math.random() * 5, (Math.random() - 0.5) * 5, {
        life: 0.7 + Math.random() * 0.8,
        size: 2.2 + Math.random() * 2.2,
        grow: 1.6,
        alpha: 0.9,
        color: FLASH_TINT,
        drag: 2.5,
        rise: 0.4,
        kind: FX_KIND.blast,
      });
  }

  /** The avalanche's powder cloud boiling off the moving snow. */
  cloud(x: number, y: number, z: number, vx: number, vz: number, k: number) {
    this.emit(x + (Math.random() - 0.5) * 3, y + Math.random() * 2, z + (Math.random() - 0.5) * 3, vx * 0.7 + (Math.random() - 0.5) * 3, 2 + Math.random() * 5 * k, vz * 0.7 + (Math.random() - 0.5) * 3, {
      life: 2.5 + Math.random() * 2.5,
      size: 3 + Math.random() * 5 * k,
      grow: 3,
      alpha: 0.38,
      drag: 0.6,
      rise: 0.2,
      color: CLOUD,
    });
  }

  /** A tongue of flame (the hearth): drawn from the fire loop, a plain warm disc without the atlas. */
  flame(x: number, y: number, z: number) {
    const lit = this.uniforms.uUseAtlas.value > 0;
    this.emit(x + (Math.random() - 0.5) * 0.25, y, z + (Math.random() - 0.5) * 0.5, 0, 0.35 + Math.random() * 0.2, 0, {
      life: 0.7 + Math.random() * 0.3,
      size: 0.55 + Math.random() * 0.2,
      grow: lit ? 0.2 : -0.5,
      alpha: lit ? 0.95 : 0.6,
      color: lit ? FIRE : ([1, 0.62, 0.3] as const),
      drag: 0.5,
      rise: 0.6,
      kind: FX_KIND.fire,
    });
  }

  update(dt: number, fog: THREE.Fog, pixelScale: number) {
    this.uniforms.uScale.value = pixelScale;
    (this.uniforms.uFogColor.value as THREE.Color).copy(fog.color);
    this.uniforms.uFogNear.value = fog.near;
    this.uniforms.uFogFar.value = fog.far;
    let j = 0;
    // walk oldest first (the pool is a ring once full) into the other buffer, so survivors stay in
    // age order and the next recycle takes the genuinely oldest puff
    const from = this.pool;
    const into = this.back;
    into.length = 0;
    const len = from.length;
    for (let n = 0; n < len; n++) {
      const p = from[(this.oldest + n) % len];
      p.life += dt;
      if (p.life >= p.max) {
        this.spare.push(p);
        continue;
      }
      const k = Math.exp(-p.drag * dt);
      p.vx *= k;
      p.vz *= k;
      p.vy = p.vy * k + p.rise * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      into.push(p);
      j++;
      const f = p.life / p.max;
      const o = (j - 1) * 3;
      this.pos[o] = p.x;
      this.pos[o + 1] = p.y;
      this.pos[o + 2] = p.z;
      this.size[j - 1] = p.size * (1 + f * p.grow);
      this.alpha[j - 1] = p.alpha * (1 - f) * Math.min(1, p.life * 8);
      this.color[o] = p.r;
      this.color[o + 1] = p.g;
      this.color[o + 2] = p.b;
      this.kind[j - 1] = p.kind;
      this.age[j - 1] = f;
    }
    this.back = from;
    this.pool = into;
    this.oldest = 0;
    this.n = j;
    this.geo.setDrawRange(0, this.n);
    for (const k of ['position', 'aSize', 'aAlpha', 'aColor', 'aKind', 'aAge']) (this.geo.getAttribute(k) as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** A 32 px soft disc, made in memory (no image to load). */
function flakeSprite(): THREE.DataTexture {
  const n = 32;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const r = Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / (n / 2);
      const a = Math.max(0, Math.min(1, (1 - r) / 0.55));
      const o = (y * n + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = 255;
      data[o + 3] = Math.round(a * a * (3 - 2 * a) * 255);
    }
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** Falling snow in a box that travels with the camera. */
export class Snowfall {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private readonly box = new THREE.Vector3(70, 40, 70);
  private mat: THREE.PointsMaterial;

  constructor(private count: number) {
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      this.pos[i * 3] = (Math.random() - 0.5) * this.box.x;
      this.pos[i * 3 + 1] = Math.random() * this.box.y;
      this.pos[i * 3 + 2] = (Math.random() - 0.5) * this.box.z;
      this.vel[i] = 1.2 + Math.random() * 1.4;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    // a soft round flake: without a sprite, points draw as hard squares, and the ones that drift
    // past the lens show up as big white tiles
    this.mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.16, map: flakeSprite(), alphaTest: 0.02, transparent: true, opacity: 0.9, depthWrite: false, sizeAttenuation: true, fog: true });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
  }

  update(dt: number, cam: THREE.Vector3, intensity: number, windX: number, windZ: number) {
    const shown = Math.floor(this.count * Math.min(1, intensity));
    this.points.geometry.setDrawRange(0, shown);
    this.points.visible = shown > 0;
    if (!shown) return;
    this.mat.size = 0.2 + intensity * 0.1;
    const bx = this.box.x;
    const by = this.box.y;
    const bz = this.box.z;
    const t = performance.now() / 1000;
    for (let i = 0; i < shown; i++) {
      const o = i * 3;
      let x = this.pos[o] + (windX * (0.6 + intensity) + Math.sin(t + i) * 0.4) * dt;
      let y = this.pos[o + 1] - this.vel[i] * (1 + intensity * 0.8) * dt;
      let z = this.pos[o + 2] + (windZ * (0.6 + intensity) + Math.cos(t * 0.8 + i) * 0.4) * dt;
      // wrap round the camera
      x = ((((x - cam.x + bx / 2) % bx) + bx) % bx) - bx / 2 + cam.x;
      z = ((((z - cam.z + bz / 2) % bz) + bz) % bz) - bz / 2 + cam.z;
      if (y < cam.y - by / 2) y += by;
      if (y > cam.y + by / 2) y -= by;
      this.pos[o] = x;
      this.pos[o + 1] = y;
      this.pos[o + 2] = z;
    }
    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }
}

const ORDER = [0, 2, 1, 1, 2, 3];

/** Ribbons pressed into the snow. Each source lays down quads; old ones fade and are reused. */
export class Tracks {
  readonly mesh: THREE.Mesh;
  private pos: Float32Array;
  private col: Float32Array;
  private ages: Float32Array;
  private head = 0;
  private last = new Map<string, { lx: number; lz: number; rx: number; rz: number; y1: number; y2: number; x: number; z: number }>();
  /** seconds a track lasts (fresh snow fills them in faster) */
  life = 240;
  private readonly quad = new Float32Array(12);

  constructor(private terrain: Terrain, private max = 1600) {
    this.pos = new Float32Array(max * 6 * 3);
    this.col = new Float32Array(max * 6 * 4);
    this.ages = new Float32Array(max).fill(1e9);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  /** Lay track from `id` at (x, z) heading (fx, fz), `half` the ribbon half width, `offset` sideways. */
  add(id: string, x: number, z: number, fx: number, fz: number, half: number, offset = 0, depth = 0.35) {
    const rx = -fz;
    const rz = fx;
    const cx = x + rx * offset;
    const cz = z + rz * offset;
    const lx = cx - rx * half;
    const lz = cz - rz * half;
    const qx = cx + rx * half;
    const qz = cz + rz * half;
    const y1 = this.terrain.height(lx, lz) + 0.05;
    const y2 = this.terrain.height(qx, qz) + 0.05;
    const prev = this.last.get(id);
    this.last.set(id, { lx, lz, rx: qx, rz: qz, y1, y2, x: cx, z: cz });
    if (!prev) return;
    const d = Math.hypot(cx - prev.x, cz - prev.z);
    if (d < 0.6) {
      this.last.set(id, prev);
      return;
    }
    if (d > 6) return;
    const v = this.quad;
    v[0] = prev.lx;
    v[1] = prev.y1;
    v[2] = prev.lz;
    v[3] = prev.rx;
    v[4] = prev.y2;
    v[5] = prev.rz;
    v[6] = lx;
    v[7] = y1;
    v[8] = lz;
    v[9] = qx;
    v[10] = y2;
    v[11] = qz;
    this.put(depth);
  }

  /**
   * One boot print where a foot came down: `len` heel to toe along (fx, fz), `half` its half width,
   * a touch wider at the ball than the heel. Prints share the ribbons' budget and fade the same way.
   */
  print(x: number, z: number, fx: number, fz: number, len = 0.3, half = 0.065, depth = 0.3) {
    const rx = -fz;
    const rz = fx;
    const hx = x - fx * len * 0.35;
    const hz = z - fz * len * 0.35;
    const tx = x + fx * len * 0.65;
    const tz = z + fz * len * 0.65;
    const v = this.quad;
    const y = this.terrain.height(x, z) + 0.05;
    v[0] = hx - rx * half * 0.85;
    v[1] = y;
    v[2] = hz - rz * half * 0.85;
    v[3] = hx + rx * half * 0.85;
    v[4] = y;
    v[5] = hz + rz * half * 0.85;
    v[6] = tx - rx * half;
    v[7] = y;
    v[8] = tz - rz * half;
    v[9] = tx + rx * half;
    v[10] = y;
    v[11] = tz + rz * half;
    this.put(depth);
  }

  private put(depth: number) {
    const i = this.head;
    this.head = (this.head + 1) % this.max;
    this.ages[i] = 0;
    const v = this.quad;
    for (let k = 0; k < 6; k++) {
      const s = ORDER[k] * 3;
      const o = (i * 6 + k) * 3;
      this.pos[o] = v[s];
      this.pos[o + 1] = v[s + 1];
      this.pos[o + 2] = v[s + 2];
      const c = (i * 6 + k) * 4;
      this.col[c] = 0.62;
      this.col[c + 1] = 0.7;
      this.col[c + 2] = 0.82;
      this.col[c + 3] = depth;
    }
  }

  /** Smooth snow again (a new patrol). */
  clear() {
    this.last.clear();
    this.ages.fill(1e9);
    this.pos.fill(0);
    this.col.fill(0);
    (this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.mesh.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }

  /** Stop a ribbon (so the next one does not join it). */
  lift(id: string) {
    this.last.delete(id);
  }

  update(dt: number, snowfall: number) {
    const life = this.life / (1 + snowfall * 4);
    for (let i = 0; i < this.max; i++) {
      if (this.ages[i] > 1e8) continue;
      this.ages[i] += dt;
      const a = this.ages[i] > life ? 0 : 1 - this.ages[i] / life;
      for (let k = 0; k < 6; k++) this.col[(i * 6 + k) * 4 + 3] = Math.min(this.col[(i * 6 + k) * 4 + 3], 0.35 * a + 0.0001);
      if (a <= 0) {
        this.ages[i] = 1e9;
        for (let k = 0; k < 6; k++) this.pos.fill(0, (i * 6 + k) * 3, (i * 6 + k) * 3 + 3);
      }
    }
    (this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.mesh.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }
}
