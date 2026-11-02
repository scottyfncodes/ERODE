import { Color, Raycaster, Vector2, Vector3, type Object3D } from 'three';
import type RAPIER_T from '@dimforge/rapier3d-deterministic-compat';
import type { LevelDef, LevelObject, ObjectState, Plan } from '../levels/types';
import { loadLevelData, type LevelData } from '../sim/levelData';
import { Simulation, RECORD_EVERY, DT, type SimEvent, type SimResult, type Recording, type Track } from '../sim/simulation';
import { activeWater, clonePlan, countInterventions, defaultPlan, defaultState, isModified, sanitizePlan } from '../sim/plan';
import { createSceneRig, detectQuality, type SceneRig } from '../render/scene';
import { buildTerrain } from '../render/terrainView';
import { buildVegetation } from '../render/vegetation';
import { buildWater, type WaterView } from '../render/waterView';
import { ObjectsView } from '../render/objectsView';
import { Effects, PiecesView, Trails, type PieceState } from '../render/dynamicView';
import { shared } from '../render/materials';
import { CameraDirector } from './camera';
import { attachGestures } from './input';
import { loadProgress, saveProgress, levelProgress, type Progress } from './progress';
import { AudioEngine } from '../audio/audio';
import { UI, type ContextAction } from '../ui/ui';
import { clamp } from '../sim/geom';

type State = 'title' | 'plan' | 'sim' | 'results' | 'replay';
const deg = Math.PI / 180;

export class Game {
  private R: typeof RAPIER_T;
  private level: LevelDef;
  private data: LevelData;
  private rig: SceneRig;
  private cam: CameraDirector;
  private water: WaterView;
  private objects: ObjectsView;
  private pieces = new PiecesView();
  private effects: Effects;
  private trails: Trails;
  private ghost: Trails;
  private audio = new AudioEngine();
  private ui: UI;
  private markers: HTMLElement;
  private progress: Progress;
  private state: State = 'title';
  private plan: Plan;
  private sim: Simulation | null = null;
  private recording: Recording | null = null;
  private result: SimResult | null = null;
  private selected: string | null = null;
  private dragging: { id: string; offX: number; offZ: number } | null = null;
  private acc = 0;
  private timeScale = 1;
  private slowUntil = 0;
  private fast = false;
  private paused = false;
  private now = 0;
  private last = 0;
  private ghostOn = true;
  private replayT = 0;
  private replayPlaying = true;
  private replaySpeed = 1;
  private replayEventIdx = 0;
  private menuOpen = false;
  private markerEls: { el: HTMLElement; pos: Vector3 }[] = [];
  private raycaster = new Raycaster();
  private hadFirstRelease = false;
  private runStatusTimer = 0;
  /** headless test browsers render in software; don't let them degrade quality */
  private automation = navigator.webdriver === true;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement, markers: HTMLElement, R: typeof RAPIER_T, level: LevelDef, onProgress: (f: number, label: string) => void) {
    this.R = R;
    this.level = level;
    this.markers = markers;
    onProgress(0.15, 'Raising the mountain…');
    this.data = loadLevelData(level);
    const quality = detectQuality();
    this.rig = createSceneRig(canvas, level, quality);
    const scene = this.rig.scene;
    onProgress(0.35, 'Laying down the ground…');
    scene.add(buildTerrain(this.data, quality.far));
    onProgress(0.5, 'Growing the forest…');
    const avoid = [
      ...level.objects.map((o) => {
        const p = 'position' in o ? o.position : o.center;
        return { x: p[0], z: p[1], r: o.type === 'tree' ? 4 : 5 };
      }),
      ...level.formations.map((f) => ({ x: f.position[0], z: f.position[1], r: Math.max(f.size[0], f.size[2]) })),
    ];
    scene.add(buildVegetation(this.data, quality.trees, avoid).group);
    onProgress(0.7, 'Finding the water…');
    this.water = buildWater(this.data, this.rig.sunDir, this.rig.fogColor);
    scene.add(this.water.group);
    this.objects = new ObjectsView(this.data);
    scene.add(this.objects.group);
    scene.add(this.pieces.group);
    this.effects = new Effects(this.data.heightAt);
    scene.add(this.effects.group);
    this.trails = new Trails(this.data.heightAt);
    this.ghost = new Trails(this.data.heightAt);
    scene.add(this.trails.group, this.ghost.group);

    this.cam = new CameraDirector(this.rig.camera, level, this.data.heightAt);

    this.progress = loadProgress();
    this.audio.setSound(this.progress.settings.sound);
    this.audio.setMusic(this.progress.settings.music);
    const lp = levelProgress(this.progress, level.id);
    this.plan = lp.lastPlan ? sanitizePlan(level, lp.lastPlan) : defaultPlan(level);
    this.objects.sync(this.plan, false);
    this.water.setActive(activeWater(level, this.plan), true);
    this.objects.onChange = (id, kind, pos) => this.onObjectChange(id, kind, pos);

    this.ui = new UI(uiRoot, {
      begin: () => this.begin(),
      release: () => this.release(),
      reset: () => this.resetLevel(),
      menu: () => this.openMenu(),
      action: (k) => this.doAction(k),
      closeContext: () => this.select(null),
      replay: () => this.startReplay(),
      adjust: () => this.toPlanning(),
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
    });

    attachGestures(canvas, {
      enabled: () => this.state === 'plan' && !this.menuOpen,
      tap: (x, y) => this.tap(x, y),
      grab: (x, y) => this.grab(x, y),
      dragObject: (x, y) => this.dragTo(x, y),
      release: () => this.dropDrag(),
      pan: (dx, dy) => this.cam.pan(dx, dy, canvas.clientHeight),
      orbit: (dx, dy) => this.cam.rotate(-dx * 0.005, dy * 0.004),
      zoom: (f) => this.cam.zoom(f),
      hover: (x, y) => this.objects.setHover(this.pick(x, y)),
    });
    // unlock audio on the first touch anywhere
    const unlock = () => this.audio.unlock();
    // iOS only treats some events as user activation; listen to all of them
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

  start() {
    // show the boulder on its shelf in the title view
    this.showRestingBoulder();
    this.ui.showTitle(this.progress, this.level);
    this.state = 'title';
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
    this.effects.setViewportHeight(this.rig.renderer.domElement.clientHeight * Math.min(2, window.devicePixelRatio || 1));
  }

  private showRestingBoulder() {
    // A throwaway simulation gives the exact resting pose and shapes, without stepping.
    const s = new Simulation(this.R, this.level, this.plan);
    this.pieces.clear();
    this.pieces.sync(this.statesFromSim(s).filter((p) => p.kind === 'stone'));
    s.dispose();
  }

  private statesFromSim(s: Simulation): PieceState[] {
    const out: PieceState[] = [];
    for (const p of s.pieces.values()) {
      const t = p.body.translation();
      const r = p.body.rotation();
      out.push({
        id: p.id,
        shape: p.shape,
        kind: p.kind,
        pos: [t.x, t.y, t.z],
        quat: [r.x, r.y, r.z, r.w],
        scale: Math.cbrt(Math.max(0.01, p.volume / p.spawnVolume)),
      });
    }
    return out;
  }

  private ndc(x: number, y: number): Vector2 {
    const c = this.rig.renderer.domElement;
    return new Vector2((x / c.clientWidth) * 2 - 1, -(y / c.clientHeight) * 2 + 1);
  }

  private pick(x: number, y: number): string | null {
    this.raycaster.setFromCamera(this.ndc(x, y), this.rig.camera);
    const hits = this.raycaster.intersectObjects(this.objects.pickTargets() as Object3D[], false);
    if (hits.length) return hits[0].object.userData.objectId as string;
    // forgiving touch: nearest object anchor on screen within ~44px
    const c = this.rig.renderer.domElement;
    let best: string | null = null;
    let bestD = 46;
    for (const o of this.level.objects) {
      const a = this.objects.anchorOf(o.id);
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
        // refine
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

  // ------------------------------------------------------------------ flow
  private begin() {
    this.audio.unlock();
    this.audio.click();
    this.ui.hideTitle();
    this.toPlanning();
  }

  private toTitle() {
    this.closeMenu();
    if (this.sim) {
      this.sim.dispose();
      this.sim = null;
    }
    this.ui.hidePlanning();
    this.ui.hideRun();
    this.ui.hideResults();
    this.ui.hideReplay();
    this.clearMarkers();
    this.trails.clear();
    this.objects.setPlanning(false);
    this.objects.sync(this.plan, false);
    this.objects.slump('soil', false);
    this.showRestingBoulder();
    this.state = 'title';
    this.cam.setMode('intro');
    this.ui.showTitle(this.progress, this.level);
  }

  private toPlanning() {
    this.state = 'plan';
    this.ui.hideResults();
    this.ui.hideReplay();
    this.ui.hideRun();
    this.trails.clear();
    this.clearMarkers();
    this.effects.clear();
    for (const o of this.level.objects) if (o.type === 'soil') this.objects.slump(o.id, false);
    this.objects.setPlanning(true);
    this.objects.sync(this.plan, false);
    this.water.setActive(activeWater(this.level, this.plan));
    this.showRestingBoulder();
    this.cam.setMode('plan');
    this.ui.showPlanning(this.level);
    const lp = levelProgress(this.progress, this.level.id);
    this.ui.setObjectives(false, false);
    if (lp.completed) this.ui.setObjectives(true, true);
    this.refreshChanges();
    this.updateGhost();
    this.addGoalMarker();
    if (!this.progress.tutorial.selected) {
      const touch = window.matchMedia('(pointer: coarse)').matches;
      this.ui.tip(
        touch
          ? 'Tap a glowing object to change it. Drag to look around, pinch to zoom.'
          : 'Click a glowing object to change it. Drag to look around, scroll to zoom.',
      );
    }
    else if (!this.progress.tutorial.released) this.ui.tip('When you’re ready, press Release and watch.', 5000);
  }

  private refreshChanges() {
    this.ui.setChanges(this.interventions(), this.level.budget);
  }

  private updateGhost() {
    this.ghost.clear();
    const lp = levelProgress(this.progress, this.level.id);
    const available = !!lp.lastTrail && lp.lastTrail.length > 1;
    this.ui.setGhost(this.ghostOn, available);
    if (this.state === 'plan' && this.ghostOn && lp.lastTrail) {
      this.ghost.add(lp.lastTrail, new Color(1, 0.93, 0.8), 0.9, { dashed: true, opacity: 0.55 });
    }
  }

  private resetLevel() {
    this.audio.click();
    if (this.state !== 'plan') this.toPlanning();
    this.plan = defaultPlan(this.level);
    this.objects.sync(this.plan, true);
    this.water.setActive(activeWater(this.level, this.plan));
    this.select(null);
    this.refreshChanges();
    this.cam.resetPlan();
    this.ui.tip('The mountain is as you found it.', 2200);
  }

  // ------------------------------------------------------------------ selection & actions
  private select(id: string | null) {
    this.selected = id;
    this.objects.setSelected(id);
    if (!id) {
      this.ui.hideContext();
      return;
    }
    if (!this.progress.tutorial.selected) {
      this.progress.tutorial.selected = true;
      saveProgress(this.progress);
      this.ui.tip(null);
    }
    // bring an object near the edge of the screen into view (the context card covers the bottom)
    const a = this.objects.anchorOf(id);
    if (a && !this.dragging) {
      const v = a.clone().project(this.rig.camera);
      if (Math.abs(v.x) > 0.5 || v.y < -0.15 || v.y > 0.6) this.cam.focusOn(a);
    }
    this.renderContext();
  }

  private renderContext() {
    const id = this.selected;
    if (!id) return;
    const o = this.obj(id);
    const st = this.plan[id] ?? defaultState(o);
    const modified = isModified(o, st);
    const can = this.canModify(id);
    const locked = !can;
    const acts: ContextAction[] = [];
    let tag = '';
    let text = o.hint;
    let note: string | undefined;
    switch (o.type) {
      case 'rock': {
        const s = st as Extract<ObjectState, { type: 'rock' }>;
        tag = 'Move · Remove';
        acts.push(s.removed ? { key: 'restore', label: 'Put it back', icon: 'undo' } : { key: 'remove', label: 'Remove stone', primary: true, disabled: locked });
        if (!s.removed && modified) acts.push({ key: 'restore', label: 'Return', icon: 'undo' });
        note = s.removed ? undefined : `Drag the stone to move it (within ${o.moveRadius} m).`;
        break;
      }
      case 'log': {
        const s = st as Extract<ObjectState, { type: 'log' }>;
        tag = 'Rotate · Drag';
        const a = Math.round((((s.yaw / deg) % 180) + 180) % 180);
        const desc =
          Math.abs(a - 90) < 16
            ? 'it lies along the slope — the way is open'
            : a < 16 || a > 164
              ? 'it lies straight across — a barrier'
              : a < 90
                ? 'it is angled to steer the boulder right'
                : 'it is angled to steer the boulder left';
        text = `${o.hint} Now ${desc}.`;
        acts.push({ key: 'rotL', label: '15°', icon: 'rotL', disabled: locked, repeat: true }, { key: 'rotR', label: '15°', icon: 'rotR', disabled: locked, repeat: true });
        if (modified) acts.push({ key: 'restore', label: 'Restore', icon: 'undo' });
        note = `Drag the log to move it (within ${o.moveRadius} m).`;
        break;
      }
      case 'branches': {
        const s = st as Extract<ObjectState, { type: 'branches' }>;
        tag = 'Remove';
        acts.push(s.removed ? { key: 'restore', label: 'Put it back', icon: 'undo' } : { key: 'remove', label: 'Clear the deadfall', primary: true, disabled: locked });
        break;
      }
      case 'tree': {
        const s = st as Extract<ObjectState, { type: 'tree' }>;
        tag = 'Fell';
        for (const f of o.fellOptions) acts.push({ key: `fell:${f.id}`, label: f.label, active: s.felled === f.id, disabled: locked && s.felled !== f.id, primary: !s.felled && f.id === o.fellOptions[0].id });
        if (s.felled) acts.push({ key: 'restore', label: 'Let it stand', icon: 'undo' });
        break;
      }
      case 'soil': {
        const s = st as Extract<ObjectState, { type: 'soil' }>;
        tag = 'Dig';
        acts.push(s.dug ? { key: 'restore', label: 'Heap it back', icon: 'undo' } : { key: 'dig', label: 'Dig it out', primary: true, disabled: locked });
        const soaked = o.saturatedBy && activeWater(this.level, this.plan).has(o.saturatedBy);
        if (!s.dug) note = soaked ? 'Water is soaking this bank — it will slump when struck.' : 'Dry and firm. Running water would soften it.';
        break;
      }
      case 'outcrop': {
        const s = st as Extract<ObjectState, { type: 'outcrop' }>;
        tag = 'Fracture';
        acts.push(s.split ? { key: 'restore', label: 'Restore', icon: 'undo' } : { key: 'split', label: 'Split the spur', primary: true, disabled: locked });
        break;
      }
      case 'ice': {
        const s = st as Extract<ObjectState, { type: 'ice' }>;
        tag = 'Break';
        acts.push(s.broken ? { key: 'restore', label: 'Let it freeze', icon: 'undo' } : { key: 'break', label: 'Break the ice', primary: true, disabled: locked });
        break;
      }
      case 'gate': {
        const s = st as Extract<ObjectState, { type: 'gate' }>;
        tag = 'Redirect';
        for (const op of o.options) acts.push({ key: `gate:${op.id}`, label: op.label, active: s.option === op.id, disabled: locked && s.option !== op.id });
        break;
      }
    }
    if (locked) note = `You’ve used all ${this.level.budget} changes. Restore one to free it up.`;
    this.ui.showContext(o.name, tag, text, acts, note);
  }

  private setState(id: string, s: ObjectState, animate = true) {
    this.plan[id] = s;
    this.objects.sync(this.plan, animate);
    this.water.setActive(activeWater(this.level, this.plan));
    this.refreshChanges();
    this.renderContext();
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
          // snap to 15° steps
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
            // re-fell: stand it back up first, instantly
            this.plan[id] = { type: 'tree', felled: null };
            this.objects.sync(this.plan, false);
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
    switch (kind) {
      case 'lift':
        this.audio.grind();
        this.effects.dust(pos, 0.2, new Color(0.5, 0.42, 0.32));
        break;
      case 'snap':
        this.audio.snap();
        this.effects.shards(pos, new Color(0.45, 0.36, 0.25), 40);
        break;
      case 'fell':
        this.audio.treeFall();
        window.setTimeout(() => {
          const a = this.objects.anchorOf(id);
          if (a) this.effects.dust(a, 0.6, new Color(0.55, 0.5, 0.4));
          this.cam.shake(0.25);
        }, 1300);
        break;
      case 'dig':
        this.audio.dig();
        this.effects.earth(pos, 0.8);
        break;
      case 'split':
        this.audio.fracture(0.6);
        this.effects.dust(pos, 0.7);
        this.effects.grit(pos, 0.6);
        window.setTimeout(() => this.cam.shake(0.3), 600);
        break;
      case 'shatter':
        this.audio.shatter();
        this.effects.shards(pos, new Color(0.85, 0.93, 1), 60);
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
      this.ui.tip(`You’ve used all ${this.level.budget} changes. Restore one to free it up.`, 2500);
      return true; // swallow the drag so the camera doesn't jump
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
    this.objects.sync(this.plan, false);
    this.refreshChanges();
  }

  private dropDrag() {
    if (!this.dragging) return;
    const o = this.obj(this.dragging.id);
    this.audio.impact(0.3, o.type === 'log' ? 'wood' : 'granite');
    const a = this.objects.anchorOf(this.dragging.id);
    if (a) this.effects.dust(a, 0.15, new Color(0.5, 0.45, 0.36));
    this.dragging = null;
    this.renderContext();
  }

  private key(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (this.menuOpen) this.closeMenu();
      else if (this.selected) this.select(null);
      else this.openMenu();
    }
    if (this.state === 'plan' && (e.key === ' ' || e.key === 'Enter') && !this.menuOpen) {
      e.preventDefault();
      this.release();
    }
    if (this.state === 'sim' && e.key === ' ') this.togglePause();
    if (this.state === 'plan' && this.selected && this.obj(this.selected).type === 'log') {
      if (e.key === 'q' || e.key === 'ArrowLeft') this.doAction('rotL');
      if (e.key === 'e' || e.key === 'ArrowRight') this.doAction('rotR');
    }
  }

  // ------------------------------------------------------------------ the run
  private release() {
    if (this.state !== 'plan') return;
    this.audio.unlock();
    this.select(null);
    this.ui.tip(null);
    this.ui.hidePlanning();
    this.clearMarkers();
    this.ghost.clear();
    this.objects.setPlanning(false);
    try {
      this.sim?.dispose();
      this.sim = new Simulation(this.R, this.level, clonePlan(this.plan));
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
    this.effects.clear();
    this.pieces.clear();
    this.cam.setMode('follow');
    this.ui.showRun();
    this.audio.release();
    this.ui.callout('Released', 1400);
    this.hadFirstRelease = true;
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
    if (this.now < this.slowUntil && !this.fast) scale = 0.32;
    this.timeScale += (scale - this.timeScale) * Math.min(1, dt * 8);
    this.acc += dt * this.timeScale;
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
    this.followFrom(states, sim);
    this.runStatusTimer -= dt;
    if (this.runStatusTimer <= 0) {
      this.runStatusTimer = 0.1;
      let stones = 0;
      for (const p of sim.pieces.values()) if (p.kind === 'stone') stones++;
      this.ui.setRunStatus(sim.step * DT, sim.fractureCount, sim.deliveredSoFar, stones);
    }
    if (sim.done) this.finishRun();
  }

  private lastFocus = new Vector3();
  private followFrom(states: PieceState[], sim?: Simulation, vels?: Map<number, Vector3>) {
    // focus on moving stone, weighted by size; follow the primary when everything is still
    let wsum = 0;
    const focus = new Vector3();
    const vel = new Vector3();
    let primary: PieceState | undefined;
    for (const s of states) {
      if (s.kind !== 'stone') continue;
      let v: Vector3;
      if (sim) {
        const p = sim.pieces.get(s.id)!;
        const lv = p.body.linvel();
        v = new Vector3(lv.x, lv.y, lv.z);
      } else v = vels?.get(s.id) ?? new Vector3();
      const w = s.shape.volume * (0.2 + Math.min(1, v.length() / 3));
      if (!primary || s.shape.volume > primary.shape.volume) primary = s;
      focus.addScaledVector(new Vector3(...s.pos), w);
      vel.addScaledVector(v, w);
      wsum += w;
    }
    if (wsum <= 0) return;
    focus.multiplyScalar(1 / wsum);
    vel.multiplyScalar(1 / wsum);
    let spread = 0;
    for (const s of states) if (s.kind === 'stone') spread = Math.max(spread, Math.min(24, focus.distanceTo(new Vector3(...s.pos))));
    this.lastFocus.copy(focus);
    this.followInfo = { focus, vel, spread };
    // sound of rolling stone
    let rolling = 0;
    let gravel = 0;
    for (const s of states) {
      if (s.kind !== 'stone') continue;
      const v = sim ? (() => { const l = sim.pieces.get(s.id)!.body.linvel(); return Math.hypot(l.x, l.y, l.z); })() : vels?.get(s.id)?.length() ?? 0;
      const ground = this.data.heightAt(s.pos[0], s.pos[2]);
      const onGround = s.pos[1] - ground < s.shape.radius * 1.4 + 0.3;
      if (!onGround) continue;
      rolling += Math.min(1, v / 10) * Math.min(1, s.shape.volume / 4);
      gravel += Math.min(1, v / 6) * 0.25;
    }
    this.rolling = Math.min(1, rolling);
    this.gravel = Math.min(1, gravel);
  }
  private followInfo: { focus: Vector3; vel: Vector3; spread: number } | undefined;
  private rolling = 0;
  private gravel = 0;

  private screenPan(p: Vector3): number {
    const v = p.clone().project(this.rig.camera);
    return clamp(v.x, -1, 1) * 0.7;
  }

  private handleEvent(e: SimEvent, live: boolean) {
    const pos = new Vector3(...e.pos);
    const pan = this.screenPan(pos);
    const dist = pos.distanceTo(this.rig.camera.position);
    const att = clamp(30 / Math.max(10, dist), 0.25, 1);
    switch (e.type) {
      case 'fracture': {
        this.audio.fracture(e.intensity * att + 0.2, pan);
        this.effects.dust(pos, 0.5 + e.intensity * 0.7);
        this.effects.grit(pos, 0.5 + e.intensity * 0.6);
        this.cam.shake(0.4 + e.intensity * 0.6);
        if (live || this.replaySpeed >= 1) {
          this.cam.punchIn(this.now);
          if (live) this.slowUntil = this.now + 0.75;
        }
        const n = e.pieces?.length ?? 0;
        this.ui.callout(`Fractured against ${e.label} — ${n} pieces`, 2400);
        break;
      }
      case 'impact':
        this.audio.impact(e.intensity * att, e.material === 'terrain' ? 'granite' : (e.material as 'granite'), pan);
        if (e.intensity > 0.25) this.effects.dust(pos, e.intensity * 0.5, e.material === 'wood' ? new Color(0.5, 0.42, 0.32) : undefined);
        if (e.intensity > 0.5) this.cam.shake(e.intensity * 0.3);
        break;
      case 'chip':
        this.audio.impact(0.4 * att, 'granite', pan);
        this.effects.grit(pos, 0.25);
        break;
      case 'splash':
        this.audio.splash(e.intensity * att + 0.15, pan);
        this.effects.splash(pos, e.intensity);
        break;
      case 'deliver':
        if (e.intensity > 0.08) this.ui.callout(`${Math.round(e.intensity * 100)}% into the stream`, 1600);
        break;
      case 'slump':
        if (e.objectId) this.objects.slump(e.objectId, true);
        this.effects.earth(pos, 1);
        this.audio.dig();
        this.ui.callout('The soaked bank gives way', 2000);
        break;
    }
  }

  private finishRun() {
    const sim = this.sim!;
    const r = sim.result!;
    this.result = r;
    this.recording = sim.recording;
    const lp = levelProgress(this.progress, this.level.id);
    const firstClear = r.success && !lp.completed;
    if (r.success) lp.completed = true;
    lp.stars = Math.max(lp.stars, r.stars);
    lp.bestDelivered = Math.max(lp.bestDelivered, r.success ? r.deliveredFraction : 0);
    lp.lastTrail = r.trajectory.map((p) => [round2(p[0]), round2(p[1]), round2(p[2])] as [number, number, number]);
    saveProgress(this.progress);
    // final positions for the aftermath framing
    const states = this.statesFromSim(sim);
    this.pieces.sync(states);
    sim.dispose();
    this.sim = null;
    this.showAftermath(states.map((s) => new Vector3(...s.pos)));
    if (firstClear) window.setTimeout(() => this.ui.callout('The stream has the first of the mountain', 2600), 300);
  }

  private showAftermath(finalPositions: Vector3[]) {
    const r = this.result!;
    this.state = 'results';
    this.ui.hideRun();
    this.cam.setMode('aftermath');
    const pts = [...finalPositions, ...r.trajectory.map((p) => new Vector3(...p))];
    this.cam.frameAftermath(pts);
    this.drawTrails();
    this.addFractureMarkers();
    const lp = levelProgress(this.progress, this.level.id);
    this.ui.setObjectives(r.fractureGoalMet, r.massGoalMet);
    this.ui.showResults(r, this.level, explain(r, this.level), { stars: lp.stars, delivered: lp.bestDelivered });
    if (!this.progress.tutorial.reviewed) {
      this.progress.tutorial.reviewed = true;
      this.progress.tutorial.released = true;
      saveProgress(this.progress);
      window.setTimeout(() => this.ui.tip('The bright line is the stone’s path. Change the mountain and try again.', 6000), 1200);
    }
  }

  private drawTrails() {
    this.trails.clear();
    const rec = this.recording;
    const r = this.result;
    if (!rec || !r) return;
    for (const t of rec.tracks) {
      if (t.kind !== 'stone' || t.shape.radius < 0.35) continue;
      const pts: [number, number, number][] = [];
      for (let i = 0; i < t.data.length; i += 8 * 3) pts.push([t.data[i], t.data[i + 1], t.data[i + 2]]);
      this.trails.add(pts, new Color(0.95, 0.9, 0.82), 0.35, { opacity: 0.45 });
    }
    this.trails.add(r.trajectory, new Color(1, 0.8, 0.5), 1.0, { opacity: 0.9 });
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
  private addFractureMarkers() {
    this.clearMarkers();
    this.result?.fractures.forEach((f, i) => this.addMarker(String(i + 1), new Vector3(...f.pos)));
    this.addGoalMarker();
  }
  private addGoalMarker() {
    const w = this.data.water.find((x) => x.spec.goal);
    if (!w) return;
    const x = 0;
    const z = 38.2;
    this.addMarker('The stream', new Vector3(x, this.data.heightAt(x, z) + 2.4, z), 'goal');
    if (this.state === 'plan') {
      const [bx, bz] = this.level.boulder.position;
      this.addMarker('The boulder', new Vector3(bx, this.data.heightAt(bx, bz) + this.level.boulder.radius * 2 + 1.8, bz), 'goal stone');
    }
  }
  private updateMarkers() {
    const c = this.rig.renderer.domElement;
    for (const m of this.markerEls) {
      const v = m.pos.clone().project(this.rig.camera);
      const vis = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
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
    this.trails.clear();
    this.clearMarkers();
    this.effects.clear();
    this.replayT = 0;
    this.replayEventIdx = 0;
    this.replayPlaying = true;
    this.replaySpeed = 1;
    for (const o of this.level.objects) if (o.type === 'soil') this.objects.slump(o.id, false);
    this.cam.setMode('follow');
    this.applyReplayFrame(0, false);
  }

  private endReplay() {
    if (!this.result) return;
    this.ui.hideReplay();
    // show the final state again
    const last = this.recording!.frames - 1;
    this.applyReplayFrame(last, false);
    const finals = this.sampleRecording(last).map((s) => new Vector3(...s.pos));
    this.showAftermath(finals);
  }

  private scrub(frac: number) {
    if (this.state !== 'replay' || !this.recording) return;
    const f = frac * (this.recording.frames - 1);
    this.replayT = f;
    this.replayPlaying = false;
    // re-sync events to the new time without replaying them
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
    // velocities by finite difference for the camera
    const ahead = this.sampleRecording(Math.min(rec.frames - 1, f + 1));
    const vels = new Map<number, Vector3>();
    for (const s of states) {
      const n = ahead.find((a) => a.id === s.id);
      if (n) vels.set(s.id, new Vector3(n.pos[0] - s.pos[0], n.pos[1] - s.pos[1], n.pos[2] - s.pos[2]).multiplyScalar(60 / RECORD_EVERY));
    }
    this.followFrom(states, undefined, vels);
    // object changes (soil slumps)
    for (const ch of rec.objectChanges) this.objects.slump(ch.objectId, f >= ch.frame);
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
    this.objects.update(dt);
    this.water.update(dt);
    this.effects.update(dt);
    this.updateMarkers();

    // ambience: how close is running water to what we're looking at
    let waterNear = 0;
    for (const p of this.water.soundPoints()) {
      const d = p.distanceTo(this.rig.camera.position);
      waterNear = Math.max(waterNear, clamp(1 - (d - 8) / 60, 0, 1));
    }
    this.audio.update(dt, { waterNear, rolling: this.rolling, gravel: this.gravel, wind: 1 });

    this.rig.renderer.render(this.rig.scene, this.rig.camera);
    if (!document.hidden && !this.automation) this.rig.adapt(dt);
    void this.hadFirstRelease;
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
      setPlan: (p: Plan) => {
        this.plan = sanitizePlan(this.level, p);
        this.objects.sync(this.plan, false);
        this.water.setActive(activeWater(this.level, this.plan), true);
        this.refreshChanges();
      },
      release: () => this.release(),
      fast: () => {
        this.fast = true;
      },
      select: (id: string | null) => this.select(id),
      action: (k: string) => this.doAction(k),
      begin: () => this.begin(),
      replay: () => this.startReplay(),
      adjust: () => this.toPlanning(),
      snapCamera: () => this.cam.snap(),
    };
  }
}

function round2(v: number) {
  return Math.round(v * 100) / 100;
}

function sampleTrack(t: Track, f: number, frames: number): PieceState | null {
  const n = t.data.length / 8;
  if (n === 0) return null;
  const end = t.endFrame ?? frames - 1;
  if (f < t.startFrame || f > end + 0.001) {
    // tracks that end by fracturing vanish; others (lost, carried) too
    return null;
  }
  const local = Math.min(n - 1, Math.max(0, f - t.startFrame));
  const i = Math.floor(local);
  const j = Math.min(n - 1, i + 1);
  const u = local - i;
  const a = i * 8,
    b = j * 8;
  const d = t.data;
  const lerp = (k: number) => d[a + k] + (d[b + k] - d[a + k]) * u;
  // quaternion nlerp with sign fix
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
  return {
    id: t.id,
    shape: t.shape,
    kind: t.kind,
    pos: [lerp(0), lerp(1), lerp(2)],
    quat: [rx / l, ry / l, rz / l, rw / l],
    scale: lerp(7),
  };
}

/** Plain-language explanation of what happened and why. */
export function explain(r: SimResult, level: LevelDef): string {
  if (r.unstable) return 'The simulation became unstable. Nothing you did was wrong — release again.';
  const parts: string[] = [];
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  if (r.success) {
    parts.push(`${pct(r.deliveredFraction)} of the boulder reached the stream after ${r.fractures.length} fracture${r.fractures.length === 1 ? '' : 's'}.`);
    if (r.stars < 3) {
      if (r.deliveredFraction < level.stars.deliveredFraction) parts.push(`Deliver ${pct(level.stars.deliveredFraction)} for another star — look for where fragments got stranded.`);
      if (r.interventions > level.stars.maxInterventions) parts.push(`Try it with ${level.stars.maxInterventions} changes or fewer.`);
    }
    return parts.join(' ');
  }
  if (!r.fractureGoalMet) {
    if (r.deliveredFraction > 0) parts.push('The boulder reached the stream whole. It needs to strike something hard on the way — rock, not soil or wood.');
    else parts.push(`The boulder came to rest at ${r.destination} without breaking.`);
  } else if (!r.massGoalMet) {
    parts.push(`It broke, but only ${pct(r.deliveredFraction)} reached the stream. Most of the stone is resting at ${r.destination}.`);
    parts.push('Clear a way for the fragments, or give them water to ride.');
  }
  return parts.join(' ');
}
