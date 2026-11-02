import { Color, Group, Vector3, type Material, type Mesh, type Object3D } from 'three';
import type { LevelDef } from '../levels/types';
import { LEVELS, levelById } from '../levels/index';
import { loadLevelData, type LevelData } from '../sim/levelData';
import { pathPointAt, makePolyline, clamp, type Polyline } from '../sim/geom';
import { generateBoulder } from '../sim/fracture';
import { COMPOSITIONS, composition, type CompositionId } from '../sim/composition';
import { RunSim, DT, KIND_LABEL, type RunEvent, type RunResult } from '../run/runner';
import { layoutLevel, type Layout } from '../run/layout';
import { createSceneRig, detectQuality, type Quality, type SceneRig } from '../render/scene';
import { buildTerrain } from '../render/terrainView';
import { buildVegetation } from '../render/vegetation';
import { buildWater, type WaterView } from '../render/waterView';
import { DestructView } from '../render/destructView';
import { Effects, PiecesView, Trails } from '../render/dynamicView';
import { shared, type RockLook } from '../render/materials';
import { CameraDirector, type ChaseInfo } from './camera';
import { compositionUnlocked, levelProgress, levelUnlocked, loadProgress, MEDALS, recordResult, saveProgress, type Medal, type Progress, type Records } from './progress';
import { AudioEngine } from '../audio/audio';
import { UI, pts, type MountainCard } from '../ui/ui';
import { wordmark } from '../ui/brand';

type State = 'title' | 'mountains' | 'ready' | 'run' | 'results';

/** Everything that belongs to one mountain, rebuilt when the player moves to another. */
interface World {
  level: LevelDef;
  data: LevelData;
  layout: Layout;
  group: Group;
  water: WaterView;
  destruct: DestructView;
  effects: Effects;
  trails: Trails;
  guides: Trails;
  paths: Map<string, Polyline>;
}

const GUIDE = [new Color(1, 0.84, 0.5), new Color(0.6, 0.86, 1), new Color(0.85, 0.7, 1)];

export class Game {
  private rig: SceneRig;
  private quality: Quality;
  private cam: CameraDirector;
  private w!: World;
  private pieces = new PiecesView();
  private audio = new AudioEngine();
  private ui: UI;
  private progress: Progress;
  private state: State = 'title';
  private sim: RunSim | null = null;
  private result: RunResult | null = null;
  private records: Records | null = null;
  private acc = 0;
  private timeScale = 1;
  private slowUntil = 0;
  private slowTo = 1;
  private paused = false;
  private menuOpen = false;
  private fast = false;
  private now = 0;
  private last = 0;
  private hudTimer = 0;
  private sprayAcc = 0;
  private lastSound = new Map<string, number>();
  private resultsShown = true;
  private resultsTimer = 0;
  private guideFor = '';
  private loadingEl = document.getElementById('loading');
  private automation = navigator.webdriver === true;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement, onProgress: (f: number, label: string) => void) {
    this.progress = loadProgress();
    const idx = LEVELS.findIndex((l) => l.id === this.progress.lastLevel);
    const level = idx >= 0 && levelUnlocked(this.progress, LEVELS, idx) ? LEVELS[idx] : LEVELS[0];
    if (!compositionUnlocked(this.progress, this.progress.composition)) this.progress.composition = 'granite';
    onProgress(0.15, 'Raising the mountain…');
    this.quality = detectQuality();
    this.rig = createSceneRig(canvas, level, this.quality);
    this.rig.scene.add(this.pieces.group);
    this.buildWorld(level, onProgress);
    this.cam = new CameraDirector(this.rig.camera, level, this.w.data.heightAt);
    this.audio.setSound(this.progress.settings.sound);
    this.audio.setMusic(this.progress.settings.music);
    this.applyLook();

    this.ui = new UI(uiRoot, {
      play: () => this.showMountains(),
      pickLevel: (id) => void this.pickLevel(id),
      mountains: () => this.showMountains(),
      release: () => this.startRun(),
      menu: () => this.openMenu(),
      retry: () => this.startRun(),
      next: () => this.nextLevel(),
      pause: () => this.togglePause(),
      toggleSound: () => this.setSound(!this.progress.settings.sound),
      toggleMusic: () => this.setMusic(!this.progress.settings.music),
      toTitle: () => this.toTitle(),
      resumeFromMenu: () => this.closeMenu(),
      composition: (id) => this.setComposition(id),
      choose: (side) => this.choose(side),
    });

    // during a run: the left or right of the screen picks that way at a fork
    canvas.addEventListener('pointerdown', (e) => {
      this.audio.unlock();
      if (this.state === 'run' && this.sim?.decision) {
        const x = e.clientX / Math.max(1, canvas.clientWidth);
        const n = this.sim.decision.options.length;
        this.choose(n === 3 && x > 0.36 && x < 0.64 ? 'centre' : x < 0.5 ? 'left' : 'right');
      } else if (this.state === 'results' && !this.resultsShown) this.revealResults();
    });
    window.addEventListener('keydown', (e) => this.key(e));
    const unlock = () => this.audio.unlock();
    for (const ev of ['pointerdown', 'touchend', 'click', 'keydown']) window.addEventListener(ev, unlock, { passive: true });
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 250));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.audio.suspend();
        if (this.state === 'run' && !this.paused) this.togglePause();
      } else this.audio.resume();
    });
    this.resize();
    onProgress(0.9, 'Placing the boulder…');
  }

  private get level(): LevelDef {
    return this.w.level;
  }
  private get comp() {
    return composition(this.progress.composition);
  }

  // ------------------------------------------------------------------ world
  private buildWorld(level: LevelDef, onProgress?: (f: number, label: string) => void) {
    const scene = this.rig.scene;
    if (this.w) {
      scene.remove(this.w.group);
      disposeTree(this.w.group);
    }
    const data = loadLevelData(level);
    const layout = layoutLevel(level, data);
    const group = new Group();
    onProgress?.(0.35, 'Laying down the ground…');
    group.add(buildTerrain(data, this.quality.far));
    onProgress?.(0.5, 'Growing the forest…');
    const avoid = [
      ...layout.trees.map((t) => ({ x: t.x, z: t.z, r: 3 })),
      ...layout.structures.map((s) => ({ x: s.x, z: s.z, r: Math.max(s.hx, s.hz) + 3 })),
      ...layout.rocks.filter((r) => r.role !== 'rock').map((r) => ({ x: r.x, z: r.z, r: r.r + 2 })),
    ];
    if (level.forest.count > 0) group.add(buildVegetation(data, this.quality.trees, avoid).group);
    onProgress?.(0.7, 'Stacking the timber…');
    const water = buildWater(data, this.rig.sunDir, this.rig.fogColor);
    group.add(water.group);
    const destruct = new DestructView(level, layout);
    group.add(destruct.group);
    const effects = new Effects(data.heightAt);
    const trails = new Trails(data.heightAt);
    const guides = new Trails(data.heightAt);
    group.add(effects.group, trails.group, guides.group);
    scene.add(group);
    effects.setViewportHeight(this.rig.renderer.domElement.clientHeight * Math.min(2, window.devicePixelRatio || 1));
    const paths = new Map(level.segments.map((s) => [s.id, makePolyline(s.path)]));
    this.w = { level, data, layout, group, water, destruct, effects, trails, guides, paths };
    this.result = null;
  }

  private async loadLevel(level: LevelDef) {
    if (this.w.level.id === level.id) return;
    const l = this.loadingEl;
    if (l) {
      l.innerHTML = `<div class="loading-inner">${wordmark('sm')}<div class="loading-text">${level.stage} · ${level.name}</div></div>`;
      l.classList.remove('gone');
    }
    await new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 30)));
    this.sim = null;
    this.pieces.clear();
    this.buildWorld(level);
    this.rig.setLevel(level);
    this.cam.setLevel(level, this.w.data.heightAt);
    this.progress.lastLevel = level.id;
    saveProgress(this.progress);
    this.showRestingBoulder();
    this.cam.snap();
    if (l) setTimeout(() => l.classList.add('gone'), 120);
  }

  start() {
    this.showRestingBoulder();
    this.showTitle();
    this.cam.setMode('intro');
    this.cam.snap();
    this.last = performance.now();
    const loop = (t: number) => {
      requestAnimationFrame(loop);
      this.frame(t);
    };
    requestAnimationFrame(loop);
  }

  private resize() {
    this.rig.resize();
    this.cam.baseFov = this.rig.camera.fov;
    this.w.effects.setViewportHeight(this.rig.renderer.domElement.clientHeight * Math.min(2, window.devicePixelRatio || 1));
  }

  private applyLook() {
    const c = this.comp;
    const look: RockLook = { tint: c.tint, speck: c.speck, gloss: c.gloss };
    this.pieces.setLook(look);
    this.w.destruct.setBoulderLook(c.tint, c.speck, c.gloss);
  }

  private boulderShape = new Map<string, ReturnType<typeof generateBoulder>>();
  private shapeFor(level: LevelDef) {
    let s = this.boulderShape.get(level.id);
    if (!s) this.boulderShape.set(level.id, (s = generateBoulder(level.boulder.radius, level.boulder.seed)));
    return s;
  }

  private showRestingBoulder() {
    const [bx, bz] = this.level.boulder.position;
    const y = this.w.data.heightAt(bx, bz) + this.level.boulder.radius * 0.92;
    this.pieces.clear();
    this.applyLook();
    this.pieces.sync([{ id: 1, shape: this.shapeFor(this.level), kind: 'stone', pos: [bx, y, bz], quat: [0, 0, 0, 1], scale: 1 }]);
  }

  private massFor(id: CompositionId): number {
    return this.shapeFor(this.level).volume * composition(id).density * 1000;
  }

  // ------------------------------------------------------------------ flow
  private hideAll() {
    this.ui.hideTitle();
    this.ui.hideMountains();
    this.ui.hideReady();
    this.ui.hideRun();
    this.ui.hideResults();
    this.ui.tip(null);
  }

  private showTitle() {
    const medals: Record<Medal, number> = { none: 0, bronze: 0, silver: 0, gold: 0, platinum: 0 };
    let finished = 0;
    let best = 0;
    for (const l of LEVELS) {
      const lp = this.progress.levels[l.id];
      if (lp?.finished) {
        finished++;
        medals[lp.medal]++;
      }
      best = Math.max(best, lp?.bestScore ?? 0);
    }
    this.ui.showTitle({ medals, finished, total: LEVELS.length, best });
  }

  private resetMountain() {
    this.sim = null;
    this.w.destruct.reset();
    this.w.effects.clear();
    this.w.trails.clear();
    this.w.guides.clear();
    this.guideFor = '';
    this.showRestingBoulder();
  }

  private toTitle() {
    this.closeMenu();
    this.hideAll();
    this.resetMountain();
    this.state = 'title';
    this.cam.setMode('intro');
    this.showTitle();
  }

  private showMountains() {
    this.audio.unlock();
    this.audio.click();
    this.closeMenu();
    this.hideAll();
    this.resetMountain();
    this.state = 'mountains';
    this.cam.setMode('intro');
    const cards: MountainCard[] = LEVELS.map((level, i) => ({
      level,
      unlocked: levelUnlocked(this.progress, LEVELS, i),
      lockText: i > 0 ? `Reach the bottom of ${LEVELS[i - 1].name} to open this mountain` : '',
      progress: this.progress.levels[level.id],
    }));
    this.ui.showMountains(cards, this.level.id);
  }

  private async pickLevel(id: string) {
    const level = levelById(id);
    if (!level) return;
    this.audio.click();
    this.ui.hideMountains();
    await this.loadLevel(level);
    this.toReady();
  }

  private nextLevel() {
    const i = LEVELS.findIndex((l) => l.id === this.level.id);
    const next = LEVELS[i + 1];
    if (next && levelUnlocked(this.progress, LEVELS, i + 1)) void this.pickLevel(next.id);
    else this.showMountains();
  }

  /** At the summit: pick a stone, then let go. */
  private toReady() {
    this.closeMenu();
    this.hideAll();
    this.resetMountain();
    this.state = 'ready';
    this.cam.setMode('summit');
    const lp = levelProgress(this.progress, this.level.id);
    this.ui.showReady(this.level, lp, !this.progress.tutorial.decided);
    this.refreshCompositions();
  }

  private refreshCompositions() {
    this.ui.setCompositions(
      COMPOSITIONS.map((c) => ({ comp: c, unlocked: compositionUnlocked(this.progress, c.id), mass: this.massFor(c.id) })),
      this.progress.composition,
    );
  }

  private setComposition(id: CompositionId) {
    if (!compositionUnlocked(this.progress, id)) return;
    this.progress.composition = id;
    saveProgress(this.progress);
    this.audio.impact(0.4, 'granite');
    this.applyLook();
    this.refreshCompositions();
    this.ui.tip(`<b>${composition(id).name}</b> — ${composition(id).blurb}`, 3200);
  }

  private key(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (this.menuOpen) this.closeMenu();
      else this.openMenu();
      return;
    }
    if (this.state === 'run' && this.sim?.decision) {
      if (e.key === 'ArrowLeft' || e.key === 'a') this.choose('left');
      if (e.key === 'ArrowRight' || e.key === 'd') this.choose('right');
      if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'ArrowUp' || e.key === 'w') this.choose('centre');
    }
    if (e.key === ' ' && this.state === 'run') this.togglePause();
    if (e.key === 'Enter' && !this.menuOpen) {
      if (this.state === 'title') this.showMountains();
      else if (this.state === 'ready') this.startRun();
      else if (this.state === 'results') {
        if (!this.resultsShown) this.revealResults();
        else this.startRun();
      }
    }
  }

  // ------------------------------------------------------------------ the run
  private startRun() {
    this.audio.unlock();
    this.closeMenu();
    this.hideAll();
    this.resetMountain();
    // every run plays out a little differently: the same choices, a different landslide
    this.sim = new RunSim(this.level, this.w.data, { composition: this.progress.composition, seed: (Math.random() * 2 ** 31) | 0 });
    const lp = levelProgress(this.progress, this.level.id);
    lp.attempts++;
    saveProgress(this.progress);
    this.state = 'run';
    this.acc = 0;
    this.timeScale = 1;
    this.fast = false;
    this.paused = false;
    this.slowUntil = 0;
    this.resultsShown = true;
    this.applyLook();
    this.cam.setMode('chase');
    // the forks, as fractions of the way down (for the progress line)
    const z0 = this.level.boulder.position[1];
    const fin = this.level.segments.find((s) => s.kind === 'finale')!.path;
    const z1 = fin[fin.length - 1][1];
    const forks = [...new Set(this.level.segments.filter((s) => s.next.length > 1).map((s) => s.path[s.path.length - 1][1]))].map((z) => (z - z0) / (z1 - z0));
    this.ui.showRun(forks);
    this.sim.release();
    this.audio.release();
    this.audio.riser(1.4);
  }

  private choose(side: 'left' | 'right' | 'centre') {
    const sim = this.sim;
    if (!sim?.decision || sim.decision.chosen !== null) return;
    if (sim.chooseSide(side)) {
      if (!this.progress.tutorial.decided) {
        this.progress.tutorial.decided = true;
        saveProgress(this.progress);
      }
    }
  }

  private togglePause() {
    if (this.state !== 'run') return;
    this.paused = !this.paused;
    this.ui.setPaused(this.paused);
    if (this.paused) this.openMenu();
    else this.closeMenu();
  }

  private slow(scale: number, seconds: number) {
    if (this.now + seconds > this.slowUntil || scale < this.slowTo) {
      this.slowTo = scale;
      this.slowUntil = this.now + seconds;
    }
  }

  private stepRun(dt: number) {
    const sim = this.sim!;
    if (this.paused || this.menuOpen) return;
    let scale = this.fast ? 4 : 1;
    if (!this.fast && this.now < this.slowUntil) scale = this.slowTo;
    else if (sim.decision && sim.decision.chosen === null) scale = 0.7;
    this.timeScale += (scale - this.timeScale) * Math.min(1, dt * 10);
    this.acc += dt * this.timeScale;
    let steps = 0;
    const max = this.fast ? 16 : 5;
    while (this.acc >= DT && steps < max && !sim.done) {
      sim.stepOnce();
      this.acc -= DT;
      steps++;
    }
    if (steps >= max) this.acc = Math.min(this.acc, DT);
    for (const e of sim.drainEvents()) this.handleEvent(e);
    if (!this.sim) return;

    // the boulder
    if (!sim.shattered) {
      this.pieces.sync([{ id: 1, shape: sim.shape, kind: 'stone', pos: [sim.pos.x, sim.pos.y, sim.pos.z], quat: [sim.quat.x, sim.quat.y, sim.quat.z, sim.quat.w], scale: 1 }]);
      this.groundFx(sim, dt);
    } else this.pieces.sync([]);
    this.w.destruct.update(sim);

    // the fork ahead: show the ways
    const d = sim.decision;
    if (d) this.ui.showDecision(d, !this.progress.tutorial.decided);
    if (sim.forkAhead && this.guideFor !== sim.seg.seg.id) this.drawGuides();

    // the camera
    if (this.cam.mode === 'chase' && sim.kind === 'finale') {
      const hall = this.w.layout.structures.find((s) => s.finale);
      if (hall && Math.hypot(hall.x - sim.pos.x, hall.z - sim.pos.z) < 30 + sim.speed * 0.6) {
        this.cam.finaleAt.set(hall.x, hall.y, hall.z);
        this.cam.finaleYaw = Math.atan2(sim.heading.x, sim.heading.z);
        this.cam.setMode('finale');
      }
    }
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.05;
      this.ui.setRun({ score: sim.score, speed: sim.speed, integrity: sim.integrity / sim.maxIntegrity, progress: sim.progress, segment: sim.segmentName });
    }
    if (sim.done && this.state === 'run') this.finishRun();
  }

  /** where the boulder is headed: a point on the route ahead, on the way it is committed to */
  private aheadPoint(sim: RunSim, dist: number): Vector3 {
    let s = sim.s + dist;
    let seg = sim.seg.seg;
    if (s > sim.seg.len && seg.next.length) {
      s -= sim.seg.len;
      const d = sim.decision;
      seg = this.level.segments.find((q) => q.id === seg.next[d ? (d.chosen ?? d.fallback) : 0])!;
    }
    const pl = this.w.paths.get(seg.id)!;
    const p = pathPointAt(pl, Math.min(s, pl.length));
    return new Vector3(p.x, this.w.data.heightAt(p.x, p.z), p.z);
  }

  private chaseInfo(): ChaseInfo | undefined {
    const sim = this.sim;
    if (!sim) return undefined;
    return {
      pos: sim.pos,
      ahead: this.aheadPoint(sim, 14 + sim.speed * 0.7),
      speed: sim.speed,
      fork: sim.forkAhead ? { t: sim.forkAhead.t, at: sim.forkAhead.at } : null,
      air: !sim.grounded,
      canopy: sim.kind === 'forest' || sim.kind === 'camp',
    };
  }

  /** Ribbons along the first stretch of each way at the coming fork, in its own colour. */
  private drawGuides(chosen?: number) {
    const sim = this.sim;
    if (!sim) return;
    const next = sim.seg.seg.next;
    this.guideFor = sim.seg.seg.id;
    this.w.guides.clear();
    next.forEach((id, i) => {
      if (chosen !== undefined && chosen !== i) return;
      const pl = this.w.paths.get(id)!;
      const pts: [number, number, number][] = [];
      for (let s = 2; s <= Math.min(pl.length, 70); s += 2) {
        const p = pathPointAt(pl, s);
        pts.push([p.x, this.w.data.heightAt(p.x, p.z) + 0.3, p.z]);
      }
      this.w.guides.add(pts, GUIDE[i % GUIDE.length], chosen !== undefined ? 2.4 : 1.6, { dashed: chosen === undefined, opacity: chosen !== undefined ? 0.75 : 0.85 });
    });
  }

  private groundFx(sim: RunSim, dt: number) {
    if (!sim.grounded || sim.speed < 6) return;
    this.sprayAcc += dt * Math.min(1.5, sim.speed / 12);
    const k = sim.kind;
    const col = k === 'forest' || k === 'camp' ? new Color(0.4, 0.32, 0.2) : new Color(...this.level.theme.dust).multiplyScalar(0.8);
    while (this.sprayAcc > 0.025) {
      this.sprayAcc -= 0.025;
      this.w.effects.spray(new Vector3(sim.pos.x, sim.pos.y - this.level.boulder.radius * 0.8, sim.pos.z), sim.vel, 1.4, col);
    }
  }

  private screen(p: Vector3): { x: number; y: number; on: boolean } {
    const v = p.clone().project(this.rig.camera);
    const c = this.rig.renderer.domElement;
    return { x: clamp((v.x * 0.5 + 0.5) * c.clientWidth, 70, c.clientWidth - 70), y: clamp((-v.y * 0.5 + 0.5) * c.clientHeight - 30, 120, c.clientHeight - 160), on: v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 };
  }

  /** limit how often one kind of sound plays */
  private sound(kind: string, gap: number): boolean {
    const t = this.lastSound.get(kind) ?? -1;
    if (this.now - t < gap) return false;
    this.lastSound.set(kind, this.now);
    return true;
  }

  private handleEvent(e: RunEvent) {
    const sim = this.sim!;
    const pos = new Vector3(...e.pos);
    const v = pos.clone().project(this.rig.camera);
    const pan = clamp(v.x, -1, 1) * 0.7;
    const dist = pos.distanceTo(this.rig.camera.position);
    const att = clamp(30 / Math.max(10, dist), 0.25, 1);
    const fx = this.w.effects;
    const dust = new Color(...this.level.theme.dust);
    const wood = new Color(...this.level.theme.wood);
    switch (e.type) {
      case 'release':
        this.audio.fracture(0.7);
        fx.dust(pos.clone().add(new Vector3(0, -1.5, 2)), 0.6, dust);
        fx.grit(pos, 0.6);
        this.cam.shake(0.5);
        break;
      case 'approach':
        this.drawGuides();
        break;
      case 'decision':
        this.audio.whoosh();
        break;
      case 'commit': {
        const d = sim.decision;
        this.ui.committed(!!e.auto, e.label ?? '');
        this.drawGuides(e.id ?? d?.chosen ?? 0);
        window.setTimeout(() => this.w.guides.clear(), 1400);
        this.audio.whoosh();
        this.audio.impact(0.5, 'granite', 0);
        this.cam.punch(0.35);
        this.ui.tip(null);
        if (e.auto) this.ui.bigBanner(e.label ?? '', 'The mountain chose', 1300, 'small');
        break;
      }
      case 'enter': {
        const seg = sim.seg.seg;
        if (seg.kind !== 'finale' && seg.kind !== 'summit') this.ui.bigBanner(seg.name.toUpperCase(), KIND_LABEL[seg.kind], 1400, 'small');
        if (seg.kind === 'finale') this.ui.bigBanner(this.level.finale.name.replace(/^the /, '').toUpperCase(), 'Dead ahead', 1600, 'small');
        break;
      }
      case 'tree':
        if (this.sound('tree', 0.06)) {
          this.audio.snap();
          this.audio.impact(0.6 * att, 'wood', pan);
        }
        fx.shards(pos.clone().add(new Vector3(0, 2.5, 0)), new Color(0.22, 0.4, 0.16), e.depth ? 10 : 22);
        fx.shards(pos.clone().add(new Vector3(0, -0.6, 0)), new Color(0.7, 0.52, 0.32), e.depth ? 6 : 14);
        if (!e.depth) this.cam.shake(0.3);
        break;
      case 'treeLand':
        fx.dust(pos, 0.25 + e.intensity * 0.35, dust.clone().lerp(new Color(0.5, 0.42, 0.3), 0.3));
        if (this.sound('treeLand', 0.09)) this.audio.impact(0.75 * att * e.intensity, 'soil', pan);
        if (dist < 30) this.cam.shake(0.3 * att);
        break;
      case 'crack':
        if (this.sound('crack', 0.15)) this.audio.creak();
        fx.shards(pos, new Color(0.7, 0.52, 0.32), 8);
        break;
      case 'rock':
        if (this.sound('rock', 0.05)) this.audio.fracture(0.35 + e.intensity * 0.5, pan);
        fx.grit(pos, 0.5 + e.intensity);
        fx.dust(pos, 0.3 + e.intensity * 0.5, dust);
        if (e.intensity > 0.8) fx.ring(pos, 6 + e.intensity * 5, dust);
        this.cam.shake(0.3 + e.intensity * 0.45);
        this.pieces.squash(1, 0.12);
        this.ui.hurt();
        break;
      case 'pillar':
        this.audio.fracture(1, pan);
        this.audio.impact(1, 'granite', pan);
        fx.dust(pos, 1.2, dust);
        fx.grit(pos.clone().add(new Vector3(0, 3, 0)), 1.6);
        this.cam.shake(0.8);
        this.cam.punch(0.5);
        this.slow(0.45, 0.35);
        this.ui.hurt();
        break;
      case 'hit':
        if (this.sound('hit', 0.07)) {
          this.audio.snap();
          this.audio.impact(Math.max(0.4, e.intensity) * att, 'wood', pan);
        }
        fx.shards(pos, wood, 30 + Math.round(e.intensity * 30));
        fx.dust(pos, 0.4 + e.intensity * 0.4, dust.clone().lerp(wood, 0.3));
        if (!e.depth) {
          this.cam.shake(0.45 + e.intensity * 0.4);
          this.pieces.squash(1, 0.1);
        }
        break;
      case 'collapse':
        if (this.sound('collapse', 0.25)) {
          this.audio.treeFall();
          this.audio.impact(0.9 * att, 'soil', pan);
        }
        fx.dust(pos, 0.9 + e.intensity * 0.8, dust.clone().lerp(wood, 0.25));
        fx.dust(pos.clone().add(new Vector3(2, -1, 2)), 0.6 + e.intensity * 0.5, dust);
        if (dist < 45) this.cam.shake(0.4 + e.intensity * 0.4);
        if (e.intensity > 0.6 && dist < 45) this.slow(0.5, 0.3);
        break;
      case 'wall':
        this.audio.impact(0.6 + e.intensity * 0.4, 'granite', pan);
        if (e.intensity > 0.4) this.audio.fracture(e.intensity * 0.7, pan);
        fx.grit(pos, 0.8 + e.intensity);
        fx.dust(pos, 0.4 + e.intensity * 0.6, dust);
        this.cam.shake(0.4 + e.intensity * 0.6);
        this.pieces.squash(1, 0.15);
        if (e.intensity > 0.6) this.ui.doFlash(0.25);
        this.ui.hurt();
        break;
      case 'land':
        this.audio.impact(0.6 + e.intensity * 0.4, 'granite', pan);
        fx.ring(pos, 8 + e.intensity * 8, dust);
        fx.dust(pos, 0.5 + e.intensity * 0.8, dust);
        fx.grit(pos, 0.6 + e.intensity);
        this.cam.shake(0.5 + e.intensity * 0.5);
        this.cam.punch(0.3 + e.intensity * 0.4);
        this.pieces.squash(1, 0.2);
        if (e.intensity > 0.3) this.ui.hurt();
        break;
      case 'slide':
        this.ui.bigBanner('ROCKSLIDE', 'The slope lets go', 1700);
        this.audio.fracture(1, pan);
        this.audio.grind();
        fx.dust(pos, 1.3, dust);
        fx.dust(pos.clone().add(new Vector3(0, 2, 8)), 1, dust);
        this.cam.shake(0.7);
        break;
      case 'milestone':
        this.ui.bigBanner(`${e.label?.toUpperCase()}`, `+${pts(e.points ?? 0)}`, 1100, 'small speed');
        this.audio.combo(4 + (e.points ?? 0) / 500);
        this.cam.punch(0.4);
        break;
      case 'chain':
        this.ui.chain(e.depth ?? 0);
        this.audio.combo(e.depth ?? 3);
        break;
      case 'score': {
        const s = this.screen(pos);
        if (s.on) this.ui.scorePop(s.x, s.y, e.points ?? 0, e.label ?? '', (e.points ?? 0) >= 1000);
        break;
      }
      case 'finale':
        this.slow(0.28, 1.5);
        this.audio.fracture(1, 0);
        this.audio.impact(1, 'wood', 0);
        this.audio.impact(1, 'granite', 0);
        this.ui.doFlash(0.6);
        this.cam.shake(1);
        this.cam.punch(1);
        fx.dust(pos, 1.6, dust);
        fx.shards(pos, wood, 90);
        break;
      case 'shatter':
        this.slow(0.3, 1.2);
        this.audio.fracture(1, 0);
        this.audio.shatter();
        this.ui.doFlash(0.7);
        this.ui.bigBanner('SHATTERED', 'The boulder couldn’t take any more', 2200);
        this.cam.shake(1);
        fx.dust(pos, 1.4, dust);
        fx.grit(pos, 2);
        break;
      case 'end':
        break;
    }
  }

  private finishRun() {
    const sim = this.sim!;
    const r = sim.result!;
    this.result = r;
    const rec = recordResult(this.progress, LEVELS, this.level, r);
    this.records = rec;
    const lp = levelProgress(this.progress, this.level.id);
    lp.lastTrail = r.trajectory.filter((_, i) => i % 2 === 0);
    this.progress.tutorial.released = true;
    saveProgress(this.progress);
    this.state = 'results';
    this.ui.hideRun();
    this.ui.tip(null);
    if (!r.finished) this.audio.finish(0);
    else window.setTimeout(() => this.audio.finish(MEDALS.indexOf(rec.medal) >= 3 ? 2 : 1), 300);
    if (r.finished && r.stats.finaleFlattened) this.ui.bigBanner(`${this.level.finale.name.replace(/^the /, '').toUpperCase()}`, 'FLATTENED', 2000);
    else if (r.reason === 'stalled') this.ui.bigBanner('STOPPED', r.cause, 2000);
    // the recap: fly back up the line over everything that came down
    this.w.trails.clear();
    this.w.trails.add(r.trajectory, new Color(1, 0.76, 0.42), 0.9, { opacity: 0.45 });
    const path = r.trajectory.map((p) => new Vector3(...p));
    window.setTimeout(() => {
      if (this.state === 'results') this.cam.recap(path);
    }, 1400);
    this.resultsShown = false;
    window.clearTimeout(this.resultsTimer);
    this.resultsTimer = window.setTimeout(() => this.revealResults(), 3200);
    this.ui.tip('Tap to see how you did', 0);
  }

  private revealResults() {
    if (this.resultsShown || this.state !== 'results' || !this.result || !this.records) return;
    this.resultsShown = true;
    window.clearTimeout(this.resultsTimer);
    this.ui.tip(null);
    const r = this.result;
    const i = LEVELS.findIndex((l) => l.id === this.level.id);
    const next = LEVELS[i + 1];
    const lp = levelProgress(this.progress, this.level.id);
    this.ui.showResults(r, this.level, this.records, lp, {
      hasNext: !!next && levelUnlocked(this.progress, LEVELS, i + 1),
      nextName: next?.name,
      compName: composition(r.composition).name,
      tip: explainRun(r, this.level, lp.found),
    });
  }

  // ------------------------------------------------------------------ menu & settings
  private openMenu() {
    this.menuOpen = true;
    if (this.state === 'run') {
      this.paused = true;
      this.ui.setPaused(true);
    }
    this.ui.showMenu(this.progress.settings.sound, this.progress.settings.music, this.state === 'run');
  }
  private closeMenu() {
    this.menuOpen = false;
    if (this.state === 'run') {
      this.paused = false;
      this.ui.setPaused(false);
    }
    this.ui.hideMenu();
  }
  private setSound(on: boolean) {
    this.progress.settings.sound = on;
    this.audio.setSound(on);
    saveProgress(this.progress);
    this.openMenu();
  }
  private setMusic(on: boolean) {
    this.progress.settings.music = on;
    this.audio.setMusic(on);
    saveProgress(this.progress);
    this.openMenu();
  }

  // ------------------------------------------------------------------ frame
  private frame(t: number) {
    const dt = Math.min(0.05, Math.max(0, (t - this.last) / 1000));
    this.last = t;
    this.now += dt;
    shared.time.value += dt;

    if (this.state === 'run' && this.sim) this.stepRun(dt);
    else if (this.state === 'results' && this.sim) {
      // the wreckage keeps settling behind the recap
      if (!this.sim.debris.active.length && !this.sim.movingTrees.size) {
        /* at rest */
      } else {
        this.sim.settle();
      }
      this.w.destruct.update(this.sim);
    }

    this.cam.update(dt, this.state === 'run' || this.state === 'results' ? this.chaseInfo() : undefined);
    // keep the line of sight to the boulder clear of timber
    const occ = shared.occluder.value;
    if ((this.cam.mode === 'chase' || this.cam.mode === 'finale') && this.sim && !this.sim.shattered) {
      occ[0] = this.sim.pos.x;
      occ[1] = this.sim.pos.y;
      occ[2] = this.sim.pos.z;
      occ[3] = this.level.boulder.radius * 2.6;
    } else if (this.state === 'ready' || this.state === 'title') {
      const [bx, bz] = this.level.boulder.position;
      occ[0] = bx;
      occ[1] = this.w.data.heightAt(bx, bz) + this.level.boulder.radius;
      occ[2] = bz;
      occ[3] = this.state === 'ready' ? this.level.boulder.radius * 2.6 : 0;
    } else occ[3] = 0;
    const look = this.cam.lookTarget;
    this.rig.focusShadows(look, this.cam.distance * 0.75 + 16);
    this.rig.setAtmosphere(look.z, dt);
    this.pieces.update(dt);
    this.w.water.update(dt);
    this.w.effects.update(dt);

    const sim = this.sim;
    const speed = sim && this.state === 'run' ? sim.speed : 0;
    const rolling = sim && this.state === 'run' && sim.grounded && !sim.shattered ? Math.min(1, speed / 10) : 0;
    this.audio.weight = 1;
    this.audio.update(dt, { waterNear: 0, rolling, gravel: rolling * (sim?.kind === 'scree' || sim?.kind === 'loose' ? 0.9 : 0.4), wind: 1, speed, size: this.level.boulder.radius });

    this.rig.renderer.render(this.rig.scene, this.rig.camera);
    if (!document.hidden && !this.automation) this.rig.adapt(dt);
  }

  /** test hooks */
  debug() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const game = this;
    return {
      get state() {
        return game.state;
      },
      get result() {
        return game.result;
      },
      get level() {
        return game.level.id;
      },
      get decision() {
        return game.sim?.decision ?? null;
      },
      get sim() {
        return game.sim;
      },
      begin: () => {
        this.ui.hideTitle();
        this.toReady();
      },
      load: (id: string) => this.pickLevel(id),
      release: () => this.startRun(),
      choose: (side: 'left' | 'right' | 'centre') => this.choose(side),
      fast: (on = true) => {
        this.fast = on;
      },
      results: () => this.revealResults(),
      composition: (id: CompositionId) => this.setComposition(id),
      unlockAll: () => {
        for (const l of LEVELS) {
          const lp = levelProgress(this.progress, l.id);
          lp.finished = true;
          if (MEDALS.indexOf(lp.medal) < 3) lp.medal = 'gold';
        }
        saveProgress(this.progress);
      },
      snapCamera: () => this.cam.snap(),
      camInfo: () => {
        const c = this.rig.camera.position;
        const s = this.sim;
        return { mode: this.cam.mode, hero: s && [s.pos.x, s.pos.y, s.pos.z].map((v) => +v.toFixed(1)), cam: [c.x, c.y, c.z].map((v) => +v.toFixed(1)), seg: s?.seg.seg.id, speed: s && +(s.speed * 3.6).toFixed(0) };
      },
      renderInfo: () => {
        const i = this.rig.renderer.info;
        return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures };
      },
    };
  }
}

/** Free GPU memory held by a subtree. */
function disposeTree(root: Object3D) {
  const mats = new Set<Material>();
  root.traverse((o) => {
    const m = o as Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as Material | Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => mats.add(x));
    else if (mat) mats.add(mat);
  });
  for (const m of mats) m.dispose();
}

/** One line on what happened, and what to try next. */
export function explainRun(r: RunResult, level: LevelDef, found: string[]): string {
  const s = r.stats;
  const unexplored = level.segments.filter((q) => q.kind !== 'summit' && q.kind !== 'finale' && !found.includes(q.id));
  if (r.reason === 'shattered') return 'Rock, walls and hard landings wore the boulder down until it broke. Gorges and rubble are rich but punishing — a tougher stone, or a softer way down, gets you to the bottom.';
  if (r.reason === 'stalled') return 'Too much timber, not enough slope: the boulder ran out of momentum. Dense ground drinks speed — balance it with a fast way down.';
  if (!s.finaleFlattened) return `You reached the bottom too slowly to flatten ${level.finale.name}. Arrive faster: open slopes and loose ground build speed.`;
  if (s.finaleSpeed * 3.6 < 60) return `${level.finale.name} came down at ${Math.round(s.finaleSpeed * 3.6)} km/h. Hit it faster for a bigger finish — the last ways down decide your speed.`;
  if (r.categories.length < 4) return `Variety pays: this run destroyed ${r.categories.length} kinds of thing. Mixing forest, rock, buildings, gorges and slides earns a bigger bonus.`;
  if (unexplored.length) return `${unexplored.length} way${unexplored.length > 1 ? 's' : ''} down still unexplored — ${unexplored[0].name} among them.`;
  return 'You have seen every way down this mountain. Now find the route that does the most damage.';
}
