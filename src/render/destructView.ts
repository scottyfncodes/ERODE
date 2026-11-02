import { BoxGeometry, Color, CylinderGeometry, Group, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, Vector3, type BufferGeometry } from 'three';
import type { LevelDef } from '../levels/types';
import type { Layout } from '../run/layout';
import { CHUNK_SLOTS, type RunSim } from '../run/runner';
import type { Body } from '../run/debris';
import { generateStone } from '../sim/fracture';
import { banded, fitBounds, type Banded } from './banded';
import { pieceGeometry } from './pieceGeometry';
import { broadleafGeometry, coniferGeometry } from './vegetation';
import { createBarkMaterial, createFoliageMaterial, createRockMaterial, ROCK_LOOKS, rockUniforms } from './materials';

const UP = new Vector3(0, 1, 0);
const _m = new Matrix4();
const _p = new Vector3();
const _s = new Vector3();
const _q = new Quaternion();
const _q2 = new Quaternion();
const _a = new Vector3();
const HIDDEN = new Matrix4().makeScale(0, 0, 0);

/**
 * Everything breakable, drawn with a handful of instanced meshes: trees (trunk + crown per variant),
 * stumps, rocks, timber parts (boards and logs) and a pool of flying rock chunks.
 * Only what changed is rewritten each frame.
 */
export class DestructView {
  readonly group = new Group();
  private layout: Layout;
  private trunks: Banded[] = [];
  private crowns: Banded[] = [];
  private stumps: InstancedMesh;
  private treeSlot: { variant: number; index: number }[] = [];
  private rocks: Banded[] = [];
  private rockSlot: { variant: number; index: number }[] = [];
  private all: InstancedMesh[] = [];
  private boxes: InstancedMesh;
  private logs: InstancedMesh;
  private partSlot: { log: boolean; index: number }[] = [];
  private chunks: InstancedMesh;
  private boulderChunks: InstancedMesh;
  private dirty = new Set<InstancedMesh>();

  constructor(level: LevelDef, layout: Layout) {
    this.layout = layout;
    const L = layout;
    // ---- trees
    const juniper = level.theme.trees === 'juniper';
    const variants = juniper ? [broadleafGeometry(51, 0), broadleafGeometry(57, 0)] : [coniferGeometry(31, 6, 1, 9, 2), coniferGeometry(43, 6, 1.1, 9, 2)];
    const bark = createBarkMaterial(new Color(0.42, 0.27, 0.17));
    const foliage = createFoliageMaterial();
    for (let v = 0; v < 2; v++) {
      const mine = L.trees.filter((t) => t.variant % 2 === v);
      mine.forEach((t, i) => (this.treeSlot[t.id] = { variant: v, index: i }));
      const tr = banded(variants[v].trunk, bark, mine, 200);
      const cr = banded(variants[v].crown, foliage, mine, 200);
      for (const m of [...tr.meshes, ...cr.meshes]) {
        m.castShadow = true;
        m.receiveShadow = true;
        this.group.add(m);
      }
      if (level.theme.trees === 'snowpine') mine.forEach((_, i) => cr.slot[i].mesh.setColorAt(cr.slot[i].index, new Color(0.8, 0.88, 0.92)));
      this.trunks.push(tr);
      this.crowns.push(cr);
    }
    const stumpGeo = new CylinderGeometry(1, 1.15, 1, 9, 1);
    stumpGeo.translate(0, 0.5, 0);
    this.stumps = new InstancedMesh(stumpGeo, createBarkMaterial(new Color(0.55, 0.4, 0.26)), Math.max(1, L.trees.length));
    this.stumps.castShadow = false;
    this.stumps.receiveShadow = true;
    this.group.add(this.stumps);

    // ---- rocks
    const look = ROCK_LOOKS[level.theme.rock] ?? ROCK_LOOKS.granite;
    const rockGeos = [0, 1].map((i) => pieceGeometry(generateStone(1, 700 + i * 13, 0.75)));
    const rockMat = createRockMaterial({ uniforms: rockUniforms(look) });
    for (let v = 0; v < 2; v++) {
      const mine = L.rocks.filter((r) => r.variant % 2 === v);
      mine.forEach((r, i) => (this.rockSlot[r.id] = { variant: v, index: i }));
      const b = banded(rockGeos[v], rockMat, mine, 300);
      for (const m of b.meshes) {
        m.castShadow = true;
        m.receiveShadow = true;
        this.group.add(m);
      }
      this.rocks.push(b);
    }
    // ---- timber parts
    const nBox = L.parts.filter((p) => p.shape === 'box').length;
    const nLog = L.parts.length - nBox;
    const boxGeo = new BoxGeometry(2, 2, 2);
    const logGeo: BufferGeometry = new CylinderGeometry(1, 1, 2, 8, 1);
    logGeo.rotateZ(Math.PI / 2);
    this.boxes = new InstancedMesh(boxGeo, new MeshStandardMaterial({ roughness: 0.86, metalness: 0 }), Math.max(1, nBox));
    this.logs = new InstancedMesh(logGeo, createBarkMaterial(new Color(1, 1, 1)), Math.max(1, nLog));
    this.boxes.count = nBox;
    this.logs.count = nLog;
    let bi = 0,
      li = 0;
    const col = new Color();
    for (const p of L.parts) {
      const log = p.shape === 'log';
      const slot = { log, index: log ? li++ : bi++ };
      this.partSlot[p.id] = slot;
      col.setRGB(p.color[0], p.color[1], p.color[2]);
      (log ? this.logs : this.boxes).setColorAt(slot.index, log ? col.clone().multiplyScalar(1.6) : col);
    }
    for (const m of [this.boxes, this.logs]) {
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
    }
    // ---- chunks
    const chunkGeo = pieceGeometry(generateStone(1, 911, 0.7));
    this.chunks = new InstancedMesh(chunkGeo, rockMat, CHUNK_SLOTS);
    this.chunks.castShadow = true;
    this.boulderChunks = new InstancedMesh(chunkGeo, createRockMaterial(), 16);
    for (let i = 0; i < CHUNK_SLOTS; i++) this.chunks.setMatrixAt(i, HIDDEN);
    for (let i = 0; i < 16; i++) this.boulderChunks.setMatrixAt(i, HIDDEN);
    this.boulderChunks.castShadow = true;
    this.group.add(this.chunks, this.boulderChunks);
    for (const m of [this.boxes, this.logs, this.stumps, this.chunks, this.boulderChunks]) m.frustumCulled = false;
    this.all = [...this.trunks.flatMap((b) => b.meshes), ...this.crowns.flatMap((b) => b.meshes), ...this.rocks.flatMap((b) => b.meshes), this.boxes, this.logs, this.stumps, this.chunks, this.boulderChunks];
    this.reset();
    // trees fall up to their own height away: grow the culling bounds to match
    fitBounds(this.trunks.flatMap((b) => b.meshes), 20);
    fitBounds(this.crowns.flatMap((b) => b.meshes), 20);
    fitBounds(this.rocks.flatMap((b) => b.meshes), 4);
  }

  /** the boulder's own look for the pieces it breaks into */
  setBoulderLook(tint: [number, number, number], speck: [number, number, number], gloss: number) {
    const mat = this.boulderChunks.material as MeshStandardMaterial & { userData: { u?: ReturnType<typeof rockUniforms> } };
    const u = rockUniforms({ tint, speck, gloss });
    this.boulderChunks.material = createRockMaterial({ uniforms: u });
    mat.dispose();
  }

  /** everything back where it started */
  reset() {
    const L = this.layout;
    for (const t of L.trees) this.poseTree(t.id, null);
    for (const r of L.rocks) this.poseRock(r.id, false);
    for (const p of L.parts) {
      const slot = this.partSlot[p.id];
      _p.set(p.pos[0], p.pos[1], p.pos[2]);
      _q.set(p.quat[0], p.quat[1], p.quat[2], p.quat[3]);
      _s.set(p.half[0], p.half[1], p.half[2]);
      (slot.log ? this.logs : this.boxes).setMatrixAt(slot.index, _m.compose(_p, _q, _s));
    }
    for (let i = 0; i < CHUNK_SLOTS; i++) this.chunks.setMatrixAt(i, HIDDEN);
    for (let i = 0; i < 16; i++) this.boulderChunks.setMatrixAt(i, HIDDEN);
    this.boulderChunkSlots.clear();
    for (const m of this.all) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  private poseTree(id: number, sim: RunSim | null) {
    const t = this.layout.trees[id];
    const slot = this.treeSlot[id];
    const st = sim ? sim.treeState[id] : 0;
    _p.set(t.x, t.y - 0.25, t.z);
    _s.setScalar(t.h);
    _q.setFromAxisAngle(UP, t.yaw);
    let snap = 0;
    if (sim && st === 0) {
      const sx = sim.treeSway[id * 2],
        sz = sim.treeSway[id * 2 + 1];
      const amt = Math.hypot(sx, sz);
      if (amt > 1e-4) _q.premultiply(_q2.setFromAxisAngle(_a.set(sz / amt, 0, -sx / amt), Math.min(0.5, amt)));
    } else if (sim && st >= 1) {
      const dx = sim.treeDir[id * 2],
        dz = sim.treeDir[id * 2 + 1];
      snap = sim.treeSnap[id];
      _q.premultiply(_q2.setFromAxisAngle(_a.set(dz, 0, -dx), sim.treeAng[id]));
      if (st >= 2) _p.y += snap;
    }
    _m.compose(_p, _q, _s);
    const a = this.trunks[slot.variant].slot[slot.index],
      b = this.crowns[slot.variant].slot[slot.index];
    a.mesh.setMatrixAt(a.index, _m);
    b.mesh.setMatrixAt(b.index, _m);
    this.dirty.add(a.mesh).add(b.mesh);
    if (st >= 2) {
      _p.set(t.x, t.y - 0.3, t.z);
      _s.set(t.r * 1.15, snap + 0.35, t.r * 1.15);
      this.stumps.setMatrixAt(id, _m.compose(_p, _q.setFromAxisAngle(UP, t.yaw), _s));
    } else this.stumps.setMatrixAt(id, HIDDEN);
    this.dirty.add(this.stumps);
  }

  private poseRock(id: number, gone: boolean) {
    const r = this.layout.rocks[id];
    const slot = this.rockSlot[id];
    const { mesh: m, index } = this.rocks[slot.variant].slot[slot.index];
    if (gone) m.setMatrixAt(index, HIDDEN);
    else {
      _p.set(r.x, r.y, r.z);
      _q.setFromAxisAngle(UP, r.yaw);
      _s.set(r.r, r.r * r.tall, r.r);
      m.setMatrixAt(index, _m.compose(_p, _q, _s));
    }
    this.dirty.add(m);
  }

  private boulderChunkSlots = new Map<number, number>();

  private poseBody(sim: RunSim, b: Body) {
    _s.set(b.half[0], b.half[1], b.half[2]);
    _m.compose(b.p, b.q, _s);
    if (b.shape === 'sphere') {
      const slot = b.ref;
      if (sim.chunkBody[slot] !== b) return;
      if (sim.chunkVariant[slot] === 255) {
        let i = this.boulderChunkSlots.get(slot);
        if (i === undefined && this.boulderChunkSlots.size < 16) {
          i = this.boulderChunkSlots.size;
          this.boulderChunkSlots.set(slot, i);
        }
        if (i !== undefined) {
          this.boulderChunks.setMatrixAt(i, _m);
          this.dirty.add(this.boulderChunks);
        }
        this.chunks.setMatrixAt(slot, HIDDEN);
      } else this.chunks.setMatrixAt(slot, _m);
      this.dirty.add(this.chunks);
      return;
    }
    const slot = this.partSlot[b.ref];
    (slot.log ? this.logs : this.boxes).setMatrixAt(slot.index, _m);
    this.dirty.add(slot.log ? this.logs : this.boxes);
  }

  update(sim: RunSim) {
    for (const id of sim.changedTrees) this.poseTree(id, sim);
    sim.changedTrees.clear();
    for (const id of sim.changedRocks) this.poseRock(id, sim.rockGone[id] === 1);
    sim.changedRocks.clear();
    for (const b of sim.debris.moved) this.poseBody(sim, b);
    sim.debris.moved.clear();
    for (const m of this.dirty) m.instanceMatrix.needsUpdate = true;
    this.dirty.clear();
  }
}
