import * as THREE from 'three';
import { Debris } from '../sim/debris';
import type { Terrain } from '../world/terrain';
import { PatrollerMesh } from './characterMesh';
import { ball, box, cyl, mat, PAL } from './kit';

/** Pepper: a small grey cat with a white chin and a tail held high. */
export function catMesh(): THREE.Group {
  const g = new THREE.Group();
  const grey = mat(0x6d7178);
  const body = ball(0.16, grey, 0, 0.18, 0, 10);
  body.scale.set(0.9, 0.85, 1.4);
  const head = ball(0.12, grey, 0, 0.34, -0.2, 10);
  const chin = ball(0.07, 0xf4f2ee, 0, 0.29, -0.28, 8);
  const earL = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.09, 4), grey);
  earL.position.set(-0.06, 0.46, -0.2);
  const earR = earL.clone();
  earR.position.x = 0.06;
  const eyeL = ball(0.02, 0xc8e05a, -0.045, 0.36, -0.31, 6);
  const eyeR = ball(0.02, 0xc8e05a, 0.045, 0.36, -0.31, 6);
  const tail = cyl(0.025, 0.03, 0.4, 5, grey, 0, 0.36, 0.22);
  tail.rotation.x = -0.4;
  g.add(body, head, chin, earL, earR, eyeL, eyeR, tail);
  for (const [x, z] of [
    [-0.07, -0.12],
    [0.07, -0.12],
    [-0.07, 0.12],
    [0.07, 0.12],
  ])
    g.add(cyl(0.025, 0.025, 0.12, 5, 0xf4f2ee, x, 0.06, z));
  g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  return g;
}

function vanMesh(): THREE.Group {
  const g = new THREE.Group();
  g.add(box(2.1, 2.0, 4.6, 0xe9e2d0, 0, 1.4, 0.2), box(2.0, 1.3, 1.4, 0xe9e2d0, 0, 1.05, -2.6));
  g.add(box(1.9, 0.7, 0.08, new THREE.MeshLambertMaterial({ color: 0x8fc4dc }), 0, 1.45, -3.32));
  g.add(box(2.12, 0.35, 4.62, 0x2f5f9e, 0, 1.6, 0.2));
  for (const [x, z] of [
    [-1.05, -2.3],
    [1.05, -2.3],
    [-1.05, 1.6],
    [1.05, 1.6],
  ]) {
    const w = cyl(0.42, 0.42, 0.3, 10, 0x1d1f22, x, 0.42, z);
    w.rotation.z = Math.PI / 2;
    g.add(w);
  }
  // the drift it slid into
  const drift = ball(2.6, PAL.snow, 1.4, 0.2, 0.5, 10);
  drift.scale.set(1, 0.45, 1.6);
  g.add(drift);
  g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  return g;
}

function fallenTree(): THREE.Group {
  const g = new THREE.Group();
  const trunk = cyl(0.35, 0.5, 14, 8, 0x5e3a22, 0, 0.5, 0);
  trunk.rotation.z = Math.PI / 2;
  g.add(trunk);
  for (let i = 0; i < 5; i++) {
    const c = new THREE.Mesh(new THREE.ConeGeometry(1.5 - i * 0.2, 2.2, 7), mat(0x2b4a33));
    c.rotation.z = Math.PI / 2;
    c.position.set(-2 - i * 1.5, 0.9, 0);
    g.add(c);
    const s = new THREE.Mesh(new THREE.ConeGeometry(1.2 - i * 0.2, 1.6, 7), mat(PAL.snow));
    s.rotation.z = Math.PI / 2;
    s.position.set(-2 - i * 1.5, 1.4, 0);
    g.add(s);
  }
  // the root plate standing up off the road
  const root = cyl(1.6, 1.6, 0.5, 10, 0x6b4428, 7, 1.2, 0);
  root.rotation.z = Math.PI / 2;
  g.add(root);
  g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  return g;
}

/**
 * The people and things missions are about: Greta at the Kettle, Nils in the trees, Pepper by
 * the boathouse, a van in a drift, a spruce across the road, the pass barrier. Sawn logs tumble
 * away on ROCKSLIDE's debris physics.
 */
export class MissionProps {
  readonly group = new THREE.Group();
  readonly greta: PatrollerMesh;
  readonly nils: PatrollerMesh;
  readonly driver: PatrollerMesh;
  readonly pepper: THREE.Group;
  readonly glove: THREE.Mesh;
  readonly van: THREE.Group;
  readonly tree: THREE.Group;
  private gateArm: THREE.Group;
  private gateClosed = false;
  private debris: Debris;
  private logs: THREE.InstancedMesh;
  private logBodies: { b: ReturnType<Debris['add']> }[] = [];

  constructor(private terrain: Terrain) {
    const t = terrain;
    this.greta = new PatrollerMesh(true);
    this.greta.setLook(0x3c6b4a, 0xe8dcc8, 'hat-bobble', 0xe9c46a, 0xf3efe6, 0x222222, 0);
    this.greta.group.position.set(336, t.height(336, 466), 466.5);
    this.greta.group.rotation.y = Math.PI + 0.2;
    this.nils = new PatrollerMesh(true);
    this.nils.setLook(0x2f7fb8, 0xf2c230, 'hat-helmet', 0x262a30, 0xf2c230, 0x7fd3e8, 0xd8382a);
    this.driver = new PatrollerMesh(true);
    this.driver.setLook(0xf07a1a, 0x262a30, 'hat-beanie', 0x262a30, 0x262a30, 0x222222, 0);
    this.driver.group.position.set(268, t.height(268, 238), 238);
    this.driver.group.rotation.y = 2.4;
    this.pepper = catMesh();
    this.glove = box(0.25, 0.12, 0.3, 0xd8382a, 606, t.height(606, -327) + 0.06, -327);
    this.van = vanMesh();
    this.van.position.set(262, t.height(262, 232) - 0.2, 232);
    this.van.rotation.set(0.05, 0.9, 0.12);
    this.tree = fallenTree();
    this.tree.position.set(-112, t.height(-112, 30), 30);
    this.tree.rotation.y = 0.6;
    // the pass barrier: a red and white arm on a post
    const gate = new THREE.Group();
    gate.add(cyl(0.18, 0.22, 1.3, 8, PAL.dark, 0, 0.65, 0));
    this.gateArm = new THREE.Group();
    for (let i = 0; i < 6; i++) this.gateArm.add(box(1.2, 0.18, 0.12, i % 2 ? PAL.white : PAL.red, 0.6 + i * 1.2, 0, 0));
    this.gateArm.position.y = 1.25;
    gate.add(this.gateArm);
    gate.position.set(-156, t.height(-156, -36), -36);
    gate.rotation.y = -0.85;
    this.group.add(this.greta.group, this.nils.group, this.driver.group, this.pepper, this.glove, this.van, this.tree, gate);
    this.setGate(false);
    this.debris = new Debris((x, z) => t.height(x, z));
    const lg = new THREE.CylinderGeometry(0.42, 0.42, 1.6, 8);
    lg.rotateZ(Math.PI / 2);
    this.logs = new THREE.InstancedMesh(lg, mat(0x6b4428), 8);
    this.logs.count = 0;
    this.logs.castShadow = true;
    this.logs.frustumCulled = false;
    this.group.add(this.logs);
  }

  setGate(closed: boolean) {
    this.gateClosed = closed;
  }

  /** The tree is cut: the trunk breaks into sections that roll off the road. */
  sawTree() {
    this.tree.visible = false;
    const base = this.tree.position;
    for (let i = 0; i < 6; i++) {
      const off = -5 + i * 2;
      const x = base.x + Math.cos(this.tree.rotation.y) * off;
      const z = base.z - Math.sin(this.tree.rotation.y) * off;
      const b = this.debris.add({
        shape: 'log',
        ref: i,
        pos: [x, this.terrain.height(x, z) + 1.2, z],
        quat: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.tree.rotation.y),
        vel: new THREE.Vector3(Math.sin(this.tree.rotation.y) * 4 + (Math.random() - 0.5), 3 + Math.random() * 2, Math.cos(this.tree.rotation.y) * 4),
        spin: new THREE.Vector3(Math.random() * 3, 0, Math.random() * 3),
        half: [0.8, 0.42, 0.42],
        mass: 200,
        chain: -1,
        depth: 0,
        hits: false,
      });
      this.logBodies.push({ b });
    }
    this.logs.count = this.logBodies.length;
  }

  resetTree() {
    this.tree.visible = true;
    this.debris.clear();
    this.logBodies = [];
    this.logs.count = 0;
  }

  update(dt: number) {
    const want = this.gateClosed ? 0 : 1.35;
    this.gateArm.rotation.z += (want - this.gateArm.rotation.z) * Math.min(1, dt * 3);
    if (this.logBodies.length) {
      this.debris.step(dt);
      const m = new THREE.Matrix4();
      this.logBodies.forEach(({ b }, i) => {
        m.compose(b.p, b.q, new THREE.Vector3(1, 1, 1));
        this.logs.setMatrixAt(i, m);
      });
      this.logs.instanceMatrix.needsUpdate = true;
    }
  }
}
