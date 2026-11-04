import * as THREE from 'three';
import { mulberry32 } from '../sim/noise';
import { BOWL, LAKE, LIFT, pad, VILLAGE } from '../world/places';
import { routeSamples, type Terrain } from '../world/terrain';
import { bakeInPlace, ball, bake, box, cyl, gable, glow, logWall, mat, PAL, shade, snowRoof, windowPane } from './kit';
import { BUILDING_IDS, roleOf, type BuildingId, type PatrolModels } from './patrolModels';
import { sign } from './stationView';

/**
 * The rest of the valley's hand-made places: Hollin village with its chapel and the Kettle,
 * the Tannberg lift and huts, the weather station on the pass, Fernhut cabin, the boathouse on
 * Mirror Lake, the berm and signs at Kessel Bowl, and snow poles along every road.
 */
export class WorldView {
  readonly group = new THREE.Group();
  readonly smokeSources: THREE.Vector3[] = [];
  private chairs: { m: THREE.Object3D; s: number }[] = [];
  private liftLine: { a: THREE.Vector3; b: THREE.Vector3; len: number; dir: THREE.Vector3 } | null = null;
  private windows: THREE.MeshLambertMaterial;
  private streetLights: THREE.MeshBasicMaterial;
  private anemo: THREE.Group | null = null;
  private stationIce: THREE.Mesh | null = null;
  private stationLight: THREE.Mesh | null = null;
  stationWorking = false;
  private t = 0;
  /** the MeshCraft buildings, when every one of them loaded (otherwise the code builds them all) */
  private bm: Record<BuildingId, THREE.Object3D> | null;
  /** true when the valley's buildings are the MeshCraft models */
  readonly modelled: boolean;

  constructor(
    private terrain: Terrain,
    models: PatrolModels = {},
  ) {
    this.bm = BUILDING_IDS.every((id) => models[id]) ? (Object.fromEntries(BUILDING_IDS.map((id) => [id, models[id]!])) as unknown as Record<BuildingId, THREE.Object3D>) : null;
    this.modelled = !!this.bm;
    this.windows = new THREE.MeshLambertMaterial({ color: PAL.window, emissive: 0xffa040, emissiveIntensity: 0.2 });
    this.streetLights = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
    // each place is built, then merged into a handful of meshes of its own (so it still culls)
    const region = (build: () => void, keep: () => THREE.Object3D[] = () => []) => {
      const before = new Set(this.group.children);
      build();
      const g = new THREE.Group();
      for (const c of [...this.group.children]) if (!before.has(c)) g.add(c);
      this.group.add(g);
      bakeInPlace(g, keep());
    };
    region(() => this.buildVillage());
    region(() => this.buildResort(), () => this.chairs.map((c) => c.m));
    region(() => this.buildWeatherStation(), () => [this.anemo!, this.stationIce!, this.stationLight!]);
    region(() => this.buildCabin());
    region(() => this.buildBoathouse());
    region(() => this.buildBowl());
    this.buildPoles();
  }

  private ground(x: number, z: number) {
    return this.terrain.height(x, z);
  }

  /**
   * A copy of a MeshCraft building, painted with the game's own materials: each part carries a
   * palette role, and `paint` says which material that role is for this building (its wall and roof
   * colours, the lit windows). Roles not named take the valley's standard material for them. So a
   * region still bakes into one mesh per material, as the code-built version did.
   */
  private building(id: BuildingId, paint: Record<string, THREE.Material> = {}): THREE.Group {
    const std: Record<string, THREE.Material> = {
      stone: mat(PAL.stone),
      stoneDark: mat(PAL.stoneDark),
      trim: mat(PAL.white),
      logDark: mat(PAL.logDark),
      logLight: mat(PAL.logLight),
      roofSnow: mat(PAL.roofSnow),
      window: this.windows,
      door: mat(0x6b4428),
      log: mat(PAL.log),
      logShade: mat(shade(PAL.log, 0.92)),
      grain: mat(0xd6b38a),
      dome: mat(PAL.mustard),
      spire: mat(PAL.yellow),
      belfry: mat(0x262a30),
      boat: mat(0x6b4428),
      boatDark: mat(0x3d2a1c),
      wall: mat(PAL.white),
      plank: mat(shade(PAL.white, 0.9)),
      roof: mat(PAL.roof),
      shutter: mat(PAL.green),
    };
    const g = this.bm![id].clone(true) as THREE.Group;
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const role = roleOf(m);
      m.material = paint[role] ?? std[role] ?? mat(parseInt(String((m.material as THREE.Material).userData?.gitcraft_color ?? '#cccccc').slice(1), 16));
      m.castShadow = true;
      m.receiveShadow = true;
    });
    return g;
  }

  /**
   * The MeshCraft chalet fitted to a house: the body and roof stretch to its width and depth (the roof
   * pitch follows the shorter side, as the code's did), the balcony moves to its front wall, the door
   * keeps its size. The wide model serves the big houses, the small one the single-storey huts.
   */
  private modelChalet(w: number, d: number, wall: number, roofCol: number, floors: number, balcony: boolean): THREE.Group {
    const [id, w0, d0] = floors < 2 ? (['rs_chalet_small', 4, 3.5] as const) : w >= 8.5 ? (['rs_chalet_wide', 10, 7.5] as const) : (['rs_chalet', 6, 5] as const);
    const g = this.building(id, {
      wall: mat(wall),
      plank: mat(shade(wall, 0.88)),
      roof: mat(roofCol),
      shutter: mat(wall === PAL.mint ? PAL.burgundy : PAL.green),
    });
    const sx = w / w0;
    const sz = d / d0;
    const node = (n: string) => g.getObjectByName(n)!;
    node('body').scale.set(sx, 1, sz);
    node('roof').scale.set(sx, Math.min(w, d) / Math.min(w0, d0), sz);
    // the door keeps its size; it moves to the house's front, to one side (clear of the signs)
    const door = node('door');
    door.position.set(w * 0.28 - w0 * 0.22, 0, (d - d0) / 2);
    const bal = g.getObjectByName('balcony');
    if (bal) {
      bal.position.z = d / 2;
      bal.scale.x = sx;
      bal.visible = balcony && floors > 1;
    }
    // the chimney is placed by whoever adds the smoke (buildVillage); hidden until then
    const chimney = node('chimney');
    chimney.visible = false;
    g.userData.chimney = chimney;
    g.userData.door = door;
    return g;
  }

  /** An alpine chalet: stone ground floor, timber upper, a balcony, a deep snowy roof. */
  private chalet(w: number, d: number, wall: number, roofCol: number, floors = 2, balcony = true): THREE.Group {
    if (this.bm) return this.modelChalet(w, d, wall, roofCol, floors, balcony);
    const g = new THREE.Group();
    const h1 = 2.6;
    g.add(box(w, h1, d, PAL.stone, 0, h1 / 2, 0));
    g.add(box(w + 0.05, 0.25, d + 0.05, PAL.stoneDark, 0, 0.12, 0));
    let top = h1;
    if (floors > 1) {
      g.add(box(w, 2.4, d, wall, 0, h1 + 1.2, 0));
      // a cream band and corner boards: painted timber, picked out
      g.add(box(w + 0.08, 0.18, d + 0.08, PAL.white, 0, h1 + 0.05, 0));
      for (const cx of [-w / 2, w / 2]) for (const cz of [-d / 2, d / 2]) g.add(box(0.16, 2.4, 0.16, PAL.white, cx, h1 + 1.2, cz));
      top = h1 + 2.4;
    }
    // windows with shutters
    for (const s of [-1, 1]) {
      for (const x of [-w / 4, w / 4]) {
        const win = windowPane(0.8, 0.9, this.windows);
        win.position.set(x, floors > 1 ? h1 + 1.3 : 1.5, (s * d) / 2 + s * 0.06);
        if (s < 0) win.rotation.y = Math.PI;
        g.add(win);
        for (const sx of [-0.62, 0.62]) g.add(box(0.4, 1.0, 0.06, wall === PAL.mint ? PAL.burgundy : PAL.green, x + sx, win.position.y, (s * d) / 2 + s * 0.1));
      }
    }
    if (balcony && floors > 1) {
      g.add(box(w * 0.8, 0.12, 1.1, PAL.logDark, 0, h1 + 0.15, d / 2 + 0.55));
      for (let i = 0; i <= 8; i++) g.add(box(0.06, 0.8, 0.06, PAL.logLight, -w * 0.4 + (i * w * 0.8) / 8, h1 + 0.6, d / 2 + 1.05));
      g.add(box(w * 0.8, 0.08, 0.1, PAL.logLight, 0, h1 + 1.0, d / 2 + 1.05));
    }
    const r = snowRoof(w + 1.6, d + 1.8, Math.min(w, d) * 0.42, roofCol);
    r.rotation.y = Math.PI / 2;
    r.position.y = top;
    g.add(r);
    for (const s of [-1, 1]) {
      const ge = gable(0.25, Math.min(w, d) * 0.42, w, wall);
      ge.rotation.y = Math.PI / 2;
      ge.position.set(0, top, s * (d / 2 - 0.05));
      g.add(ge);
    }
    return g;
  }

  private buildVillage() {
    // Hollin as a painted row: pastel facades with cream trim, burgundy and slate roofs
    const roofs = [PAL.burgundy, 0x5a4f6e, 0x8e3f4c, 0x4f5f70];
    const walls = [PAL.blush, PAL.mustard, PAL.mint, PAL.powder, PAL.lavender];
    const rng = mulberry32(31);
    const parts = new THREE.Group();
    for (const v of VILLAGE) {
      const y = this.ground(v.x, v.z);
      let b: THREE.Group;
      switch (v.kind) {
        case 'lodge': {
          b = this.chalet(9, 7, 0xd98b8f, PAL.burgundy, 2, true);
          const s = sign('THE KETTLE', 3.4, 0.7, { bg: '#7b2f3b', fg: '#f6ecdc' });
          s.position.set(0, 2.25, 3.6);
          b.add(s);
          // tables out front with umbrellas folded for winter
          for (const x of [-2.5, 2.5]) b.add(box(1.2, 0.08, 0.8, PAL.logDark, x, 0.75, 5), cyl(0.05, 0.05, 2.2, 5, PAL.logDark, x, 1.1, 5), cyl(0.12, 0.12, 1.1, 6, PAL.red, x, 2.0, 5));
          break;
        }
        case 'clinic': {
          b = this.chalet(7, 6, PAL.mint, 0x4f5f70, 2, false);
          const s = sign('CLINIC', 2.4, 0.6, { bg: '#f6ecdc', fg: '#3a2632', accent: '#d4422f' });
          s.position.set(0, 2.3, 3.07);
          b.add(s);
          b.add(box(1.4, 2.1, 0.1, 0x6f8fbf, 0, 1.05, 3.05));
          // the clinic has its glass door; the model's own front door would be a second one
          if (b.userData.door) b.userData.door.visible = false;
          break;
        }
        case 'shop': {
          b = this.chalet(6, 5, PAL.mustard, PAL.burgundy, 2, true);
          const s = sign('BAKER', 2.2, 0.5, { bg: '#e7aaa6', fg: '#7b2f3b' });
          s.position.set(0, 2.3, 2.57);
          b.add(s);
          break;
        }
        case 'chapel': {
          if (this.bm) {
            b = this.building('rs_chapel', { wall: mat(PAL.powder), roof: mat(PAL.burgundy) });
            break;
          }
          b = new THREE.Group();
          b.add(box(5, 4.2, 8, PAL.powder, 0, 2.1, 0));
          const r = snowRoof(5.8, 8.8, 2.4, PAL.burgundy);
          r.rotation.y = Math.PI / 2;
          r.position.y = 4.2;
          b.add(r);
          // the bell tower with its onion dome
          b.add(box(2.4, 8, 2.4, PAL.white, 0, 4, -4.6));
          const dome = ball(1.4, PAL.mustard, 0, 9.0, -4.6, 12);
          dome.scale.set(1, 1.15, 1);
          b.add(dome, cyl(0.06, 0.06, 1.6, 4, PAL.yellow, 0, 10.8, -4.6), ball(0.55, PAL.roofSnow, 0, 9.9, -4.6, 8));
          b.add(box(0.9, 1.2, 0.1, 0x262a30, 0, 6.6, -3.35));
          break;
        }
        default:
          b = this.chalet(5 + rng() * 1.5, 4.5 + rng(), walls[Math.floor(rng() * walls.length)], roofs[Math.floor(rng() * roofs.length)], 2, rng() > 0.4);
      }
      b.position.set(v.x, y, v.z);
      b.rotation.y = v.rot;
      parts.add(b);
      // a chimney with smoke on most
      if (v.kind !== 'chapel') {
        const cx = v.x + Math.cos(v.rot) * 1.2;
        const cz = v.z - Math.sin(v.rot) * 1.2;
        this.smokeSources.push(new THREE.Vector3(cx, y + 8.2, cz));
        if (b.userData.chimney) {
          // the model's chimney, where the code put its own (and the smoke)
          const ch = b.userData.chimney as THREE.Object3D;
          ch.position.set(1.2, 5.55, 0);
          ch.visible = true;
        } else b.add(box(0.7, 2.5, 0.7, PAL.stone, 1.2, 6.8, 0));
      }
      // wood piles and a sled by the door
      if (v.kind === 'house') {
        const wp = new THREE.Group();
        for (let i = 0; i < 9; i++) {
          const log = cyl(0.13, 0.13, 1.1, 6, i % 2 ? PAL.log : PAL.logLight, (i % 3) * 0.27 - 0.27, 0.15 + Math.floor(i / 3) * 0.24, 0);
          log.rotation.x = Math.PI / 2;
          wp.add(log);
        }
        wp.position.set(-2.6, 0, 2.2);
        b.add(wp);
      }
    }
    // street lamps along the main street
    for (let i = 0; i < 6; i++) {
      const x = 260 + i * 30;
      const z = 470 + Math.sin(i) * 8;
      const y = this.ground(x, z);
      const l = new THREE.Group();
      l.add(cyl(0.08, 0.1, 3.4, 6, 0x262a30, 0, 1.7, 0), box(0.4, 0.5, 0.4, this.streetLights, 0, 3.5, 0), box(0.55, 0.1, 0.55, 0x262a30, 0, 3.8, 0));
      l.position.set(x, y, z);
      parts.add(l);
    }
    // a village Christmas-tree-sized spruce with lights in the square
    const sq = new THREE.Group();
    for (let i = 0; i < 4; i++) sq.add(new THREE.Mesh(new THREE.ConeGeometry(2.2 - i * 0.45, 2.4, 8), mat(0x2b4a33)).translateY(1.6 + i * 1.3));
    for (let i = 0; i < 18; i++) {
      const a = i * 1.7;
      const h = 1 + (i / 18) * 5;
      const r = 2.1 - (i / 18) * 1.7;
      sq.add(ball(0.12, glow([0xffd23f, 0xff5a3a, 0x7fd3e8][i % 3]), Math.cos(a) * r, h, Math.sin(a) * r, 6));
    }
    sq.position.set(325, this.ground(325, 490), 490);
    parts.add(sq);
    this.group.add(parts);
  }

  private buildResort() {
    const base = pad('resort');
    const top = pad('lifttop');
    const yb = this.ground(base.x, base.z);
    // base lodge
    const lodge = this.chalet(12, 8, PAL.blush, PAL.burgundy, 2, true);
    lodge.position.set(base.x + 18, yb, base.z + 14);
    lodge.rotation.y = -0.3;
    const s = sign('TANNBERG', 4, 0.8, { bg: '#2f5f9e', fg: '#f3efe6' });
    s.position.set(0, 5.9, 4.3);
    lodge.add(s);
    this.group.add(lodge);
    this.smokeSources.push(new THREE.Vector3(base.x + 19, yb + 9, base.z + 14));
    // top station hut
    if (this.bm) {
      // the MeshCraft log cabin fitted to the hut: 6 x 4 m, walls 2.6 m, its roof 7 x 5.4 m, pitch 1.6
      const hut = this.building('rs_cabin');
      hut.getObjectByName('body')!.scale.set(6 / 5, 2.6 / 2.3, 1);
      const roof = hut.getObjectByName('roof')!;
      roof.position.y = 2.6;
      roof.scale.set(7 / 6, 1.6 / 1.7, 5.4 / 5.6);
      hut.position.set(top.x + 10, this.ground(top.x, top.z), top.z - 6 + 2);
      this.group.add(hut);
    } else {
    const hut = new THREE.Group();
    const L = logWall(6, 2.6);
    hut.add(L);
    const L2 = logWall(6, 2.6);
    L2.position.z = 4;
    hut.add(L2);
    for (const x of [-3, 3]) {
      const l = logWall(4, 2.6);
      l.rotation.y = Math.PI / 2;
      l.position.set(x, 0, 2);
      hut.add(l);
    }
    const r = snowRoof(7, 5.4, 1.6);
    r.position.set(0, 2.6, 2);
    hut.add(r);
    hut.position.set(top.x + 10, this.ground(top.x, top.z), top.z - 6);
    this.group.add(hut);
    }
    const ts = sign('TOP STATION', 3, 0.6, { bg: '#2f5f9e', fg: '#f3efe6' });
    ts.position.set(top.x + 10, this.ground(top.x, top.z) + 3.4, top.z - 1.8);
    this.group.add(ts);
    // the chairlift: towers, a cable loop, chairs that move
    const a = new THREE.Vector3(LIFT.from[0], 0, LIFT.from[1]);
    const b = new THREE.Vector3(LIFT.to[0], 0, LIFT.to[1]);
    const n = 10;
    const towers: THREE.Vector3[] = [];
    for (let i = 0; i <= n; i++) {
      const p = a.clone().lerp(b, i / n);
      const y = this.ground(p.x, p.z);
      const hgt = i === 0 || i === n ? 6 : 10;
      const tw = new THREE.Group();
      tw.add(box(0.5, hgt, 0.5, 0x6e7a85, 0, hgt / 2, 0), box(3.2, 0.3, 0.4, 0x6e7a85, 0, hgt, 0));
      if (i === 0 || i === n) tw.add(new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.15, 6, 16), mat(0x262a30)).rotateX(Math.PI / 2).translateZ(-hgt));
      tw.position.set(p.x, y, p.z);
      tw.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
      this.group.add(tw);
      towers.push(new THREE.Vector3(p.x, y + hgt - 0.2, p.z));
    }
    const dir = b.clone().sub(a).normalize();
    const side = new THREE.Vector3(dir.z, 0, -dir.x).multiplyScalar(1.5);
    for (const s2 of [-1, 1]) {
      const pts = towers.map((t) => t.clone().addScaledVector(side, s2));
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      this.group.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x1d1f22 })));
    }
    this.liftLine = { a: towers[0], b: towers[n], len: towers[0].distanceTo(towers[n]), dir };
    const chairMat = mat(0x2f5f9e);
    const chairs = 22;
    for (let i = 0; i < chairs; i++) {
      const c = new THREE.Group();
      c.add(cyl(0.03, 0.03, 1.6, 4, 0x262a30, 0, -0.8, 0), box(1.2, 0.1, 0.5, chairMat, 0, -1.6, 0), box(1.2, 0.6, 0.08, chairMat, 0, -1.3, 0.25));
      this.group.add(c);
      this.chairs.push({ m: c, s: i / chairs });
    }
    // fences and piste markers along the run
    for (const p of routeSamples(this.terrain, 'piste', 26)) {
      for (const s2 of [-1, 1]) {
        const x = p.x - p.tz * s2 * 17;
        const z = p.z + p.tx * s2 * 17;
        const pole = cyl(0.05, 0.05, 1.6, 4, s2 < 0 ? 0x2f5f9e : 0xf3efe6, x, this.ground(x, z) + 0.8, z);
        const tip = box(0.12, 0.3, 0.12, s2 < 0 ? 0x2f5f9e : 0xd8382a, x, this.ground(x, z) + 1.6, z);
        this.group.add(pole, tip);
      }
    }
  }

  private buildWeatherStation() {
    const st = pad('station');
    const x = -646;
    const z = -296;
    const y = this.ground(x, z);
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.add(cyl(0.12, 0.14, 7, 6, PAL.metal, 0, 3.5, 0));
    for (const a of [0, 2.1, 4.2]) {
      const guy = cyl(0.02, 0.02, 8, 3, 0x333333, Math.cos(a) * 2, 3.5, Math.sin(a) * 2);
      guy.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
      g.add(guy);
    }
    // the anemometer: three cups on a hub
    const an = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const arm = box(0.9, 0.04, 0.04, 0x333333);
      arm.position.x = 0.45;
      const cup = ball(0.13, PAL.white, 0.9, 0, 0, 8);
      const holder = new THREE.Group();
      holder.add(arm, cup);
      holder.rotation.y = (i * Math.PI * 2) / 3;
      an.add(holder);
    }
    an.position.y = 7.2;
    this.anemo = an;
    this.stationIce = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), new THREE.MeshLambertMaterial({ color: 0xcfe8f5, transparent: true, opacity: 0.85 }));
    this.stationIce.position.y = 7.2;
    this.stationIce.scale.set(1.8, 0.7, 1.8);
    g.add(an, this.stationIce);
    // the logger box, a solar panel, a vane
    g.add(box(0.8, 1.0, 0.4, PAL.white, 0.2, 2.2, 0.15), box(1.4, 0.06, 0.9, 0x1f3a60, -0.2, 4.4, 0));
    this.stationLight = box(0.12, 0.12, 0.05, glow(0xff3020), 0.2, 2.5, 0.37);
    g.add(this.stationLight);
    const vane = new THREE.Group();
    vane.add(box(1.2, 0.05, 0.05, 0x333333, 0, 0, 0), box(0.05, 0.3, 0.35, PAL.red, -0.6, 0, 0));
    vane.position.y = 6.2;
    g.add(vane);
    // the little hut it reports from
    const hut = this.chalet(4, 3.5, PAL.mustard, PAL.burgundy, 1, false);
    hut.position.set(st.x + 6, this.ground(st.x + 6, st.z + 4), st.z + 4);
    this.group.add(g, hut);
  }

  private buildCabin() {
    const c = pad('cabin');
    if (this.bm) {
      const cabin = this.building('rs_cabin');
      cabin.position.set(c.x, this.ground(c.x, c.z), c.z);
      this.group.add(cabin);
      return;
    }
    const g = new THREE.Group();
    for (const [len, x, z, rot] of [
      [5, 0, -2, 0],
      [5, 0, 2, 0],
      [4, -2.5, 0, Math.PI / 2],
      [4, 2.5, 0, Math.PI / 2],
    ] as const) {
      const l = logWall(len, 2.3);
      l.rotation.y = rot;
      l.position.set(x, 0, z);
      g.add(l);
    }
    const r = snowRoof(6, 5.6, 1.7);
    r.position.y = 2.3;
    g.add(r);
    const w = windowPane(0.8, 0.7, this.windows);
    w.position.set(0, 1.4, 2.2);
    g.add(w);
    g.add(box(0.6, 1.8, 0.6, PAL.stone, 2.3, 3.2, 1));
    g.position.set(c.x, this.ground(c.x, c.z), c.z);
    this.group.add(g);
  }

  private buildBoathouse() {
    const x = -342;
    const z = 392;
    const y = this.ground(x, z);
    if (this.bm) {
      const bh = this.building('rs_boathouse');
      bh.position.set(x, y, z);
      bh.rotation.y = 0.5;
      this.group.add(bh);
      return;
    }
    const g = new THREE.Group();
    g.add(box(5, 2.4, 7, 0x6b4428, 0, 1.2, 0));
    const r = snowRoof(5.8, 7.8, 1.8, 0x5b3a2a);
    r.rotation.y = Math.PI / 2;
    r.position.y = 2.4;
    g.add(r);
    g.add(box(3, 2, 0.1, 0x3d2a1c, 0, 1.0, 3.55));
    g.add(box(1.6, 0.15, 6, PAL.logDark, 0, 0.3, 6.5));
    g.position.set(x, y, z);
    g.rotation.y = 0.5;
    this.group.add(g);
  }

  private buildBowl() {
    const gx = -150;
    const gz = -40;
    // avalanche warning signs at both ends of the bowl road
    for (const [x, z, rot] of [
      [-120, 10, 0.5],
      [-330, -165, -1.2],
    ] as const) {
      const g = new THREE.Group();
      g.add(cyl(0.06, 0.06, 2.6, 5, PAL.metal, 0, 1.3, 0));
      const s = sign('AVALANCHE AREA', 1.8, 0.9, { bg: '#f2c230', fg: '#262a30' });
      s.position.y = 2.3;
      g.add(s);
      g.position.set(x, this.ground(x, z), z);
      g.rotation.y = rot;
      this.group.add(g);
    }
    // the barrier hut beside the pass road
    const hut = this.bm ? this.building('rs_barrier_hut', { trim: mat(0xf3efe6), roof: mat(PAL.red) }) : new THREE.Group();
    if (!this.bm) {
      hut.add(box(2, 2.2, 2, 0xf3efe6, 0, 1.1, 0));
      const r = snowRoof(2.6, 2.6, 0.7, PAL.red, 0.2);
      r.position.y = 2.2;
      hut.add(r);
    }
    hut.position.set(gx - 8, this.ground(gx - 8, gz), gz + 2);
    this.group.add(hut);
    // the berm's marker posts
    for (let x = BOWL.berm.x0 + 10; x < BOWL.berm.x1; x += 30) {
      const u = (x - BOWL.berm.x0) / (BOWL.berm.x1 - BOWL.berm.x0);
      const z = BOWL.berm.z - Math.sin(u * Math.PI) * 14;
      const p = new THREE.Group();
      p.add(cyl(0.08, 0.08, 2.4, 5, 0x262a30, 0, 1.2, 0), box(0.2, 0.4, 0.2, PAL.yellow, 0, 2.3, 0));
      p.position.set(x, this.ground(x, z), z);
      this.group.add(p);
    }
    // the ridge cairn and a wind-blown cornice along the ridge
    const ridge = pad('ridge');
    const cairn = new THREE.Group();
    for (let i = 0; i < 5; i++) cairn.add(ball(0.6 - i * 0.1, PAL.stone, Math.sin(i) * 0.1, 0.4 + i * 0.5, 0, 6));
    cairn.position.set(ridge.x - 10, this.ground(ridge.x - 10, ridge.z - 8), ridge.z - 8);
    this.group.add(cairn);
    const cornice = new THREE.Group();
    // the cornice: wind-built lips of snow along the top of the start zone
    for (let x = BOWL.slab.x0 + 4; x < BOWL.slab.x1 - 4; x += 7) {
      const z = BOWL.slab.z0 - 14 + Math.sin(x * 0.07) * 3;
      const c = ball(2, PAL.snow, 0, 0, 0, 8);
      c.scale.set(1.7, 0.45, 0.9);
      c.position.set(x, this.ground(x, z) + 0.3, z);
      cornice.add(c);
    }
    this.group.add(bake(cornice));
  }

  /** Orange-tipped snow poles along every road and track, so you can follow them in a whiteout. */
  private buildPoles() {
    const geo = new THREE.CylinderGeometry(0.05, 0.05, 2, 4);
    geo.translate(0, 1, 0);
    const tipGeo = new THREE.BoxGeometry(0.11, 0.35, 0.11);
    tipGeo.translate(0, 2.0, 0);
    const list: THREE.Vector3[] = [];
    for (const g of this.terrain.routes) {
      if (g.route.kind === 'piste') continue;
      for (const p of routeSamples(this.terrain, g.route.id, 22)) {
        for (const s of [-1, 1]) {
          const off = g.route.width + 1.6;
          const x = p.x - p.tz * s * off;
          const z = p.z + p.tx * s * off;
          if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r) continue;
          list.push(new THREE.Vector3(x, this.ground(x, z), z));
        }
      }
    }
    const poles = new THREE.InstancedMesh(geo, mat(0x262a30), list.length);
    const tips = new THREE.InstancedMesh(tipGeo, mat(0xff7a1a), list.length);
    const m = new THREE.Matrix4();
    list.forEach((p, i) => {
      m.makeTranslation(p.x, p.y - 0.1, p.z);
      poles.setMatrixAt(i, m);
      tips.setMatrixAt(i, m);
    });
    poles.computeBoundingSphere();
    tips.computeBoundingSphere();
    this.group.add(poles, tips);
  }

  /** The station's anemometer turns once it has been repaired. */
  setStationWorking(on: boolean) {
    this.stationWorking = on;
    if (this.stationIce) this.stationIce.visible = !on;
    if (this.stationLight) (this.stationLight.material as THREE.MeshBasicMaterial).color.setHex(on ? 0x34e05a : 0xff3020);
  }

  update(dt: number, night: number, wind: number) {
    this.t += dt;
    this.windows.emissiveIntensity = 0.25 + night * 1.6;
    this.streetLights.color.setHex(night > 0.3 ? 0xffd9a0 : 0xc9c2b4);
    if (this.anemo && this.stationWorking) this.anemo.rotation.y += dt * (3 + wind * 10);
    if (this.liftLine) {
      const L = this.liftLine;
      for (const c of this.chairs) {
        c.s = (c.s + dt * 0.006) % 1;
        // up one side, down the other
        const up = c.s < 0.5;
        const f = up ? c.s * 2 : (1 - c.s) * 2;
        const p = L.a.clone().lerp(L.b, f);
        const side = new THREE.Vector3(L.dir.z, 0, -L.dir.x).multiplyScalar(up ? 1.5 : -1.5);
        p.add(side);
        // sag between towers
        p.y -= Math.sin(f * Math.PI * 10) ** 2 * 0.8;
        c.m.position.copy(p);
        c.m.rotation.y = Math.atan2(L.dir.x, L.dir.z) + (up ? 0 : Math.PI);
      }
    }
  }
}
