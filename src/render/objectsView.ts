import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  DoubleSide,
  Euler,
  IcosahedronGeometry,
} from 'three';
import type { LevelDef, LevelObject, Plan } from '../levels/types';
import type { LevelData } from '../sim/levelData';
import {
  formationShape,
  iceSheet,
  lyingTrunk,
  rockShape,
  soilShape,
  treeFallen,
  type Q4,
} from '../sim/objects';
import { generateBlock, fracturePiece } from '../sim/fracture';
import { defaultState } from '../sim/plan';
import { mulberry32 } from '../sim/noise';
import { pieceGeometry } from './pieceGeometry';
import {
  createBarkMaterial,
  createEndGrainMaterial,
  createFoliageMaterial,
  createIceMaterial,
  createOutlineMaterial,
  createRockMaterial,
  createSoilMaterial,
} from './materials';
import { coniferGeometry } from './vegetation';

const UP = new Vector3(0, 1, 0);
const q4 = (q: Q4) => new Quaternion(q[0], q[1], q[2], q[3]);
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

interface Ctl {
  def: LevelObject;
  root: Group;
  /** meshes that get an outline */
  outlined: Mesh[];
  outlines: Mesh[];
  outlineMat: ShaderMaterial;
  proxy: Mesh;
  ring: Mesh;
  ringMat: MeshBasicMaterial;
  /** animation state */
  anim: number; // 0..1 progress of the current transition
  from: unknown;
  to: unknown;
  apply(state: unknown, t: number): void;
  current: unknown;
  /** anchor for UI (world position of the object's centre) */
  anchor: Vector3;
  /** visible in the current mode? (rocks are hidden while the simulation renders them) */
  hiddenBySim?: boolean;
  slumped?: boolean;
}

export class ObjectsView {
  readonly group = new Group();
  private ctls = new Map<string, Ctl>();
  private data: LevelData;
  private level: LevelDef;
  private hover: string | null = null;
  private selected: string | null = null;
  private planning = true;
  private time = 0;
  private mats = {
    rock: createRockMaterial(),
    breaker: createRockMaterial({ tint: new Color(0.95, 0.62, 0.48), scale: 1.4 }),
    bark: createBarkMaterial(),
    deadBark: createBarkMaterial(new Color(0.42, 0.36, 0.3)),
    end: createEndGrainMaterial(),
    foliage: createFoliageMaterial(),
    soil: createSoilMaterial(),
    ice: createIceMaterial(),
    needles: new MeshStandardMaterial({ color: new Color(0.3, 0.3, 0.16), roughness: 1, flatShading: true }),
    wood: new MeshStandardMaterial({ color: new Color(0.45, 0.33, 0.22), roughness: 0.9 }),
    pool: new MeshStandardMaterial({ color: new Color(0.16, 0.3, 0.32), roughness: 0.15, metalness: 0.1 }),
  };
  /** callbacks for effects (dust, sound) when objects change */
  onChange: ((id: string, kind: string, pos: Vector3) => void) | null = null;

  constructor(data: LevelData) {
    this.data = data;
    this.level = data.level;
    for (const o of this.level.objects) this.ctls.set(o.id, this.build(o));
    for (const f of this.level.formations) {
      const shape = formationShape(f);
      const mesh = new Mesh(pieceGeometry(shape), this.mats.rock);
      const h = data.heightAt(f.position[0], f.position[1]);
      mesh.position.set(f.position[0], h + f.size[1] * 0.5 - (f.sink ?? 0.5), f.position[1]);
      mesh.quaternion.setFromAxisAngle(UP, -f.yaw);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.name = `formation:${f.id}`;
      this.group.add(mesh);
    }
  }

  private h(x: number, z: number) {
    return this.data.heightAt(x, z);
  }

  private ringFor(x: number, z: number, r: number): { ring: Mesh; mat: MeshBasicMaterial } {
    const seg = 48;
    const pos: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      for (const rr of [r, r + 0.35]) {
        const px = x + Math.cos(a) * rr,
          pz = z + Math.sin(a) * rr;
        pos.push(px, this.h(px, pz) + 0.12, pz);
      }
      if (i < seg) {
        const k = i * 2;
        idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    g.setIndex(idx);
    const mat = new MeshBasicMaterial({ color: 0xfff4dc, transparent: true, opacity: 0, depthWrite: false, side: DoubleSide, fog: false });
    const ring = new Mesh(g, mat);
    ring.renderOrder = 3;
    return { ring, mat };
  }

  private proxyMesh(radius: number): Mesh {
    const m = new Mesh(new SphereGeometry(radius, 10, 8), new MeshBasicMaterial({ visible: false }));
    return m;
  }

  private build(o: LevelObject): Ctl {
    const root = new Group();
    root.name = `object:${o.id}`;
    this.group.add(root);
    const outlineMat = createOutlineMaterial(new Color(1, 0.95, 0.82), 0.06);
    const outlined: Mesh[] = [];
    const st = defaultState(o);
    let anchor = new Vector3();
    let proxyR = 2;
    let apply: Ctl['apply'] = () => {};
    let ringXZ: [number, number] = [0, 0];
    let ringR = 2;

    switch (o.type) {
      case 'rock': {
        const mesh = new Mesh(pieceGeometry(rockShape(o.id, o.radius, o.seed)), this.mats.rock);
        mesh.castShadow = mesh.receiveShadow = true;
        root.add(mesh);
        outlined.push(mesh);
        proxyR = Math.max(1.4, o.radius * 2.2);
        ringXZ = [o.position[0], o.position[1]];
        ringR = o.radius + 0.6;
        apply = (s: any, t: number) => {
          const y = this.h(s.x, s.z) + o.radius * 0.6;
          mesh.position.set(s.x, y + (s.removed ? t * 3 : 0), s.z);
          mesh.quaternion.setFromAxisAngle(UP, -o.seed);
          const k = s.removed ? 1 - t : 1;
          mesh.scale.setScalar(Math.max(0.001, k));
          mesh.visible = k > 0.01;
          anchor.set(s.x, y, s.z);
        };
        break;
      }
      case 'log': {
        const g = new Group();
        const trunk = new Mesh(new CylinderGeometry(o.radius * 0.94, o.radius, o.length, 16, 6), this.mats.bark);
        // knobbly: displace a little
        const p = trunk.geometry.getAttribute('position');
        const rng = mulberry32(o.seed);
        for (let i = 0; i < p.count; i++) {
          const k = 1 + (Math.sin(p.getY(i) * 2.1 + o.seed) * 0.04 + (rng() - 0.5) * 0.05);
          p.setX(i, p.getX(i) * k);
          p.setZ(i, p.getZ(i) * k);
        }
        trunk.geometry.computeVertexNormals();
        trunk.castShadow = trunk.receiveShadow = true;
        g.add(trunk);
        for (const sgn of [-1, 1]) {
          const cap = new Mesh(new CircleGeometry(o.radius * 0.93, 16), this.mats.end);
          cap.rotation.x = sgn > 0 ? -Math.PI / 2 : Math.PI / 2;
          cap.position.y = (sgn * o.length) / 2;
          g.add(cap);
        }
        // a few broken branch stubs
        for (let i = 0; i < 5; i++) {
          const stub = new Mesh(new CylinderGeometry(0.04, 0.09, 0.7 + rng() * 0.6, 5), this.mats.deadBark);
          const a = rng() * Math.PI * 2;
          const y = (rng() - 0.5) * o.length * 0.8;
          stub.position.set(Math.cos(a) * o.radius, y, Math.sin(a) * o.radius);
          stub.quaternion.setFromUnitVectors(UP, new Vector3(Math.cos(a), 0.4, Math.sin(a)).normalize());
          stub.translateY(0.3);
          stub.castShadow = true;
          g.add(stub);
        }
        root.add(g);
        outlined.push(trunk);
        proxyR = o.length * 0.5;
        ringXZ = [o.position[0], o.position[1]];
        ringR = o.length * 0.5 + 0.4;
        const tmpA = new Quaternion();
        const tmpB = new Quaternion();
        apply = (s: any, t: number, from?: any) => {
          const target = lyingTrunk((x, z) => this.h(x, z), s.x, s.z, s.yaw, o.length, o.radius);
          if (from && t < 1) {
            const src = lyingTrunk((x, z) => this.h(x, z), from.x, from.z, from.yaw, o.length, o.radius);
            const e = ease(t);
            g.position.set(
              src.pos[0] + (target.pos[0] - src.pos[0]) * e,
              src.pos[1] + (target.pos[1] - src.pos[1]) * e + Math.sin(e * Math.PI) * 0.8,
              src.pos[2] + (target.pos[2] - src.pos[2]) * e,
            );
            tmpA.copy(q4(src.quat));
            tmpB.copy(q4(target.quat));
            if (tmpA.dot(tmpB) < 0) tmpB.set(-tmpB.x, -tmpB.y, -tmpB.z, -tmpB.w);
            g.quaternion.slerpQuaternions(tmpA, tmpB, e);
          } else {
            g.position.set(...target.pos);
            g.quaternion.copy(q4(target.quat));
          }
          anchor.copy(g.position);
        };
        break;
      }
      case 'branches': {
        const g = new Group();
        const rng = mulberry32(o.seed + 1);
        const baseY = this.h(o.position[0], o.position[1]);
        const bh = o.height ?? 2.2;
        const cy = Math.cos(o.yaw),
          sy = Math.sin(o.yaw);
        const place = (along: number, across: number, up: number) => {
          const x = o.position[0] + along * cy - across * sy;
          const z = o.position[1] + along * sy + across * cy;
          return new Vector3(x, Math.max(this.h(x, z), baseY - 1) + up, z);
        };
        const addStick = (len: number, rad: number, at: Vector3, yaw: number, pitch: number, mat: MeshStandardMaterial, caps: boolean) => {
          const m = new Mesh(new CylinderGeometry(rad * 0.85, rad, len, caps ? 12 : 6), mat);
          m.position.copy(at);
          m.quaternion.setFromUnitVectors(UP, new Vector3(Math.cos(yaw), Math.sin(pitch), Math.sin(yaw)).normalize());
          m.castShadow = true;
          m.receiveShadow = true;
          g.add(m);
          outlined.push(m);
          if (caps)
            for (const sg of [-1, 1]) {
              const cap = new Mesh(new CircleGeometry(rad * 0.84, 12), this.mats.end);
              cap.rotation.x = sg > 0 ? -Math.PI / 2 : Math.PI / 2;
              cap.position.y = (sg * len) / 2;
              m.add(cap);
            }
        };
        const style = o.style ?? 'deadfall';
        if (style === 'logjam') {
          // storm-felled trunks: short logs that rest on the ground beneath them, stacked in a pile
          const layers = Math.max(3, Math.round(bh / 1.15));
          for (let l = 0; l < layers; l++) {
            const n = Math.max(2, 6 - l);
            for (let k = 0; k < n; k++) {
              const rad = 0.38 + rng() * 0.24;
              const len = o.span * (0.26 + rng() * 0.18);
              const along = ((k + 0.5) / n - 0.5) * o.span * Math.max(0.25, 0.8 - l * 0.16) + (rng() - 0.5) * 1.0;
              const across = (rng() - 0.5) * 1.4;
              const yaw = o.yaw + (rng() - 0.5) * 0.5;
              // rest on the highest ground under the log
              const c0 = place(along, across, 0);
              let ground = 0;
              for (let t = -2; t <= 2; t++) {
                const gx = c0.x + Math.cos(yaw) * len * 0.25 * t,
                  gz = c0.z + Math.sin(yaw) * len * 0.25 * t;
                ground += this.h(gx, gz) / 5;
              }
              // tilt the log to follow the ground under it
              const e1 = this.h(c0.x - Math.cos(yaw) * len * 0.5, c0.z - Math.sin(yaw) * len * 0.5);
              const e2 = this.h(c0.x + Math.cos(yaw) * len * 0.5, c0.z + Math.sin(yaw) * len * 0.5);
              const pitch = Math.atan2(e2 - e1, len);
              const at = new Vector3(c0.x, ground + rad * 0.7 + l * rad * 1.65, c0.z);
              addStick(len, rad, at, yaw, pitch + (rng() - 0.5) * 0.06, this.mats.bark, true);
            }
          }
          for (let k = 0; k < 10; k++)
            addStick(1.5 + rng() * 2.5, 0.06 + rng() * 0.08, place((rng() - 0.5) * o.span * 0.8, (rng() - 0.5) * 2.5, rng() * bh * 0.8), rng() * 6.28, (rng() - 0.5) * 1.2, this.mats.deadBark, false);
        } else if (style === 'beaver') {
          const mud = new Mesh(new SphereGeometry(1, 18, 10), this.mats.soil);
          mud.scale.set(o.span * 0.5, bh * 0.75, 1.8);
          mud.position.copy(place(0, 0, -0.2));
          mud.rotation.y = -o.yaw;
          mud.castShadow = mud.receiveShadow = true;
          g.add(mud);
          outlined.push(mud);
          for (let k = 0; k < 55; k++) {
            const a = (rng() - 0.5) * o.span * 0.95;
            const hh = bh * (1 - Math.pow(Math.abs(a) / (o.span * 0.5), 2)) * (0.5 + rng() * 0.6);
            addStick(1.2 + rng() * 2.8, 0.05 + rng() * 0.08, place(a, (rng() - 0.5) * 2.2, hh), o.yaw + (rng() - 0.5) * 2.4, (rng() - 0.5) * 1.3, this.mats.deadBark, false);
          }
        } else {
          // tangles of branches (and, for river debris, a few trunks) with dead needles
          const logs = style === 'debris' ? 5 : 0;
          for (let k = 0; k < logs; k++)
            addStick(o.span * (0.35 + rng() * 0.35), 0.3 + rng() * 0.2, place((rng() - 0.5) * o.span * 0.5, (rng() - 0.5) * 1.5, 0.3 + rng() * bh * 0.6), o.yaw + (rng() - 0.5) * 0.6, (rng() - 0.5) * 0.3, this.mats.bark, true);
          const n = style === 'debris' ? 40 : 16;
          for (let k = 0; k < n; k++) {
            addStick(o.span * (0.12 + rng() * 0.3), 0.05 + rng() * 0.1, place((rng() - 0.5) * o.span * 0.9, (rng() - 0.5) * 1.6, 0.2 + rng() * bh), o.yaw + (rng() - 0.5) * 1.4, (rng() - 0.5) * 0.9, this.mats.deadBark, false);
            if (rng() < 0.5) {
              const tuft = new Mesh(new IcosahedronGeometry(0.22 + rng() * 0.3, 0), this.mats.needles);
              tuft.position.copy(place((rng() - 0.5) * o.span * 0.85, (rng() - 0.5) * 1.6, rng() * bh));
              tuft.scale.set(1.6, 0.45, 1.1);
              tuft.rotation.set(rng() * 3, rng() * 3, rng() * 3);
              tuft.castShadow = true;
              g.add(tuft);
            }
          }
        }
        root.add(g);
        anchor = new Vector3(o.position[0], baseY + bh * 0.6, o.position[1]);
        proxyR = Math.max(3, o.span * 0.5);
        ringXZ = [o.position[0], o.position[1]];
        ringR = o.span * 0.5 + 0.3;
        const base = g.children.map((c) => ({ p: c.position.clone(), v: new Vector3((rng() - 0.5) * 10, 6 + rng() * 8, (rng() - 0.5) * 10) }));
        apply = (st: any, t: number) => {
          const k = st.removed ? t : 0;
          g.children.forEach((c, i) => {
            const b = base[i];
            c.position.copy(b.p).addScaledVector(b.v, k * 0.6).add(new Vector3(0, -9.8 * k * k * 0.3, 0));
            c.scale.setScalar(Math.max(0.001, 1 - k * k));
          });
          g.visible = !(st.removed && t >= 1);
        };
        break;
      }
      case 'tree': {
        const v = coniferGeometry(o.seed, 7, 0.95);
        const pivot = new Group();
        const s = o.height;
        const trunk = new Mesh(v.trunk.clone(), this.mats.bark);
        // thicker trunk for a landmark tree
        trunk.geometry.scale(1.6, 2.2, 1.6);
        trunk.scale.setScalar(s);
        const crown = new Mesh(v.crown, this.mats.foliage);
        crown.scale.setScalar(s);
        trunk.castShadow = crown.castShadow = true;
        trunk.receiveShadow = crown.receiveShadow = true;
        pivot.add(trunk, crown);
        const baseY = this.h(o.position[0], o.position[1]) - 0.2;
        pivot.position.set(o.position[0], baseY, o.position[1]);
        const stump = new Mesh(new CylinderGeometry(o.radius * 1.1, o.radius * 1.3, 0.7, 10), this.mats.bark);
        stump.position.set(o.position[0], baseY + 0.35, o.position[1]);
        const stumpTop = new Mesh(new CircleGeometry(o.radius * 1.08, 10), this.mats.end);
        stumpTop.rotation.x = -Math.PI / 2;
        stumpTop.position.set(o.position[0], baseY + 0.71, o.position[1]);
        root.add(pivot, stump, stumpTop);
        outlined.push(crown, trunk);
        proxyR = 3.5;
        ringXZ = [o.position[0], o.position[1]];
        ringR = 2.4;
        const qa = new Quaternion();
        apply = (st: any, t: number, from?: any) => {
          const felled = st.felled as string | null;
          const prev = (from?.felled ?? null) as string | null;
          stump.visible = stumpTop.visible = !!felled || (!!prev && t < 1);
          const which = felled ?? prev;
          if (!which) {
            pivot.quaternion.identity();
            anchor.set(o.position[0], baseY + s * 0.4, o.position[1]);
            pivot.visible = true;
            return;
          }
          const opt = o.fellOptions.find((f) => f.id === which) ?? o.fellOptions[0];
          const fallen = treeFallen((x, z) => this.h(x, z), o.position, opt.yaw, o.height, o.radius);
          const dir = new Vector3(...fallen.dir);
          qa.setFromUnitVectors(UP, dir);
          // fall accelerates like a toppling body, then settles with a small bounce
          let k = felled ? t : 1 - t;
          if (felled) k = t < 0.85 ? Math.pow(t / 0.85, 2.2) : 1 - Math.sin(((t - 0.85) / 0.15) * Math.PI) * 0.03;
          pivot.quaternion.identity().slerp(qa, Math.min(1, Math.max(0, k)));
          pivot.position.set(o.position[0], baseY + 0.55 * k, o.position[1]);
          anchor.set(fallen.trunk.pos[0], fallen.trunk.pos[1] + 1, fallen.trunk.pos[2]);
        };
        break;
      }
      case 'soil': {
        const shape = soilShape(o.id, o.radius[0], o.radius[1], o.height, o.seed);
        const geo = pieceGeometry(shape);
        const mesh = new Mesh(geo, this.mats.soil);
        mesh.castShadow = mesh.receiveShadow = true;
        const y = this.h(o.position[0], o.position[1]) - 0.15;
        mesh.position.set(o.position[0], y, o.position[1]);
        mesh.quaternion.setFromAxisAngle(UP, -o.yaw);
        // a few roots and stones poking out
        const rng = mulberry32(o.seed);
        for (let i = 0; i < 6; i++) {
          const st = new Mesh(pieceGeometry(rockShape(`soil-stone-${o.id}-${i}`, 0.25 + rng() * 0.25, o.seed + i)), this.mats.rock);
          const a = rng() * Math.PI * 2;
          st.position.set(Math.cos(a) * o.radius[0] * 0.6, o.height * 0.35 * rng(), Math.sin(a) * o.radius[1] * 0.6);
          mesh.add(st);
        }
        const patch = new Mesh(new CircleGeometry(1, 24), new MeshStandardMaterial({ color: new Color(0.3, 0.22, 0.15), roughness: 1, transparent: true, opacity: 0.85, depthWrite: false }));
        patch.rotation.x = -Math.PI / 2;
        patch.scale.set(o.radius[0], o.radius[1], 1);
        patch.position.set(o.position[0], y + 0.25, o.position[1]);
        patch.rotation.z = o.yaw;
        root.add(mesh, patch);
        outlined.push(mesh);
        anchor = new Vector3(o.position[0], y + o.height * 0.6, o.position[1]);
        proxyR = Math.max(o.radius[0], o.radius[1]);
        ringXZ = [o.position[0], o.position[1]];
        ringR = Math.max(o.radius[0], o.radius[1]) + 0.4;
        apply = (s: any, t: number) => {
          const gone = s.dug || this.ctls.get(o.id)?.slumped;
          const k = gone ? ease(t) : 0;
          mesh.position.y = y - o.height * 0.95 * k;
          mesh.scale.set(1 + k * 0.25, 1 - k * 0.8, 1 + k * 0.25);
          mesh.visible = k < 0.999;
          patch.visible = k > 0.05;
        };
        break;
      }
      case 'outcrop': {
        const shape = generateBlock(o.size, o.seed, 0.3);
        // show the crack: split the block in two along a fixed plane
        const halves = fracturePiece(shape, [1, 0.2, 0.1], 2, o.seed, 0.01).cells;
        const g = new Group();
        for (const c of halves) {
          const m = new Mesh(pieceGeometry(c.shape), this.mats.rock);
          m.position.set(c.offset[0] * 1.015, c.offset[1], c.offset[2] * 1.015);
          m.castShadow = m.receiveShadow = true;
          g.add(m);
          outlined.push(m);
        }
        root.add(g);
        proxyR = Math.max(...o.size) * 0.7;
        ringXZ = [o.position[0], o.position[1]];
        ringR = Math.max(o.size[0], o.size[2]) * 0.6 + 0.5;
        const yaw0 = new Quaternion().setFromAxisAngle(UP, -o.yaw);
        const fallenQ = o.hardness
          ? new Quaternion().setFromAxisAngle(UP, -(o.yaw + 0.5))
          : new Quaternion().setFromEuler(new Euler(0, -(o.yaw + 0.9), Math.PI / 2, 'YXZ'));
        if (o.hardness) for (const m of g.children) (m as Mesh).material = this.mats.breaker;
        apply = (s: any, t: number) => {
          const y0 = this.h(o.position[0], o.position[1]) + o.size[1] * 0.5 - 0.7;
          const [sx, sz] = o.splitTo;
          const y1 = o.hardness ? this.h(sx, sz) + o.size[1] * 0.5 - 0.7 : this.h(sx, sz) + o.size[0] * 0.5 - 0.35;
          const k = s.split ? ease(t) : 0;
          g.position.set(
            o.position[0] + (sx - o.position[0]) * k,
            y0 + (y1 - y0) * k + Math.sin(k * Math.PI) * (o.hardness ? 6 : 1.5),
            o.position[1] + (sz - o.position[1]) * k,
          );
          g.quaternion.slerpQuaternions(yaw0, fallenQ, k);
          anchor.copy(g.position);
        };
        break;
      }
      case 'ice': {
        const sheet = iceSheet((x, z) => this.h(x, z), o.center, o.size, o.yaw, 0.09);
        const geo = new BufferGeometry();
        geo.setAttribute('position', new BufferAttribute(sheet.vertices, 3));
        geo.setIndex(new BufferAttribute(sheet.indices, 1));
        geo.computeVertexNormals();
        const mesh = new Mesh(geo, this.mats.ice);
        mesh.receiveShadow = true;
        mesh.renderOrder = 1;
        root.add(mesh);
        outlined.push(mesh);
        anchor = new Vector3(o.center[0], this.h(o.center[0], o.center[1]) + 0.3, o.center[1]);
        proxyR = Math.max(o.size[0], o.size[1]) * 0.5;
        ringXZ = o.center;
        ringR = Math.max(o.size[0], o.size[1]) * 0.5 + 0.3;
        apply = (s: any, t: number) => {
          const k = s.broken ? t : 0;
          (mesh.material as MeshStandardMaterial).opacity = 0.78 * (1 - k);
          mesh.visible = k < 0.999;
        };
        // each ice object gets its own material so it can fade independently
        mesh.material = this.mats.ice.clone();
        mesh.material.onBeforeCompile = this.mats.ice.onBeforeCompile;
        mesh.material.customProgramCacheKey = this.mats.ice.customProgramCacheKey;
        break;
      }
      case 'gate': {
        const x = o.position[0],
          z = o.position[1];
        const y = this.h(x, z);
        const pool = new Mesh(new CircleGeometry(1.3, 20), this.mats.pool);
        pool.rotation.x = -Math.PI / 2;
        pool.position.set(x, y + 0.12, z);
        const stones = new Group();
        const rng = mulberry32(99);
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * Math.PI * 2;
          const st = new Mesh(pieceGeometry(rockShape(`gate-stone-${i}`, 0.28 + rng() * 0.15, 300 + i)), this.mats.rock);
          st.position.set(x + Math.cos(a) * 1.45, y + 0.1, z + Math.sin(a) * 1.45);
          st.castShadow = true;
          stones.add(st);
        }
        const board = new Mesh(new BoxGeometry(2.2, 0.55, 0.12), this.mats.wood);
        board.castShadow = true;
        const post1 = new Mesh(new CylinderGeometry(0.08, 0.1, 1.1, 6), this.mats.wood);
        const post2 = post1.clone();
        root.add(pool, stones, board, post1, post2);
        outlined.push(board);
        anchor = new Vector3(x, y + 0.6, z);
        proxyR = 2.2;
        ringXZ = [x, z];
        ringR = 2.1;
        const yawFor = (opt: string) => (opt === 'left' ? 0.55 : -0.55);
        apply = (s: any, t: number, from?: any) => {
          const a0 = yawFor(from?.option ?? s.option);
          const a1 = yawFor(s.option);
          const a = a0 + (a1 - a0) * ease(t);
          // the board blocks one outlet, sending water to the other side
          const bx = x + Math.cos(a) * 0.2,
            bz = z + 0.9;
          board.position.set(bx, y + 0.3, bz);
          board.rotation.set(0, a, 0);
          post1.position.set(bx - Math.cos(a) * 1.05, y + 0.45, bz + Math.sin(a) * 1.05);
          post2.position.set(bx + Math.cos(a) * 1.05, y + 0.45, bz - Math.sin(a) * 1.05);
        };
        break;
      }
    }

    const { ring, mat: ringMat } = this.ringFor(ringXZ[0], ringXZ[1], ringR);
    this.group.add(ring);
    const outlines = outlined.map((m) => {
      const ol = new Mesh(m.geometry, outlineMat);
      ol.renderOrder = 4;
      ol.userData.follow = m;
      ol.matrixAutoUpdate = false;
      this.group.add(ol);
      return ol;
    });
    const proxy = this.proxyMesh(proxyR);
    proxy.userData.objectId = o.id;
    this.group.add(proxy);
    const ctl: Ctl = {
      def: o,
      root,
      outlined,
      outlines,
      outlineMat,
      proxy,
      ring,
      ringMat,
      anim: 1,
      from: st,
      to: st,
      current: st,
      apply: apply as Ctl['apply'],
      anchor,
    };
    ctl.apply(st, 1);
    return ctl;
  }

  /** Bring objects to the plan's state. animate=true plays the transition. */
  sync(plan: Plan, animate: boolean) {
    for (const [id, c] of this.ctls) {
      const s = plan[id] ?? defaultState(c.def);
      const same = JSON.stringify(s) === JSON.stringify(c.to);
      if (same && c.anim >= 1) continue;
      if (!same) {
        c.from = c.current;
        c.to = JSON.parse(JSON.stringify(s));
        c.anim = animate ? 0 : 1;
        if (animate) this.onChange?.(id, this.describeChange(c.def, c.from, c.to), c.anchor.clone());
      }
      if (!animate) {
        c.anim = 1;
        c.current = c.to;
        (c.apply as any)(c.to, 1, undefined);
      }
    }
  }

  private describeChange(o: LevelObject, from: any, to: any): string {
    switch (o.type) {
      case 'rock':
        return to.removed !== from.removed ? (to.removed ? 'lift' : 'place') : 'drag';
      case 'log':
        return 'log';
      case 'branches':
        return to.removed ? 'snap' : 'place';
      case 'tree':
        return to.felled ? 'fell' : 'raise';
      case 'soil':
        return to.dug ? 'dig' : 'fill';
      case 'outcrop':
        return to.split ? 'split' : 'mend';
      case 'ice':
        return to.broken ? 'shatter' : 'freeze';
      case 'gate':
        return 'gate';
    }
  }

  slump(id: string, on: boolean) {
    const c = this.ctls.get(id);
    if (!c) return;
    c.slumped = on;
    c.anim = on ? 0 : 1;
    if (!on) (c.apply as any)(c.to, 1);
  }

  setPlanning(on: boolean) {
    this.planning = on;
    // loose rocks are simulated bodies during a run; the piece view draws them
    for (const c of this.ctls.values()) if (c.def.type === 'rock') c.root.visible = on;
  }

  setHover(id: string | null) {
    this.hover = id;
  }
  setSelected(id: string | null) {
    this.selected = id;
  }

  pickTargets(): Object3D[] {
    const out: Object3D[] = [];
    for (const c of this.ctls.values()) {
      const st = c.to as any;
      if (c.def.type === 'rock' && st.removed) continue;
      // proxies follow their objects
      c.proxy.position.copy(c.anchor);
      out.push(c.proxy);
    }
    return out;
  }

  anchorOf(id: string): Vector3 | null {
    return this.ctls.get(id)?.anchor.clone() ?? null;
  }

  update(dt: number) {
    this.time += dt;
    for (const [id, c] of this.ctls) {
      if (c.anim < 1) {
        const dur = c.def.type === 'tree' ? 1.6 : c.def.type === 'soil' ? 1.2 : c.def.type === 'outcrop' ? 1.1 : 0.6;
        c.anim = Math.min(1, c.anim + dt / dur);
        (c.apply as any)(c.slumped ? c.to : c.to, c.anim, c.from);
        if (c.anim >= 1) c.current = c.to;
      }
      // outline + ring intensity
      const sel = this.selected === id;
      const hov = this.hover === id;
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 2.2 + id.length);
      let o = 0;
      if (this.planning) o = sel ? 0.95 : hov ? 0.6 : 0.12 + pulse * 0.16;
      c.outlineMat.uniforms.uOpacity.value = o;
      (c.outlineMat.uniforms.uColor.value as Color).setRGB(1, sel ? 0.86 : 0.97, sel ? 0.58 : 0.88);
      c.ringMat.opacity = this.planning ? (sel ? 0.75 : hov ? 0.5 : 0.1 + pulse * 0.14) : 0;
      c.ring.visible = this.planning;
      for (const ol of c.outlines) {
        const m = ol.userData.follow as Mesh;
        ol.visible = this.planning && m.visible && o > 0.01 && (m.parent?.visible ?? true) && c.root.visible;
        if (ol.visible) {
          m.updateWorldMatrix(true, false);
          ol.matrix.copy(m.matrixWorld);
          ol.matrixWorld.copy(m.matrixWorld);
        }
      }
    }
  }
}
