import { Color, Group, Raycaster, Vector2, Vector3, type Material, type Mesh, type Object3D } from 'three';
import type RAPIER_T from '@dimforge/rapier3d-deterministic-compat';
import type { LevelDef, LevelObject, ObjectState, Plan } from '../levels/types';
import { LEVELS, levelById } from '../levels/index';
import { loadLevelData, type LevelData } from '../sim/levelData';
import { Simulation, RECORD_EVERY, FRAME, DT, MEDALS, restingBoulder, type Medal, type SimEvent, type SimResult, type Recording, type Track } from '../sim/simulation';
import { activeWater, clonePlan, countInterventions, defaultPlan, defaultState, isModified, sanitizePlan } from '../sim/plan';
import { COMPOSITIONS, composition, type CompositionId } from '../sim/composition';
import { createSceneRig, detectQuality, type Quality, type SceneRig } from '../render/scene';
import { buildTerrain } from '../render/terrainView';
import { buildVegetation } from '../render/vegetation';
import { buildWater, type WaterView } from '../render/waterView';
import { ObjectsView } from '../render/objectsView';
import { Effects, PiecesView, Trails, type PieceState } from '../render/dynamicView';
import { PropsView } from '../render/propsView';
import { layoutProps } from '../sim/props';
import { shared, type RockLook } from '../render/materials';
import { CameraDirector } from './camera';
import { attachGestures } from './input';
import { compositionUnlocked, levelProgress, levelUnlocked, loadProgress, recordResult, saveProgress, type Progress } from './progress';
import { AudioEngine } from '../audio/audio';
import { UI, type ContextAction, type MountainCard } from '../ui/ui';
import { kg, pct } from '../ui/format';
import { clamp, makePolyline, pathDistance } from '../sim/geom';

type State = 'title' | 'mountains' | 'plan' | 'sim' | 'results' | 'replay';
const deg = Math.PI / 180;
const ROUTE_COLORS = [new Color(1, 0.82, 0.45), new Color(0.55, 0.85, 1), new Color(0.8, 0.66, 1), new Color(0.6, 1, 0.7)];

/** Everything that belongs to one mountain, rebuilt when the player moves to another. */
interface World {
  level: LevelDef;
  data: LevelData;
  group: Group;
  water: WaterView;
  objects: ObjectsView;
  props: PropsView;
  effects: Effects;
  trails: Trails;
  ghost: Trails;
  routes: Trails;
}

export class Game {
  private R: typeof RAPIER_T;
  private rig: SceneRig;
  private quality: Quality;
  private cam: CameraDirector;
  private w!: World;
  private pieces = new PiecesView();
  private audio = new AudioEngine();
  private ui: UI;
  private markers: HTMLElement;
  private progress: Progress;
  private state: State = 'title';
  private plan: Plan = {};
  private sim: Simulation | null = null;
  private recording: Recording | null = null;
  private result: SimResult | null = null;
  private selected: string | null = null;
  private dragging: { id: string; offX: number; offZ: number } | null = null;
  private acc = 0;
  private timeScale = 1;
  private slowUntil = 0;
  private hitStopUntil = 0;
  private releaseUntil = 0;
  private fast = false;
  private paused = false;
  private now = 0;
  private last = 0;
  private ghostOn = true;
  private routesOn = false;
  private replayT = 0;
  private replayPlaying = true;
  private replaySpeed = 1;
  private replayEventIdx = 0;
  private replayLastF = 0;
  private menuOpen = false;
  private markerEls: { el: HTMLElement; pos: Vector3 }[] = [];
  private raycaster = new Raycaster();
  private runStatusTimer = 0;
  private runTier: Medal = 'platinum';
  private steerKeys = { left: false, right: false };
  private steerTouch = 0;
  private steerButtons = 0;
  private steerSmoothed = 0;
  private sprayAcc = 0;
  private rolling = 0;
  private gravel = 0;
  private followInfo: { focus: Vector3; vel: Vector3; spread: number; small?: boolean; size?: number; courseYaw?: number; wet?: boolean } | undefined;
  private coursePl: ReturnType<typeof makePolyline> | null = null;
  private loadingEl = document.getElementById('loading');
  /** headless test browsers render in software; don't let them degrade quality */
  private automation = navigator.webdriver === true;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement, markers: HTMLElement, R: typeof RAPIER_T, onProgress: (f: number, label: string) => void) {
    this.R = R;
    this.markers = markers;
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
    this.cam.onSurveyEnd = () => this.endSurvey();
    this.audio.setSound(this.progress.settings.sound);
    this.audio.setMusic(this.progress.settings.music);
    this.applyLook();

    this.ui = new UI(uiRoot, {
      play: () => this.showMountains(),
      pickLevel: (id) => void this.pickLevel(id),
      mountains: () => this.showMountains(),
      release: () => this.release(),
      reset: () => this.resetLevel(),
      menu: () => this.openMenu(),
      action: (k) => this.doAction(k),
      closeContext: () => this.select(null),
      replay: () => this.startReplay(),
      adjust: () => this.toPlanning(),
      retry: () => this.startRun(),
      next: () => this.nextLevel(),
      pause: () => this.togglePause(),
      skip: () => this.toggleFast(),
      scrub: (f) => this.scrub(f),
      replayToggle: () => (this.replayPlaying = !this.replayPlaying),
      replaySpeed: () => (this.replaySpeed = this.replaySpeed === 1 ? 0.25 : this.replaySpeed === 0.25 ? 2 : 1),
      exitReplay: () => this.endReplay(),
      toggleSound: () => this.setSound(!this.progress.settings.sound),
      toggleMusic: () => this.setMusic(!this.progress.settings.music),
      toTitle: () => this.toTitle(),
      resumeFromMenu: () => this.closeMenu(),
      toggleGhost: () => {
        this.ghostOn = !this.ghostOn;
        this.updateGhost();
      },
      toggleRoutes: () => {
        this.routesOn = !this.routesOn;
        this.updateRoutes();
      },
      survey: () => this.survey(),
      zone: (id) => this.goZone(id),
      composition: (id) => this.setComposition(id),
      steer: (d) => (this.steerButtons = d),
    });

    // during a run: drag anywhere — left/right of where you touched — to lean
    let drag: { id: number; x: number } | null = null;
    canvas.addEventListener('pointerdown', (e) => {
      if (this.state === 'sim') drag = { id: e.pointerId, x: e.clientX };
      if (this.state === 'plan' && this.cam.surveying) this.endSurvey(true);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (this.state !== 'sim' || !drag || drag.id !== e.pointerId) return;
      const w = Math.max(320, canvas.clientWidth);
      const range = w * 0.12;
      let dx = e.clientX - drag.x;
      if (dx > range) {
        drag.x = e.clientX - range;
        dx = range;
      } else if (dx < -range) {
        drag.x = e.clientX + range;
        dx = -range;
      }
      const v = dx / range;
      this.steerTouch = Math.abs(v) < 0.08 ? 0 : clamp((v - Math.sign(v) * 0.08) / 0.92, -1, 1);
    });
    const endDrag = (e: PointerEvent) => {
      if (drag && drag.id === e.pointerId) {
        drag = null;
        this.steerTouch = 0;
      }
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    window.addEventListener('keyup', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'a') this.steerKeys.left = false;
      if (e.key === 'ArrowRight' || e.key === 'd') this.steerKeys.right = false;
    });

    attachGestures(canvas, {
      enabled: () => this.state === 'plan' && !this.menuOpen && !this.cam.surveying,
      tap: (x, y) => this.tap(x, y),
      grab: (x, y) => this.grab(x, y),
      dragObject: (x, y) => this.dragTo(x, y),
      release: () => this.dropDrag(),
      pan: (dx, dy) => this.cam.pan(dx, dy, canvas.clientHeight),
      orbit: (dx, dy) => this.cam.rotate(-dx * 0.005, dy * 0.004),
      zoom: (f) => this.cam.zoom(f),
      hover: (x, y) => this.w.objects.setHover(this.pick(x, y)),
    });
    const unlock = () => this.audio.unlock();
    for (const ev of ['pointerdown', 'touchend', 'click', 'keydown']) window.addEventListener(ev, unlock, { passive: true });
    window.addEventListener('keydown', (e) => this.key(e));
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 250));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.audio.suspend();
        if (this.state === 'sim' && !this.paused) this.togglePause();
      } else this.audio.resume();
    });
    this.resize();
    onProgress(0.9, 'Placing the boulder…');
  }

  private get level(): LevelDef {
    return this.w.level;
  }
  private get data(): LevelData {
    return this.w.data;
  }
  private get comp() {
    return composition(this.progress.composition);
  }

  // ------------------------------------------------------------------ world building
  private buildWorld(level: LevelDef, onProgress?: (f: number, label: string) => void) {
    const scene = this.rig.scene;
    if (this.w) {
      scene.remove(this.w.group);
      disposeTree(this.w.group);
    }
    const data = loadLevelData(level);
    const group = new Group();
    onProgress?.(0.35, 'Laying down the ground…');
    group.add(buildTerrain(data, this.quality.far));
    onProgress?.(0.5, 'Growing the forest…');
    const avoid = [
      ...level.objects.map((o) => {
        const p = 'position' in o ? o.position : o.center;
        return { x: p[0], z: p[1], r: o.type === 'tree' ? 4 : 5 };
      }),
      ...level.formations.map((f) => ({ x: f.position[0], z: f.position[1], r: Math.max(f.size[0], f.size[2]) })),
    ];
    if (level.forest.count > 0) group.add(buildVegetation(data, this.quality.trees, avoid).group);
    onProgress?.(0.7, 'Finding the water…');
    const water = buildWater(data, this.rig.sunDir, this.rig.fogColor);
    group.add(water.group);
    const objects = new ObjectsView(data);
    group.add(objects.group);
    const props = new PropsView(layoutProps(level, data));
    group.add(props.group);
    const effects = new Effects(data.heightAt);
    const trails = new Trails(data.heightAt);
    const ghost = new Trails(data.heightAt);
    const routes = new Trails(data.heightAt);
    group.add(effects.group, trails.group, ghost.group, routes.group);
    scene.add(group);
    objects.onChange = (id, kind, pos) => this.onObjectChange(id, kind, pos);
    this.w = { level, data, group, water, objects, props, effects, trails, ghost, routes };
    this.coursePl = level.terrain.course ? makePolyline(level.terrain.course) : null;
    const lp = levelProgress(this.progress, level.id);
    this.plan = lp.lastPlan ? sanitizePlan(level, lp.lastPlan) : defaultPlan(level);
    objects.sync(this.plan, false);
    water.setActive(activeWater(level, this.plan), true);
    effects.setViewportHeight(this.rig.renderer.domElement.clientHeight * Math.min(2, window.devicePixelRatio || 1));
    this.recording = null;
    this.result = null;
  }

  private async loadLevel(level: LevelDef) {
    if (this.w.level.id === level.id) return;
    const l = this.loadingEl;
    if (l) {
      l.innerHTML = `<div class="loading-inner"><div class="wordmark">ERODE</div><div class="loading-text">${level.stage} · ${level.name}</div></div>`;
      l.classList.remove('gone');
    }
    await new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 30)));
    this.sim?.dispose();
    this.sim = null;
    this.pieces.clear();
    this.buildWorld(level);
    this.rig.setLevel(level);
    this.cam.setLevel(level, this.data.heightAt);
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

  // ------------------------------------------------------------------ helpers
  private resize() {
    this.rig.resize();
    this.cam.baseFov = this.rig.camera.fov;
    this.w.effects.setViewportHeight(this.rig.renderer.domElement.clientHeight * Math.min(2, window.devicePixelRatio || 1));
  }

  private applyLook() {
    const c = this.comp;
    const look: RockLook = { tint: c.tint, speck: c.speck, gloss: c.gloss };
    this.pieces.setLook(look);
  }

  private showRestingBoulder() {
    const b = restingBoulder(this.level);
    this.pieces.clear();
    this.applyLook();
    this.pieces.sync([{ id: 1, shape: b.shape, kind: 'stone', pos: b.pos, quat: [0, 0, 0, 1], scale: 1 }]);
  }

  /** starting mass of this level's boulder in a given stone */
  private massFor(id: CompositionId): number {
    return restingBoulder(this.level).shape.volume * composition(id).density * 1000;
  }

  private statesFromSim(s: Simulation): PieceState[] {
    const out: PieceState[] = [];
    for (const p of s.pieces.values()) {
      const pose = s.pose(p);
      out.push({ id: p.id, shape: p.shape, kind: p.kind, pos: pose.pos, quat: pose.quat, scale: pose.scale, smooth: pose.smooth });
    }
    return out;
  }

  private ndc(x: number, y: number): Vector2 {
    const c = this.rig.renderer.domElement;
    return new Vector2((x / c.clientWidth) * 2 - 1, -(y / c.clientHeight) * 2 + 1);
  }

  private pick(x: number, y: number): string | null {
    this.raycaster.setFromCamera(this.ndc(x, y), this.rig.camera);
    const hits = this.raycaster.intersectObjects(this.w.objects.pickTargets() as Object3D[], false);
    if (hits.length) return hits[0].object.userData.objectId as string;
    // forgiving touch: nearest object anchor on screen within ~46px
    const c = this.rig.renderer.domElement;
    let best: string | null = null;
    let bestD = 46;
    for (const o of this.level.objects) {
      const a = this.w.objects.anchorOf(o.id);
      if (!a) continue;
      const st = this.plan[o.id];
      if (st?.type === 'rock' && st.removed) continue;
      const v = a.clone().project(this.rig.camera);
      if (v.z > 1) continue;
      const sx = (v.x * 0.5 + 0.5) * c.clientWidth,
        sy = (-v.y * 0.5 + 0.5) * c.clientHeight;
      const d = Math.hypot(sx - x, sy - y);
      if (d < bestD) {
        bestD = d;
        best = o.id;
      }
    }
    return best;
  }

  /** Where the pointer ray meets the ground (marching the heightfield). */
  private groundPoint(x: number, y: number): Vector3 | null {
    this.raycaster.setFromCamera(this.ndc(x, y), this.rig.camera);
    const o = this.raycaster.ray.origin.clone();
    const d = this.raycaster.ray.direction.clone();
    let prev = o.clone();
    for (let t = 0; t < 400; t += 0.6) {
      const p = o.clone().addScaledVector(d, t);
      if (p.y <= this.data.heightAt(p.x, p.z)) {
        let a = prev,
          b = p;
        for (let i = 0; i < 12; i++) {
          const m = a.clone().lerp(b, 0.5);
          if (m.y <= this.data.heightAt(m.x, m.z)) b = m;
          else a = m;
        }
        return b;
      }
      prev = p;
    }
    return null;
  }

  private obj(id: string): LevelObject {
    return this.level.objects.find((o) => o.id === id)!;
  }

  private interventions(): number {
    return countInterventions(this.level, this.plan);
  }

  private canModify(id: string): boolean {
    const o = this.obj(id);
    const st = this.plan[id] ?? defaultState(o);
    return isModified(o, st) || this.interventions() < this.level.budget;
  }

  private courseYawAt(x: number, z: number): number {
    if (!this.coursePl) return 0;
    const h = pathDistance(this.coursePl, x, z);
    return Math.atan2(h.tx, h.tz);
  }

  private zoneAt(z: number): { id: string; name: string } | null {
    for (const q of this.level.zones ?? []) if (z >= q.z[0] && z < q.z[1]) return q;
    return null;
  }

  // ------------------------------------------------------------------ flow
  private hideAll() {
    this.ui.hideTitle();
    this.ui.hideMountains();
    this.ui.hidePlanning();
    this.ui.hideRun();
    this.ui.hideResults();
    this.ui.hideReplay();
    this.ui.tip(null);
  }

  private showTitle() {
    const medals: Record<Medal, number> = { none: 0, bronze: 0, silver: 0, gold: 0, platinum: 0 };
    let finished = 0;
    for (const l of LEVELS) {
      const lp = this.progress.levels[l.id];
      if (lp?.finished) {
        finished++;
        medals[lp.medal]++;
      }
    }
    this.ui.showTitle({ medals, finished, total: LEVELS.length });
  }

  private toTitle() {
    this.closeMenu();
    this.sim?.dispose();
    this.sim = null;
    this.hideAll();
    this.clearMarkers();
    this.w.trails.clear();
    this.w.routes.clear();
    this.w.objects.setPlanning(false);
    this.resetObjectsView();
    this.showRestingBoulder();
    this.state = 'title';
    this.cam.setMode('intro');
    this.showTitle();
  }

  private showMountains() {
    this.audio.unlock();
    this.audio.click();
    this.closeMenu();
    this.sim?.dispose();
    this.sim = null;
    this.hideAll();
    this.clearMarkers();
    this.w.trails.clear();
    this.w.routes.clear();
    this.w.objects.setPlanning(false);
    this.resetObjectsView();
    this.showRestingBoulder();
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
    this.toPlanning();
  }

  private nextLevel() {
    const i = LEVELS.findIndex((l) => l.id === this.level.id);
    const next = LEVELS[i + 1];
    if (next && levelUnlocked(this.progress, LEVELS, i + 1)) void this.pickLevel(next.id);
    else this.showMountains();
  }

  private resetObjectsView() {
    this.w.objects.sync(this.plan, false);
    for (const o of this.level.objects) {
      if (o.type === 'soil') this.w.objects.slump(o.id, false);
      if (o.type === 'branches') this.w.objects.smash(o.id, false, false);
    }
    this.w.props.reset();
  }

  private toPlanning() {
    this.closeMenu();
    this.sim?.dispose();
    this.sim = null;
    this.state = 'plan';
    this.hideAll();
    this.w.trails.clear();
    this.clearMarkers();
    this.w.effects.clear();
    this.w.objects.setPlanning(true);
    this.resetObjectsView();
    this.w.water.setActive(activeWater(this.level, this.plan));
    this.showRestingBoulder();
    this.cam.setMode('plan');
    const lp = levelProgress(this.progress, this.level.id);
    this.ui.showPlanning(this.level, lp);
    this.refreshCompositions();
    this.refreshChanges();
    this.updateGhost();
    this.updateRoutes();
    this.addPlanMarkers();
    if (!this.progress.tutorial.selected) {
      const touch = window.matchMedia('(pointer: coarse)').matches;
      this.ui.tip(
        `Survey the descent, then plan it: ${touch ? 'tap' : 'click'} the glowing objects to move, fell, clear or lever them — ${this.level.budget} moves. ${touch ? 'Swipe' : 'Drag'} to look around.`,
      );
    } else if (!this.progress.tutorial.released) this.ui.tip('Ready? Release the boulder — then drag left and right to lean.', 5000);
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
    this.renderContext();
    this.ui.tip(`${composition(id).name}: ${composition(id).blurb}`, 3200);
  }

  /** Fly the planning camera to a stretch of the course. */
  private goZone(id: string) {
    const z = this.level.zones?.find((q) => q.id === id);
    if (!z) return;
    const zc = (z.z[0] + z.z[1]) / 2;
    let x = 0;
    if (this.coursePl) {
      const course = this.level.terrain.course!;
      for (let i = 0; i < course.length - 1; i++)
        if (course[i][1] <= zc && course[i + 1][1] >= zc) {
          const u = (zc - course[i][1]) / (course[i + 1][1] - course[i][1]);
          x = course[i][0] + (course[i + 1][0] - course[i][0]) * u;
        }
    }
    this.audio.click();
    this.cam.focusOn(new Vector3(x, this.data.heightAt(x, zc), zc), Math.max(55, (z.z[1] - z.z[0]) * 0.7));
  }

  /** The survey: a glide down the mountain before you commit. */
  private survey() {
    if (this.state !== 'plan') return;
    this.audio.whoosh();
    this.select(null);
    this.clearMarkers();
    this.ui.setSurveying(true);
    this.routesOn = true;
    this.updateRoutes();
    const course = this.level.terrain.course!;
    const start = this.level.boulder.position[1];
    const end = this.level.finish.z + 10;
    this.cam.survey(course.filter((p) => p[1] >= start - 5 && p[1] <= end + 40));
  }
  private endSurvey(early = false) {
    if (early) this.cam.setMode('plan');
    this.ui.setSurveying(false);
    if (this.state === 'plan') this.addPlanMarkers();
  }

  private refreshChanges() {
    this.ui.setChanges(this.interventions(), this.level.budget);
  }

  private updateGhost() {
    this.w.ghost.clear();
    const lp = levelProgress(this.progress, this.level.id);
    const available = !!lp.lastTrail && lp.lastTrail.length > 1;
    this.ui.setGhost(this.ghostOn, available);
    if (this.state === 'plan' && this.ghostOn && lp.lastTrail) this.w.ghost.add(lp.lastTrail, new Color(1, 0.93, 0.8), 0.9, { dashed: true, opacity: 0.55 });
  }

  private updateRoutes() {
    this.w.routes.clear();
    this.ui.setRoutes(this.routesOn);
    if (this.state !== 'plan' || !this.routesOn) return;
    this.level.routes.forEach((r, i) => {
      const pl = makePolyline(r.path);
      const pts: [number, number, number][] = [];
      for (let s = 0; s <= pl.length; s += 2) {
        let k = 0;
        while (k < pl.cum.length - 2 && pl.cum[k + 1] < s) k++;
        const a = pl.pts[k],
          b = pl.pts[k + 1];
        const u = (s - pl.cum[k]) / (pl.cum[k + 1] - pl.cum[k] || 1);
        const x = a[0] + (b[0] - a[0]) * u,
          z = a[1] + (b[1] - a[1]) * u;
        pts.push([x, this.data.heightAt(x, z) + 0.25, z]);
      }
      this.w.routes.add(pts, ROUTE_COLORS[i % ROUTE_COLORS.length], 0.7, { dashed: true, opacity: 0.8 });
    });
    this.clearMarkers();
    this.addPlanMarkers();
  }

  private resetLevel() {
    this.audio.click();
    if (this.state !== 'plan') this.toPlanning();
    this.plan = defaultPlan(this.level);
    this.w.objects.sync(this.plan, true);
    this.w.water.setActive(activeWater(this.level, this.plan));
    this.select(null);
    this.refreshChanges();
    this.cam.resetPlan();
    this.ui.tip('The mountain is as you found it.', 2200);
  }

  // ------------------------------------------------------------------ selection & actions
  private select(id: string | null) {
    this.selected = id;
    this.w.objects.setSelected(id);
    if (!id) {
      this.ui.hideContext();
      return;
    }
    if (!this.progress.tutorial.selected) {
      this.progress.tutorial.selected = true;
      saveProgress(this.progress);
      this.ui.tip(null);
    }
    const a = this.w.objects.anchorOf(id);
    if (a && !this.dragging) {
      const v = a.clone().project(this.rig.camera);
      if (Math.abs(v.x) > 0.5 || v.y < -0.15 || v.y > 0.6) this.cam.focusOn(a);
    }
    this.renderContext();
  }

  /** what it takes (speed) for the current stone to burst through a barrier */
  private breakSpeed(momentum: number): string {
    const m = this.massFor(this.progress.composition);
    return `${Math.round((momentum / m) * 3.6)} km/h`;
  }

  private renderContext() {
    const id = this.selected;
    if (!id) return;
    const o = this.obj(id);
    const st = this.plan[id] ?? defaultState(o);
    const modified = isModified(o, st);
    const locked = !this.canModify(id);
    const acts: ContextAction[] = [];
    let tag = '';
    let text = o.hint;
    let note: string | undefined;
    let kind: 'hazard' | 'block' | 'tweak' = 'tweak';
    switch (o.type) {
      case 'rock': {
        const s = st as Extract<ObjectState, { type: 'rock' }>;
        tag = 'Loose boulder · drag to move';
        kind = 'hazard';
        acts.push(s.removed ? { key: 'restore', label: 'Put it back', icon: 'undo' } : { key: 'remove', label: 'Lever it away', primary: true, disabled: locked });
        if (!s.removed && modified) acts.push({ key: 'restore', label: 'Return', icon: 'undo' });
        note = s.removed ? undefined : `Drag it to move it (up to ${o.moveRadius} m).`;
        break;
      }
      case 'log': {
        const s = st as Extract<ObjectState, { type: 'log' }>;
        tag = 'Trunk · rotate and drag';
        const a = Math.round((((s.yaw / deg) % 180) + 180) % 180);
        const desc =
          Math.abs(a - 90) < 16
            ? 'it lies along the slope — out of the way'
            : a < 16 || a > 164
              ? 'it lies straight across — a barrier'
              : a < 90
                ? 'it is angled to turn the boulder to the right'
                : 'it is angled to turn the boulder to the left';
        text = `${o.hint} Now ${desc}.`;
        acts.push({ key: 'rotL', label: '15°', icon: 'rotL', disabled: locked, repeat: true }, { key: 'rotR', label: '15°', icon: 'rotR', disabled: locked, repeat: true });
        if (modified) acts.push({ key: 'restore', label: 'Restore', icon: 'undo' });
        note = `Drag the trunk to move it (up to ${o.moveRadius} m).`;
        break;
      }
      case 'branches': {
        const s = st as Extract<ObjectState, { type: 'branches' }>;
        kind = 'block';
        tag = s.removed ? 'Barrier · cleared' : o.breakMomentum ? 'Barrier · breakable' : 'Barrier';
        acts.push(s.removed ? { key: 'restore', label: 'Put it back', icon: 'undo' } : { key: 'remove', label: o.style === 'logjam' ? 'Clear the jam' : o.style === 'fence' || o.style === 'trestle' ? 'Pull it down' : 'Clear it', primary: true, disabled: locked });
        if (!s.removed) note = o.breakMomentum ? `Your ${this.comp.name.toLowerCase()} boulder bursts through at about ${this.breakSpeed(o.breakMomentum)} or more. Slower, and it stops dead.` : 'Nothing breaks through this. Clear it, or go another way.';
        break;
      }
      case 'tree': {
        const s = st as Extract<ObjectState, { type: 'tree' }>;
        tag = 'Tree · fell it';
        for (const f of o.fellOptions) acts.push({ key: `fell:${f.id}`, label: f.label, active: s.felled === f.id, disabled: locked && s.felled !== f.id, primary: !s.felled && f.id === o.fellOptions[0].id });
        if (s.felled) acts.push({ key: 'restore', label: 'Let it stand', icon: 'undo' });
        break;
      }
      case 'soil': {
        const s = st as Extract<ObjectState, { type: 'soil' }>;
        const what = o.material === 'snow' ? 'Snowbank' : o.material === 'ash' ? 'Ash drift' : 'Earth bank';
        tag = s.dug ? `${what} · dug out` : `${what} · cushion`;
        acts.push(s.dug ? { key: 'restore', label: 'Heap it back', icon: 'undo' } : { key: 'dig', label: 'Dig it out', primary: true, disabled: locked });
        const soaked = o.saturatedBy && activeWater(this.level, this.plan).has(o.saturatedBy);
        if (!s.dug) note = soaked ? 'Water is soaking this bank — it will slump when struck.' : 'Soft: it soaks up a hit but swallows speed.';
        break;
      }
      case 'outcrop': {
        const s = st as Extract<ObjectState, { type: 'outcrop' }>;
        tag = s.split ? 'Rock · levered' : 'Rock · lever it';
        kind = 'hazard';
        acts.push(s.split ? { key: 'restore', label: 'Put it back', icon: 'undo' } : { key: 'split', label: o.actionLabel ?? 'Lever it over', primary: true, disabled: locked });
        break;
      }
      case 'ice': {
        const s = st as Extract<ObjectState, { type: 'ice' }>;
        tag = 'Ice · break it';
        acts.push(s.broken ? { key: 'restore', label: 'Let it freeze', icon: 'undo' } : { key: 'break', label: 'Break the ice', primary: true, disabled: locked });
        break;
      }
      case 'gate': {
        const s = st as Extract<ObjectState, { type: 'gate' }>;
        tag = 'Water · divert it';
        for (const op of o.options) acts.push({ key: `gate:${op.id}`, label: op.label, active: s.option === op.id, disabled: locked && s.option !== op.id });
        break;
      }
    }
    if (locked) note = `You’ve used all ${this.level.budget} moves. Undo one to free it up.`;
    this.ui.showContext(o.name, tag, text, acts, note, kind);
  }

  private setState(id: string, s: ObjectState, animate = true) {
    this.plan[id] = s;
    this.w.objects.sync(this.plan, animate);
    this.w.water.setActive(activeWater(this.level, this.plan));
    this.refreshChanges();
    this.renderContext();
    window.setTimeout(() => {
      if (this.state !== 'plan' || this.cam.surveying) return;
      this.clearMarkers();
      this.addPlanMarkers();
    }, 1300);
  }

  private doAction(key: string) {
    const id = this.selected;
    if (!id) return;
    const o = this.obj(id);
    const st = JSON.parse(JSON.stringify(this.plan[id] ?? defaultState(o))) as ObjectState;
    if (key === 'restore') {
      this.setState(id, defaultState(o));
      return;
    }
    if (!this.canModify(id) && !key.startsWith('gate:') && !key.startsWith('fell:')) return;
    switch (st.type) {
      case 'rock':
        if (key === 'remove') this.setState(id, { ...st, removed: true });
        break;
      case 'log':
        if (key === 'rotL' || key === 'rotR') {
          const step = 15 * deg * (key === 'rotL' ? -1 : 1);
          const yaw = Math.round((st.yaw + step) / (15 * deg)) * 15 * deg;
          this.setState(id, { ...st, yaw }, true);
          this.audio.impact(0.25, 'wood');
        }
        break;
      case 'branches':
        if (key === 'remove') this.setState(id, { ...st, removed: true });
        break;
      case 'tree':
        if (key.startsWith('fell:')) {
          const f = key.slice(5);
          if (st.felled && st.felled !== f) {
            this.plan[id] = { type: 'tree', felled: null };
            this.w.objects.sync(this.plan, false);
          }
          if (!this.canModify(id) && !st.felled) return;
          this.setState(id, { type: 'tree', felled: f });
        }
        break;
      case 'soil':
        if (key === 'dig') this.setState(id, { ...st, dug: true });
        break;
      case 'outcrop':
        if (key === 'split') this.setState(id, { ...st, split: true });
        break;
      case 'ice':
        if (key === 'break') this.setState(id, { ...st, broken: true });
        break;
      case 'gate':
        if (key.startsWith('gate:')) {
          const opt = key.slice(5);
          if (opt !== st.option && (this.canModify(id) || opt === (o as Extract<LevelObject, { type: 'gate' }>).initial)) this.setState(id, { ...st, option: opt });
        }
        break;
    }
  }

  private onObjectChange(id: string, kind: string, pos: Vector3) {
    const fx = this.w.effects;
    switch (kind) {
      case 'lift':
        this.audio.grind();
        fx.dust(pos, 0.2, new Color(0.5, 0.42, 0.32));
        break;
      case 'snap':
        this.audio.snap();
        fx.shards(pos, new Color(0.45, 0.36, 0.25), 40);
        break;
      case 'fell':
        this.audio.treeFall();
        window.setTimeout(() => {
          const a = this.w.objects.anchorOf(id);
          if (a) fx.dust(a, 0.6, new Color(0.55, 0.5, 0.4));
          this.cam.shake(0.25);
        }, 1300);
        break;
      case 'dig':
        this.audio.dig();
        fx.earth(pos, 0.8);
        break;
      case 'split':
        this.audio.fracture(0.6);
        fx.dust(pos, 0.7);
        fx.grit(pos, 0.6);
        window.setTimeout(() => this.cam.shake(0.3), 600);
        break;
      case 'shatter':
        this.audio.shatter();
        fx.shards(pos, new Color(0.85, 0.93, 1), 60);
        break;
      case 'gate':
        this.audio.gate();
        break;
      case 'log':
        break;
      default:
        this.audio.click();
    }
  }

  // ------------------------------------------------------------------ gestures
  private tap(x: number, y: number) {
    this.audio.unlock();
    const id = this.pick(x, y);
    if (id) this.audio.click();
    this.select(id === this.selected ? null : id);
  }

  private grab(x: number, y: number): boolean {
    const id = this.pick(x, y);
    if (!id) return false;
    const o = this.obj(id);
    if (o.type !== 'rock' && o.type !== 'log') return false;
    const st = this.plan[id] ?? defaultState(o);
    if (st.type === 'rock' && st.removed) return false;
    if (!this.canModify(id)) {
      this.ui.tip(`You’ve used all ${this.level.budget} moves. Undo one to free it up.`, 2500);
      return true;
    }
    const g = this.groundPoint(x, y);
    if (!g) return false;
    const s = st as { x: number; z: number };
    this.dragging = { id, offX: s.x - g.x, offZ: s.z - g.z };
    this.select(id);
    return true;
  }

  private dragTo(x: number, y: number) {
    if (!this.dragging) return;
    const g = this.groundPoint(x, y);
    if (!g) return;
    const { id } = this.dragging;
    const o = this.obj(id) as Extract<LevelObject, { type: 'rock' | 'log' }>;
    let nx = g.x + this.dragging.offX;
    let nz = g.z + this.dragging.offZ;
    const dx = nx - o.position[0],
      dz = nz - o.position[1];
    const d = Math.hypot(dx, dz);
    if (d > o.moveRadius) {
      nx = o.position[0] + (dx / d) * o.moveRadius;
      nz = o.position[1] + (dz / d) * o.moveRadius;
    }
    const b = this.level.terrain.bounds;
    nx = clamp(nx, b.x[0] + 3, b.x[1] - 3);
    nz = clamp(nz, b.z[0] + 3, b.z[1] - 3);
    const st = this.plan[id] ?? defaultState(o);
    this.plan[id] = { ...(st as object), x: nx, z: nz } as ObjectState;
    this.w.objects.sync(this.plan, false);
    this.refreshChanges();
  }

  private dropDrag() {
    if (!this.dragging) return;
    const o = this.obj(this.dragging.id);
    this.audio.impact(0.3, o.type === 'log' ? 'wood' : 'granite');
    const a = this.w.objects.anchorOf(this.dragging.id);
    if (a) this.w.effects.dust(a, 0.15, new Color(0.5, 0.45, 0.36));
    this.dragging = null;
    this.renderContext();
  }

  private key(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (this.menuOpen) this.closeMenu();
      else if (this.selected) this.select(null);
      else this.openMenu();
    }
    if (e.key === 'Enter' && !this.menuOpen) {
      if (this.state === 'title') this.showMountains();
      else if (this.state === 'results') this.startRun();
      else if (this.state === 'plan' && !this.selected) this.release();
    }
    if (this.state === 'sim' && e.key === ' ') this.togglePause();
    if (e.key === 'ArrowLeft' || e.key === 'a') this.steerKeys.left = true;
    if (e.key === 'ArrowRight' || e.key === 'd') this.steerKeys.right = true;
    if (this.state === 'plan' && this.selected && this.obj(this.selected).type === 'log') {
      if (e.key === 'q') this.doAction('rotL');
      if (e.key === 'e') this.doAction('rotR');
    }
  }

  // ------------------------------------------------------------------ the run
  private release() {
    if (this.state !== 'plan') return;
    this.startRun();
  }

  private startRun() {
    this.audio.unlock();
    this.closeMenu();
    this.hideAll();
    this.w.trails.clear();
    this.w.routes.clear();
    this.steerKeys = { left: false, right: false };
    this.steerTouch = 0;
    this.steerButtons = 0;
    this.resetObjectsView();
    this.select(null);
    this.clearMarkers();
    this.w.ghost.clear();
    this.w.objects.setPlanning(false);
    try {
      this.sim?.dispose();
      this.sim = new Simulation(this.R, this.level, clonePlan(this.plan), { composition: this.progress.composition });
    } catch (err) {
      console.error(err);
      this.ui.tip('The mountain could not be prepared. Try again.', 3000);
      this.toPlanning();
      return;
    }
    const lp = levelProgress(this.progress, this.level.id);
    lp.lastPlan = clonePlan(this.plan);
    lp.attempts++;
    saveProgress(this.progress);
    this.state = 'sim';
    this.acc = 0;
    this.timeScale = 1;
    this.fast = false;
    this.paused = false;
    this.slowUntil = 0;
    this.runTier = 'platinum';
    this.w.effects.clear();
    this.pieces.clear();
    this.applyLook();
    const rb = restingBoulder(this.level);
    this.cam.subject.set(rb.pos[0], rb.pos[1], rb.pos[2]);
    this.cam.subjectYaw = this.courseYawAt(rb.pos[0], rb.pos[2]);
    this.cam.setMode('release');
    this.releaseUntil = this.now + 1.1;
    this.ui.showRun(this.level.zones ?? [], this.sim.startMass, this.level.medals);
    this.audio.release();
    this.audio.riser(1.2);
  }

  private togglePause() {
    if (this.state === 'sim') {
      this.paused = !this.paused;
      this.ui.setPaused(this.paused);
    }
  }

  private toggleFast() {
    this.fast = !this.fast;
    if (this.fast) this.ui.callout('Fast forward', 900);
  }

  private stepSim(dt: number) {
    const sim = this.sim!;
    if (this.paused || this.menuOpen) return;
    let scale = this.fast ? 4 : 1;
    if (!this.fast && this.now < this.hitStopUntil) scale = 0.08;
    else if (this.now < this.slowUntil && !this.fast) scale = 0.35;
    this.timeScale += (scale - this.timeScale) * Math.min(1, dt * 12);
    this.acc += dt * this.timeScale;
    const keys = (this.steerKeys.right ? 1 : 0) - (this.steerKeys.left ? 1 : 0);
    const want = clamp(keys + this.steerButtons + this.steerTouch, -1, 1);
    this.steerSmoothed += (want - this.steerSmoothed) * Math.min(1, dt * 22);
    this.ui.setSteer(this.steerSmoothed);
    sim.steer = this.steerSmoothed;
    let steps = 0;
    const maxSteps = this.fast ? 16 : 6;
    try {
      while (this.acc >= DT && steps < maxSteps && !sim.done) {
        sim.stepOnce();
        this.acc -= DT;
        steps++;
      }
    } catch (err) {
      console.error(err);
      sim.finish('unstable');
    }
    if (steps >= maxSteps) this.acc = Math.min(this.acc, DT);
    for (const e of sim.drainEvents()) this.handleEvent(e, true);
    const states = this.statesFromSim(sim);
    this.pieces.sync(states);
    this.groundFx(sim, dt);
    if (this.cam.mode === 'release') {
      const h = sim.hero;
      if (h) {
        const t = h.body.translation();
        this.cam.subject.set(t.x, t.y, t.z);
      }
      if (this.now > this.releaseUntil) this.cam.setMode('follow');
    }
    this.followFrom(states, sim.leader?.id ?? -1, (id) => {
      const p = sim.pieces.get(id);
      if (!p) return new Vector3();
      const l = p.body.linvel();
      return new Vector3(l.x, l.y, l.z);
    });
    this.runStatusTimer -= dt;
    if (this.runStatusTimer <= 0) {
      this.runStatusTimer = 0.05;
      const lead = sim.leader;
      const mass = sim.liveMass;
      this.ui.setMass(mass);
      const lz = lead?.body.translation().z ?? 0;
      const v = lead?.body.linvel();
      const z0 = this.level.boulder.position[1];
      this.ui.setRun({
        progress: (lz - z0) / (this.level.finish.z - z0),
        zone: this.zoneAt(lz)?.name ?? '',
        speed: v ? Math.hypot(v.x, v.y, v.z) : 0,
      });
      // a medal slipping away is news
      const f = mass / sim.startMass;
      const m = this.level.medals;
      const tier: Medal = f >= m.platinum ? 'platinum' : f >= m.gold ? 'gold' : f >= m.silver ? 'silver' : 'bronze';
      if (MEDALS.indexOf(tier) < MEDALS.indexOf(this.runTier) && !sim.crossed) {
        this.ui.callout(`${this.runTier[0].toUpperCase()}${this.runTier.slice(1)} slips away`, 1800);
        this.runTier = tier;
      }
    }
    if (sim.done) this.finishRun();
  }

  /** Gravel spray under a rolling stone. */
  private groundFx(sim: Simulation, dt: number) {
    const h = sim.hero;
    if (!h) return;
    const t = h.body.translation();
    const v = h.body.linvel();
    const vel = new Vector3(v.x, v.y, v.z);
    const sp = vel.length();
    const grounded = sim.step - h.lastContactStep < 4 && !h.wet;
    if (grounded && sp > 5) {
      this.sprayAcc += dt * Math.min(1.5, sp / 12) * (0.5 + Math.min(1, h.size));
      const surf = h.contactSurface;
      const col =
        surf === 'snow' || surf === 'ice'
          ? new Color(0.95, 0.97, 1)
          : surf === 'sand'
            ? new Color(0.95, 0.82, 0.58)
            : surf === 'mud'
              ? new Color(0.32, 0.24, 0.16)
              : surf === 'ash'
                ? new Color(0.35, 0.33, 0.32)
                : surf === 'meadow' || surf === 'soil'
                  ? new Color(0.42, 0.36, 0.22)
                  : new Color(0.62, 0.56, 0.48);
      while (this.sprayAcc > 0.02) {
        this.sprayAcc -= 0.02;
        const r = h.shape.radius * h.physScale;
        this.w.effects.spray(new Vector3(t.x, t.y - r * 0.8, t.z), vel, 1, col);
      }
    }
  }

  private followFrom(states: PieceState[], leaderId: number, velOf: (id: number) => Vector3) {
    const lead = states.find((s) => s.id === leaderId) ?? states.find((s) => s.kind === 'stone');
    if (!lead) return;
    const focus = new Vector3(...lead.pos);
    const vel = velOf(lead.id);
    let spread = 0;
    for (const s of states) {
      if (s.kind !== 'stone') continue;
      const d = focus.distanceTo(new Vector3(...s.pos));
      if (d < 26) spread = Math.max(spread, d);
    }
    const r = lead.shape.radius * lead.scale;
    const courseYaw = this.coursePl ? this.courseYawAt(focus.x, focus.z) : undefined;
    const wet = this.sim?.hero?.wet ?? false;
    this.followInfo = { focus: focus.add(new Vector3(0, r * 0.4, 0)), vel, spread: Math.min(18, spread), small: r < 0.3, size: r, courseYaw, wet };
    let rolling = 0;
    let gravel = 0;
    for (const s of states) {
      if (s.kind !== 'stone') continue;
      const v = velOf(s.id).length();
      const ground = this.data.heightAt(s.pos[0], s.pos[2]);
      if (s.pos[1] - ground > s.shape.radius * 1.4 + 0.3) continue;
      rolling += Math.min(1, v / 12) * Math.min(1, s.shape.volume / 4);
      gravel += Math.min(1, v / 8) * 0.25;
    }
    this.rolling = Math.min(1, rolling);
    this.gravel = Math.min(1, gravel);
  }

  private squashHero(amount: number, live: boolean) {
    const id = live ? this.sim?.hero?.id : this.recording?.leader[Math.min(this.recording.leader.length - 1, Math.max(0, Math.round(this.replayT)))];
    if (id !== undefined) this.pieces.squash(id, amount);
  }

  private screenPan(p: Vector3): number {
    const v = p.clone().project(this.rig.camera);
    return clamp(v.x, -1, 1) * 0.7;
  }

  private screenPos(p: Vector3): { x: number; y: number } {
    const v = p.clone().project(this.rig.camera);
    const c = this.rig.renderer.domElement;
    return { x: clamp((v.x * 0.5 + 0.5) * c.clientWidth, 80, c.clientWidth - 80), y: clamp((-v.y * 0.5 + 0.5) * c.clientHeight - 40, 150, c.clientHeight - 170) };
  }

  private handleEvent(e: SimEvent, live: boolean) {
    const pos = new Vector3(...e.pos);
    const pan = this.screenPan(pos);
    const dist = pos.distanceTo(this.rig.camera.position);
    const att = clamp(40 / Math.max(10, dist), 0.3, 1);
    const fx = live || this.replaySpeed >= 1;
    const eff = this.w.effects;
    switch (e.type) {
      case 'breakoff':
        this.audio.fracture(0.8, 0);
        eff.dust(pos.clone().add(new Vector3(0, -0.5, 3)), 0.3);
        eff.grit(pos, 0.6);
        this.cam.shake(0.6);
        if (live) this.slowUntil = this.now + 0.7;
        break;
      case 'damage': {
        const sev = e.severity ?? 'minor';
        if (fx) {
          const sp = this.screenPos(pos);
          this.ui.damagePop(sp.x, sp.y, e.kg ?? 0, sev, e.label ?? '');
        }
        if (sev === 'major') {
          this.cam.shake(1);
          if (fx) this.ui.doFlash(0.3);
          if (live) {
            this.hitStopUntil = this.now + 0.1;
            this.slowUntil = this.now + 0.6;
            this.cam.punchIn(this.now);
          }
        } else if (sev === 'moderate') this.cam.shake(0.55);
        this.squashHero(sev === 'major' ? 0.4 : sev === 'moderate' ? 0.22 : 0.1, live);
        break;
      }
      case 'fracture':
        eff.ring(pos, 9 + e.intensity * 8, new Color(1, 0.93, 0.82));
        this.audio.fracture(e.intensity * att + 0.3, pan);
        eff.dust(pos, 0.6 + e.intensity * 0.6);
        eff.grit(pos, 1 + e.intensity);
        this.cam.shake(1);
        if (fx) this.ui.bigBanner('SPLIT', 'You carry on with the largest piece', 1600);
        break;
      case 'impact':
        this.audio.impact(Math.min(1, e.intensity * 1.3) * att, e.material === 'terrain' ? 'granite' : (e.material as 'granite'), pan);
        if (e.intensity > 0.3) eff.dust(pos, e.intensity * 0.45, e.material === 'wood' ? new Color(0.5, 0.42, 0.32) : e.material === 'snow' ? new Color(0.96, 0.98, 1) : undefined);
        if (e.intensity > 0.65 && e.material === 'terrain') eff.ring(pos, 4 + e.intensity * 4, new Color(0.92, 0.88, 0.8));
        if (e.intensity > 0.35) this.cam.shake(e.intensity * 0.45);
        break;
      case 'chip':
        this.audio.fracture(Math.min(1, e.intensity) * att * 0.7 + 0.1, pan);
        eff.grit(pos, 0.4 + e.intensity * 0.6);
        eff.dust(pos, 0.2 + e.intensity * 0.3);
        break;
      case 'splash':
        this.audio.splash(e.intensity * att + 0.2, pan);
        eff.splash(pos, e.intensity + 0.2);
        break;
      case 'tree': {
        const id = Number((e.objectId ?? 'tree:-1').slice(5));
        this.w.props.fell(id, e.dir ?? [0, 1]);
        this.audio.snap();
        this.audio.impact(0.7 * att, 'wood', pan);
        eff.shards(pos, new Color(0.25, 0.45, 0.18), 26);
        eff.shards(pos.clone().add(new Vector3(0, -1, 0)), new Color(0.55, 0.36, 0.2), 14);
        this.cam.shake(0.35);
        window.setTimeout(() => {
          this.audio.impact(0.8 * att, 'wood', pan);
          eff.dust(pos.clone().add(new Vector3((e.dir?.[0] ?? 0) * 8, -1, (e.dir?.[1] ?? 1) * 8)), 0.5, new Color(0.9, 0.85, 0.72));
        }, 650);
        break;
      }
      case 'smash':
        if (e.objectId) this.w.objects.smash(e.objectId, true);
        this.audio.snap();
        this.audio.impact(1, 'wood', pan);
        eff.shards(pos, new Color(0.5, 0.38, 0.25), 60);
        eff.dust(pos, 0.8, new Color(0.7, 0.62, 0.5));
        this.cam.shake(0.9);
        if (live) {
          this.hitStopUntil = this.now + 0.08;
          this.slowUntil = this.now + 0.5;
        }
        if (fx) this.ui.callout(`Smashed through the ${(e.label ?? '').toLowerCase()}`, 1800);
        break;
      case 'bowl':
        this.audio.impact(0.7 * att, 'granite', pan);
        eff.dust(pos, 0.4);
        break;
      case 'slump':
        if (e.objectId) this.w.objects.slump(e.objectId, true);
        eff.earth(pos, 1);
        this.audio.dig();
        break;
      case 'route':
        if (fx) this.ui.callout(e.label ?? '', 1600);
        break;
      case 'finish':
        if (fx) this.ui.bigBanner(this.level.finish.name.replace(/^the /, '').toUpperCase(), live && this.sim ? `${kg(this.sim.liveMass)} · ${pct(this.sim.liveMass / this.sim.startMass)}` : '', 2200);
        this.audio.finish(1);
        break;
    }
  }

  private finishRun() {
    const sim = this.sim!;
    const r = sim.result!;
    this.result = r;
    this.recording = sim.recording;
    const lp = levelProgress(this.progress, this.level.id);
    const rec = recordResult(this.progress, LEVELS, this.level, r);
    lp.lastTrail = r.trajectory.map((p) => [round2(p[0]), round2(p[1]), round2(p[2])] as [number, number, number]);
    this.progress.tutorial.released = true;
    saveProgress(this.progress);
    if (!r.finished) this.audio.finish(0);
    else if (MEDALS.indexOf(r.medal) >= 3) window.setTimeout(() => this.audio.finish(2), 900);
    const states = this.statesFromSim(sim);
    this.pieces.sync(states);
    const lead = sim.leader ? sim.pose(sim.leader).pos : states[0]?.pos;
    sim.dispose();
    this.sim = null;
    this.lastRecords = rec;
    if (!r.finished) this.ui.bigBanner(r.reason === 'stuck' ? 'STOPPED' : r.reason === 'lost' ? 'LOST' : 'OVER', r.cause, 2000);
    window.setTimeout(() => this.showAftermath(lead ? [new Vector3(...lead)] : []), r.finished ? 1200 : 1500);
  }
  private lastRecords: ReturnType<typeof recordResult> | null = null;

  private showAftermath(finalPositions: Vector3[]) {
    const r = this.result!;
    this.state = 'results';
    this.ui.hideRun();
    const end = finalPositions[0];
    if (end) {
      this.cam.subject.copy(end);
      this.cam.subjectYaw = this.courseYawAt(end.x, end.z);
      this.cam.orbitDist = Math.max(4, Math.min(16, 3 + r.size * 6));
      this.cam.setMode('orbit');
    } else {
      this.cam.setMode('aftermath');
      this.cam.frameAftermath(r.trajectory.slice(-12).map((p) => new Vector3(...p)));
    }
    this.drawTrails();
    this.addHitMarkers();
    const i = LEVELS.findIndex((l) => l.id === this.level.id);
    const next = LEVELS[i + 1];
    const lp = levelProgress(this.progress, this.level.id);
    this.ui.showResults(r, this.level, this.lastRecords!, lp, {
      hasNext: !!next && levelUnlocked(this.progress, LEVELS, i + 1),
      nextName: next?.name,
      compName: composition(r.composition).name,
      routeName: this.level.routes.find((q) => q.id === r.route)?.name ?? null,
      tip: explainRun(r, this.level, this.plan),
    });
    if (!this.progress.tutorial.reviewed) {
      this.progress.tutorial.reviewed = true;
      saveProgress(this.progress);
    }
  }

  private drawTrails() {
    this.w.trails.clear();
    const r = this.result;
    if (!r) return;
    this.w.trails.add(r.trajectory, new Color(1, 0.7, 0.3), 1.1, { opacity: 0.9 });
  }

  // ------------------------------------------------------------------ markers
  private clearMarkers() {
    for (const m of this.markerEls) m.el.remove();
    this.markerEls = [];
  }
  private addMarker(text: string, pos: Vector3, cls = '') {
    const el = document.createElement('div');
    el.className = `marker ${cls}`;
    el.textContent = text;
    this.markers.append(el);
    this.markerEls.push({ el, pos });
  }
  /** where the stone lost the most */
  private addHitMarkers() {
    this.clearMarkers();
    const hits = [...(this.result?.collisions ?? [])].filter((c) => c.severity !== 'minor').sort((a, b) => b.kg - a.kg).slice(0, 6);
    for (const c of hits) this.addMarker(`−${Math.round(c.kg).toLocaleString('en-US')} kg`, new Vector3(c.pos[0], c.pos[1] + 2, c.pos[2]), `hit sev-${c.severity}`);
  }
  private addPlanMarkers() {
    if (this.state !== 'plan') return;
    const [bx, bz] = this.level.boulder.position;
    this.addMarker(`${this.comp.name} · ${kg(this.massFor(this.progress.composition))}`, new Vector3(bx, this.data.heightAt(bx, bz) + this.level.boulder.radius * 2 + 2, bz), 'goal stone');
    const fz = this.level.finish.z + 8;
    const fx = this.level.finish.x ? (this.level.finish.x[0] + this.level.finish.x[1]) / 2 : this.coursePl ? pathDistance(this.coursePl, 0, fz).px : 0;
    this.addMarker(`Finish · ${this.level.finish.name}`, new Vector3(fx, this.data.heightAt(fx, fz) + 3, fz), 'goal');
    for (const o of this.level.objects) {
      const st = this.plan[o.id] ?? defaultState(o);
      const a = this.w.objects.anchorOf(o.id);
      if (!a) continue;
      if (o.type === 'branches' && st.type === 'branches' && !st.removed) this.addMarker(o.breakMomentum ? `Breakable · ${this.breakSpeed(o.breakMomentum)}` : 'Barrier', a.clone().add(new Vector3(0, 2, 0)), 'blocker');
    }
    if (this.routesOn)
      this.level.routes.forEach((r, i) => {
        // label the route where it passes its first gate
        const g = r.gates[0];
        const gz = g ? (g.z[0] + g.z[1]) / 2 : r.path[Math.floor(r.path.length / 2)][1];
        let p: [number, number] = r.path[0];
        for (let k = 0; k < r.path.length - 1; k++) {
          const a = r.path[k],
            b = r.path[k + 1];
          if (a[1] <= gz && b[1] >= gz) {
            const u = (gz - a[1]) / (b[1] - a[1] || 1);
            p = [a[0] + (b[0] - a[0]) * u, gz];
          }
        }
        const el = `route r${i % ROUTE_COLORS.length}`;
        this.addMarker(r.name, new Vector3(p[0], this.data.heightAt(p[0], p[1]) + 1, p[1]), el);
      });
  }
  private updateMarkers() {
    const c = this.rig.renderer.domElement;
    const hide = this.cam.surveying;
    for (const m of this.markerEls) {
      const v = m.pos.clone().project(this.rig.camera);
      const vis = !hide && v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 && m.pos.distanceTo(this.rig.camera.position) < 220;
      m.el.style.opacity = vis ? '1' : '0';
      m.el.style.left = `${(v.x * 0.5 + 0.5) * c.clientWidth}px`;
      m.el.style.top = `${(-v.y * 0.5 + 0.5) * c.clientHeight}px`;
    }
  }

  // ------------------------------------------------------------------ replay
  private startReplay() {
    if (!this.recording) return;
    this.state = 'replay';
    this.ui.hideResults();
    this.ui.showReplay();
    this.w.trails.clear();
    this.clearMarkers();
    this.w.effects.clear();
    this.replayT = 0;
    this.replayEventIdx = 0;
    this.resetObjectsView();
    this.replayLastF = 0;
    this.replayPlaying = true;
    this.replaySpeed = 1;
    this.cam.setMode('follow');
    this.applyReplayFrame(0, false);
  }

  private endReplay() {
    if (!this.result) return;
    this.ui.hideReplay();
    const last = this.recording!.frames - 1;
    this.applyReplayFrame(last, false);
    const lead = this.recording!.leader[last];
    const finals = this.sampleRecording(last).filter((s) => s.id === lead).map((s) => new Vector3(...s.pos));
    this.showAftermath(finals);
  }

  private scrub(frac: number) {
    if (this.state !== 'replay' || !this.recording) return;
    const f = frac * (this.recording.frames - 1);
    this.replayT = f;
    this.replayPlaying = false;
    const evs = this.recording.events;
    this.replayEventIdx = evs.findIndex((e) => e.step / RECORD_EVERY > f);
    if (this.replayEventIdx < 0) this.replayEventIdx = evs.length;
    this.applyReplayFrame(f, false);
  }

  private sampleRecording(f: number): PieceState[] {
    const rec = this.recording!;
    const out: PieceState[] = [];
    for (const t of rec.tracks) {
      const s = sampleTrack(t, f, rec.frames);
      if (s) out.push(s);
    }
    return out;
  }

  private applyReplayFrame(f: number, withEvents: boolean) {
    const rec = this.recording!;
    const states = this.sampleRecording(f);
    this.pieces.sync(states);
    const ahead = this.sampleRecording(Math.min(rec.frames - 1, f + 1));
    const vels = new Map<number, Vector3>();
    for (const s of states) {
      const n = ahead.find((a) => a.id === s.id);
      if (n) vels.set(s.id, new Vector3(n.pos[0] - s.pos[0], n.pos[1] - s.pos[1], n.pos[2] - s.pos[2]).multiplyScalar(60 / RECORD_EVERY));
    }
    const leader = rec.leader[Math.min(rec.leader.length - 1, Math.max(0, Math.round(f)))] ?? -1;
    this.followFrom(states, leader, (id) => vels.get(id) ?? new Vector3());
    if (f < this.replayLastF - 0.5) this.w.props.reset();
    this.replayLastF = f;
    for (const ch of rec.objectChanges) {
      if (ch.change === 'felled') {
        if (f >= ch.frame) this.w.props.fell(Number(ch.objectId.slice(5)), ch.dir ?? [0, 1], f - ch.frame > 15);
      } else if (ch.change === 'smashed') this.w.objects.smash(ch.objectId, f >= ch.frame, f - ch.frame < 2);
      else this.w.objects.slump(ch.objectId, f >= ch.frame);
    }
    if (withEvents) {
      const evs = rec.events;
      while (this.replayEventIdx < evs.length && evs[this.replayEventIdx].step / RECORD_EVERY <= f) {
        this.handleEvent(evs[this.replayEventIdx], false);
        this.replayEventIdx++;
      }
    }
  }

  private stepReplay(dt: number) {
    const rec = this.recording!;
    if (this.replayPlaying && !this.menuOpen) {
      this.replayT += dt * (60 / RECORD_EVERY) * this.replaySpeed;
      if (this.replayT >= rec.frames - 1) {
        this.replayT = rec.frames - 1;
        this.replayPlaying = false;
      }
      this.applyReplayFrame(this.replayT, true);
    }
    this.ui.setReplay(this.replayT / Math.max(1, rec.frames - 1), this.replayPlaying, this.replaySpeed);
  }

  // ------------------------------------------------------------------ menu & settings
  private openMenu() {
    this.menuOpen = true;
    this.ui.showMenu(this.progress.settings.sound, this.progress.settings.music, this.state === 'sim');
  }
  private closeMenu() {
    this.menuOpen = false;
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

    if (this.state === 'sim' && this.sim) this.stepSim(dt);
    else if (this.state === 'replay' && this.recording) this.stepReplay(dt);
    else {
      this.rolling *= Math.exp(-dt * 4);
      this.gravel *= Math.exp(-dt * 4);
    }

    const follow = this.state === 'sim' || this.state === 'replay' ? this.followInfo : undefined;
    this.cam.update(dt, this.now, follow);
    const look = this.cam.lookTarget;
    this.rig.focusShadows(look, this.cam.distance * 0.75 + 12);
    this.rig.setAtmosphere(look.z, dt);
    const w = this.w;
    w.objects.update(dt);
    w.props.update(dt);
    this.pieces.update(dt);
    w.water.update(dt);
    w.effects.update(dt);
    this.updateMarkers();

    let waterNear = 0;
    for (const p of w.water.soundPoints()) {
      const d = p.distanceTo(this.rig.camera.position);
      waterNear = Math.max(waterNear, clamp(1 - (d - 8) / 60, 0, 1));
    }
    const hero = this.sim?.hero;
    const hv = hero?.body.linvel();
    const speed = hv && this.state === 'sim' ? Math.hypot(hv.x, hv.y, hv.z) : 0;
    const heroSize = hero?.size ?? this.level.boulder.radius;
    this.audio.weight = Math.min(1, Math.sqrt(heroSize / this.level.boulder.radius));
    const fz = this.level.zones?.find((q) => q.id === 'falls')?.z[0] ?? -1e9;
    const fallsNear = clamp(1 - (Math.hypot(this.rig.camera.position.x, this.rig.camera.position.z - (fz + 10)) - 10) / 70, 0, 1);
    this.audio.update(dt, { waterNear, rolling: this.rolling, gravel: this.gravel, wind: 1, speed, size: heroSize, falls: fallsNear, sand: hero?.contactSurface === 'sand' });

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
      get plan() {
        return game.plan;
      },
      get level() {
        return game.level.id;
      },
      setPlan: (p: Plan) => {
        this.plan = sanitizePlan(this.level, p);
        this.w.objects.sync(this.plan, false);
        this.w.water.setActive(activeWater(this.level, this.plan), true);
        this.refreshChanges();
      },
      release: () => this.release(),
      fast: () => {
        this.fast = true;
      },
      select: (id: string | null) => this.select(id),
      action: (k: string) => this.doAction(k),
      begin: () => {
        this.ui.hideTitle();
        this.toPlanning();
      },
      mountains: () => this.showMountains(),
      load: (id: string) => this.pickLevel(id),
      composition: (id: CompositionId) => this.setComposition(id),
      survey: () => this.survey(),
      routes: () => {
        this.routesOn = !this.routesOn;
        this.updateRoutes();
      },
      replay: () => this.startReplay(),
      adjust: () => this.toPlanning(),
      snapCamera: () => this.cam.snap(),
      camInfo: () => {
        const h = this.sim?.hero?.body.translation();
        const c = this.rig.camera.position;
        return { mode: this.cam.mode, step: this.sim?.step, hero: h && [h.x, h.y, h.z].map((v) => +v.toFixed(1)), cam: [c.x, c.y, c.z].map((v) => +v.toFixed(1)) };
      },
      unlockAll: () => {
        for (const l of LEVELS) {
          const lp = levelProgress(this.progress, l.id);
          lp.finished = true;
          if (MEDALS.indexOf(lp.medal) < 3) lp.medal = 'gold';
        }
        saveProgress(this.progress);
      },
      look: (id: string, pitch = 0.32, dist = 70) => {
        this.ui.hideTitle();
        this.state = 'plan';
        this.cam.setMode('plan');
        this.goZone(id);
        this.cam.plan.pitch = pitch;
        this.cam.plan.dist = dist;
        this.cam.snap();
        for (let i = 0; i < 90; i++) this.rig.setAtmosphere(this.cam.lookTarget.z, 0.1);
      },
      finishNow: () => {
        if (!this.sim) return;
        while (!this.sim.done) this.sim.stepOnce();
        this.sim.drainEvents();
      },
    };
  }
}

function round2(v: number) {
  return Math.round(v * 100) / 100;
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

function sampleTrack(t: Track, f: number, frames: number): PieceState | null {
  const n = t.data.length / FRAME;
  if (n === 0) return null;
  const end = t.endFrame ?? frames - 1;
  if (f < t.startFrame || f > end + 0.001) return null;
  const local = Math.min(n - 1, Math.max(0, f - t.startFrame));
  const i = Math.floor(local);
  const j = Math.min(n - 1, i + 1);
  const u = local - i;
  const a = i * FRAME,
    b = j * FRAME;
  const d = t.data;
  const lerp = (k: number) => d[a + k] + (d[b + k] - d[a + k]) * u;
  let qx = d[b + 3],
    qy = d[b + 4],
    qz = d[b + 5],
    qw = d[b + 6];
  if (d[a + 3] * qx + d[a + 4] * qy + d[a + 5] * qz + d[a + 6] * qw < 0) {
    qx = -qx;
    qy = -qy;
    qz = -qz;
    qw = -qw;
  }
  const rx = d[a + 3] + (qx - d[a + 3]) * u,
    ry = d[a + 4] + (qy - d[a + 4]) * u,
    rz = d[a + 5] + (qz - d[a + 5]) * u,
    rw = d[a + 6] + (qw - d[a + 6]) * u;
  const l = Math.hypot(rx, ry, rz, rw) || 1;
  return { id: t.id, shape: t.shape, kind: t.kind, pos: [lerp(0), lerp(1), lerp(2)], quat: [rx / l, ry / l, rz / l, rw / l], scale: lerp(7), smooth: lerp(8) };
}

/** What happened, and what to try next. */
export function explainRun(r: SimResult, level: LevelDef, _plan: Plan): string {
  if (r.unstable) return 'The physics hiccuped — nothing you did. Go again.';
  if (!r.finished) {
    if (/Stopped dead by/.test(r.cause)) return 'It hit that barrier without enough momentum. Clear it as a move, carry more speed into it — or pick a heavier stone.';
    if (/Wedged/.test(r.cause)) return 'Too big for the gap. Lose a little mass on the way down, or take the long way round.';
    if (/mud|snow|momentum/.test(r.cause)) return 'Soft ground swallowed its speed. Keep more momentum, or choose a firmer line.';
    if (r.reason === 'lost') return 'It left the mountain. Lean earlier to hold the line.';
    return 'It came to rest before the bottom. Look for what stopped it and change the plan.';
  }
  const worst = [...r.collisions].sort((a, b) => b.kg - a.kg)[0];
  const m = level.medals;
  const next = r.retained < m.silver ? 'silver' : r.retained < m.gold ? 'gold' : r.retained < m.platinum ? 'platinum' : null;
  const need = next ? `${next[0].toUpperCase()}${next.slice(1)} needs ${pct(m[next])}.` : 'Platinum — the mountain barely touched you.';
  if (worst && worst.kg > r.massLost * 0.35 && worst.kg > r.startMass * 0.02)
    return `${worst.split ? 'Splitting on' : 'The hit on'} ${worst.against} cost ${kg(worst.kg)} — ${pct(worst.kg / r.massLost, 0)} of everything you lost. Steer round it, cushion it, or move it. ${need}`;
  if (r.abrasionLoss > r.massLost * 0.5) return `Most of the loss was wear — rough ground and water grinding at you. A softer line keeps more. ${need}`;
  const others = level.routes.filter((q) => q.id !== r.route).map((q) => q.name);
  return `${need}${others.length && next ? ` Have you tried the ${others[0]}?` : ''}`;
}
