import * as THREE from 'three';
import { BADGES } from '../progress/catalog';
import type { Terrain } from '../world/terrain';
import { EQUIP, GARAGE, HANGAR, KENNEL, LODGE, MAST, PAD, SPOTS, WING, type UpgradeId } from '../world/station';
import { bakeInPlace, ball, box, cyl, gable, glow, logWall, mat, PAL, shade, snowRoof, windowPane } from './kit';
import { LODGE_IDS, paintModel, YARD_IDS, type LodgeId, type PatrolModels, type YardId } from './patrolModels';

/** Whether `o` is `root` or inside it. */
function isUnder(o: THREE.Object3D, root: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === root) return true;
  return false;
}

/** A painted sign: chunky letters on a board. */
export function signTexture(text: string, bg = '#7b2f3b', fg = '#f6ecdc', w = 512, h = 128, accent?: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(255,255,255,0.06)';
  for (let y = 10; y < h; y += 22) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(w, y + 4);
    g.stroke();
  }
  if (accent) {
    // the patrol cross
    g.fillStyle = accent;
    const s = h * 0.5;
    g.fillRect(h * 0.25 + s * 0.35, h * 0.25, s * 0.3, s);
    g.fillRect(h * 0.25, h * 0.25 + s * 0.35, s, s * 0.3);
  }
  // a thin inset rule, like a painted hotel sign
  g.strokeStyle = fg;
  g.globalAlpha = 0.7;
  g.lineWidth = Math.max(2, h * 0.03);
  g.strokeRect(h * 0.08, h * 0.08, w - h * 0.16, h - h * 0.16);
  g.globalAlpha = 1;
  g.fillStyle = fg;
  g.font = `600 ${Math.round(h * 0.4)}px "Jost", sans-serif`;
  (g as unknown as { letterSpacing: string }).letterSpacing = `${Math.round(h * 0.06)}px`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, accent ? w / 2 + h * 0.3 : w / 2, h / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function sign(text: string, w: number, h: number, opts: { bg?: string; fg?: string; accent?: string } = {}): THREE.Mesh {
  const tex = signTexture(text, opts.bg, opts.fg, 512, Math.round((512 * h) / w), opts.accent);
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ map: tex }));
}

interface Room {
  group: THREE.Group;
  roof: THREE.Object3D;
  /** walls with their outward normal, for the dollhouse cutaway */
  walls: { obj: THREE.Object3D; nx: number; nz: number }[];
  x: number;
  z: number;
}

/**
 * Kessel Patrol Station. The lodge (mission room, hearth, bunk, wardrobe, Koda's bed), the garage,
 * the pad, the dog house, and every building the operation adds as it grows.
 */
/** from the middle coded flame to the mouth of the firebox (the hearth faces +x into the room) */
const HEARTH_MOUTH = new THREE.Vector3(0.35, -0.12, 0);

export class StationView {
  readonly group = new THREE.Group();
  readonly upgrades = new Map<UpgradeId, THREE.Object3D>();
  private baseKennel: THREE.Object3D;
  private rooms: Room[] = [];
  readonly fireLight: THREE.PointLight;
  private fire: THREE.Mesh[] = [];
  private windows: THREE.MeshLambertMaterial;
  private lamps: THREE.MeshBasicMaterial;
  private lampLights: THREE.PointLight[] = [];
  private beacon: THREE.Mesh;
  private flag: THREE.Mesh;
  private badgePins = new Map<string, THREE.Mesh>();
  readonly chimney = new THREE.Vector3();
  readonly smokeSources: THREE.Vector3[] = [];
  private gate: THREE.Object3D | null = null;
  private t = 0;
  readonly y: number;
  /** the MeshCraft yard buildings (garage, hangar, equipment room, Koda's house, the mast), when every one loaded */
  private ym: Record<YardId, THREE.Object3D> | null;
  /** true when the yard's buildings are the MeshCraft models */
  readonly modelled: boolean;
  /** the MeshCraft lodge, its wing and its furniture, when all three loaded */
  private lm: Record<LodgeId, THREE.Object3D> | null;
  /** true when the lodge, the wing and the furniture are the MeshCraft models */
  readonly lodgeModelled: boolean;
  /** the furniture model, painted, its pieces taken out one by one as the lodge is furnished */
  private furniture: THREE.Object3D | null = null;

  constructor(t: Terrain, topo: HTMLCanvasElement, models: PatrolModels = {}) {
    this.ym = YARD_IDS.every((id) => models[id]) ? (Object.fromEntries(YARD_IDS.map((id) => [id, models[id]!])) as unknown as Record<YardId, THREE.Object3D>) : null;
    this.modelled = !!this.ym;
    this.lm = LODGE_IDS.every((id) => models[id]) ? (Object.fromEntries(LODGE_IDS.map((id) => [id, models[id]!])) as unknown as Record<LodgeId, THREE.Object3D>) : null;
    this.lodgeModelled = !!this.lm;
    this.y = t.height(LODGE.x, LODGE.z);
    const y = this.y;
    this.windows = new THREE.MeshLambertMaterial({ color: PAL.window, emissive: 0xffa040, emissiveIntensity: 0.2 });
    this.lamps = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
    this.fireLight = new THREE.PointLight(0xff9a4a, 6, 14, 1.6);
    if (this.lm) this.furniture = paintModel(this.lm.rs_lodge_furniture, { ...this.lodgePaint(), lamp: this.lamps }, (hex) => mat(hex));
    this.rooms.push(this.buildLodge(y, topo));
    this.rooms.push(this.buildGarage(y));
    this.buildPad(y);
    this.baseKennel = this.buildKennel(y, false);
    this.upgrades.set('kennel', this.buildKennel(y, true));
    this.upgrades.set('hangar', this.buildHangar(y));
    this.upgrades.set('equipment', this.buildEquipment(y));
    this.upgrades.set('wing', this.buildWing(y));
    const mast = this.buildMast(y);
    this.upgrades.set('mast', mast.group);
    this.beacon = mast.beacon;
    const lights = this.buildLights(y);
    this.upgrades.set('lights', lights.group);
    this.flag = lights.flag;
    this.upgrades.set('workshop', this.buildWorkshop(y));
    for (const [, o] of this.upgrades) this.group.add(o);
    this.group.add(this.baseKennel);
    // merge everything that does not move into a few meshes per building
    for (const r of this.rooms) {
      // the MeshCraft lodge is painted in many roles: bake its plain colours per vertex, so each
      // cut-away wall still draws in a couple of calls
      const vc = this.lodgeModelled && r === this.rooms[0];
      for (const w of r.walls) bakeInPlace(w.obj, [...this.badgePins.values()].filter((p) => isUnder(p, w.obj)), vc);
      bakeInPlace(r.roof, [], vc);
      const keep: THREE.Object3D[] = [...r.walls.map((w) => w.obj), r.roof];
      for (const c of r.group.children) if (c.name === 'inside' || c.name === 'supply-crate') keep.push(c);
      const inside = r.group.getObjectByName('inside');
      if (inside) bakeInPlace(inside, [...this.fire, ...[...this.badgePins.values()].filter((p) => isUnder(p, inside))], vc);
      bakeInPlace(r.group, keep, vc);
    }
    for (const [id, o] of this.upgrades) bakeInPlace(o, id === 'lights' ? [this.flag] : [], id === 'wing' && this.lodgeModelled);
    bakeInPlace(this.baseKennel);
    for (const c of this.group.children) if (c.userData.pad) bakeInPlace(c);
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !(m.material instanceof THREE.MeshBasicMaterial)) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
  }

  private buildLodge(y: number, topo: HTMLCanvasElement): Room {
    const L = LODGE;
    const g = new THREE.Group();
    g.position.set(L.x, y, L.z);
    const hw = L.w / 2;
    const hd = L.d / 2;
    const walls: Room['walls'] = [];
    const roof = new THREE.Group();
    if (this.lm) {
      // the MeshCraft lodge: plinth and porch, each wall its own node (for the cut-away), the roof, the chimney
      const m = paintModel(this.lm.rs_lodge, this.lodgePaint(), (hex) => mat(hex));
      const node = (n: string) => m.getObjectByName(n)!;
      g.add(node('base'), node('chimney'));
      for (const [n, nx, nz] of [
        ['wall_n', 0, -1],
        ['wall_s', 0, 1],
        ['wall_w', -1, 0],
        ['wall_e', 1, 0],
      ] as const) {
        const o = new THREE.Group();
        o.add(node(n));
        g.add(o);
        walls.push({ obj: o, nx, nz });
      }
      roof.add(node('roof'));
      g.add(roof);
    } else {
      this.codeLodge(g, walls, roof);
    }
    this.chimney.set(L.x - hw - 0.5, y + L.wallH + 5, L.z + 2.5);
    this.smokeSources.push(this.chimney);
    // porch with a lantern and the sign
    const porch = new THREE.Group();
    if (!this.lm) {
      porch.add(box(3, 0.2, 5.6, 0x8a603a, hw + 1.5, 0.15, 0));
      for (const s of [-1, 1]) porch.add(cyl(0.12, 0.12, 2.8, 6, PAL.logDark, hw + 2.8, 1.5, s * 2.5));
      const pr = snowRoof(5.8, 3.2, 0.6);
      pr.rotation.y = Math.PI / 2;
      pr.position.set(hw + 1.6, 2.85, 0);
      roof.add(pr);
      porch.add(box(0.5, 0.45, 1.8, PAL.logDark, hw + 0.5, 0.45, -1.6));
    }
    const lantern = box(0.25, 0.35, 0.25, this.lamps, hw + 0.35, 2.4, 1.6);
    porch.add(lantern);
    const s = sign('KESSEL PATROL', 4.2, 0.8, { bg: '#f6ecdc', fg: '#7b2f3b', accent: '#d4422f' });
    s.position.set(hw + 0.22, 3.0, 0);
    s.rotation.y = Math.PI / 2;
    porch.add(s);
    g.add(porch);

    // --- inside ---
    const inside = new THREE.Group();
    // a big red rug by the fire
    inside.add(box(4.2, 0.03, 3.2, 0xa63a2c, -4.5, 0.28, 2.3));
    inside.add(box(3.6, 0.035, 2.6, 0xc9a35a, -4.5, 0.285, 2.3));
    // the hearth
    const hearth = new THREE.Group();
    if (this.lm) hearth.add(this.piece('hearth'));
    else {
      hearth.add(box(0.9, 2.4, 2.8, PAL.stone, 0, 1.45, 0));
      hearth.add(box(0.95, 1.0, 1.4, 0x1a1512, 0.05, 0.85, 0));
      hearth.add(box(1.4, 0.2, 3.2, PAL.stoneDark, 0.2, 0.32, 0));
      hearth.add(box(1.1, 0.15, 3.0, 0x6b4428, 0.1, 2.0, 0));
    }
    const fireMat = glow(0xffa040);
    const fireMat2 = glow(0xffe08a);
    for (let i = 0; i < 3; i++) {
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.2 - i * 0.03, 0.6 - i * 0.1, 6), i === 1 ? fireMat2 : fireMat);
      f.position.set(0.25, 0.65, (i - 1) * 0.28);
      this.fire.push(f);
      hearth.add(f);
    }
    if (!this.lm)
      for (const z of [-0.25, 0.25]) {
        const log = cyl(0.08, 0.08, 0.8, 6, PAL.logDark, 0.3, 0.42, z);
        log.rotation.x = Math.PI / 2;
        hearth.add(log);
      }
    hearth.position.set(-hw + 0.75, 0, 2.5);
    this.fireLight.position.set(L.x - hw + 2, y + 1.3, L.z + 2.5);
    inside.add(hearth);
    // the mission table with the valley map on it
    const table = new THREE.Group();
    const tex = new THREE.CanvasTexture(topo);
    tex.colorSpace = THREE.SRGBColorSpace;
    // a wooden top and the map as its own sheet on it: the lodge's furniture is baked into a few
    // meshes per material, and the baker skips multi-material meshes (that is how the top vanished)
    if (this.lm) table.add(this.piece('table'));
    else table.add(box(3, 0.1, 2, 0x6b4428, 0, 0.95, 0));
    const map = new THREE.Mesh(new THREE.PlaneGeometry(2.84, 1.84), new THREE.MeshLambertMaterial({ map: tex }));
    map.rotation.x = -Math.PI / 2;
    map.position.y = 1.006;
    table.add(map);
    if (!this.lm) {
      for (const [x, z] of [
        [-1.35, -0.85],
        [1.35, -0.85],
        [-1.35, 0.85],
        [1.35, 0.85],
      ])
        table.add(box(0.14, 0.9, 0.14, PAL.logDark, x, 0.5, z));
      table.add(box(0.5, 0.35, 0.3, 0x3d4a3a, 1.0, 1.15, -0.6)); // the radio
      table.add(box(0.04, 0.4, 0.04, 0x222222, 1.15, 1.45, -0.6));
    }
    table.position.set(SPOTS.table.x - L.x, 0.25, SPOTS.table.z - L.z);
    inside.add(table);
    // the bunk
    const bed = new THREE.Group();
    if (this.lm) bed.add(this.piece('bunk'));
    else {
      bed.add(box(3.6, 0.4, 1.8, PAL.logDark, 0, 0.45, 0));
      bed.add(box(3.4, 0.25, 1.65, 0xb33a2e, 0.1, 0.75, 0));
      for (let i = -3; i <= 3; i++) bed.add(box(0.06, 0.26, 1.66, 0x7d2a22, i * 0.45, 0.755, 0));
      bed.add(box(0.6, 0.2, 1.3, 0xf3efe6, -1.4, 0.95, 0));
      bed.add(box(0.2, 1.2, 1.8, PAL.logDark, -1.85, 0.85, 0));
    }
    bed.position.set(-35.6 - L.x, 0.25, 240.2 - L.z);
    inside.add(bed);
    // wardrobe
    const ward = new THREE.Group();
    if (this.lm) ward.add(this.piece('wardrobe'));
    else {
      ward.add(box(1.6, 2.3, 0.7, 0x7a4f2e, 0, 1.15, 0));
      ward.add(box(0.03, 2.1, 0.02, 0x4a2e1a, 0, 1.15, 0.36));
      ward.add(ball(0.05, PAL.yellow, -0.12, 1.2, 0.38, 6), ball(0.05, PAL.yellow, 0.12, 1.2, 0.38, 6));
    }
    ward.position.set(SPOTS.wardrobe.x - L.x, 0.25, SPOTS.wardrobe.z - 0.3 - L.z);
    inside.add(ward);
    // the badge board on the south wall: a pin for each one you have found
    const board = new THREE.Group();
    board.add(box(2.6, 1.4, 0.08, 0x5e3a22, 0, 0, 0));
    board.add(box(2.4, 1.2, 0.09, 0x2f4a3a, 0, 0, 0));
    BADGES.forEach((b, i) => {
      const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.04, 10), mat([0xd8382a, 0xf2c230, 0x2f7fb8, 0xf3efe6, 0x3c6b4a][i % 5]));
      pin.rotation.x = Math.PI / 2;
      pin.position.set(-0.9 + (i % 5) * 0.45, i < 5 ? 0.25 : -0.25, -0.06);
      pin.visible = false;
      this.badgePins.set(b.id, pin);
      board.add(pin);
      const slot = new THREE.Mesh(new THREE.CircleGeometry(0.11, 10), mat(0x24382c));
      slot.position.set(pin.position.x, pin.position.y, -0.05);
      slot.rotation.y = Math.PI;
      board.add(slot);
    });
    board.position.set(SPOTS.badges.x - L.x, 1.9, hd - 0.3);
    board.rotation.y = Math.PI;
    inside.add(board);
    // Koda's bed by the fire
    if (this.lm) inside.add(this.piece('dogbed').translateX(SPOTS.dogBed.x - L.x).translateY(0.25).translateZ(SPOTS.dogBed.z - L.z));
    else {
      const dogBed = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.18, 6, 14), mat(0x2f5f9e));
      dogBed.rotation.x = Math.PI / 2;
      dogBed.position.set(SPOTS.dogBed.x - L.x, 0.42, SPOTS.dogBed.z - L.z);
      const cushion = cyl(0.45, 0.45, 0.12, 14, 0xe8dcc8, SPOTS.dogBed.x - L.x, 0.33, SPOTS.dogBed.z - L.z);
      inside.add(dogBed, cushion);
    }
    // an armchair, a shelf of books, a hanging lamp, skis on the wall
    const chair = new THREE.Group();
    if (this.lm) chair.add(this.piece('armchair'));
    else chair.add(box(1, 0.45, 1, 0x3c6b4a, 0, 0.5, 0), box(1, 0.9, 0.25, 0x3c6b4a, 0, 0.95, 0.4), box(0.2, 0.6, 1, 0x2f553a, -0.45, 0.75, 0), box(0.2, 0.6, 1, 0x2f553a, 0.45, 0.75, 0));
    chair.position.set(-4.6, 0.25, 4.6);
    chair.rotation.y = -2.4;
    inside.add(chair);
    const shelf = new THREE.Group();
    if (this.lm) shelf.add(this.piece('shelf'));
    else {
      shelf.add(box(2, 1.6, 0.4, 0x6b4428, 0, 0.8, 0));
      for (let k = 0; k < 9; k++) shelf.add(box(0.15, 0.45, 0.3, [0xa63a2c, 0x2f5f9e, 0xe9c46a, 0x3c6b4a][k % 4], -0.8 + k * 0.2, 1.3, 0.02));
      for (let k = 0; k < 7; k++) shelf.add(box(0.18, 0.4, 0.3, [0x7a4f2e, 0xf3efe6, 0xa63a2c][k % 3], -0.7 + k * 0.22, 0.6, 0.02));
    }
    shelf.position.set(3.2, 0.25, hd - 0.45);
    shelf.rotation.y = Math.PI;
    inside.add(shelf);
    const lamp = new THREE.Group();
    if (this.lm) lamp.add(this.piece('lamp'));
    else lamp.add(cyl(0.02, 0.02, 0.9, 4, 0x222222, 0, 0.45, 0), new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.3, 10, 1, true), mat(0x3d4a3a, { side: THREE.DoubleSide })), ball(0.12, this.lamps, 0, -0.1, 0, 8));
    lamp.position.set(SPOTS.table.x - L.x, 2.6, SPOTS.table.z - L.z);
    inside.add(lamp);
    for (let k = 0; k < 3; k++) {
      const ski = box(0.1, 1.8, 0.04, [PAL.red, PAL.wood, 0x2a9d8f][k], 5.6 + k * 0.25, 1.3, -hd + 0.3);
      ski.name = 'wall-skis';
      inside.add(ski);
    }
    inside.name = 'inside';
    g.add(inside);
    // what hangs on a wall, or is built into it, goes with that wall in the cut-away: the porch sign and
    // lantern with the east wall, the chimney with the west, the badge board with the south, the skis
    // hung on the north wall with it
    const wallAt = (nx: number, nz: number) => walls.find((w) => w.nx === nx && w.nz === nz)!.obj;
    wallAt(1, 0).add(lantern, s);
    for (const c of g.children.filter((c) => c.name === 'chimney')) wallAt(-1, 0).add(c);
    wallAt(0, 1).add(board);
    for (const c of inside.children.filter((c) => c.name === 'wall-skis')) wallAt(0, -1).add(c);
    this.group.add(g);
    this.group.add(this.fireLight);
    return { group: g, roof, walls, x: L.x, z: L.z };
  }


  /** The game's materials for the lodge's paint roles (the wing uses the same). */
  private lodgePaint(): Record<string, THREE.Material> {
    return {
      log: mat(PAL.log),
      logShade: mat(shade(PAL.log, 0.92)),
      grain: mat(PAL.logLight),
      logLight: mat(PAL.logLight),
      logDark: mat(PAL.logDark),
      roof: mat(PAL.roof),
      roofSnow: mat(PAL.roofSnow),
      stone: mat(PAL.stone),
      stoneDark: mat(PAL.stoneDark),
      window: this.windows,
      floor: mat(0xa77a4c),
      floorDark: mat(0x8a603a),
      door: mat(0x6b4428),
      shutter: mat(PAL.green),
      dark: mat(0x1a1512),
    };
  }

  /** One piece of the MeshCraft furniture (its origin is where the code's group stood). */
  private piece(name: string): THREE.Object3D {
    const o = this.furniture!.getObjectByName(name)!;
    o.removeFromParent();
    o.position.set(0, 0, 0);
    o.rotation.set(0, 0, 0);
    return o;
  }

  /** The code-built lodge shell (walls, windows, door, roof, gables, chimney): the fallback. */
  private codeLodge(g: THREE.Group, walls: Room['walls'], roof: THREE.Group) {
    const L = LODGE;
    const hw = L.w / 2;
    const hd = L.d / 2;
    // foundation and floor
    g.add(box(L.w + 0.6, 0.5, L.d + 0.6, PAL.stone, 0, -0.1, 0));
    const floor = box(L.w - 0.3, 0.12, L.d - 0.3, 0xa77a4c, 0, 0.2, 0);
    g.add(floor);
    for (let i = -7; i <= 7; i++) g.add(box(0.03, 0.125, L.d - 0.3, 0x8a603a, i, 0.205, 0));
    const wall = (len: number, x: number, z: number, rotY: number, nx: number, nz: number, extra: THREE.Object3D[] = []) => {
      const w = new THREE.Group();
      const logs = logWall(len, L.wallH);
      logs.rotation.y = rotY;
      logs.position.set(x, 0.25, z);
      w.add(logs, ...extra);
      g.add(w);
      walls.push({ obj: w, nx, nz });
      return w;
    };
    // windows (outside and in)
    const win = (x: number, z: number, rotY: number) => {
      const o = windowPane(1.3, 1.1, this.windows);
      o.position.set(x, 1.75, z);
      o.rotation.y = rotY;
      return o;
    };
    wall(L.w, 0, -hd, 0, 0, -1, [win(-3, -hd - 0.2, Math.PI), win(4, -hd - 0.2, Math.PI)]);
    wall(L.w, 0, hd, 0, 0, 1, [win(-4, hd + 0.2, 0), win(1, hd + 0.2, 0), win(5, hd + 0.2, 0)]);
    wall(L.d, -hw, 0, Math.PI / 2, -1, 0);
    // east wall with the door
    const seg = (L.d - 2.4) / 2;
    const east = wall(seg, hw, -hd + seg / 2, Math.PI / 2, 1, 0, [win(hw + 0.2, -3.6, Math.PI / 2)]);
    const e2 = logWall(seg, L.wallH);
    e2.rotation.y = Math.PI / 2;
    e2.position.set(hw, 0.25, hd - seg / 2);
    const lintel = logWall(2.6, 0.7);
    lintel.rotation.y = Math.PI / 2;
    lintel.position.set(hw, 2.65, 0);
    east.add(e2, lintel);
    // gable ends and the roof
    const r = snowRoof(L.w + 1.8, L.d + 1.6, 2.7);
    r.position.y = L.wallH + 0.25;
    roof.add(r);
    for (const s of [-1, 1]) {
      const ge = gable(0.32, 2.7, L.d, PAL.logLight);
      ge.position.set(s * (hw - 0.05), L.wallH + 0.25, 0);
      roof.add(ge);
    }
    // ceiling beams (seen from inside with the roof off? no: part of the roof)
    g.add(roof);
    // chimney on the west end
    const chim = box(1.2, L.wallH + 4.5, 1.2, PAL.stone, -hw - 0.5, (L.wallH + 4.5) / 2, 2.5);
    const cap = box(1.5, 0.3, 1.5, PAL.stoneDark, -hw - 0.5, L.wallH + 4.6, 2.5);
    chim.name = cap.name = 'chimney';
    g.add(chim, cap);
  }

  /** A MeshCraft yard building, painted with the game's own materials (see paintModel). */
  private yard(id: YardId, paint: Record<string, THREE.Material>): THREE.Group {
    return paintModel(this.ym![id], { roofSnow: mat(PAL.roofSnow), logDark: mat(PAL.logDark), stoneDark: mat(PAL.stoneDark), red: mat(PAL.red), white: mat(PAL.white), metal: mat(PAL.metal), trim: mat(PAL.white), ...paint }, (hex) => mat(hex));
  }

  private buildGarage(y: number): Room {
    const G = GARAGE;
    const g = new THREE.Group();
    g.position.set(G.x, y, G.z);
    const hw = G.w / 2;
    const hd = G.d / 2;
    // the garage: painted mint boards
    const plank = 0x8fbfa8;
    const walls: Room['walls'] = [];
    let roof: THREE.Group;
    if (this.ym) {
      // the MeshCraft garage: each wall, the front and the roof its own node, for the cut-away
      const m = this.yard('rs_garage', {
        boards: mat(plank),
        batten: mat(shade(plank, 0.8)),
        header: mat(shade(plank, 0.7)),
        floor: mat(0x9c9a94),
        rolled: mat(0xe9e2d0),
        roofDark: mat(0x4a4f55),
        window: this.windows,
      });
      const node = (n: string) => m.getObjectByName(n)!;
      g.add(node('floor'));
      for (const [n, nx, nz] of [
        ['wall_n', 0, -1],
        ['wall_s', 0, 1],
        ['wall_e', 1, 0],
      ] as const) {
        const o = new THREE.Group();
        o.add(node(n));
        g.add(o);
        walls.push({ obj: o, nx, nz });
      }
      const front = new THREE.Group();
      front.add(node('front'));
      const s = sign('GARAGE', 2.6, 0.55, { bg: '#7b2f3b', fg: '#f6ecdc' });
      s.position.set(-hw - 0.22, G.wallH + 0.4, 0);
      s.rotation.y = -Math.PI / 2;
      front.add(s);
      g.add(front);
      walls.push({ obj: front, nx: -1, nz: 0 });
      roof = new THREE.Group();
      roof.add(node('roof'));
      g.add(roof);
    } else {
    g.add(box(G.w, 0.15, G.d, 0x9c9a94, 0, 0.07, 0));
    const wall = (w: number, d: number, x: number, z: number, nx: number, nz: number) => {
      const o = new THREE.Group();
      o.add(box(w, G.wallH, d, plank, x, G.wallH / 2, z));
      // vertical battens
      const n = Math.round(Math.max(w, d) / 0.6);
      for (let i = 0; i < n; i++) {
        const u = -0.5 + (i + 0.5) / n;
        o.add(box(w > d ? 0.08 : d + 0.04, G.wallH, w > d ? d + 0.04 : 0.08, shade(plank, 0.8), w > d ? x + u * w : x, G.wallH / 2, w > d ? z : z + u * d));
      }
      g.add(o);
      walls.push({ obj: o, nx, nz });
    };
    wall(G.w, 0.3, 0, -hd, 0, -1);
    wall(G.w, 0.3, 0, hd, 0, 1);
    wall(0.3, G.d, hw, 0, 1, 0);
    // west front: posts either side of the big door, a header beam
    const front = new THREE.Group();
    const side = (G.d - 5.5) / 2;
    front.add(box(0.3, G.wallH, side, plank, -hw, G.wallH / 2, -hd + side / 2));
    front.add(box(0.3, G.wallH, side, plank, -hw, G.wallH / 2, hd - side / 2));
    front.add(box(0.4, 0.7, G.d, shade(plank, 0.7), -hw, G.wallH - 0.35, 0));
    // the door, rolled up
    front.add(box(0.3, 0.5, 5.6, 0xe9e2d0, -hw + 0.2, G.wallH - 0.95, 0));
    const s = sign('GARAGE', 2.6, 0.55, { bg: '#7b2f3b', fg: '#f6ecdc' });
    s.position.set(-hw - 0.22, G.wallH + 0.4, 0);
    s.rotation.y = -Math.PI / 2;
    front.add(s);
    g.add(front);
    walls.push({ obj: front, nx: -1, nz: 0 });
    roof = new THREE.Group();
    const r = snowRoof(G.w + 1.2, G.d + 1.2, 1.8, 0x4a4f55);
    r.position.y = G.wallH;
    roof.add(r);
    for (const sd of [-1, 1]) {
      const ge = gable(0.3, 1.8, G.d, plank);
      ge.position.set(sd * (hw - 0.1), G.wallH, 0);
      roof.add(ge);
    }
    g.add(roof);
    }
    // inside: the explosives locker, oil drums, a bench
    const locker = new THREE.Group();
    locker.add(box(1.2, 1.8, 0.6, PAL.red, 0, 0.9, 0));
    locker.add(box(0.5, 0.5, 0.02, PAL.yellow, 0, 1.3, -0.31));
    locker.position.set(SPOTS.locker.x - G.x, 0.15, SPOTS.locker.z - G.z + 0.4);
    locker.rotation.y = Math.PI;
    g.add(locker);
    g.add(cyl(0.3, 0.3, 0.9, 10, 0x2f5f9e, 4.8, 0.6, -3.9), cyl(0.3, 0.3, 0.9, 10, PAL.red, 4.1, 0.6, -4.1));
    g.add(box(0.8, 0.9, 2.6, PAL.logDark, SPOTS.workbench.x - G.x + 1.2, 0.6, SPOTS.workbench.z - G.z));
    g.add(box(0.4, 1.2, 1.4, 0x5e6266, SPOTS.workbench.x - G.x + 1.4, 1.65, SPOTS.workbench.z - G.z));
    // the supply crates out front
    const cr = new THREE.Group();
    cr.add(box(1.0, 0.7, 0.9, PAL.wood, 0, 0.35, 0), box(1.04, 0.1, 0.94, PAL.logDark, 0, 0.66, 0));
    cr.position.set(SPOTS.crate.x - G.x, 0, SPOTS.crate.z - G.z);
    cr.name = 'supply-crate';
    g.add(cr);
    this.group.add(g);
    return { group: g, roof, walls, x: G.x, z: G.z };
  }

  /** The supply crate in the yard (hidden once it is on the sled). */
  get crate(): THREE.Object3D {
    return this.rooms[1].group.getObjectByName('supply-crate')!;
  }

  private buildWorkshop(y: number): THREE.Group {
    const g = new THREE.Group();
    g.position.set(GARAGE.x, y, GARAGE.z);
    // a tool wall, a hoist, a tyre stack, a bright work lamp
    const wall = box(0.1, 1.6, 3.4, 0x5e6266, GARAGE.w / 2 - 0.25, 2.0, -3.0);
    g.add(wall);
    for (let i = 0; i < 6; i++) g.add(box(0.08, 0.35 + (i % 3) * 0.1, 0.08, [PAL.red, PAL.yellow, 0x2f5f9e][i % 3], GARAGE.w / 2 - 0.35, 2.1, -4.3 + i * 0.5));
    g.add(box(0.2, 0.2, GARAGE.d - 0.6, 0x3a3e44, 0, GARAGE.wallH - 0.3, 0));
    g.add(cyl(0.03, 0.03, 1.4, 4, 0x222222, 0, GARAGE.wallH - 1.0, 0), box(0.3, 0.3, 0.3, PAL.yellow, 0, GARAGE.wallH - 1.8, 0));
    for (let i = 0; i < 3; i++) {
      const tire = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.14, 6, 12), mat(0x1d1f22));
      tire.rotation.x = Math.PI / 2;
      tire.position.set(-4.4, 0.25 + i * 0.28, 3.8);
      g.add(tire);
    }
    g.add(box(0.5, 0.15, 0.3, glow(0xfff4e0), 2, GARAGE.wallH - 0.15, 0));
    return g;
  }

  private buildPad(y: number) {
    const g = new THREE.Group();
    g.position.set(PAD.x, y + 0.05, PAD.z);
    const disc = cyl(PAD.r, PAD.r + 0.3, 0.2, 32, 0x50565c, 0, 0, 0);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(PAD.r - 0.8, 0.18, 4, 40), mat(PAL.yellow));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.11;
    g.add(disc, ring);
    // the H
    g.add(box(0.7, 0.03, 4.4, PAL.white, -1.4, 0.12, 0), box(0.7, 0.03, 4.4, PAL.white, 1.4, 0.12, 0), box(2.2, 0.03, 0.7, PAL.white, 0, 0.12, 0));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      g.add(box(0.25, 0.25, 0.25, glow(0x5ad1ff), Math.cos(a) * (PAD.r + 0.6), 0.15, Math.sin(a) * (PAD.r + 0.6)));
    }
    // windsock
    const pole = cyl(0.06, 0.06, 4, 6, PAL.metal, PAD.r + 2, 2, -PAD.r);
    const sock = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.6, 8, 1, true), mat(0xff7a1a, { side: THREE.DoubleSide }));
    sock.rotation.z = Math.PI / 2;
    sock.position.set(PAD.r + 2.8, 3.8, -PAD.r);
    g.add(pole, sock);
    g.userData.pad = true;
    this.group.add(g);
  }

  private buildKennel(y: number, upgraded: boolean): THREE.Group {
    const g = new THREE.Group();
    g.position.set(KENNEL.x, y, KENNEL.z);
    const s = upgraded ? 1.25 : 1;
    const wood = upgraded ? 0x7a4f2e : 0x8a603a;
    const house = this.ym
      ? this.yard('rs_doghouse', { wall: mat(wood), plank: mat(shade(wood, 0.85)), roof: mat(upgraded ? PAL.red : PAL.roof), dark: mat(0x1a1512) })
      : new THREE.Group();
    if (this.ym) house.scale.setScalar(s);
    else {
    house.add(box(1.8 * s, 1.1 * s, 2.2 * s, wood, 0, 0.55 * s, 0));
    const r = snowRoof(2.4 * s, 2.6 * s, 0.8 * s, upgraded ? PAL.red : PAL.roof, 0.18);
    r.rotation.y = Math.PI / 2;
    r.position.y = 1.1 * s;
    house.add(r);
    house.add(box(0.75 * s, 0.75 * s, 0.05, 0x1a1512, 0, 0.42 * s, 1.11 * s));
    }
    g.add(house);
    // bowl (and a name board when upgraded)
    g.add(cyl(0.22, 0.17, 0.12, 12, 0x2f5f9e, SPOTS.bowl.x - KENNEL.x, 0.06, SPOTS.bowl.z - KENNEL.z));
    if (upgraded) {
      const nm = sign('KODA', 1.3, 0.35, { bg: '#e7aaa6', fg: '#7b2f3b' });
      nm.position.set(0, 1.6 * s, 1.15 * s);
      g.add(nm);
      // the fenced run
      const fence = new THREE.Group();
      const posts = 14;
      for (let i = 0; i < posts; i++) {
        const a = (i / posts) * Math.PI * 2;
        fence.add(box(0.12, 1.0, 0.12, PAL.logLight, Math.cos(a) * 4.5, 0.5, Math.sin(a) * 4.5 + 1));
        const a2 = ((i + 1) / posts) * Math.PI * 2;
        const rail = box(0.08, 0.08, 4.5 * 2 * Math.sin(Math.PI / posts), PAL.logLight);
        rail.position.set(((Math.cos(a) + Math.cos(a2)) / 2) * 4.5, 0.75, ((Math.sin(a) + Math.sin(a2)) / 2) * 4.5 + 1);
        rail.rotation.y = -(a + a2) / 2;
        fence.add(rail);
      }
      g.add(fence);
      // a chew toy and a ball
      g.add(ball(0.12, PAL.yellow, 2, 0.12, 2.5, 8), box(0.4, 0.1, 0.1, 0xe8dcc8, -1.8, 0.05, 2.8));
    }
    return g;
  }

  private buildHangar(y: number): THREE.Group {
    const H = HANGAR;
    const g = new THREE.Group();
    g.position.set(H.x, y, H.z);
    const steel = 0x6e7a85;
    if (this.ym) {
      g.add(this.yard('rs_hangar', { steel: mat(steel), rib: mat(shade(steel, 0.8)), arch: mat(0x4f5a64), floor: mat(0x9c9a94), hut: mat(0x5e6266) }));
    } else {
    g.add(box(H.w, 0.15, H.d, 0x9c9a94, 0, 0.07, 0));
    g.add(box(H.w - 2, H.wallH, 0.3, steel, 1, H.wallH / 2, -H.d / 2), box(H.w - 2, H.wallH, 0.3, steel, 1, H.wallH / 2, H.d / 2), box(0.3, H.wallH, H.d, steel, H.w / 2, H.wallH / 2, 0));
    for (let i = 0; i < 10; i++) {
      const x = -H.w / 2 + 2 + i * ((H.w - 2) / 10);
      g.add(box(0.12, H.wallH, 0.36, shade(steel, 0.8), x, H.wallH / 2, -H.d / 2), box(0.12, H.wallH, 0.36, shade(steel, 0.8), x, H.wallH / 2, H.d / 2));
    }
    // a curved roof: a half cylinder along x
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(H.d / 2 + 0.4, H.d / 2 + 0.4, H.w, 20, 1, false, 0, Math.PI), mat(0x4f5a64, { side: THREE.DoubleSide }));
    roof.rotation.z = Math.PI / 2;
    roof.rotation.x = Math.PI / 2;
    roof.scale.set(1, 1, 0.35);
    roof.position.set(1, H.wallH, 0);
    const snow = new THREE.Mesh(new THREE.CylinderGeometry(H.d / 2 + 0.55, H.d / 2 + 0.55, H.w - 0.3, 20, 1, false, Math.PI * 0.2, Math.PI * 0.6), mat(PAL.roofSnow, { side: THREE.DoubleSide }));
    snow.rotation.copy(roof.rotation);
    snow.scale.copy(roof.scale);
    snow.position.copy(roof.position);
    g.add(roof, snow);
    }
    const s = sign('HANGAR 1', 4, 0.8, { bg: '#5a4f6e', fg: '#e0b042' });
    s.position.set(-H.w / 2 + 1.2, H.wallH + 1.6, 0);
    s.rotation.y = -Math.PI / 2;
    g.add(s);
    // fuel bowser and a tool cart inside
    g.add(box(1.4, 1.3, 3, PAL.red, 4, 0.8, -5.5), cyl(0.5, 0.5, 2.6, 10, 0xe9e2d0, 4, 1.9, -5.5));
    return g;
  }

  private buildEquipment(y: number): THREE.Group {
    const E = EQUIP;
    const g = new THREE.Group();
    g.position.set(E.x, y, E.z);
    if (this.ym) {
      g.add(this.yard('rs_equipment', { boat: mat(0x7a4f2e), boatDark: mat(0x5e3a22), roof: mat(PAL.roof), window: this.windows }));
    } else {
    g.add(box(E.w, E.wallH, E.d, 0x7a4f2e, 0, E.wallH / 2, 0));
    for (let i = 0; i < 12; i++) g.add(box(0.08, E.wallH, E.d + 0.04, 0x5e3a22, -E.w / 2 + 0.4 + i * 0.75, E.wallH / 2, 0));
    const r = snowRoof(E.w + 1, E.d + 1, 1.4);
    r.position.y = E.wallH;
    g.add(r);
    g.add(box(1.4, 2.2, 0.1, 0x3d2a1c, 0, 1.1, E.d / 2 + 0.05));
    }
    const s = sign('EQUIPMENT', 3, 0.55, { bg: '#9cc9b3', fg: '#3a2632' });
    s.position.set(0, E.wallH - 0.4, E.d / 2 + 0.08);
    g.add(s);
    // a ski rack outside
    for (let i = 0; i < 6; i++) {
      const ski = box(0.1, 1.9, 0.05, [PAL.red, PAL.wood, 0x2a9d8f, PAL.yellow][i % 4], 2.2 + i * 0.22, 1.0, E.d / 2 + 0.4);
      ski.rotation.x = -0.15;
      g.add(ski);
    }
    g.add(box(1.6, 0.1, 0.3, PAL.logDark, 2.75, 0.4, E.d / 2 + 0.55));
    g.add(new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.07, 6, 14), mat(0xff7a1a)).translateX(-2.6).translateY(1.6).translateZ(E.d / 2 + 0.1));
    return g;
  }

  private buildWing(y: number): THREE.Group {
    const W = WING;
    const g = new THREE.Group();
    g.position.set(W.x, y, W.z);
    if (this.lm) {
      g.add(paintModel(this.lm.rs_lodge_wing, this.lodgePaint(), (hex) => mat(hex)));
      return g;
    }
    g.add(box(W.w + 0.4, 0.5, W.d + 0.4, PAL.stone, 0, -0.1, 0));
    for (const [len, x, z, rot] of [
      [W.w, 0, -W.d / 2, 0],
      [W.d, -W.w / 2, 0, Math.PI / 2],
      [W.d, W.w / 2, 0, Math.PI / 2],
    ] as const) {
      const l = logWall(len, W.wallH);
      l.rotation.y = rot;
      l.position.set(x, 0.25, z);
      g.add(l);
    }
    for (const x of [-3.5, 0, 3.5]) {
      const w = windowPane(1.1, 0.9, this.windows);
      w.position.set(x, 1.7, -W.d / 2 - 0.2);
      w.rotation.y = Math.PI;
      g.add(w);
    }
    const r = snowRoof(W.w + 1.4, W.d + 1.2, 2);
    r.position.y = W.wallH + 0.25;
    g.add(r);
    for (const s of [-1, 1]) {
      const ge = gable(0.3, 2, W.d, PAL.logLight);
      ge.position.set(s * (W.w / 2 - 0.05), W.wallH + 0.25, 0);
      g.add(ge);
    }
    return g;
  }

  private buildMast(y: number): { group: THREE.Group; beacon: THREE.Mesh } {
    const g = new THREE.Group();
    g.position.set(MAST.x, y, MAST.z);
    const H = 20;
    if (this.ym) {
      g.add(this.yard('rs_mast', { hut: mat(0x5e6266), roofDark: mat(0x4a4f55) }));
    } else {
    for (let i = 0; i < 8; i++) {
      const c = i % 2 ? PAL.white : PAL.red;
      const seg = cyl(0.55 - i * 0.04, 0.6 - i * 0.04, H / 8, 4, c, 0, (i + 0.5) * (H / 8), 0);
      seg.rotation.y = Math.PI / 4;
      g.add(seg);
    }
    g.add(box(1.4, 0.2, 0.8, PAL.metal, 0.5, 14, 0), box(0.2, 1.4, 0.2, PAL.metal, 1.1, 15, 0));
    const dish = new THREE.Mesh(new THREE.SphereGeometry(0.8, 12, 8, 0, Math.PI * 2, 0, 0.9), mat(PAL.white, { side: THREE.DoubleSide }));
    dish.rotation.z = Math.PI / 2;
    dish.position.set(-0.6, 12, 0);
    g.add(dish);
    g.add(box(2.2, 1.8, 1.8, 0x5e6266, 1.6, 0.9, 1.6));
    }
    const beacon = ball(0.3, glow(0xff3020), 0, H + 0.3, 0, 8);
    g.add(beacon);
    return { group: g, beacon };
  }

  private buildLights(y: number): { group: THREE.Group; flag: THREE.Mesh } {
    const g = new THREE.Group();
    const spots = [
      [-14, 232],
      [-14, 258],
      [8, 238],
      [8, 262],
      [16, 248],
      [30, 262],
      [14, 284],
      [-20, 270],
    ];
    for (const [x, z] of spots) {
      const post = new THREE.Group();
      post.add(cyl(0.08, 0.1, 3, 6, 0x262a30, 0, 1.5, 0), box(0.35, 0.45, 0.35, this.lamps, 0, 3.1, 0), box(0.5, 0.08, 0.5, 0x262a30, 0, 3.38, 0));
      post.position.set(x, y, z);
      g.add(post);
    }
    // two of them carry real light at night
    for (const [x, z] of [spots[0], spots[4]]) {
      const l = new THREE.PointLight(0xffc77a, 0, 22, 1.5);
      l.position.set(x, y + 3, z);
      this.lampLights.push(l);
      g.add(l);
    }
    // the patrol flag
    const pole = cyl(0.07, 0.09, 9, 6, PAL.metal, 6, y + 4.5, 270);
    const tex = signTexture('', '#d8382a', '#ffffff', 256, 160, '#f3efe6');
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.5, 8, 1), new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }));
    flag.position.set(7.25, y + 8.1, 270);
    g.add(pole, flag);
    return { group: g, flag };
  }

  /** Which upgrades stand. */
  setUpgrades(have: readonly UpgradeId[]) {
    for (const [id, o] of this.upgrades) o.visible = have.includes(id);
    this.baseKennel.visible = !have.includes('kennel');
  }

  setBadges(found: readonly string[]) {
    for (const [id, pin] of this.badgePins) pin.visible = found.includes(id);
  }

  /**
   * Cut away the roof (and the walls on the camera's side) of the room you are standing in,
   * so you can see yourself inside.
   */
  cutaway(px: number, pz: number, cam: THREE.Vector3) {
    for (const r of this.rooms) {
      const lodge = r === this.rooms[0];
      // the lodge's cutaway reaches out over the porch
      const dx = px - r.x;
      const playerIn = (lodge ? dx > -LODGE.w / 2 - 0.6 && dx < LODGE.w / 2 + 3.4 : Math.abs(dx) < GARAGE.w / 2 + 0.6) && Math.abs(pz - r.z) < (lodge ? LODGE.d : GARAGE.d) / 2 + 0.6;
      // the camera inside the lodge's roof (over the room or under the porch roof, as it is when you walk
      // out of the door with the camera behind you) cuts it away too, so it never looks out through logs
      const cx = cam.x - r.x;
      const camIn = lodge && cx > -LODGE.w / 2 - 1.0 && cx < LODGE.w / 2 + 3.6 && Math.abs(cam.z - r.z) < LODGE.d / 2 + 1.0 && cam.y < this.y + LODGE.wallH + 3.3;
      const inside = playerIn || camIn;
      r.roof.visible = !inside;
      for (const w of r.walls) {
        const facing = (cam.x - r.x) * w.nx + (cam.z - r.z) * w.nz > 0;
        w.obj.visible = !(inside && facing);
      }
    }
  }

  /** Where the flames sit in the hearth, in world space (the FXCraft fire is emitted here). */
  hearthAt(out: THREE.Vector3): THREE.Vector3 {
    // the mouth of the firebox, just in front of the coded flames
    // (the lodge bake moves the flames up to the interior's group, so work from the flame itself)
    const f = this.fire[1];
    f.parent!.updateWorldMatrix(true, false);
    return f.parent!.localToWorld(out.copy(f.position).add(HEARTH_MOUTH));
  }

  update(dt: number, night: number) {
    this.t += dt;
    const flick = 0.85 + Math.sin(this.t * 13) * 0.08 + Math.sin(this.t * 7.3) * 0.07;
    this.fireLight.intensity = 7 * flick;
    this.fire.forEach((f, i) => (f.scale.y = 0.8 + Math.sin(this.t * (9 + i * 3) + i) * 0.25));
    this.windows.emissiveIntensity = 0.25 + night * 1.6;
    for (const l of this.lampLights) l.intensity = night * 14;
    (this.beacon.material as THREE.MeshBasicMaterial).color.setHex(Math.sin(this.t * 3) > 0.6 ? 0xff3020 : 0x401010);
    const pos = this.flag.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + 1.2;
      pos.setZ(i, Math.sin(this.t * 4 - x * 2.2) * 0.12 * x);
    }
    pos.needsUpdate = true;
    if (this.gate) this.gate.rotation.z = 0;
  }
}
