import {
  AdditiveBlending,
  BackSide,
  DoubleSide,
  MeshBasicMaterial,
  RingGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  Mesh,
  NormalBlending,
  Points,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector3,
  type BufferGeometry as BG,
  type MeshStandardMaterial,
} from 'three';
import type { PieceShape } from '../sim/fracture';
import { pieceGeometry } from './pieceGeometry';
import { createRockMaterial, type RockUniforms } from './materials';
import { mulberry32 } from '../sim/noise';

export interface PieceState {
  id: number;
  shape: PieceShape;
  kind: 'stone' | 'loose' | 'chip';
  pos: [number, number, number];
  quat: [number, number, number, number];
  scale: number;
  /** 0 jagged … 1 polished */
  smooth?: number;
}

/** Renders the boulder, its fragments and loose stones. */
const OUTLINE_VERT = /* glsl */ `
  uniform float uSmooth;
  uniform float uRadius;
  uniform float uWidth;
  void main() {
    vec3 round = normalize(position) * uRadius * vec3(1.08, 0.82, 1.0);
    vec3 p = mix(position, round, uSmooth * 0.8);
    vec3 n = normalize(mix(normal, normalize(position), 0.5 + uSmooth * 0.5));
    p += n * uWidth;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

interface PieceEntry {
  root: Group;
  mesh: Mesh;
  u: RockUniforms & { uWidth: { value: number } };
  squash: number;
  squashT: number;
}

/** Renders the boulder, its fragments and chips: cartoon ink outlines and squash-and-stretch. */
export class PiecesView {
  readonly group = new Group();
  private meshes = new Map<number, PieceEntry>();
  private geoCache = new WeakMap<PieceShape, BG>();

  private geo(shape: PieceShape): BG {
    let g = this.geoCache.get(shape);
    if (!g) {
      g = pieceGeometry(shape);
      this.geoCache.set(shape, g);
    }
    return g;
  }

  /** a cartoon squash on impact (0..1) */
  squash(id: number, amount: number) {
    const e = this.meshes.get(id);
    if (!e) return;
    e.squash = Math.min(0.18, Math.max(e.squash * Math.exp(-e.squashT * 6), amount));
    e.squashT = 0;
  }

  update(dt: number) {
    for (const e of this.meshes.values()) {
      if (e.squash <= 0.001) continue;
      e.squashT += dt;
      const a = e.squash * Math.cos(e.squashT * 26) * Math.exp(-e.squashT * 6);
      e.root.scale.set(1 + a * 0.55, 1 - a, 1 + a * 0.55);
      if (e.squashT > 1) {
        e.squash = 0;
        e.root.scale.set(1, 1, 1);
      }
    }
  }

  sync(states: PieceState[]) {
    const seen = new Set<number>();
    for (const s of states) {
      seen.add(s.id);
      let e = this.meshes.get(s.id);
      if (!e) {
        const u = { uSmooth: { value: 0 }, uRadius: { value: s.shape.radius }, uWidth: { value: 0.05 } };
        const geo = this.geo(s.shape);
        const mesh = new Mesh(geo, createRockMaterial({ uniforms: u }));
        mesh.castShadow = s.kind !== 'chip';
        mesh.receiveShadow = true;
        const outline = new Mesh(
          geo,
          new ShaderMaterial({ uniforms: u, vertexShader: OUTLINE_VERT, fragmentShader: 'void main() { gl_FragColor = vec4(0.16, 0.13, 0.11, 1.0); }', side: BackSide }),
        );
        mesh.add(outline);
        const root = new Group();
        root.add(mesh);
        e = { root, mesh, u, squash: 0, squashT: 0 };
        this.meshes.set(s.id, e);
        this.group.add(root);
      }
      const m = e.mesh;
      e.root.visible = true;
      // cartoon minimum: gravel and sand stay readable on screen (the HUD shows the true size)
      let scale = s.scale;
      let lift = 0;
      const vis = s.shape.radius * scale;
      if (s.kind === 'stone' && vis < 0.035) {
        scale = 0.035 / s.shape.radius;
        lift = (0.035 - vis) * 0.85;
      }
      e.root.position.set(s.pos[0], s.pos[1] + lift, s.pos[2]);
      m.quaternion.set(s.quat[0], s.quat[1], s.quat[2], s.quat[3]);
      m.scale.setScalar(scale);
      e.u.uSmooth.value = s.smooth ?? 0;
      // outline thickness in object space, so it reads the same at any size
      const r = s.shape.radius * scale;
      e.u.uWidth.value = Math.min(0.05, Math.max(0.002, r * 0.03)) / Math.max(0.0001, scale);
    }
    for (const [id, e] of this.meshes) if (!seen.has(id)) e.root.visible = false;
  }

  clear() {
    for (const e of this.meshes.values()) {
      this.group.remove(e.root);
      (e.mesh.material as MeshStandardMaterial).dispose();
      for (const c of e.mesh.children) ((c as Mesh).material as ShaderMaterial).dispose();
    }
    this.meshes.clear();
  }
}

// ---------------------------------------------------------------- particles

const MAX_P = 900;

interface Particle {
  alive: boolean;
  pos: Vector3;
  vel: Vector3;
  life: number;
  maxLife: number;
  size: number;
  grow: number;
  color: Color;
  alpha: number;
  drag: number;
  gravity: number;
}

/** Dust, grit and spray. CPU-simulated, one draw call. */
export class Effects {
  readonly group = new Group();
  private parts: Particle[] = [];
  private geo = new BufferGeometry();
  private pos = new Float32Array(MAX_P * 3);
  private col = new Float32Array(MAX_P * 4);
  private size = new Float32Array(MAX_P);
  private rng = mulberry32(12345);
  private ground: (x: number, z: number) => number;
  private rings: { mesh: Mesh; t: number; life: number; size: number }[] = [];

  /** A shock ring that races out across the ground from a heavy hit. */
  ring(at: Vector3, size: number, color = new Color(1, 0.95, 0.85)) {
    let r = this.rings.find((q) => !q.mesh.visible);
    if (!r) {
      if (this.rings.length >= 8) r = this.rings[0];
      else {
        const mesh = new Mesh(
          new RingGeometry(0.82, 1, 48),
          new MeshBasicMaterial({ color, transparent: true, opacity: 0.6, depthWrite: false, side: DoubleSide, fog: true }),
        );
        mesh.rotation.x = -Math.PI / 2;
        mesh.renderOrder = 6;
        this.group.add(mesh);
        r = { mesh, t: 0, life: 0.6, size };
        this.rings.push(r);
      }
    }
    r.mesh.visible = true;
    r.t = 0;
    r.size = size;
    r.life = 0.45 + size * 0.04;
    (r.mesh.material as MeshBasicMaterial).color.copy(color);
    r.mesh.position.set(at.x, this.ground(at.x, at.z) + 0.15, at.z);
  }

  /** Gravel kicked up behind a stone grinding over rough ground. */
  spray(at: Vector3, vel: Vector3, amount: number, color = new Color(0.62, 0.56, 0.48)) {
    const n = Math.floor(amount * 3 + this.rng());
    for (let i = 0; i < n; i++) {
      const back = vel.clone().multiplyScalar(-0.15);
      this.spawn({
        pos: at.clone().add(new Vector3((this.rng() - 0.5) * 0.8, 0, (this.rng() - 0.5) * 0.8)),
        vel: back.add(new Vector3((this.rng() - 0.5) * 3, 1.5 + this.rng() * 3, (this.rng() - 0.5) * 3)),
        maxLife: 0.5 + this.rng() * 0.4,
        size: 0.08 + this.rng() * 0.1,
        color: color.clone().multiplyScalar(0.8 + this.rng() * 0.4),
        alpha: 0.95,
        drag: 0.6,
        gravity: 9.8,
      });
    }
  }

  constructor(ground: (x: number, z: number) => number) {
    this.ground = ground;
    for (let i = 0; i < MAX_P; i++)
      this.parts.push({
        alive: false,
        pos: new Vector3(),
        vel: new Vector3(),
        life: 0,
        maxLife: 1,
        size: 1,
        grow: 0,
        color: new Color(),
        alpha: 1,
        drag: 1,
        gravity: 0,
      });
    this.geo.setAttribute('position', new BufferAttribute(this.pos, 3).setUsage(DynamicDrawUsage));
    this.geo.setAttribute('aColor', new BufferAttribute(this.col, 4).setUsage(DynamicDrawUsage));
    this.geo.setAttribute('aSize', new BufferAttribute(this.size, 1).setUsage(DynamicDrawUsage));
    const mat = new ShaderMaterial({
      uniforms: UniformsUtils.merge([UniformsLib.fog, { uScale: { value: 300 } }]),
      vertexShader: /* glsl */ `
        attribute vec4 aColor; attribute float aSize; uniform float uScale;
        varying vec4 vColor;
        #include <fog_pars_vertex>
        void main() {
          vColor = aColor;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = min(220.0, aSize * uScale / max(1.0, -mvPosition.z));
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec4 vColor;
        #include <fog_pars_fragment>
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r = length(d);
          if (r > 0.5) discard;
          float a = smoothstep(0.5, 0.0, r);
          gl_FragColor = vec4(vColor.rgb, vColor.a * a);
          #include <fog_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
      fog: true,
    });
    const pts = new Points(this.geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 5;
    this.group.add(pts);
    void AdditiveBlending;
  }

  setViewportHeight(px: number) {
    ((this.group.children[0] as Points).material as ShaderMaterial).uniforms.uScale.value = px * 0.5;
  }

  private spawn(p: Partial<Particle> & { pos: Vector3; vel: Vector3 }) {
    const slot = this.parts.find((q) => !q.alive);
    if (!slot) return;
    slot.alive = true;
    slot.pos.copy(p.pos);
    slot.vel.copy(p.vel);
    slot.life = 0;
    slot.maxLife = p.maxLife ?? 1.5;
    slot.size = p.size ?? 1;
    slot.grow = p.grow ?? 0;
    slot.color.copy(p.color ?? new Color(0.7, 0.65, 0.58));
    slot.alpha = p.alpha ?? 0.6;
    slot.drag = p.drag ?? 1.5;
    slot.gravity = p.gravity ?? 0;
  }

  /** A billow of rock dust (impacts, fractures). */
  dust(at: Vector3, strength: number, tint = new Color(0.97, 0.92, 0.82)) {
    const n = Math.round(6 + strength * 30);
    for (let i = 0; i < n; i++) {
      const a = this.rng() * Math.PI * 2;
      const sp = (0.6 + this.rng() * 2.2) * (0.5 + strength);
      this.spawn({
        pos: at.clone().add(new Vector3((this.rng() - 0.5) * 1.2, this.rng() * 0.6, (this.rng() - 0.5) * 1.2)),
        vel: new Vector3(Math.cos(a) * sp, 0.4 + this.rng() * 1.6 * (0.5 + strength), Math.sin(a) * sp),
        maxLife: 1.6 + this.rng() * 1.6,
        size: 1.1 + this.rng() * 1.4 + strength,
        grow: 1.6,
        color: tint.clone().multiplyScalar(0.85 + this.rng() * 0.3),
        alpha: 0.22 + strength * 0.18,
        drag: 1.8,
        gravity: -0.15,
      });
    }
  }

  /** Grit and chips thrown out of a break. */
  grit(at: Vector3, strength: number) {
    const n = Math.round(8 + strength * 26);
    for (let i = 0; i < n; i++) {
      const dir = new Vector3(this.rng() - 0.5, this.rng() * 0.9 + 0.2, this.rng() - 0.5).normalize();
      this.spawn({
        pos: at.clone(),
        vel: dir.multiplyScalar(3 + this.rng() * 7 * (0.4 + strength)),
        maxLife: 1.2 + this.rng() * 0.8,
        size: 0.12 + this.rng() * 0.16,
        color: new Color(0.62, 0.58, 0.55).multiplyScalar(0.7 + this.rng() * 0.5),
        alpha: 1,
        drag: 0.15,
        gravity: 9.8,
      });
    }
  }

  splash(at: Vector3, strength: number) {
    const n = Math.round(10 + strength * 50);
    for (let i = 0; i < n; i++) {
      const a = this.rng() * Math.PI * 2;
      const sp = 1 + this.rng() * 4 * (0.4 + strength);
      this.spawn({
        pos: at.clone().add(new Vector3(0, 0.2, 0)),
        vel: new Vector3(Math.cos(a) * sp, 2 + this.rng() * 6 * (0.3 + strength), Math.sin(a) * sp),
        maxLife: 0.8 + this.rng() * 0.6,
        size: 0.25 + this.rng() * 0.4,
        color: new Color(0.9, 0.95, 0.97),
        alpha: 0.85,
        drag: 0.4,
        gravity: 9.8,
      });
    }
    this.dust(at.clone().add(new Vector3(0, 0.3, 0)), strength * 0.4, new Color(0.92, 0.95, 0.97));
  }

  /** Loosened earth (digging, slumping). */
  earth(at: Vector3, strength: number) {
    this.dust(at, strength * 0.6, new Color(0.45, 0.35, 0.25));
    for (let i = 0; i < 30 * strength + 8; i++) {
      const dir = new Vector3(this.rng() - 0.5, this.rng() * 0.8 + 0.3, this.rng() - 0.5).normalize();
      this.spawn({
        pos: at.clone().add(new Vector3((this.rng() - 0.5) * 2, 0.3, (this.rng() - 0.5) * 2)),
        vel: dir.multiplyScalar(2 + this.rng() * 4),
        maxLife: 1,
        size: 0.18 + this.rng() * 0.2,
        color: new Color(0.35, 0.26, 0.18),
        alpha: 1,
        drag: 0.2,
        gravity: 9.8,
      });
    }
  }

  /** Shattered ice / snapped twigs. */
  shards(at: Vector3, color: Color, count = 30) {
    for (let i = 0; i < count; i++) {
      const dir = new Vector3(this.rng() - 0.5, this.rng() * 0.9 + 0.2, this.rng() - 0.5).normalize();
      this.spawn({
        pos: at.clone().add(new Vector3((this.rng() - 0.5) * 2.5, 0.1, (this.rng() - 0.5) * 2.5)),
        vel: dir.multiplyScalar(2 + this.rng() * 4),
        maxLife: 0.9 + this.rng() * 0.6,
        size: 0.15 + this.rng() * 0.2,
        color: color.clone(),
        alpha: 0.95,
        drag: 0.3,
        gravity: 9.8,
      });
    }
  }

  clear() {
    for (const p of this.parts) p.alive = false;
    for (const r of this.rings) r.mesh.visible = false;
  }

  update(dt: number) {
    for (const r of this.rings) {
      if (!r.mesh.visible) continue;
      r.t += dt;
      const k = r.t / r.life;
      if (k >= 1) {
        r.mesh.visible = false;
        continue;
      }
      const e = 1 - Math.pow(1 - k, 3);
      r.mesh.scale.setScalar(0.5 + e * r.size);
      (r.mesh.material as MeshBasicMaterial).opacity = 0.55 * (1 - k);
    }
    let n = 0;
    for (const p of this.parts) {
      if (!p.alive) continue;
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.alive = false;
        continue;
      }
      p.vel.multiplyScalar(Math.exp(-p.drag * dt));
      p.vel.y -= p.gravity * dt;
      p.pos.addScaledVector(p.vel, dt);
      const g = this.ground(p.pos.x, p.pos.z);
      if (p.pos.y < g + 0.05) {
        p.pos.y = g + 0.05;
        p.vel.y = Math.abs(p.vel.y) * 0.2;
        p.vel.x *= 0.5;
        p.vel.z *= 0.5;
      }
      const t = p.life / p.maxLife;
      this.pos[n * 3] = p.pos.x;
      this.pos[n * 3 + 1] = p.pos.y;
      this.pos[n * 3 + 2] = p.pos.z;
      this.col[n * 4] = p.color.r;
      this.col[n * 4 + 1] = p.color.g;
      this.col[n * 4 + 2] = p.color.b;
      this.col[n * 4 + 3] = p.alpha * (1 - t) * Math.min(1, p.life * 8);
      this.size[n] = p.size * (1 + p.grow * t);
      n++;
    }
    this.geo.setDrawRange(0, n);
    (this.geo.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aColor') as BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aSize') as BufferAttribute).needsUpdate = true;
  }
}

// ---------------------------------------------------------------- trails

const trailMat = (color: Color, dashed: boolean, opacity: number) =>
  new ShaderMaterial({
    uniforms: UniformsUtils.merge([
      UniformsLib.fog,
      { uColor: { value: color }, uOpacity: { value: opacity }, uDash: { value: dashed ? 1 : 0 }, uReveal: { value: 1 } },
    ]),
    vertexShader: /* glsl */ `
      attribute float aT; varying float vT; varying float vS; attribute float aS;
      #include <fog_pars_vertex>
      void main() { vT = aT; vS = aS; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uOpacity; uniform float uDash; uniform float uReveal;
      varying float vT; varying float vS;
      #include <fog_pars_fragment>
      void main() {
        if (vT > uReveal) discard;
        float a = uOpacity;
        if (uDash > 0.5 && fract(vS * 0.35) > 0.55) discard;
        gl_FragColor = vec4(uColor, a);
        #include <fog_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    fog: true,
  });

/** Flat ribbon trails drawn over the ground: the path of the stone. */
export class Trails {
  readonly group = new Group();
  private ground: (x: number, z: number) => number;
  constructor(ground: (x: number, z: number) => number) {
    this.ground = ground;
  }

  clear() {
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      (c as Mesh).geometry.dispose();
    }
  }

  add(points: [number, number, number][], color: Color, width: number, opts: { dashed?: boolean; opacity?: number } = {}): Mesh | null {
    if (points.length < 2) return null;
    // resample to ~0.6 m spacing for a smooth ribbon
    const pts: Vector3[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = new Vector3(...points[i]),
        b = new Vector3(...points[i + 1]);
      const n = Math.max(1, Math.ceil(a.distanceTo(b) / 0.6));
      for (let k = 0; k < n; k++) pts.push(a.clone().lerp(b, k / n));
    }
    pts.push(new Vector3(...points[points.length - 1]));
    const pos: number[] = [];
    const t: number[] = [];
    const s: number[] = [];
    let acc = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[Math.min(pts.length - 1, i + 1)];
      const r = pts[Math.max(0, i - 1)];
      const dx = q.x - r.x,
        dz = q.z - r.z;
      const l = Math.hypot(dx, dz) || 1;
      const nx = -dz / l,
        nz = dx / l;
      if (i > 0) acc += p.distanceTo(pts[i - 1]);
      for (const side of [-1, 1]) {
        const x = p.x + nx * width * 0.5 * side,
          z = p.z + nz * width * 0.5 * side;
        // drape: stay above the ground but follow airborne arcs too
        const y = Math.max(this.ground(x, z) + 0.12, Math.min(p.y, this.ground(x, z) + 6));
        pos.push(x, y, z);
        t.push(i / (pts.length - 1));
        s.push(acc);
      }
    }
    const idx: number[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('aT', new BufferAttribute(new Float32Array(t), 1));
    g.setAttribute('aS', new BufferAttribute(new Float32Array(s), 1));
    g.setIndex(idx);
    const m = new Mesh(g, trailMat(color, !!opts.dashed, opts.opacity ?? 0.85));
    m.renderOrder = 6;
    m.frustumCulled = false;
    this.group.add(m);
    return m;
  }
}
