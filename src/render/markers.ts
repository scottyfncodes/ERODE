import * as THREE from 'three';
import { SHAPES, type Snowpack } from '../missions/avalanche';
import { fracturePiece, generateBlock } from '../sim/fracture';
import type { Terrain } from '../world/terrain';
import { ball, box, cyl, glow, mat } from './kit';
import { pieceGeometry } from './pieceGeometry';

/**
 * Wayfinding in the world, in the language of SKYTRACE's instruments: a light column over where
 * you are going, a ring where you can act, pins over the slopes the scanner reads, flags where
 * charges go, paw prints on a scent trail.
 */
export class Markers {
  readonly group = new THREE.Group();
  private beacon: THREE.Group;
  private beaconRing: THREE.Mesh;
  private beaconMat: THREE.MeshBasicMaterial;
  private rings: THREE.Mesh[] = [];
  private ringMat: THREE.MeshBasicMaterial;
  private pins = new Map<string, { g: THREE.Group; head: THREE.MeshBasicMaterial; prog: THREE.Mesh }>();
  private flags = new Map<string, THREE.Group>();
  private paws: THREE.InstancedMesh;
  private pawCount = 0;
  private t = 0;

  constructor(private terrain: Terrain) {
    this.beaconMat = new THREE.MeshBasicMaterial({ color: 0x5ad1ff, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide, fog: false });
    this.beacon = new THREE.Group();
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.6, 120, 16, 1, true), this.beaconMat);
    col.position.y = 60;
    this.beaconRing = new THREE.Mesh(new THREE.RingGeometry(4, 4.8, 40), new THREE.MeshBasicMaterial({ color: 0x5ad1ff, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
    this.beaconRing.rotation.x = -Math.PI / 2;
    this.beaconRing.position.y = 0.3;
    this.beacon.add(col, this.beaconRing);
    this.beacon.visible = false;
    this.group.add(this.beacon);
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xf2c230, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide });
    for (let i = 0; i < 4; i++) {
      const r = new THREE.Mesh(new THREE.RingGeometry(1, 1.25, 32), this.ringMat);
      r.rotation.x = -Math.PI / 2;
      r.visible = false;
      this.rings.push(r);
      this.group.add(r);
    }
    const pawGeo = new THREE.CircleGeometry(0.16, 8);
    pawGeo.rotateX(-Math.PI / 2);
    this.paws = new THREE.InstancedMesh(pawGeo, new THREE.MeshBasicMaterial({ color: 0x5ad1ff, transparent: true, opacity: 0.85, depthWrite: false }), 200);
    this.paws.count = 0;
    this.paws.frustumCulled = false;
    this.group.add(this.paws);
  }

  setBeacon(x: number | null, z = 0, color = 0x5ad1ff) {
    if (x === null) {
      this.beacon.visible = false;
      return;
    }
    this.beacon.visible = true;
    this.beacon.position.set(x, this.terrain.height(x, z), z);
    this.beaconMat.color.setHex(color);
    (this.beaconRing.material as THREE.MeshBasicMaterial).color.setHex(color);
  }

  setRings(spots: { x: number; z: number; r: number }[]) {
    this.rings.forEach((r, i) => {
      const s = spots[i];
      r.visible = !!s;
      if (s) {
        r.position.set(s.x, this.terrain.height(s.x, s.z) + 0.15, s.z);
        r.scale.setScalar(Math.min(3, s.r * 0.6));
      }
    });
  }

  /** A SKYTRACE recon pin over a contact: grey ?, filling as it is read, then red (loaded) or green. */
  setPins(list: { id: string; x: number; z: number; state: 'unknown' | 'loaded' | 'stable'; progress: number }[]) {
    const seen = new Set<string>();
    for (const p of list) {
      seen.add(p.id);
      let pin = this.pins.get(p.id);
      if (!pin) {
        const g = new THREE.Group();
        const head = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
        g.add(cyl(0.12, 0.12, 9, 5, mat(0x262a30), 0, 4.5, 0));
        const h = new THREE.Mesh(new THREE.SphereGeometry(1.6, 14, 10), head);
        h.position.y = 10.5;
        const tipM = new THREE.Mesh(new THREE.ConeGeometry(1.2, 2, 12), head);
        tipM.rotation.x = Math.PI;
        tipM.position.y = 9.1;
        const prog = new THREE.Mesh(new THREE.RingGeometry(2.0, 2.5, 32, 1, 0, Math.PI * 2), new THREE.MeshBasicMaterial({ color: 0x5ad1ff, side: THREE.DoubleSide, fog: false }));
        prog.position.y = 10.5;
        g.add(h, tipM, prog);
        this.group.add(g);
        pin = { g, head, prog };
        this.pins.set(p.id, pin);
      }
      pin.g.position.set(p.x, this.terrain.height(p.x, p.z), p.z);
      pin.head.color.setHex(p.state === 'unknown' ? 0xf3efe6 : p.state === 'loaded' ? 0xe0412c : 0x3fbf6a);
      pin.prog.visible = p.state === 'unknown' && p.progress > 0;
      pin.prog.geometry.dispose();
      pin.prog.geometry = new THREE.RingGeometry(2.0, 2.5, 32, 1, Math.PI / 2, Math.max(0.01, p.progress) * Math.PI * 2);
      pin.g.visible = true;
    }
    for (const [id, pin] of this.pins) if (!seen.has(id)) pin.g.visible = false;
  }

  /** Orange flags on loaded slopes; a placed charge blinks. */
  setFlags(list: { id: string; x: number; z: number; charged: boolean }[]) {
    const seen = new Set<string>();
    for (const f of list) {
      seen.add(f.id);
      let g = this.flags.get(f.id);
      if (!g) {
        g = new THREE.Group();
        g.add(cyl(0.05, 0.05, 2.4, 4, mat(0x262a30), 0, 1.2, 0));
        const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.6), mat(0xff7a1a, { side: THREE.DoubleSide }));
        flag.position.set(0.45, 2.1, 0);
        g.add(flag);
        const charge = new THREE.Group();
        charge.add(box(0.5, 0.35, 0.35, 0xd8382a, 0, 0.18, 0.5), ball(0.07, glow(0xff2a1a), 0, 0.4, 0.5, 6));
        charge.name = 'charge';
        g.add(charge);
        this.group.add(g);
        this.flags.set(f.id, g);
      }
      g.position.set(f.x, this.terrain.height(f.x, f.z), f.z);
      g.getObjectByName('charge')!.visible = f.charged && Math.sin(this.t * 6) > -0.2;
      g.visible = true;
    }
    for (const [id, g] of this.flags) if (!seen.has(id)) g.visible = false;
  }

  /** Paw prints along the part of a trail Koda has covered. */
  setPaws(trail: { x: number; z: number }[], upto: number) {
    if (upto <= 0 || trail.length < 2) {
      this.paws.count = 0;
      this.pawCount = 0;
      return;
    }
    const m = new THREE.Matrix4();
    let n = 0;
    for (let i = 0; i < Math.min(upto, trail.length - 1); i++) {
      const a = trail[i];
      const b = trail[i + 1];
      const d = Math.hypot(b.x - a.x, b.z - a.z);
      const steps = Math.floor(d / 1.4);
      for (let k = 0; k < steps && n < 200; k++) {
        const f = k / steps;
        const side = k % 2 ? 0.18 : -0.18;
        const x = a.x + (b.x - a.x) * f + ((b.z - a.z) / d) * side;
        const z = a.z + (b.z - a.z) * f - ((b.x - a.x) / d) * side;
        m.makeTranslation(x, this.terrain.height(x, z) + 0.08, z);
        this.paws.setMatrixAt(n++, m);
      }
    }
    this.paws.count = n;
    this.pawCount = n;
    this.paws.instanceMatrix.needsUpdate = true;
  }

  update(dt: number) {
    this.t += dt;
    const s = 1 + Math.sin(this.t * 3) * 0.08;
    this.beaconRing.scale.setScalar(s);
    this.beaconMat.opacity = 0.2 + Math.sin(this.t * 2) * 0.06;
    this.ringMat.opacity = 0.6 + Math.sin(this.t * 5) * 0.25;
    for (const [, p] of this.pins) p.g.rotation.y += dt * 0.6;
    void this.pawCount;
  }
}

/** The slab and the avalanche, drawn from fractured snow blocks (ROCKSLIDE's Voronoi fracture). */
export class AvalancheView {
  readonly group = new THREE.Group();
  private meshes: THREE.InstancedMesh[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  private axis = new THREE.Vector3();

  constructor(private max = 640) {
    const parent = generateBlock([1, 0.42, 1], 5, 0.25);
    const cells = fracturePiece(parent, [0.3, 1, 0.2], SHAPES, 77, 0.0005).cells;
    const shapes = cells.length ? cells.map((c) => c.shape) : [parent];
    const mat = new THREE.MeshLambertMaterial({ color: 0xf3f6fa, flatShading: true });
    for (let i = 0; i < SHAPES; i++) {
      const sh = shapes[i % shapes.length];
      const geo = pieceGeometry(sh);
      // normalise so every cell reads as a block of about 1 m
      geo.computeBoundingBox();
      const bb = geo.boundingBox!;
      const size = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z) || 1;
      geo.scale(1 / size, 1 / size, 1 / size);
      const mesh = new THREE.InstancedMesh(geo, mat, max);
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
  }

  sync(pack: Snowpack) {
    const counts = new Array(SHAPES).fill(0);
    for (const b of pack.blocks) {
      // the resting slab is part of the snow surface; blocks show once they break away
      if (b.state < 2) continue;
      const mesh = this.meshes[b.shape];
      const k = counts[b.shape]++;
      if (k >= this.max) continue;
      this.p.set(b.x, b.y, b.z);
      if (b.state === 0 || b.state === 1) {
        // resting slab: flat pillows of wind-packed snow
        this.q.identity();
        this.s.set(b.size * 1.3, b.size * 0.4, b.size * 1.3);
      } else {
        this.axis.set(b.ax, 0, b.az);
        if (this.axis.lengthSq() < 1e-6) this.axis.set(1, 0, 0);
        this.q.setFromAxisAngle(this.axis.normalize(), b.angle);
        this.s.set(b.size, b.size * 0.7, b.size);
      }
      this.m.compose(this.p, this.q, this.s);
      mesh.setMatrixAt(k, this.m);
    }
    this.meshes.forEach((m, i) => {
      m.count = Math.min(this.max, counts[i]);
      m.instanceMatrix.needsUpdate = true;
    });
  }
}
