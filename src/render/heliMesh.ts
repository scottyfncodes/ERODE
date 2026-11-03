import * as THREE from 'three';
import { box, cyl, glow, mat, paint, PAL, repaint } from './kit';
import { dressModel, mountAtPivot, retire } from './patrolModels';

const cylZ = (rt: number, rb: number, len: number, seg: number, m: THREE.Material) => {
  const c = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, len, seg), m);
  c.rotation.x = Math.PI / 2;
  return c;
};

/**
 * The patrol helicopter, SKYTRACE's red-and-white Rescue Helicopter: one big rotor, a bubble nose,
 * a hoist arm over the right-hand door, nav lights and a strobe. Skis on the skids for the snow,
 * a searchlight when fitted, and the paint is yours to choose.
 */
export class HeliMesh {
  readonly group = new THREE.Group();
  private body = new THREE.Group();
  private rotor = new THREE.Group();
  private tail = new THREE.Group();
  private disc: THREE.Mesh;
  private strobe: THREE.Mesh[] = [];
  private main: THREE.MeshLambertMaterial;
  private second: THREE.MeshLambertMaterial;
  private glass: THREE.MeshLambertMaterial;
  /** the code-built shape, until (unless) the MeshCraft model replaces it */
  private shell: THREE.Object3D[] = [];
  /** true once the MeshCraft model is in */
  modelled = false;
  readonly light: THREE.SpotLight;
  private lightCone: THREE.Mesh;
  /** a scanner glow under the nose */
  private scanner: THREE.Mesh;
  private spin = 0;

  constructor() {
    this.group.add(this.body);
    this.main = paint(PAL.red);
    this.second = paint(PAL.white);
    const yellow = mat(0xffd23f);
    const dark = mat(0x2a2e33);
    const grey = mat(PAL.metal);
    const glass = (this.glass = new THREE.MeshLambertMaterial({ color: 0x8fd6f2, transparent: true, opacity: 0.85, emissive: 0x1a4a5e }));
    const add = (...o: THREE.Object3D[]) => this.body.add(...o);

    const cabin = new THREE.Mesh(new THREE.SphereGeometry(1.7, 18, 12), this.main);
    cabin.scale.set(1, 0.95, 1.55);
    cabin.position.set(0, 0.3, -0.4);
    const belly = new THREE.Mesh(new THREE.SphereGeometry(1.62, 18, 12), this.second);
    belly.scale.set(1.02, 0.6, 1.5);
    belly.position.set(0, -0.35, -0.35);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(1.25, 16, 10), glass);
    nose.scale.set(1.05, 0.9, 1.05);
    nose.position.set(0, 0.55, -1.95);
    const stripe = cylZ(1.72, 1.72, 0.45, 18, yellow);
    stripe.scale.set(1, 0.95, 1);
    stripe.position.set(0, 0.3, 0.9);
    const door = box(0.06, 1.3, 1.5, this.second, 1.66, 0.35, 0.1);
    const boom = cylZ(0.22, 0.55, 5.6, 10, this.main);
    boom.position.set(0, 0.75, 3.9);
    const fin = box(0.18, 1.9, 1.1, this.main, 0, 1.55, 6.45);
    fin.rotation.x = -0.35;
    const finTip = box(0.2, 0.4, 0.9, this.second, 0, 2.35, 6.75);
    finTip.rotation.x = -0.35;
    const stab = box(2.0, 0.12, 0.6, this.second, 0, 0.85, 5.6);
    const mast = cyl(0.28, 0.5, 0.9, 10, grey, 0, 1.95, -0.2);
    const engine = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 8), this.second);
    engine.scale.set(0.9, 0.55, 1.6);
    engine.position.set(0, 1.55, 0.5);
    // the patrol cross on the door
    const crossV = box(0.08, 0.7, 0.22, this.main, 1.69, 0.35, 0.1);
    const crossH = box(0.08, 0.22, 0.7, this.main, 1.69, 0.35, 0.1);
    add(cabin, belly, nose, stripe, door, crossV, crossH, boom, fin, finTip, stab, mast, engine);
    this.shell.push(cabin, belly, nose, stripe, door, crossV, crossH, boom, fin, finTip, stab, mast, engine);

    for (let i = 0; i < 4; i++) {
      const b = box(12.4, 0.08, 0.42, dark);
      b.rotation.y = (i * Math.PI) / 4;
      this.rotor.add(b);
    }
    this.rotor.add(cyl(0.35, 0.45, 0.5, 10, grey));
    this.shell.push(...this.rotor.children);
    this.rotor.position.set(0, 2.45, -0.2);
    this.disc = new THREE.Mesh(new THREE.CircleGeometry(6.2, 32), new THREE.MeshBasicMaterial({ color: 0x1b1f24, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
    this.disc.rotation.x = -Math.PI / 2;
    this.disc.position.set(0, 2.47, -0.2);
    add(this.rotor, this.disc);
    for (let i = 0; i < 2; i++) {
      const b = box(0.06, 1.9, 0.22, dark);
      b.rotation.x = (i * Math.PI) / 2;
      this.tail.add(b);
      this.shell.push(b);
    }
    this.tail.position.set(-0.25, 1.75, 6.55);
    add(this.tail);

    // skids with little skis for the snow
    for (const s of [-1, 1]) {
      const rail = cylZ(0.12, 0.12, 4.6, 6, dark);
      rail.position.set(s * 1.25, -1.45, -0.2);
      const ski = box(0.42, 0.08, 2.2, this.main, s * 1.25, -1.56, -0.4);
      const tip = box(0.42, 0.08, 0.5, this.main, s * 1.25, -1.45, -1.65);
      tip.rotation.x = 0.5;
      add(rail, ski, tip);
      this.shell.push(rail, ski, tip);
      for (const zz of [-1.3, 1.3]) {
        const strut = box(0.1, 1.3, 0.1, dark, s * 1.0, -0.72, -0.2 + zz);
        strut.rotation.z = -s * 0.3;
        add(strut);
        this.shell.push(strut);
      }
    }
    // hoist arm over the right-hand door
    const hoist = [box(1.4, 0.2, 0.25, grey, 2.15, 1.25, -0.2), box(0.4, 0.4, 0.4, yellow, 2.8, 1.15, -0.2)];
    add(...hoist);
    this.shell.push(...hoist);
    const navL = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 4), glow(0xff3b30));
    navL.position.set(-1.7, 0.2, -0.6);
    const navR = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 4), glow(0x34e05a));
    navR.position.set(1.7, 0.2, -0.6);
    add(navL, navR);
    for (const [x, y, z, c] of [
      [0, 2.6, 6.9, 0xffffff],
      [0, -1.0, -0.8, 0xff4433],
    ] as const) {
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 4), glow(c));
      l.position.set(x, y, z);
      this.strobe.push(l);
      add(l);
    }
    // scanner turret under the nose (SKYTRACE's camera ball)
    const turret = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8), dark);
    turret.position.set(0, -0.75, -2.0);
    this.scanner = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), glow(0x7fe3ff));
    this.scanner.position.set(0, -0.8, -2.3);
    add(turret, this.scanner);
    this.shell.push(turret);

    // searchlight (fitted later)
    this.light = new THREE.SpotLight(0xfff1d0, 0, 140, 0.32, 0.5, 1.2);
    this.light.position.set(0, -1.0, -1.6);
    this.light.target.position.set(0, -30, -22);
    this.lightCone = new THREE.Mesh(new THREE.ConeGeometry(5, 26, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff1d0, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide }));
    this.lightCone.position.set(0, -12, -10);
    this.lightCone.rotation.x = -0.65;
    this.lightCone.visible = false;
    add(this.light, this.light.target, this.lightCone);
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m !== this.disc && m !== this.lightCone) m.castShadow = true;
    });
  }

  /**
   * Swap the code-built shape for the MeshCraft model (public/models/rs_heli.glb). Same size, same
   * place: the rotor and tail rotor are nodes on the pivots they spin about, the paint still changes,
   * and the nav lights, strobes, scanner, rotor disc and searchlight are the code's own.
   * Returns false, leaving the code-built helicopter, if the model is unusable.
   */
  useModel(scene: THREE.Object3D | undefined): boolean {
    const n = dressModel(scene, ['heli_body', 'heli_rotor', 'heli_tail_rotor'], {
      main: this.main,
      second: this.second,
      glass: this.glass,
      yellow: mat(0xffd23f),
      dark: mat(0x2a2e33),
      metal: mat(PAL.metal),
    });
    if (!n) return false;
    retire(this.shell);
    this.shell = [];
    this.body.add(n.heli_body);
    mountAtPivot(n.heli_rotor, this.rotor);
    mountAtPivot(n.heli_tail_rotor, this.tail);
    this.modelled = true;
    return true;
  }

  setPaint(main: number, second: number) {
    repaint(this.main, main);
    repaint(this.second, second);
  }

  /** Searchlight on (night) when fitted. */
  setSearchlight(on: boolean) {
    this.light.intensity = on ? 60 : 0;
    this.lightCone.visible = on;
  }

  sync(x: number, y: number, z: number, yaw: number, pitch: number, roll: number, rotor: number, t: number, dt: number, scanning: boolean) {
    this.group.position.set(x, y + 1.62, z);
    this.group.rotation.set(0, yaw, 0);
    this.body.rotation.set(pitch, 0, -roll, 'YXZ');
    this.spin += dt * (rotor * 34);
    this.rotor.rotation.y = this.spin;
    this.tail.rotation.x = this.spin * 2.2;
    this.disc.visible = rotor > 0.5;
    const k = (t % 1.1) / 1.1;
    const on = rotor > 0.1 && (k < 0.05 || (k > 0.12 && k < 0.17));
    for (const s of this.strobe) s.visible = on;
    this.scanner.visible = scanning ? Math.sin(t * 14) > -0.3 : rotor > 0.1;
  }
}
