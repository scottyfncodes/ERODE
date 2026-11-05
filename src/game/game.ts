import * as THREE from 'three';
import { AudioEngine } from '../audio/audio';
import { Input } from '../core/input';
import { forwardSpeed, glideSpeed, newGlider, SKIS, SLED, stepGlider, type Glider } from '../actors/glide';
import { HELI, heliAgl, newHeli, stepHeli, type Heli } from '../actors/heli';
import { newHusky, pet, startTrack, stepHusky, type Husky, type Scent } from '../actors/husky';
import { newWalker, stepWalker, type Walker } from '../actors/walker';
import { Snowpack, simulateRelease } from '../missions/avalanche';
import { FAMILY_LABEL, mission, MISSIONS, type MissionDef, type Vehicle } from '../missions/catalog';
import { currentStep, fire, fireState, interact, interactables, navTarget, newRun, tickRun, type RunEvent } from '../missions/runner';
import { BADGES, item, RANKS, type Group } from '../progress/catalog';
import { available, build, buy, complete, done, equip, findBadge, hasUpgrade, loadProfile, newProfile, rank, saveProfile, tickEvents, type Profile, type Settings, type Store } from '../progress/profile';
import { PatrollerMesh, type Pose } from '../render/characterMesh';
import { ForestView } from '../render/forestView';
import { FX_KIND, GroundDrift, Particles, Snowfall, Tracks } from '../render/fx';

/** Vince's hair: honey blonde */
const VINCE_HAIR = 0xe6c27a;
import { HeliMesh } from '../render/heliMesh';
import { HuskyMesh } from '../render/huskyMesh';
import { shared } from '../render/materials';
import { AvalancheView, Markers } from '../render/markers';
import { catMesh, MissionProps } from '../render/missionProps';
import { detectQuality, Rig } from '../render/rig';
import { SledMesh } from '../render/sledMesh';
import { StationView } from '../render/stationView';
import { buildTerrain, snowUniforms } from '../render/terrainView';
import { drawTopo, topoJob } from '../render/topoMap';
import { buildOps, opsObstacles } from '../render/opsView';
import { PEAKS } from '../world/places';
import { WorldView } from '../render/worldView';
import { KitView, type Kit } from '../render/kitView';
import { OPS_IDS, PROP_IDS, type PatrolModels } from '../render/patrolModels';
import { StatsOverlay, statsWanted } from '../ui/stats';
import { kitObstacles, scatterKit, type Placed } from '../world/scatter';
import { Hud } from '../ui/hud';
import { Panels } from '../ui/panels';
import type { Colliders } from '../world/colliders';
import { plantForest, TreeGrid, type Tree } from '../world/forest';
import { CHARGE_SPOTS, elevation } from '../world/places';
import { buildColliders, HQ, inGarage, inLodge, LODGE, SPOTS, UPGRADES, type UpgradeId } from '../world/station';
import { getTerrain, SURFACE_LABEL, type Terrain } from '../world/terrain';
import { avalancheDanger, clock, conditions, DANGER_LABEL, nextDay, SKY_LABEL, tickWeather, type Conditions } from '../world/weather';
import { FollowCamera } from './camera';

type Mode = 'foot' | 'sled' | 'heli' | 'skis';

interface Act {
  id: string;
  label: string;
  hold: number;
  red?: boolean;
  enabled?: boolean;
  run: () => void;
  /** working pose and sound while holding */
  work?: 'saw' | 'dig' | 'fix';
}

const storage = (): Store | null => {
  try {
    const s = window.localStorage;
    s.setItem('__t', '1');
    s.removeItem('__t');
    return s;
  } catch {
    return null;
  }
};

const UP = new THREE.Vector3(0, 1, 0);

export class Game {
  private rig: Rig;
  private terrain: Terrain;
  private trees: Tree[];
  private grid: TreeGrid;
  private solid: Colliders;
  private station: StationView;
  private world: WorldView;
  private kitView: KitView;
  private scattered: Placed[];
  private markers: Markers;
  private avView: AvalancheView;
  private props: MissionProps;
  private particles: Particles;
  private snowfall: Snowfall;
  private tracks: Tracks;
  private drift: GroundDrift;
  private spinT = 0;
  /** Vince: twenty, the patrol's newest hand, long blonde hair with a bit of a curl */
  private player = new PatrollerMesh(false, { hair: VINCE_HAIR, long: true });
  private dogMesh = new HuskyMesh();
  private sledMesh = new SledMesh();
  private heliMesh = new HeliMesh();
  private pepperHeld: THREE.Group;
  private walker: Walker;
  private sled: Glider;
  private skis: Glider;
  private heli: Heli;
  private dog: Husky;
  private mode: Mode = 'foot';
  private pack: Snowpack;
  private input: Input;
  private hud: Hud;
  private panels: Panels;
  private audio = new AudioEngine();
  private cam: FollowCamera;
  private p: Profile;
  private store = storage();
  private topo: HTMLCanvasElement;
  /** when the valley was last drawn behind an open panel */
  private lastBehind = 0;
  /** the sharp copy of the map is drawn */
  private sharpMap = false;
  /** what a render costs on the main thread (ms, smoothed) */
  private renderMs = 8;
  private readonly footPos = new THREE.Vector3();
  private state: 'title' | 'play' = 'title';
  private last = performance.now();
  private time = 0;
  private holdId = '';
  private holdT = 0;
  private saveT = 0;
  private watching = 0;
  private watchSkip = false;
  private cond: Conditions;
  private indoors = 0;
  private seat = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private smokeT = 0;
  private rng = Math.random;
  private passengerVisible = false;
  private alertShown: string | null = null;
  private fps = 60;
  private kitLoaded: string[] = [];
  /** which code-built meshes the MeshCraft models replaced (QA) */
  private modelled = { sled: false, heli: false, forest: false, patroller: false, koda: false, villagers: false, buildings: false, yard: false, props: false, lift: false, outfits: false, lodge: false, ops: false, weather: false };
  /** wall-clock frame time: holds on buttons follow your thumb, not the simulation */
  private realDt = 0;
  /** the ?stats performance readout (off unless asked for) */
  private stats: StatsOverlay | null = null;
  private forest!: ForestView;

  constructor(canvas: HTMLCanvasElement, private ui: HTMLElement, progress: (f: number, t: string) => void, kit: Kit = {}, models: PatrolModels = {}) {
    this.p = loadProfile(this.store) ?? newProfile();
    if (statsWanted()) this.stats = new StatsOverlay(document.body);
    this.rig = new Rig(canvas, detectQuality(this.p.settings.quality));
    progress(0.15, 'Raising the mountains');
    this.terrain = getTerrain();
    this.solid = buildColliders();
    progress(0.35, 'Planting the forest');
    this.trees = plantForest(this.terrain, this.rig.quality.trees);
    // the Kessel kit (MeshCraft): tors on the steeps, boulders, deadwood and the patrol's own gear
    const scattered = (this.scattered = scatterKit(this.terrain, this.trees, this.rig.quality.trees));
    // collisions use the same trees and rocks you see
    this.grid = new TreeGrid([...this.trees, ...kitObstacles(scattered.filter((p) => kit[p.kind])), ...opsObstacles(this.terrain)]);
    progress(0.5, 'Drawing the map');
    this.topo = drawTopo(this.terrain, 640);
    const scene = this.rig.scene;
    scene.add(buildTerrain(this.terrain));
    // the working mountain: snow fences, exploders, signs, the old snowcat, the mine
    scene.add(buildOps(this.terrain, models));
    this.modelled.ops = OPS_IDS.every((id) => models[id]);
    const forest = (this.forest = new ForestView(this.trees, models));
    scene.add(forest.group);
    // the patrol's vehicles from MeshCraft; the code-built ones stay if a model did not load
    this.modelled = { ...this.modelled, sled: this.sledMesh.useModel(models.rs_sled), heli: this.heliMesh.useModel(models.rs_heli), forest: forest.modelled };
    // the patroller and Koda: skinned models on skeletons of the code's own joints
    this.modelled.patroller = this.player.useModel(models.rs_patroller);
    this.modelled.koda = this.dogMesh.useModel(models.rs_koda);
    this.kitLoaded = Object.keys(kit).sort();
    this.kitView = new KitView(kit, scattered, (x, z) => this.terrain.height(x, z), this.rig.quality.tier === 'high');
    scene.add(this.kitView.group);
    progress(0.7, 'Lighting the stove');
    this.station = new StationView(this.terrain, this.topo, models);
    this.modelled.yard = this.station.modelled;
    this.modelled.lodge = this.station.lodgeModelled;
    this.world = new WorldView(this.terrain, models);
    this.modelled.buildings = this.world.modelled;
    this.modelled.weather = this.world.weatherModelled;
    this.markers = new Markers(this.terrain);
    this.avView = new AvalancheView();
    this.props = new MissionProps(this.terrain, models);
    this.pepperHeld = catMesh(models.rs_cat);
    this.modelled.villagers = this.props.usePeople(models.rs_villager, models.rs_patroller);
    this.modelled.outfits = !!models.rs_villager && this.modelled.villagers;
    this.modelled.props = PROP_IDS.every((id) => models[id]);
    this.modelled.lift = this.world.liftModelled;
    this.particles = new Particles(this.rig.quality.tier === 'low' ? 1600 : 2600);
    this.loadFxAtlas();
    this.snowfall = new Snowfall(this.rig.quality.snowflakes);
    this.drift = new GroundDrift(this.terrain, this.rig.quality.tier === 'low' ? 380 : 700, this.rig.quality.tier === 'low' ? 36 : 64);
    this.tracks = new Tracks(this.terrain, this.rig.quality.tier === 'low' ? 1100 : 1800);
    scene.add(this.station.group, this.world.group, this.markers.group, this.avView.group, this.props.group, this.particles.points, this.snowfall.points, this.tracks.mesh, this.drift.group);
    scene.add(this.player.group, this.dogMesh.group, this.sledMesh.group, this.heliMesh.group);
    progress(0.85, 'Waking Koda');
    this.pack = new Snowpack(this.terrain);
    const pl = this.p.player;
    this.walker = newWalker(pl.x, pl.z, pl.yaw, this.terrain);
    this.sled = newGlider(this.p.sled.x, this.p.sled.z, this.p.sled.yaw, this.terrain);
    this.skis = newGlider(pl.x, pl.z, pl.yaw, this.terrain);
    this.heli = newHeli(this.p.heli.x, this.p.heli.z, this.p.heli.yaw, this.terrain);
    this.dog = newHusky(pl.x + 1.5, pl.z + 1, this.terrain);
    this.cam = new FollowCamera(this.rig.camera, this.terrain);
    this.input = new Input(canvas);
    this.hud = new Hud(ui, this.input);
    this.panels = new Panels(ui, this.topo.toDataURL('image/png'));
    setTimeout(() => this.drawSharpMap(), 2000);
    this.cond = conditions(this.p.weather);
    this.bindHud();
    this.applyProfile();
    window.addEventListener('resize', () => this.rig.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.save();
        this.audio.suspend();
      } else this.audio.resume();
    });
    window.addEventListener('pagehide', () => this.save());
    // a touch wakes sound the phone put to sleep (a call, the lock screen, another app)
    window.addEventListener('pointerdown', () => this.audio.ready && this.audio.unlock(), { capture: true, passive: true });
    // the voiced lines speak as their subtitles go up, and the subtitle waits for the voice
    this.hud.onLine = (_who, text) => this.audio.say(text, (secs) => this.hud.holdRadio(secs + 0.4));
    // iOS reports the new size a beat after it turns
    window.addEventListener('orientationchange', () => setTimeout(() => this.rig.resize(), 250));
    window.visualViewport?.addEventListener('resize', () => this.rig.resize());
  }

  // ------------------------------------------------------------------ setup

  private bindHud() {
    this.hud.chips.map.onclick = () => this.openMap();
    this.hud.chips.koda.onclick = () => this.kodaCommand();
    this.hud.chips.skis.onclick = () => this.toggleSkis();
    this.hud.chips.off.onclick = () => this.dismount();
    this.hud.pause.onclick = () => this.openPause();
  }

  /** Make the world match the save: buildings, gear, paint, mission state. */
  private applyProfile() {
    const p = this.p;
    this.station.setUpgrades(p.upgrades);
    this.station.setBadges(p.badges);
    for (const u of UPGRADES) this.solid.setEnabled(u.id, p.upgrades.includes(u.id));
    const e = p.equip;
    const jacket = item(e.jacket);
    const hat = item(e.hat);
    this.player.setLook(jacket.color!, jacket.color2!, e.hat, hat.color!, hat.color2!, item(e.goggles).color!, item(e.skis).color!);
    const sp = item(e.sledPaint);
    this.sledMesh.setPaint(sp.color!, sp.color2!);
    const hp = item(e.heliPaint);
    this.heliMesh.setPaint(hp.color!, hp.color2!);
    const har = item(e.harness);
    const ban = item(e.bandana);
    this.dogMesh.setGear(item(e.collar).color!, har.color !== undefined ? { main: har.color, second: har.color2!, pack: e.harness === 'harness-pack' } : null, ban.color ?? null);
    this.world.setStationWorking(done(p, 'rounds') || (p.active?.id === 'rounds' && p.active.step > 3));
    this.props.tree.visible = p.events.includes('tree') || p.active?.id === 'tree';
    this.props.van.visible = p.events.includes('drift') || p.active?.id === 'drift';
    this.props.driver.group.visible = this.props.van.visible;
    if (done(p, 'release')) this.pack.reset();
    this.syncMissionVisuals();
  }

  private syncMissionVisuals() {
    const r = this.p.active;
    const id = r?.id;
    const step = r?.step ?? -1;
    // the barrier
    this.props.setGate(id === 'release' && step >= 1 && step <= 6);
    // Nils
    const nilsHere = id === 'skier' && !r!.passenger && step <= 3;
    this.props.nils.group.visible = nilsHere || (id === 'skier' && r!.passenger);
    if (nilsHere) {
      const s = mission('skier').subject!;
      this.props.nils.group.position.set(s.x, this.terrain.height(s.x, s.z), s.z);
      this.props.nils.group.rotation.y = 0.5;
    }
    this.props.glove.visible = id === 'skier' && step <= 1;
    // Pepper
    const pepper = mission('pepper').subject!;
    if (id === 'pepper' && r!.carrying) {
      this.props.pepper.visible = false;
      this.player.hold(this.pepperHeld);
    } else {
      this.player.hold(null);
      this.props.pepper.visible = id === 'pepper' || done(this.p, 'pepper');
      if (done(this.p, 'pepper') && id !== 'pepper') {
        // home on the Kettle's windowsill
        this.props.pepper.position.set(333.5, this.terrain.height(334, 462) + 1.1, 461.2);
      } else this.props.pepper.position.set(pepper.x, this.terrain.height(pepper.x, pepper.z) + 0.05, pepper.z);
    }
    // the crate
    this.sledMesh.crate.visible = !!r?.cargo;
    this.station.crate.visible = !(id === 'supplies' && (r!.cargo || step > 0)) && !done(this.p, 'supplies');
    // tracking
    if (r && currentStep(r)?.kind === 'track' && r.tracking && this.dog.mode !== 'track') {
      const s = currentStep(r)!;
      if (s.kind === 'track') startTrack(this.dog, s.trail);
    }
  }

  start() {
    this.showTitle();
    const loop = () => {
      requestAnimationFrame(loop);
      this.frame();
    };
    requestAnimationFrame(loop);
  }

  // ------------------------------------------------------------------ title

  private showTitle() {
    this.state = 'title';
    this.hud.show(false);
    const has = !!this.p.savedAt && !this.p.fresh;
    const el = document.createElement('div');
    el.className = 'title-screen';
    const when = has ? `Day ${this.p.weather.day}, ${clock(this.p.weather.minute)} · ${RANKS[rank(this.p)].name} · ${this.p.funds} funds` : '';
    el.innerHTML = `<div class="inner"><img class="emblem" src="${import.meta.env.BASE_URL}icons/icon.svg" alt="" width="72" height="72"><div class="wordmark" role="img" aria-label="ROCKSLIDE"><span class="wm-top" aria-hidden="true">ROCKSLIDE</span><span class="wm-bot" aria-hidden="true">ROCKSLIDE</span></div><div class="subbrand">Mountain Patrol</div><p>The Kessel valley is yours to look after: its slopes, its roads, its people. You have a log station, a snowmobile, a borrowed helicopter, a pair of old skis, and Koda.</p><div class="row">${has ? '<button class="btn red" data-a="cont">Continue</button><button class="btn ghost" data-a="new">New patrol</button>' : '<button class="btn red" data-a="new">Start your patrol</button>'}</div>${has ? `<div class="meta">${when}</div>` : ''}</div>`;
    this.ui.appendChild(el);
    const go = (fresh: boolean) => {
      this.audio.unlock();
      this.applySettings(this.p.settings);
      if (fresh) {
        const btn = el.querySelector('[data-a=new]') as HTMLElement;
        if (has && !btn.dataset.armed) {
          btn.dataset.armed = '1';
          btn.textContent = 'Tap again: this erases your save';
          return;
        }
        this.resetProfile();
      }
      el.remove();
      this.beginPlay();
    };
    (el.querySelector('[data-a=new]') as HTMLElement).onclick = () => go(true);
    const c = el.querySelector('[data-a=cont]') as HTMLElement | null;
    if (c) c.onclick = () => go(false);
  }

  private resetProfile() {
    const settings = this.p.settings;
    this.p = newProfile();
    this.p.settings = settings;
    const pl = this.p.player;
    this.walker = newWalker(pl.x, pl.z, pl.yaw, this.terrain);
    this.sled = newGlider(this.p.sled.x, this.p.sled.z, this.p.sled.yaw, this.terrain);
    this.heli = newHeli(this.p.heli.x, this.p.heli.z, this.p.heli.yaw, this.terrain);
    this.dog = newHusky(pl.x + 1.5, pl.z + 1, this.terrain);
    this.skis = newGlider(pl.x, pl.z, pl.yaw, this.terrain);
    this.pack.reset();
    this.props.resetTree();
    this.mode = 'foot';
    // nothing from the last patrol carries over: the avalanche camera, a half-held job, an
    // unanswered call, queued radio, Koda's scent trail, pins and old tracks in the snow
    this.watching = 0;
    this.watchSkip = false;
    this.holdId = '';
    this.holdT = 0;
    this.alertShown = null;
    this.passengerVisible = false;
    this.hud.reset();
    this.markers.setPaws([], 0);
    this.markers.setPins([]);
    this.markers.setBeacon(null);
    this.tracks.clear();
    this.player.hold(null);
    this.cam.setMode('foot');
    this.cam.snapBehind(pl.yaw);
    this.applyProfile();
  }

  private beginPlay() {
    this.state = 'play';
    this.hud.show(true);
    const p = this.p;
    // restore the vehicle you were in
    const m = p.player.mode;
    this.mode = 'foot';
    if (m === 'sled') this.mountSled(true);
    else if (m === 'heli') {
      this.mountHeli(true);
      this.heli.running = true;
      this.heli.rotor = 1;
    } else if (m === 'skis') this.toggleSkis(true);
    this.cam.snapBehind(this.headingNow());
    // a mission caught mid-avalanche finishes off-screen
    if (p.active && currentStep(p.active)?.kind === 'watch') {
      const sp = simulateRelease(this.terrain, p.active.charges.length ? p.active.charges : ['A', 'C']);
      this.pack = sp;
    }
    if (p.fresh) {
      p.fresh = false;
      this.hud.radio('Dispatch', 'Morning, Kessel Patrol. Forty centimetres up high overnight. There is a call on your mission table.', 6);
      this.hud.radio('Dispatch', 'Koda is already at the door.', 3.5);
    } else this.hud.radio('Dispatch', `Welcome back. ${p.active ? `Still on ${mission(p.active.id).title}.` : 'Nothing urgent.'}`, 4);
    this.save();
  }

  // ------------------------------------------------------------------ vehicles

  private mountSled(silent = false) {
    this.mode = 'sled';
    this.cam.setMode('sled');
    this.player.setSkis(false);
    this.dog.mode = this.p.active?.passenger ? 'follow' : 'ride';
    this.sled.vx = this.sled.vz = 0;
    if (!silent) this.audio.click();
  }

  private mountHeli(silent = false) {
    if (this.cond.grounded) {
      this.hud.toast('Grounded: storm', 'warn');
      this.hud.radio('Dispatch', 'Nobody flies in this. Wait for it to pass.', 3.5);
      return;
    }
    this.mode = 'heli';
    this.cam.setMode('heli');
    this.heli.running = true;
    this.dog.mode = 'ride';
    if (!silent) this.hud.toast('Climb to lift off', '');
  }

  private dismount() {
    if (this.mode === 'sled') {
      const s = this.sled;
      const rx = Math.cos(s.yaw);
      const rz = -Math.sin(s.yaw);
      this.placeWalker(s.x + rx * 1.6, s.z + rz * 1.6, s.yaw);
      this.mode = 'foot';
      this.dog.mode = 'follow';
      this.dog.x = s.x - rx * 1.4;
      this.dog.z = s.z - rz * 1.4;
    } else if (this.mode === 'heli') {
      if (!this.heli.landed) {
        this.hud.toast('Land first', 'warn');
        return;
      }
      const h = this.heli;
      const rx = Math.cos(h.yaw);
      const rz = -Math.sin(h.yaw);
      this.placeWalker(h.x + rx * 3.2, h.z + rz * 3.2, h.yaw);
      h.running = false;
      this.mode = 'foot';
      this.dog.mode = 'follow';
      this.dog.x = h.x + rx * 4.2;
      this.dog.z = h.z + rz * 4.2 + 1;
    } else if (this.mode === 'skis') {
      this.toggleSkis();
      return;
    }
    this.cam.setMode('foot');
    this.audio.click();
  }

  private gradeDim = false;
  /** the lens grade closes in at night and in heavy weather */
  private grade() {
    const dim = this.rig.night > 0.55 || this.cond.fog > 0.6;
    if (dim === this.gradeDim) return;
    this.gradeDim = dim;
    document.getElementById('grade')?.classList.toggle('dim', dim);
  }

  private placeWalker(x: number, z: number, yaw: number) {
    const r = this.solid.resolve(x, z, 0.5);
    this.walker.x = r.x;
    this.walker.z = r.z;
    this.walker.y = this.terrain.height(r.x, r.z);
    this.walker.yaw = yaw;
    this.walker.vx = this.walker.vz = 0;
  }

  private toggleSkis(silent = false) {
    if (this.mode === 'foot') {
      if (inLodge(this.walker.x, this.walker.z) || inGarage(this.walker.x, this.walker.z)) {
        this.hud.toast('Not indoors', 'warn');
        return;
      }
      this.skis = newGlider(this.walker.x, this.walker.z, this.walker.yaw, this.terrain);
      this.mode = 'skis';
      this.cam.setMode('skis');
      this.player.setSkis(true);
      this.tracks.lift('ski-l');
      this.tracks.lift('ski-r');
      if (!silent) this.audio.click();
    } else if (this.mode === 'skis') {
      this.placeWalker(this.skis.x, this.skis.z, this.skis.yaw);
      this.mode = 'foot';
      this.cam.setMode('foot');
      this.player.setSkis(false);
      this.audio.click();
    }
  }

  private kodaCommand() {
    const d = this.dog;
    if (d.mode === 'track') {
      this.hud.toast('Koda is on the scent');
      return;
    }
    if (d.mode === 'stay') {
      d.mode = 'follow';
      this.hud.toast('Koda: heel');
    } else if (this.mode === 'foot' || this.mode === 'skis') {
      d.mode = 'stay';
      this.hud.toast('Koda: stay');
    }
    this.audio.click();
  }

  // ------------------------------------------------------------------ the frame

  private frame() {
    const now = performance.now();
    // wall-clock, uncapped, for the stats readout (the simulation's steps below are capped)
    const frameMs = now - this.last;
    this.realDt = Math.min(0.25, (now - this.last) / 1000);
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.fps += (1 / Math.max(dt, 1e-3) - this.fps) * 0.05;
    this.time += dt;
    shared.time.value = this.time;
    if (this.state === 'title') this.titleFrame(dt);
    else if (!this.panels.open) this.playFrame(dt);
    else this.idleFrame(dt);
    // Behind a panel the valley only needs to look alive: drawing it about eight times a second leaves
    // the phone's GPU and main thread to the panel (a map being pinched stays smooth), and the render
    // scale is left alone rather than dropped for frames that were never rendered.
    // On a device where a frame is expensive it is drawn less often still (up to a second apart), so
    // the main thread stays free for the fingers on the panel.
    if (this.state !== 'title' && this.panels.open && now - this.lastBehind < Math.min(1000, Math.max(120, this.renderMs * 10))) {
      this.stats?.frame(frameMs, { renderer: this.rig.renderer, tier: this.rig.quality.tier, scale: this.rig.renderScale });
      this.input.endFrame();
      return;
    }
    this.lastBehind = now;
    if (!this.panels.open) this.rig.adapt(dt);
    this.forest.update(this.rig.camera.position);
    const r0 = performance.now();
    this.rig.render();
    this.renderMs += (performance.now() - r0 - this.renderMs) * 0.2;
    this.stats?.frame(frameMs, { renderer: this.rig.renderer, tier: this.rig.quality.tier, scale: this.rig.renderScale });
    this.input.endFrame();
  }

  private titleFrame(dt: number) {
    // a symmetrical, one-point view of the lodge front, square on, with a slow push in and out
    const c = this.rig.camera;
    const push = 0.5 - 0.5 * Math.cos(this.time * 0.06);
    const front = LODGE.x + LODGE.w / 2;
    c.position.set(front + 40 - push * 12, this.station.y + 3.6 + push * 0.6, LODGE.z);
    c.lookAt(front - 2, this.station.y + 3.4, LODGE.z);
    this.cond = conditions(this.p.weather);
    this.rig.setConditions(this.cond);
    this.grade();
    this.rig.focus(this.tmp2.set(HQ.x, this.station.y, HQ.z), 70);
    this.station.update(dt, this.rig.night);
    this.world.update(dt, this.rig.night, this.cond.wind);
    this.kitView.update(dt, this.rig.night);
    this.placeActors(dt, true);
    this.dogMesh.animate('sit', 0, dt);
    this.smoke(dt);
    this.particles.update(dt, this.rig.fog, this.pixelScale());
    this.snowfall.update(dt, c.position, this.cond.snow, this.cond.wind * 4, this.cond.wind);
  }

  /** While a panel is open: the world holds still, the fire still flickers. */
  private idleFrame(dt: number) {
    this.input.frame();
    // the keys that open a panel also close it
    if (this.input.pressed('Escape') || (this.panels.kind === 'map' && (this.input.pressed('KeyM') || this.input.pressed('Tab')))) this.panels.close();
    this.station.update(dt, this.rig.night);
    this.hud.update(Math.max(dt, this.realDt));
    this.audio.update(dt, { engine: 0, speed: 0, rotor: this.mode === 'heli' ? this.heli.rotor * 0.5 : 0, hiss: 0, wind: this.cond.wind, rumble: 0, fire: this.indoors, outdoors: 1 - this.indoors, day: 1 - this.rig.night, talking: this.hud.talking });
  }

  private pixelScale() {
    return (window.innerHeight * this.rig.renderer.getPixelRatio()) / (2 * Math.tan((this.rig.camera.fov * Math.PI) / 360));
  }

  private playFrame(dt: number) {
    const p = this.p;
    const { look } = this.input.frame();
    this.cam.look(look.x, look.y, p.settings.look, p.settings.invertY);
    if (this.input.pressed('Escape') || this.input.pressed('KeyP')) return this.openPause();
    if (this.input.pressed('KeyM') || this.input.pressed('Tab')) return this.openMap();
    if (this.input.pressed('KeyQ')) {
      if (this.mode === 'foot' || this.mode === 'skis') this.toggleSkis();
    }
    if (this.input.pressed('KeyX')) this.dismount();
    if (this.input.pressed('KeyG')) this.kodaCommand();

    // weather and the clock
    tickWeather(p.weather, dt);
    this.cond = conditions(p.weather);
    const c = this.cond;
    p.played += dt;

    this.moveActors(dt);
    this.updateDog(dt);
    this.updateMission(dt);
    this.updateAvalanche(dt);
    this.updateInteractions(dt);
    this.updateBadges();
    this.updateEvents(dt);

    // indoors?
    const fp = this.pos2();
    const px = fp.x;
    const pz = fp.z;
    const inside = this.mode === 'foot' && (inLodge(px, pz) || inGarage(px, pz));
    this.indoors += ((inside ? 1 : 0) - this.indoors) * Math.min(1, dt * 4);
    if (this.watching <= 0) this.cam.setMode(inside ? 'indoor' : this.mode === 'foot' ? 'foot' : this.mode);
    this.station.cutaway(px, pz, this.rig.camera.position);

    // camera
    this.cam.portrait = THREE.MathUtils.clamp((1 - this.rig.camera.aspect) / 0.5, 0, 1);
    const pos = this.focusPos();
    if (this.watching > 0 && !this.watchSkip) {
      const t = this.avalancheFocus();
      this.cam.setMode('watch');
      // from the side, so you see it run down the slope
      this.cam.yaw = 1.3;
      this.cam.pitch = 0.2;
      this.cam.update(dt, t, 1.3, 0);
    } else this.cam.update(dt, pos, this.headingNow(), this.speedNow());

    this.rig.setConditions(c, this.indoors);
    this.grade();
    this.rig.focus(pos, this.mode === 'heli' ? 110 : 55);
    snowUniforms.fresh.value = Math.min(1, p.weather.freshSnow / 40);
    this.station.update(dt, this.rig.night);
    this.world.update(dt, this.rig.night, c.wind);
    this.kitView.update(dt, this.rig.night);
    this.props.update(dt);
    for (const im of this.props.impacts) {
      const me = this.pos2();
      const d = Math.hypot(im.x - me.x, im.z - me.z);
      this.audio.thud(0.6 + im.hard * 0.6, d);
      this.particles.powder(im.x, im.y, im.z, 4 + Math.round(im.hard * 6), 2.2, 1.6 * im.hard + 0.5, 0, 0, 1.1);
      if (d < 14) this.cam.kick(0.08 * im.hard * (1 - d / 14));
    }
    this.markers.update(dt);
    this.placeActors(dt, false);
    this.smoke(dt);
    this.particles.update(dt, this.rig.fog, this.pixelScale());
    this.snowfall.update(dt, this.rig.camera.position, c.snow * (1 - this.indoors * 0.8), c.wind * 6, c.wind * 2);
    this.drift.update(dt, this.rig.camera.position, c.wind, 4, 1, c.snow, 1 - this.indoors);
    this.cam.wind = c.wind;
    this.spindrift(dt, c.wind, c.light);
    this.tracks.update(dt, c.snow);
    this.updateHud(dt);
    this.updateAudio(dt);
    this.saveT += dt;
    if (this.saveT > 12) this.save();
  }

  private headingNow(): number {
    switch (this.mode) {
      case 'sled':
        return this.sled.yaw;
      case 'skis':
        return this.skis.yaw;
      case 'heli':
        return this.heli.yaw;
      default:
        return this.walker.yaw;
    }
  }

  private speedNow(): number {
    switch (this.mode) {
      case 'sled':
        return glideSpeed(this.sled);
      case 'skis':
        return glideSpeed(this.skis);
      case 'heli':
        return Math.hypot(this.heli.vx, this.heli.vz);
      default:
        return this.walker.speed;
    }
  }

  private focusPos(): THREE.Vector3 {
    switch (this.mode) {
      case 'sled':
        return this.tmp.set(this.sled.x, this.sled.y, this.sled.z);
      case 'skis':
        return this.tmp.set(this.skis.x, this.skis.y, this.skis.z);
      case 'heli':
        return this.tmp.set(this.heli.x, this.heli.y, this.heli.z);
      default:
        return this.tmp.set(this.walker.x, this.walker.y, this.walker.z);
    }
  }

  private pos2(): { x: number; z: number } {
    const f = this.focusPos();
    return { x: f.x, z: f.z };
  }

  private moveActors(dt: number) {
    const mv = this.input.move;
    const f = this.cam.forward();
    // stick to world: up is camera-forward
    const wx = -f.z * mv.x + f.x * mv.y;
    const wz = f.x * mv.x + f.z * mv.y;
    const free = this.watching <= 0 || this.watchSkip;
    const e = this.p.equip;
    if (this.mode === 'foot') {
      const indoors = inLodge(this.walker.x, this.walker.z) || inGarage(this.walker.x, this.walker.z);
      const working = this.holdT > 0;
      stepWalker(this.walker, free && !working ? wx : 0, free && !working ? wz : 0, dt, this.terrain, this.solid, this.grid, indoors);
      // (footsteps, boot prints and the snow they kick up come from the animation's footfalls)
    } else if (this.mode === 'sled') {
      const s = this.sled;
      const boost = item(e.sledEngine).stat ?? 1;
      const trackStat = item(e.sledTrack).stat ?? 1;
      // the deep lug track floats and bites in powder
      const prof = { ...SLED, powderDrag: SLED.powderDrag * trackStat, powderBite: 1 / Math.sqrt(trackStat) };
      stepGlider(s, prof, free ? mv.x : 0, free ? mv.y : 0, dt, this.terrain, this.solid, this.grid, boost);
      const sp = glideSpeed(s);
      const fx = -Math.sin(s.yaw);
      const fz = -Math.cos(s.yaw);
      if (!s.airborne && sp > 1) {
        this.tracks.add('sled-l', s.x - fx * 0.8, s.z - fz * 0.8, fx, fz, 0.2, -0.32, 0.45);
        this.tracks.add('sled-r', s.x - fx * 0.8, s.z - fz * 0.8, fx, fz, 0.2, 0.32, 0.45);
      } else {
        this.tracks.lift('sled-l');
        this.tracks.lift('sled-r');
      }
      // powder spray off the track and out of the turns
      const powder = s.surface === 'powder' ? 1 : s.surface === 'crust' ? 0.4 : s.surface === 'ice' ? 0.1 : 0.3;
      if (!s.airborne && sp > 3) {
        const n = Math.round((sp / 8 + s.slip * 0.6) * powder * (this.rig.quality.tier === 'low' ? 1 : 2));
        if (n > 0) this.particles.powder(s.x - fx * 1.9, s.y + 0.4, s.z - fz * 1.9, n, 2.5 + s.slip, 2 + sp * 0.12, -fx * sp * 0.25 + s.vx * 0.3, -fz * sp * 0.25 + s.vz * 0.3, 0.9);
      }
      if (s.landed > 3) {
        this.particles.powder(s.x, s.y + 0.3, s.z, 14, 6, 3, s.vx * 0.3, s.vz * 0.3, 1.4, FX_KIND.powder);
        this.audio.landing(s.landed);
        this.cam.kick(Math.min(1, s.landed / 10));
      }
      if (s.bump > 3) {
        this.audio.bump(s.bump);
        this.cam.kick(Math.min(1, s.bump / 10));
        this.particles.powder(s.x, s.y + 1, s.z, 10, 4, 2, 0, 0, 1, FX_KIND.powder);
      }
    } else if (this.mode === 'skis') {
      const s = this.skis;
      const st = item(e.skis).stat ?? 1;
      const prof = { ...SKIS, turn: SKIS.turn * st, climb: item(e.skins).stat ?? 0, engine: 0 };
      if (prof.climb > 0) {
        // skins: walk the skis uphill
        prof.push = 2.6;
        prof.pushTop = 2.4;
      }
      stepGlider(s, prof, free ? mv.x : 0, free ? mv.y : 0, dt, this.terrain, this.solid, this.grid, 1);
      const sp = glideSpeed(s);
      const fx = -Math.sin(s.yaw);
      const fz = -Math.cos(s.yaw);
      if (!s.airborne && sp > 0.6) {
        this.tracks.add('ski-l', s.x, s.z, fx, fz, 0.06, -0.16, 0.5);
        this.tracks.add('ski-r', s.x, s.z, fx, fz, 0.06, 0.16, 0.5);
      }
      if (!s.airborne && (s.slip > 1.5 || sp > 9) && s.surface !== 'ice') {
        const n = Math.round(s.slip * 0.8 + (sp > 9 ? 1 : 0));
        const side = Math.sign(s.lean) || 1;
        this.particles.powder(s.x, s.y + 0.2, s.z, n, 1.5, 1.5 + sp * 0.08, (-fz * side * s.slip) * 0.6, (fx * side * s.slip) * 0.6, 0.6);
      }
      if (s.landed > 3) {
        this.particles.powder(s.x, s.y + 0.2, s.z, 10, 4, 2.5, 0, 0, 1, FX_KIND.powder);
        this.audio.landing(s.landed);
      }
      if (s.bump > 3) {
        this.audio.bump(s.bump);
        this.cam.kick(0.5);
        // a knock you can see: snow shaken loose where you hit
        this.particles.powder(s.x, s.y + 0.8, s.z, 8, 3, 1.8, 0, 0, 0.9, FX_KIND.powder);
      }
    } else if (this.mode === 'heli') {
      const h = this.heli;
      const lift = (this.input.held('up') ? 1 : 0) - (this.input.held('down') ? 1 : 0);
      const scan = item(e.heliScanner);
      void scan;
      const gust = Math.sin(this.time * 0.7) * 0.5 + Math.sin(this.time * 1.9) * 0.3;
      const w = this.cond.wind * (1 + gust * 0.5) * 1.1;
      stepHeli(h, HELI, free ? wx : 0, free ? wz : 0, lift, dt, this.terrain, { x: w, z: w * 0.3 });
      // rotor wash: snow blown off the ground when low
      const agl = heliAgl(h, this.terrain);
      if (h.rotor > 0.6 && agl < 14) {
        const n = Math.round((1 - agl / 14) * (this.rig.quality.tier === 'low' ? 3 : 6));
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2;
          const gx = h.x + Math.cos(a) * 3;
          const gz = h.z + Math.sin(a) * 3;
          this.particles.emit(gx, this.terrain.height(gx, gz) + 0.3, gz, Math.cos(a) * 9, 1 + Math.random() * 2, Math.sin(a) * 9, { life: 1.2, size: 1.6, grow: 2.5, alpha: 0.55, drag: 1.4, rise: -1 });
        }
      }
      if (h.bump > 4) {
        this.audio.bump(h.bump);
        this.cam.kick(0.6);
      }
    }
    // the sled and skis you are not on stay where they are, settled on the ground
    if (this.mode !== 'sled') {
      this.sled.vx = this.sled.vz = 0;
      this.sled.y = this.terrain.height(this.sled.x, this.sled.z);
    }
    if (this.mode !== 'heli' && this.heli.landed) {
      this.heli.running = false;
      stepHeli(this.heli, HELI, 0, 0, 0, dt, this.terrain);
    }
  }

  private updateDog(dt: number) {
    const d = this.dog;
    const pos = this.pos2();
    const owner = { x: pos.x, z: pos.z, yaw: this.headingNow(), speed: this.speedNow() };
    // in a vehicle, Koda rides along
    if (this.mode === 'heli' || (this.mode === 'sled' && !this.p.active?.passenger)) {
      if (d.mode !== 'track') d.mode = 'ride';
    } else if (d.mode === 'ride') d.mode = 'follow';
    // at night at the station, Koda heads for the bed by the fire
    const nearBed = Math.hypot(pos.x - SPOTS.bed.x, pos.z - SPOTS.bed.z) < 6;
    if (this.rig.night > 0.6 && nearBed && d.mode === 'follow' && this.walker.speed < 0.3) {
      d.mode = 'bed';
      d.x = SPOTS.dogBed.x;
      d.z = SPOTS.dogBed.z;
    } else if (d.mode === 'bed' && (!nearBed || this.walker.speed > 1.5)) d.mode = 'follow';
    const scents: Scent[] = [];
    for (const b of BADGES) if (!this.p.badges.includes(b.id)) scents.push({ id: b.id, x: b.x, z: b.z });
    const range = hasUpgrade(this.p, 'kennel') ? 44 : 32;
    const ev = stepHusky(d, owner, dt, this.terrain, this.solid, d.mode === 'ride' ? [] : scents, range, this.rig.night > 0.6);
    for (const e of ev) {
      if (e.type === 'bark') this.audio.bark();
      if (e.type === 'noticed') {
        this.hud.toast('Koda found something', 'good');
        this.audio.whine();
      }
      if (e.type === 'found') {
        this.hud.radio('Vince', 'Good dog. Good, good dog.', 2.5);
        this.audio.whine();
      }
    }
  }

  // ------------------------------------------------------------------ missions

  private snapshot() {
    const pos = this.pos2();
    const vehicle: Vehicle = this.mode;
    return {
      x: pos.x,
      z: pos.z,
      vehicle,
      heliLanded: this.heli.landed,
      heliAgl: heliAgl(this.heli, this.terrain),
      heliYaw: this.heli.yaw,
      avalancheDone: this.pack.done,
    };
  }

  private accept(id: string) {
    const def = mission(id);
    this.p.active = newRun(id);
    this.panels.close();
    this.hud.clearAlert();
    this.alertShown = null;
    this.audio.radio();
    this.audio.accept();
    this.hud.radio(def.from, def.alert, 5);
    // the title card: story missions are chapters, callouts are interludes
    const story = MISSIONS.filter((m) => !m.dynamic);
    const n = story.findIndex((m) => m.id === id);
    const WORDS = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
    this.hud.chapter(n >= 0 ? `Chapter ${WORDS[n] ?? n + 1}` : 'An interlude', def.title, `${FAMILY_LABEL[def.family]} · called in by ${def.from}`, def.family);
    if (id === 'tree') {
      this.props.resetTree();
      this.props.tree.visible = true;
    }
    if (id === 'drift') {
      this.props.van.visible = true;
      this.props.driver.group.visible = true;
    }
    if (id === 'release') this.pack.reset();
    this.syncMissionVisuals();
    this.save();
  }

  private handle(ev: RunEvent[]) {
    const r = this.p.active;
    if (!r) return;
    const def = mission(r.id);
    for (const e of ev) {
      switch (e.type) {
        case 'step': {
          this.audio.chime();
          const s = def.steps[e.index];
          this.hud.toast('Objective done', 'good', 1.6);
          if (s.kind === 'scan') this.hud.radio('Scanner', 'Scanner on. Point the nose at each slope, close and low, and hold it there.', 5);
          if (s.kind === 'fire') {
            this.audio.warning();
            this.hud.radio('Avalanche service', 'Charges set. Get clear of the slope: up on the ridge is safe. Then fire.', 5);
          }
          if (s.kind === 'carry') this.hud.radio('Nils', "Thank you. I really didn't fancy another night out here.", 4);
          if (r.id === 'skier' && s.kind === 'goto' && e.index === 4) this.hud.radio('Tannberg ski patrol', 'The clinic in Hollin is expecting him.', 3.5);
          this.syncMissionVisuals();
          this.save();
          break;
        }
        case 'complete':
          this.finishMission(def);
          return;
        case 'scan': {
          const s = currentStep(r);
          if (s?.kind !== 'scan') break;
          const ct = s.contacts[e.ev.index];
          this.audio.chime();
          this.hud.toast(`${ct.label}: ${e.ev.type === 'found' ? 'Loaded' : 'Stable'}`, e.ev.type === 'found' ? 'warn' : 'good');
          this.hud.radio('Scanner', ct.clear, 4);
          break;
        }
        case 'charge':
          this.audio.click();
          this.hud.toast(`Charge set: ${CHARGE_SPOTS.find((c) => c.id === e.spot)!.label}`, 'good');
          break;
        case 'fire': {
          this.pack.fire(e.charges);
          this.watching = 1;
          this.watchSkip = false;
          for (const ev2 of this.pack.events) if (ev2.type === 'boom') this.particles.blast(ev2.x, this.terrain.height(ev2.x, ev2.z), ev2.z);
          const d = Math.hypot(this.pos2().x - CHARGE_SPOTS[0].x, this.pos2().z - CHARGE_SPOTS[0].z);
          this.audio.boom(d);
          this.cam.kick(0.8);
          this.pack.events.length = 0;
          this.hud.radio('Avalanche service', 'Fire in the hole.', 2.5);
          break;
        }
        case 'track':
          this.audio.whine();
          this.hud.radio('Vince', 'Koda, find him. Find!', 2.5);
          {
            const s = currentStep(r);
            if (s?.kind === 'track') startTrack(this.dog, s.trail);
          }
          break;
        case 'boarded':
          this.audio.chime();
          break;
        case 'cargo':
          this.syncMissionVisuals();
          break;
      }
    }
  }

  private finishMission(def: MissionDef) {
    const before = available(this.p);
    const r = complete(this.p, def.id);
    this.audio.reward();
    if (r.rankAfter > r.rankBefore) this.audio.promote();
    this.hud.radio(def.from, def.done, 5);
    this.dog.mode = this.dog.mode === 'track' ? 'follow' : this.dog.mode;
    this.dog.trail = [];
    this.markers.setPaws([], 0);
    if (def.id === 'drift') {
      this.props.van.visible = false;
      this.props.driver.group.visible = false;
    }
    if (def.id === 'skier') this.props.nils.group.visible = false;
    this.syncMissionVisuals();
    const after = available(this.p).filter((id) => !before.includes(id) && !mission(id).dynamic).map((id) => mission(id).title);
    let extra = '';
    if (def.id === 'release') {
      const res = this.pack.result;
      const pct = Math.round((res.weakReleased / Math.max(1, res.weakTotal)) * 100);
      extra = `${pct}% of the loaded snow came down under control. ${res.roadHit ? 'Some reached the road: the barrier kept it clear of traffic.' : 'The berm held: nothing reached the road.'}${res.secondary ? ' The flow also knocked loose a little snow off a neighbouring slope.' : ''}`;
    }
    if (def.id === 'survey') extra = 'Slopes A and C are marked on the map and flagged on the mountain.';
    this.save();
    this.input.release();
    this.panels.debrief(def.title, def.done, r.funds, r.rep, r.rankAfter > r.rankBefore ? RANKS[r.rankAfter].name : null, after, extra, () => {});
  }

  private updateMission(dt: number) {
    const r = this.p.active;
    if (!r) {
      this.markers.setPins([]);
      this.updateFlags();
      return;
    }
    const ev = tickRun(r, this.snapshot(), dt);
    this.handle(ev);
    const rr = this.p.active;
    // recon pins over the slopes
    const s = rr ? currentStep(rr) : null;
    if (rr && s?.kind === 'scan' && rr.scan) {
      this.markers.setPins(
        s.contacts.map((c, i) => ({
          id: c.label,
          x: c.x,
          z: c.z,
          state: rr.scan!.identified[i] ? (c.target ? 'loaded' : 'stable') : 'unknown',
          progress: rr.scan!.progress[i],
        })),
      );
    } else this.markers.setPins([]);
    if (rr && s?.kind === 'track' && rr.tracking) this.markers.setPaws(s.trail, this.dog.trailI);
    this.updateFlags();
  }

  private updateFlags() {
    const r = this.p.active;
    const show = done(this.p, 'survey') && (!done(this.p, 'release') || r?.id === 'release') && !(r?.id === 'release' && r.fired);
    this.markers.setFlags(show ? this.p.marked.map((id) => ({ id, x: CHARGE_SPOTS.find((c) => c.id === id)!.x, z: CHARGE_SPOTS.find((c) => c.id === id)!.z, charged: !!r?.charges.includes(id) })) : []);
  }

  private updateAvalanche(dt: number) {
    const pack = this.pack;
    if (pack.fired && !pack.done) {
      pack.step(dt);
      let k = 0;
      const step = this.rig.quality.tier === 'low' ? 7 : 4;
      for (const b of pack.blocks) {
        if (b.state !== 2) continue;
        if (k++ % step !== Math.floor(this.time * 30) % step) continue;
        const sp = Math.hypot(b.vx, b.vz);
        if (sp > 2) this.particles.cloud(b.x, b.y, b.z, b.vx, b.vz, Math.min(1, sp / 20));
      }
      for (const e of pack.events) {
        if (e.type === 'crack') this.audio.crack();
        // slab blocks letting go: heavy, dull, further off the later they arrive
        if (e.type === 'release') this.audio.thud(1.6, Math.hypot(e.x - this.pos2().x, e.z - this.pos2().z) * 0.35);
        if (e.type === 'secondary') this.hud.radio('Avalanche service', 'Secondary release on the next slope over. That is fine, let it run.', 4);
      }
      pack.events.length = 0;
      const d = Math.hypot(this.pos2().x - -120, this.pos2().z - -330);
      if (pack.moving > 0) this.cam.kick(Math.min(0.5, (pack.moving / 200) * (200 / Math.max(80, d))));
    }
    if (this.watching > 0 && pack.done) {
      this.watching = 0;
      this.hud.radio('Avalanche service', pack.result.roadHit ? 'It is down. A little over the road, but the barrier did its job.' : 'It is down. The berm caught the lot. Beautiful.', 4.5);
    }
    this.avView.sync(pack);
  }

  private avalancheFocus(): THREE.Vector3 {
    let x = 0;
    let y = 0;
    let z = 0;
    let n = 0;
    for (const b of this.pack.blocks) {
      if (b.state !== 2) continue;
      x += b.x;
      y += b.y;
      z += b.z;
      n++;
    }
    if (!n) return new THREE.Vector3(-120, this.terrain.height(-120, -330), -330);
    return new THREE.Vector3(x / n, y / n, z / n);
  }

  // ------------------------------------------------------------------ interaction

  /** Everything you could do right where you stand, best first. */
  private candidates(): Act[] {
    const out: Act[] = [];
    const p = this.p;
    const pos = this.pos2();
    const near = (x: number, z: number, r: number) => Math.hypot(pos.x - x, pos.z - z) < r;
    const r = p.active;
    // watching the avalanche
    if (this.watching > 0 && !this.watchSkip) {
      out.push({ id: 'look-away', label: 'Back to you', hold: 0, run: () => (this.watchSkip = true) });
      return out;
    }
    // firing the charges
    if (r) {
      const fs = fireState(r, pos.x, pos.z);
      if (fs !== 'none') out.push({ id: 'fire', label: fs === 'ready' ? 'Fire charges' : 'Too close to fire', hold: fs === 'ready' ? 0.6 : 0, red: true, enabled: fs === 'ready', run: () => fs === 'ready' && this.handle(fire(r)) });
    }
    // mission work
    if (r) {
      for (const it of interactables(r)) {
        const x = it.dog ? this.dog.x : it.x;
        const z = it.dog ? this.dog.z : it.z;
        if (!near(x, z, it.radius)) continue;
        if (it.onFoot && this.mode !== 'foot') continue;
        if (it.onSled && this.mode !== 'sled') continue;
        const work: Act['work'] = it.id === 'saw' ? 'saw' : it.id === 'dig' ? 'dig' : it.hold >= 2 ? 'fix' : undefined;
        out.push({
          id: it.id,
          label: it.action,
          hold: it.hold,
          work,
          red: it.id.startsWith('charge'),
          run: () => this.missionInteract(it.id),
        });
      }
    }
    // vehicles
    if (this.mode === 'foot') {
      if (near(this.sled.x, this.sled.z, 2.8)) out.push({ id: 'ride', label: 'Ride the sled', hold: 0, run: () => this.mountSled() });
      if (near(this.heli.x, this.heli.z, 4.5)) out.push({ id: 'fly', label: this.cond.grounded ? 'Grounded' : 'Fly', hold: 0, enabled: !this.cond.grounded, run: () => this.mountHeli() });
    }
    if (this.mode === 'heli' && this.heli.landed && this.heli.rotor < 0.3) out.push({ id: 'off', label: 'Climb out', hold: 0, run: () => this.dismount() });
    // the station
    if (this.mode === 'foot') {
      if (near(SPOTS.table.x, SPOTS.table.z, 2.6)) out.push({ id: 'table', label: 'Mission table', hold: 0, run: () => this.openBoard() });
      if (near(SPOTS.wardrobe.x, SPOTS.wardrobe.z, 2.2)) out.push({ id: 'wardrobe', label: 'Wardrobe', hold: 0, run: () => this.openOutfit('Wardrobe', ['patroller']) });
      if (near(SPOTS.bed.x, SPOTS.bed.z, 2.6)) out.push({ id: 'bed', label: 'Sleep till morning', hold: 1, run: () => this.sleep() });
      if (near(SPOTS.workbench.x, SPOTS.workbench.z, 2.6)) out.push({ id: 'bench', label: 'Workbench', hold: 0, run: () => this.openOutfit('Garage workbench', ['sled', 'skis']) });
      if (near(SPOTS.kennel.x, SPOTS.kennel.z, 3) || near(SPOTS.dogBed.x, SPOTS.dogBed.z, 2)) out.push({ id: 'kennel', label: "Koda's gear", hold: 0, run: () => this.openOutfit("Koda's corner", ['koda']) });
      if (near(SPOTS.heli.x, SPOTS.heli.z, 10) && !near(this.heli.x, this.heli.z, 4.5)) out.push({ id: 'heligear', label: 'Helicopter kit', hold: 0, run: () => this.openOutfit('Helicopter kit', ['heli']) });
      if (hasUpgrade(p, 'hangar') && near(SPOTS.hangarDoor.x, SPOTS.hangarDoor.z, 4)) out.push({ id: 'hangar', label: 'Hangar', hold: 0, run: () => this.openOutfit('Hangar', ['heli']) });
      if (hasUpgrade(p, 'equipment') && near(SPOTS.equipDoor.x, SPOTS.equipDoor.z, 3)) out.push({ id: 'equip', label: 'Equipment room', hold: 0, run: () => this.openOutfit('Equipment room', ['skis', 'patroller']) });
      if (near(this.dog.x, this.dog.z, 2.4) && this.dog.mode !== 'track') out.push({ id: 'pet', label: 'Pet Koda', hold: 0, run: () => this.petDog() });
    }
    return out;
  }

  private petDog() {
    pet(this.dog);
    this.p.affection++;
    this.audio.whine();
    this.player.animate('pet', 0, 0, 0, 0.016);
    this.holdId = 'pet-pose';
    this.holdT = 0.9;
  }

  private missionInteract(id: string) {
    const r = this.p.active;
    if (!r) return;
    if (id === 'pet') this.petDog();
    if (id === 'anemometer') {
      this.world.setStationWorking(true);
      this.hud.radio('Dispatch', 'Data coming through. Nice work.', 3);
    }
    if (id === 'saw') this.props.sawTree();
    if (id === 'locker') this.hud.radio('Vince', 'Two charges, detonators, the firing box. Signed out.', 3.5);
    if (id === 'gate-close') this.hud.radio('Dispatch', 'Pass road closed below Kessel Bowl.', 3);
    if (id === 'gate-open') this.hud.radio('Dispatch', 'Pass road open again.', 3);
    if (id === 'aid-nils') this.hud.radio('Nils', 'I heard the dog first. I thought I was dreaming.', 4);
    if (id === 'unload') this.hud.radio('Greta', "Oh, bless you both. Mind the step, it's icy.", 3);
    if (id === 'pepper-home') this.hud.radio('Greta', 'Pepper! You silly thing. Come here, you are frozen.', 3);
    if (id === 'dig') this.hud.radio('Van driver', "That's it, she's free! Thank you. I'd still be sat here at midnight.", 3.5);
    if (id === 'pepper') this.audio.whine();
    const ev = interact(r, id);
    this.handle(ev);
    this.syncMissionVisuals();
  }

  private updateInteractions(dt: number) {
    const list = this.candidates();
    const pos = this.pos2();
    // rings on the ground where you can act
    const r = this.p.active;
    const rings: { x: number; z: number; r: number }[] = [];
    if (r) for (const it of interactables(r)) if (!it.dog && Math.hypot(pos.x - it.x, pos.z - it.z) < 60) rings.push({ x: it.x, z: it.z, r: it.radius });
    this.markers.setRings(rings);
    const a = list[0];
    if (this.holdId === 'pet-pose') {
      this.holdT -= dt;
      if (this.holdT <= 0) this.holdId = '';
    }
    if (!a) {
      this.hud.setAction(null);
      if (this.holdId !== 'pet-pose') {
        this.holdId = '';
        this.holdT = 0;
      }
      return;
    }
    const held = this.input.held('action');
    const pressed = this.input.pressed('btn:action') || this.input.pressed('KeyE') || this.input.pressed('Space') || this.input.pressed('Enter');
    const enabled = a.enabled !== false;
    if (pressed && !enabled) this.audio.deny();
    if (a.hold <= 0) {
      if (pressed && enabled) a.run();
      this.hud.setAction(a.label, !!a.red, 0, enabled);
      return;
    }
    if (held && enabled) {
      if (this.holdId !== a.id) {
        this.holdId = a.id;
        this.holdT = 0;
      }
      this.holdT += Math.max(dt, this.realDt);
      if (a.work && Math.random() < dt * 8) this.audio.work(a.work);
      if (this.holdT >= a.hold) {
        this.holdT = 0;
        this.holdId = '';
        this.audio.done();
        this.hud.actDone();
        a.run();
      }
    } else if (this.holdId !== 'pet-pose') {
      this.holdT = Math.max(0, this.holdT - dt * 2);
      if (this.holdT === 0) this.holdId = '';
    }
    this.hud.setAction(a.label, !!a.red, this.holdId === a.id ? this.holdT / a.hold : 0, enabled);
  }

  private updateBadges() {
    if (this.mode === 'heli' && !this.heli.landed) return;
    const pos = this.pos2();
    for (const b of BADGES) {
      if (this.p.badges.includes(b.id)) continue;
      if (Math.hypot(pos.x - b.x, pos.z - b.z) < 3) {
        findBadge(this.p, b.id);
        this.station.setBadges(this.p.badges);
        this.audio.sparkle();
        this.hud.toast(`Old patrol badge: ${b.name}`, 'good', 3);
        this.hud.radio('Vince', `${this.p.badges.length} of ${BADGES.length}. That one goes on the board in the lodge.`, 3.5);
        this.save();
      }
    }
  }

  private updateEvents(dt: number) {
    const id = tickEvents(this.p, dt, this.cond.sky === 'storm', this.rng);
    if (id) {
      const m = mission(id);
      this.audio.radio();
      this.hud.radio(m.from, m.alert, 5);
      if (id === 'tree') {
        this.props.resetTree();
        this.props.tree.visible = true;
      }
      if (id === 'drift') {
        this.props.van.visible = true;
        this.props.driver.group.visible = true;
      }
      this.save();
    }
    // offer the waiting callout when you are free
    const waiting = this.p.events[0];
    if (waiting && !this.p.active && this.alertShown !== waiting && !this.panels.open) {
      this.alertShown = waiting;
      const m = mission(waiting);
      this.hud.alert(m.title, m.alert, () => this.accept(waiting), () => this.hud.toast('On the mission table'));
    }
  }

  // ------------------------------------------------------------------ actors on screen

  private placeActors(dt: number, title: boolean) {
    const pl = this.player;
    const sledY = this.sled.y;
    const n = this.terrain.normal(this.sled.x, this.sled.z);
    this.sledMesh.sync(this.sled.x, sledY, this.sled.z, this.sled.yaw, n.x, n.y, n.z, this.sled.lean, glideSpeed(this.sled), this.mode === 'sled' ? this.input.move.x : 0, dt);
    this.sledMesh.setHeadlight(this.rig.night > 0.4 && this.mode === 'sled');
    const hl = this.heli;
    this.heliMesh.sync(hl.x, hl.y, hl.z, hl.yaw, hl.pitch, hl.roll, hl.rotor, this.time, dt, this.mode === 'heli' && this.p.active ? currentStep(this.p.active)?.kind === 'scan' : false);
    this.heliMesh.setSearchlight(this.p.equip.heliLight === 'light-search' && this.rig.night > 0.4 && this.mode === 'heli' && !hl.landed);
    pl.group.visible = this.mode !== 'heli';
    let pose: Pose = 'idle';
    if (title) {
      // either side of the door, square to the camera
      pl.group.position.set(SPOTS.lodgeDoor.x + 4, this.station.y + 0.3, SPOTS.lodgeDoor.z - 1.4);
      pl.group.rotation.y = -Math.PI / 2;
      pl.animate('idle', 0, 0, 0, dt);
      this.dogMesh.group.position.set(SPOTS.lodgeDoor.x + 4, this.station.y + 0.3, SPOTS.lodgeDoor.z + 1.4);
      this.dogMesh.group.rotation.y = -Math.PI / 2;
      return;
    }
    if (this.mode === 'foot') {
      pl.backSkis(true);
      const w = this.walker;
      const indoors = inLodge(w.x, w.z) || inGarage(w.x, w.z);
      pl.group.position.set(w.x, w.y + (indoors ? 0.32 : 0), w.z);
      pl.group.quaternion.setFromAxisAngle(UP, w.yaw);
      const carrying = !!this.p.active?.carrying;
      pose = this.holdT > 0 && this.holdId && this.holdId !== 'pet-pose' ? 'work' : this.holdId === 'pet-pose' ? 'pet' : carrying ? 'carry' : w.speed > 4 ? 'run' : w.speed > 0.3 ? 'walk' : 'idle';
      // the ground's rise ahead, so planted feet meet a slope instead of floating over it
      const fx = -Math.sin(w.yaw);
      const fz = -Math.cos(w.yaw);
      const slope = indoors ? 0 : this.terrain.height(w.x + fx * 0.4, w.z + fz * 0.4) - this.terrain.height(w.x - fx * 0.4, w.z - fz * 0.4);
      pl.animate(pose, w.stride, w.speed, 0, dt, THREE.MathUtils.clamp(slope / 0.8, -0.8, 0.8));
      // a boot meets the snow on this frame: the sound and the kick of snow come from that boot
      const ff = pl.footfall;
      if (ff) {
        const surf = indoors ? 'packed' : this.terrain.surface(w.x, w.z);
        const soft = surf === 'powder' ? 1 : surf === 'ice' ? 0 : 0.3;
        this.audio.step(ff.hard, soft);
        if (!indoors) {
          pl.footWorld(ff.side, this.footPos);
          // a boot print where the boot actually landed (powder takes a deeper one)
          this.tracks.print(this.footPos.x - Math.sin(w.yaw) * 0.06, this.footPos.z - Math.cos(w.yaw) * 0.06, -Math.sin(w.yaw), -Math.cos(w.yaw), 0.3, 0.07, 0.22 + soft * 0.14);
          // powder flies off a running boot; packed snow only puffs a little
          // a small kick of snow off the boot: a couple of grains on packed snow, a little more in powder
          const n = surf === 'powder' ? 2 + Math.round(ff.hard) : ff.hard > 0.6 ? 1 : 0;
          const fx = -Math.sin(w.yaw);
          const fz = -Math.cos(w.yaw);
          if (n) this.particles.powder(this.footPos.x, this.footPos.y + 0.03, this.footPos.z, n, 0.35 + ff.hard * 0.3, 0.3 + ff.hard * 0.4, fx * w.speed * 0.15, fz * w.speed * 0.15, 0.14 + ff.hard * 0.1 + soft * 0.08);
        }
      }
    } else if (this.mode === 'sled') {
      this.sledMesh.group.updateMatrixWorld(true);
      this.seat.copy(this.sledMesh.seat);
      this.sledMesh.body.localToWorld(this.seat);
      pl.group.position.copy(this.seat).y -= 0.62;
      pl.group.quaternion.copy(this.sledMesh.group.quaternion);
      pl.animate('ride', 0, glideSpeed(this.sled), this.sled.lean, dt);
      pl.backSkis(false);
    } else if (this.mode === 'skis') {
      const s = this.skis;
      pl.group.position.set(s.x, s.y + 0.08, s.z);
      pl.group.quaternion.setFromAxisAngle(UP, s.yaw);
      pl.animate('ski', s.x + s.z, glideSpeed(s), s.lean, dt);
    }
    // Nils on the back of the sled
    const r = this.p.active;
    const nilsRiding = r?.id === 'skier' && r.passenger;
    if (nilsRiding) {
      const seat = this.tmp2.copy(this.sledMesh.rack);
      seat.z -= 0.35;
      this.sledMesh.body.localToWorld(seat);
      this.props.nils.group.position.copy(seat).y -= 0.62;
      this.props.nils.group.quaternion.copy(this.sledMesh.group.quaternion);
      this.props.nils.animate('ride', 0, 0, 0, dt);
      this.props.nils.group.visible = true;
      this.passengerVisible = true;
    } else if (this.passengerVisible) {
      this.passengerVisible = false;
      this.syncMissionVisuals();
    } else if (this.props.nils.group.visible) {
      const step = r?.step ?? 0;
      this.props.nils.animate(step >= 3 ? 'idle' : 'work', 0, 0, 0, dt);
    }
    this.props.greta.animate('idle', 0, 0, 0, dt);
    if (this.props.driver.group.visible) this.props.driver.animate('idle', 0, 0, 0, dt);
    // Koda
    const d = this.dog;
    const dm = this.dogMesh;
    if (d.mode === 'ride' && this.mode === 'sled') {
      const rack = this.tmp2.copy(this.sledMesh.rack);
      this.sledMesh.body.localToWorld(rack);
      dm.group.visible = true;
      dm.group.position.copy(rack).y -= 0.45;
      dm.group.quaternion.copy(this.sledMesh.group.quaternion);
      dm.animate('ride', 0, dt);
    } else if (d.mode === 'ride' && this.mode === 'heli') {
      dm.group.visible = false;
    } else {
      dm.group.visible = true;
      dm.group.position.set(d.x, d.y + (inLodge(d.x, d.z) ? 0.32 : 0), d.z);
      dm.group.quaternion.setFromAxisAngle(UP, d.yaw);
      dm.animate(d.anim, d.stride, dt);
      if ((d.anim === 'run' || d.anim === 'trot') && Math.random() < dt * 6 && this.terrain.surface(d.x, d.z) === 'powder') this.particles.powder(d.x, d.y + 0.1, d.z, 1, 0.6, 0.6, 0, 0, 0.4);
    }
  }

  /** The FXCraft flipbook atlas for the particles (Light, or a failed load, keeps the plain discs). */
  private fxAtlas: THREE.Texture | null = null;
  private loadFxAtlas() {
    if (!this.rig.quality.fx) return this.particles.setAtlas(null);
    if (this.fxAtlas) return this.particles.setAtlas(this.fxAtlas);
    new THREE.TextureLoader().load(
      `${import.meta.env.BASE_URL}fx/kessel-fx.png`,
      (t) => {
        t.flipY = false;
        t.colorSpace = THREE.NoColorSpace;
        t.generateMipmaps = false;
        t.minFilter = THREE.LinearFilter;
        this.fxAtlas = t;
        if (this.rig.quality.fx) this.particles.setAtlas(t);
      },
      undefined,
      () => this.particles.setAtlas(null),
    );
  }

  private hearthFlame = 0;
  private readonly hearthPos = new THREE.Vector3();

  /**
   * Spindrift: the wind tearing snow off the summits in long plumes, streaming east. Seen from the
   * valley floor it says how hard it blows up high even when it is still down here.
   */
  private spindrift(dt: number, wind: number, light: number) {
    this.spinT -= dt;
    if (this.spinT > 0 || light < 0.2) return;
    this.spinT = 0.5 / (0.4 + wind * 1.6);
    const p = PEAKS[Math.floor(Math.random() * PEAKS.length)];
    const y = this.terrain.height(p.x, p.z) + 6;
    const v = 6 + wind * 16;
    this.particles.emit(p.x + (Math.random() - 0.5) * 30, y + Math.random() * 8, p.z + (Math.random() - 0.5) * 30, v * 0.97, 1.5 + Math.random() * 2, v * 0.25, {
      life: 5 + Math.random() * 4,
      size: 18 + Math.random() * 16,
      grow: 2.6,
      alpha: 0.18 + wind * 0.22,
      drag: 0.05,
      rise: 0.3,
      kind: FX_KIND.powder,
    });
  }

  private smoke(dt: number) {
    // the hearth burns while you are in the lodge to see it
    if (this.indoors > 0.5 && inLodge(this.walker.x, this.walker.z)) {
      this.hearthFlame += dt * (this.rig.quality.tier === 'low' ? 14 : 24);
      if (this.hearthFlame >= 1) this.station.hearthAt(this.hearthPos);
      for (; this.hearthFlame >= 1; this.hearthFlame--) this.particles.flame(this.hearthPos.x, this.hearthPos.y, this.hearthPos.z);
    }
    this.smokeT -= dt;
    if (this.smokeT > 0) return;
    this.smokeT = this.rig.quality.tier === 'low' ? 0.35 : 0.2;
    const camPos = this.rig.camera.position;
    for (const list of [this.station.smokeSources, this.world.smokeSources])
      for (const s of list) {
        if (s.distanceToSquared(camPos) > 400 * 400) continue;
        this.particles.smoke(s.x, s.y, s.z, this.cond.wind);
      }
  }

  // ------------------------------------------------------------------ HUD

  private freeHint(): string {
    const pos = this.pos2();
    const atHq = Math.hypot(pos.x - HQ.x, pos.z - HQ.z) < 90;
    const ids = available(this.p);
    if (!ids.length) return 'All quiet. Explore, look for old patrol badges, or sleep at the station.';
    return atHq ? `${ids.length === 1 ? 'A call is' : `${ids.length} calls are`} waiting on the mission table in the lodge.` : 'Calls come in on the radio. The mission table is at the station.';
  }

  private updateHud(dt: number) {
    const p = this.p;
    const r = p.active;
    const pos = this.pos2();
    if (r) {
      const def = mission(r.id);
      const s = currentStep(r);
      let obj = s ? (s.kind === 'interact' || s.kind === 'goto' || s.kind === 'land' ? s.text : s.text) : '';
      if (s?.kind === 'charges') obj += ` (${r.charges.length} of ${s.spots.length})`;
      if (s?.kind === 'scan' && r.scan) obj += ` (${r.scan.identified.filter(Boolean).length} of ${s.contacts.length})`;
      this.hud.setTask({ family: FAMILY_LABEL[def.family], title: def.title, objective: obj, steps: def.steps.length, current: r.step }, '');
    } else this.hud.setTask(null, this.freeHint());
    // where to go
    let target: { x: number; z: number; label: string } | null = null;
    if (r) {
      const t = navTarget(r, pos);
      if (t === 'dog') target = { x: this.dog.x, z: this.dog.z, label: 'Koda' };
      else if (t === 'sled') target = this.mode === 'sled' ? null : { x: this.sled.x, z: this.sled.z, label: 'Sled' };
      else if (t === 'heli') target = this.mode === 'heli' ? null : { x: this.heli.x, z: this.heli.z, label: 'Helicopter' };
      else if (t) target = t;
      if (t && typeof t === 'object' && r.id === 'rounds' && r.step === 0) target = null;
    } else if (available(p).length && Math.hypot(pos.x - HQ.x, pos.z - HQ.z) < 400) target = { x: SPOTS.table.x, z: SPOTS.table.z, label: 'Mission table' };
    const heading = ((-this.cam.yaw * 180) / Math.PI + 3600) % 360;
    if (target) {
      const dx = target.x - pos.x;
      const dz = target.z - pos.z;
      const bearing = ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
      const dist = Math.hypot(dx, dz);
      this.hud.setCompass(heading, bearing, dist, target.label);
      this.markers.setBeacon(dist > 12 ? target.x : null, target.z, this.p.active ? 0x5ad1ff : 0xf2c230);
    } else {
      this.hud.setCompass(heading, null, 0, '');
      this.markers.setBeacon(null);
    }
    const c = this.cond;
    const danger = avalancheDanger(p.weather, c);
    // minimal: the temperature, and the sky only when it matters (snow, a storm that grounds the helicopter)
    this.hud.setConditions(clock(p.weather.minute), `${c.temp}°${c.sky === 'snow' || c.sky === 'storm' ? ` ${SKY_LABEL[c.sky]}` : ''}`, danger, DANGER_LABEL[danger], p.funds);
    // chips
    const busyDog = this.dog.mode === 'track';
    this.hud.setChips({
      off: this.mode === 'sled' ? 'Get off' : this.mode === 'heli' ? (this.heli.landed ? 'Shut down' : null) : this.mode === 'skis' ? 'Skis off' : null,
      skis: this.mode === 'foot' && !this.indoorsNow() ? 'Skis on' : null,
      koda: this.mode === 'foot' || this.mode === 'skis' ? (busyDog ? 'Koda: tracking' : this.dog.mode === 'stay' ? 'Koda: heel' : 'Koda: stay') : null,
      kodaOn: busyDog || this.dog.mode === 'stay',
    });
    this.hud.setLever(this.mode === 'heli');
    if (this.mode === 'sled') this.hud.setSpeedo(Math.abs(forwardSpeed(this.sled)) * 3.6, SURFACE_LABEL[this.sled.surface]);
    else if (this.mode === 'skis') this.hud.setSpeedo(glideSpeed(this.skis) * 3.6, SURFACE_LABEL[this.skis.surface]);
    else this.hud.setSpeedo(null, '');
    if (this.mode === 'heli') this.hud.setAlt(heliAgl(this.heli, this.terrain), elevation(this.heli.y), Math.hypot(this.heli.vx, this.heli.vz));
    else this.hud.setAlt(null);
    // the SKYTRACE scanner readout
    const s = r ? currentStep(r) : null;
    if (r && s?.kind === 'scan' && r.scan && this.mode === 'heli' && r.scan.looking >= 0) {
      this.hud.setScan(`Reading ${s.contacts[r.scan.looking].label}`, r.scan.progress[r.scan.looking]);
    } else if (r && s?.kind === 'scan' && this.mode === 'heli' && !this.heli.landed && heliAgl(this.heli, this.terrain) > 200) {
      this.hud.setScan('Too high to read the snow', 0);
    } else this.hud.setScan(null, 0);
    this.hud.hint(!this.input.touch ? false : p.played < 25 && this.mode === 'foot');
    this.hud.update(Math.max(dt, this.realDt));
  }

  private indoorsNow() {
    return inLodge(this.walker.x, this.walker.z) || inGarage(this.walker.x, this.walker.z);
  }

  private updateAudio(dt: number) {
    const m = this.mode;
    const sp = this.speedNow();
    const s = m === 'sled' ? this.sled : m === 'skis' ? this.skis : null;
    this.audio.update(dt, {
      engine: m === 'sled' ? 0.15 + this.sled.power * 0.85 : 0,
      speed: sp,
      rotor: this.heli.rotor * (this.mode === 'heli' ? 1 : Math.max(0, 1 - Math.hypot(this.heli.x - this.walker.x, this.heli.z - this.walker.z) / 120)),
      hiss: s && !s.airborne ? Math.min(1, sp / 15) : 0,
      wind: this.cond.wind,
      rumble: this.pack.fired && !this.pack.done ? Math.min(1, this.pack.moving / 120) : 0,
      fire: this.indoors * (inLodge(this.walker.x, this.walker.z) ? 1 : 0),
      outdoors: 1 - this.indoors * 0.7,
      day: 1 - this.rig.night,
      talking: this.hud.talking,
      intensity: this.musicIntensity(),
    });
  }

  /** How hard the theme plays: the patrol bed, a call in hand, the avalanche about to go or going. */
  private musicIntensity(): 0 | 1 | 2 {
    const a = this.p.active;
    if ((this.pack.fired && !this.pack.done) || (a?.id === 'release' && currentStep(a)?.kind === 'fire')) return 2;
    return a ? 1 : 0;
  }

  // ------------------------------------------------------------------ screens

  private openBoard(tab: 'calls' | 'station' | 'log' = 'calls') {
    this.input.release();
    if (!this.panels.open) this.audio.paper();
    const danger = avalancheDanger(this.p.weather, this.cond);
    this.panels.board(
      this.p,
      this.cond,
      danger,
      (id) => this.accept(id),
      (u) => {
        if (build(this.p, u as UpgradeId)) {
          this.audio.reward();
          this.station.setUpgrades(this.p.upgrades);
          this.solid.setEnabled(u, true);
          this.hud.toast(`Built: ${UPGRADES.find((k) => k.id === u)!.name}`, 'good', 3);
          this.save();
        } else this.audio.deny();
        this.openBoard('station');
      },
      tab,
    );
  }

  private openOutfit(title: string, groups: Group[]) {
    this.input.release();
    if (!this.panels.open) this.audio.paper();
    this.panels.outfit(
      title,
      groups,
      this.p,
      (id) => {
        if (buy(this.p, id)) {
          this.audio.chime();
          this.applyProfile();
          this.save();
        } else this.audio.deny();
      },
      (id) => {
        equip(this.p, id);
        this.audio.click();
        this.applyProfile();
        this.save();
      },
    );
  }

  /**
   * A sharp copy of the map for zooming in, drawn a few milliseconds at a time once the valley is up.
   * Its own method (not a closure in the constructor), so its drawing buffers are freed when it is done.
   */
  private drawSharpMap() {
    const sharp = topoJob(this.terrain, 1536);
    const drawSharp = () => {
      if (!sharp.step(6)) return void setTimeout(drawSharp, 24);
      const c = sharp.canvas;
      c.toBlob((b) => {
        if (b) this.panels.setTopo(URL.createObjectURL(b));
        this.sharpMap = !!b;
        // the PNG is all the map needs from here: give the canvas's memory back
        c.width = c.height = 0;
      }, 'image/png');
    };
    drawSharp();
  }

  private openMap() {
    this.input.release();
    if (!this.panels.open) this.audio.paper();
    const pos = this.pos2();
    const r = this.p.active;
    let target: { x: number; z: number; label: string } | null = null;
    if (r) {
      const t = navTarget(r, pos);
      if (t && typeof t === 'object') target = t;
      else if (t === 'dog') target = { x: this.dog.x, z: this.dog.z, label: 'Koda' };
    }
    this.panels.map(this.p, {
      me: { ...pos, yaw: this.headingNow() },
      koda: { x: this.dog.x, z: this.dog.z },
      sled: { x: this.sled.x, z: this.sled.z },
      heli: { x: this.heli.x, z: this.heli.z },
      target,
      badges: hasUpgrade(this.p, 'mast') ? BADGES.map((b) => ({ x: b.x, z: b.z, found: this.p.badges.includes(b.id) })) : this.p.badges.map((id) => ({ ...BADGES.find((b) => b.id === id)!, found: true })),
    });
  }

  private openPause() {
    this.input.release();
    if (!this.panels.open) this.audio.paper();
    this.save();
    this.panels.pause(
      this.p.settings,
      (s) => this.applySettings(s),
      () => {
        this.save();
        this.panels.close();
        this.showTitle();
      },
      () => {
        this.panels.close();
        this.resetProfile();
        try {
          this.store?.removeItem('rockslide.patrol.v1');
        } catch {
          /* ignore */
        }
        this.showTitle();
      },
    );
  }

  private applySettings(s: Settings) {
    const q = s.quality !== this.p.settings.quality;
    this.p.settings = s;
    this.audio.setSound(s.sound);
    this.audio.setMusic(s.music);
    if (q) {
      this.rig.quality = detectQuality(s.quality);
      this.loadFxAtlas();
      this.rig.resize();
    }
    this.save();
  }

  private sleep() {
    const p = this.p;
    nextDay(p.weather);
    if (done(p, 'release')) this.pack.reset();
    const bonus = hasUpgrade(p, 'wing') ? 60 : 0;
    p.funds += bonus;
    this.cond = conditions(p.weather);
    this.audio.chime();
    this.save();
    this.input.release();
    this.panels.morning(p.weather.day, this.cond, avalancheDanger(p.weather, this.cond), bonus);
  }

  // ------------------------------------------------------------------ saving

  private save() {
    this.saveT = 0;
    if (this.state !== 'play') return;
    const p = this.p;
    const pos = this.pos2();
    p.player = { x: pos.x, z: pos.z, yaw: this.headingNow(), mode: this.mode };
    if (this.mode === 'skis') p.player = { x: this.skis.x, z: this.skis.z, yaw: this.skis.yaw, mode: 'skis' };
    p.sled = { x: this.sled.x, z: this.sled.z, yaw: this.sled.yaw };
    p.heli = { x: this.heli.x, z: this.heli.z, yaw: this.heli.yaw };
    saveProfile(this.store, p);
  }

  /** For the browser test scripts. */
  debug() {
    return {
      game: this,
      profile: () => this.p,
      /** the Kessel kit (QA): how much is placed, in how many draw calls, and the pieces nearest a point */
      /** which code-built meshes the MeshCraft models replaced */
      models: () => ({ ...this.modelled }),
      /** the audio files (QA): format, theme on, intensity, how many voice lines have played */
      audio: () => this.audio.stats(),
      hearth: () => ({ at: this.station.hearthAt(new THREE.Vector3()).toArray(), indoors: this.indoors, particles: this.particles.count, atlas: this.particles.uniforms.uUseAtlas.value }),
      /** set an effect off where you are looking (QA and the trailer): a charge, or the powder cloud */
      fx: (what: 'blast' | 'cloud', x: number, z: number) => {
        const y = this.terrain.height(x, z);
        if (what === 'blast') this.particles.blast(x, y, z);
        else for (let i = 0; i < 160; i++) this.particles.cloud(x + (Math.random() - 0.5) * 30, y + 1, z + (Math.random() - 0.5) * 30, 0, 8, 1);
      },
      /** the forest's level of detail: cells near and far, and a switch for A/B checks */
      forest: (lod?: boolean) => {
        if (lod !== undefined) this.forest.setLod(lod);
        return this.forest.stats();
      },
      kit: (x?: number, z?: number, kind?: string) => ({
        loaded: this.kitLoaded,
        placed: this.kitView.placed,
        drawCalls: this.kitView.drawCalls,
        near:
          x === undefined || z === undefined
            ? []
            : this.scattered
                .filter((p) => !kind || p.kind.startsWith(kind))
                .map((p) => ({ ...p, d: Math.hypot(p.x - x, p.z - z) }))
                .sort((a, b) => a.d - b.d)
                .slice(0, 5),
      }),
      sharpMap: () => this.sharpMap,
      actor: () => ({ yaw: this.walker.yaw, speed: this.walker.speed, camYaw: this.cam.yaw, x: this.walker.x, z: this.walker.z }),
      info: () => ({ calls: this.rig.renderer.info.render.calls, tris: this.rig.renderer.info.render.triangles, heli: { ...this.heli }, dog: { mode: this.dog.mode, anim: this.dog.anim, x: this.dog.x, z: this.dog.z } }),
      state: () => ({ mode: this.mode, pos: this.pos2(), active: this.p.active, fps: Math.round(this.fps), step: this.p.active ? currentStep(this.p.active)?.kind : null, watching: this.watching, pack: { fired: this.pack.fired, done: this.pack.done, moving: this.pack.moving, result: this.pack.result } }),
      teleport: (x: number, z: number, yaw = 0) => {
        if (this.mode === 'sled') {
          this.sled.x = x;
          this.sled.z = z;
          this.sled.yaw = yaw;
          this.sled.y = this.terrain.height(x, z);
        } else if (this.mode === 'heli') {
          this.heli.x = x;
          this.heli.z = z;
          this.heli.yaw = yaw;
          this.heli.y = Math.max(this.heli.y, this.terrain.height(x, z) + 40);
        } else if (this.mode === 'skis') {
          this.skis.x = x;
          this.skis.z = z;
          this.skis.yaw = yaw;
          this.skis.y = this.terrain.height(x, z);
        } else this.placeWalker(x, z, yaw);
        this.cam.snapBehind(yaw);
      },
      sledTo: (x: number, z: number) => {
        this.sled.x = x;
        this.sled.z = z;
        this.sled.y = this.terrain.height(x, z);
      },
      heliTo: (x: number, z: number, y: number) => {
        this.heli.x = x;
        this.heli.z = z;
        this.heli.y = y;
        this.heli.landed = false;
        this.heli.running = true;
        this.heli.rotor = 1;
      },
      dogTo: (x: number, z: number) => {
        this.dog.x = x;
        this.dog.z = z;
      },
      setTime: (minute: number) => (this.p.weather.minute = minute),
      setDay: (d: number) => (this.p.weather.day = d),
      accept: (id: string) => this.accept(id),
      complete: (id: string) => complete(this.p, id),
      funds: (n: number) => (this.p.funds = n),
      rep: (n: number) => (this.p.rep = n),
      apply: () => this.applyProfile(),
      camYaw: (y: number) => (this.cam.yaw = y),
      camPitch: (y: number) => (this.cam.pitch = y),
      closePanel: () => this.panels.close(),
      save: () => this.save(),
      missions: () => MISSIONS.map((m) => m.id),
    };
  }
}
