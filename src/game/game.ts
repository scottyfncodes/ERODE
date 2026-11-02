import { Color, Raycaster, Vector2, Vector3, type Object3D } from 'three';
import type RAPIER_T from '@dimforge/rapier3d-deterministic-compat';
import type { LevelDef, LevelObject, ObjectState, Plan } from '../levels/types';
import { loadLevelData, type LevelData } from '../sim/levelData';
import { Simulation, RECORD_EVERY, FRAME, DT, STAGES, stageOf, restingBoulder, type SimEvent, type SimResult, type Recording, type Track } from '../sim/simulation';
import { activeWater, clonePlan, countInterventions, defaultPlan, defaultState, isModified, sanitizePlan } from '../sim/plan';
import { createSceneRig, detectQuality, type SceneRig } from '../render/scene';
import { buildTerrain } from '../render/terrainView';
import { buildVegetation } from '../render/vegetation';
import { buildWater, type WaterView } from '../render/waterView';
import { ObjectsView } from '../render/objectsView';
import { Effects, PiecesView, Trails, type PieceState } from '../render/dynamicView';
import { PropsView } from '../render/propsView';
import { layoutProps } from '../sim/props';
import { shared } from '../render/materials';
import { CameraDirector } from './camera';
import { attachGestures } from './input';
import { loadProgress, saveProgress, levelProgress, type Progress } from './progress';
import { AudioEngine } from '../audio/audio';
import { UI, sizeLabel, type ContextAction } from '../ui/ui';
import { clamp, makePolyline, pathDistance } from '../sim/geom';

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
  private props!: PropsView;
  private replayLastF = 0;
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
    this.props = new PropsView(layoutProps(level, this.data));
    scene.add(this.props.group);
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
      adjust: () => this.startRun(),
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
      zone: (id) => this.goZone(id),
      nudge: (d) => this.nudge(d),
      steer: (d) => (this.steerButtons = d),
    });
    // during a run: drag anywhere — left/right of where you touched — to steer
    let drag: { id: number; x: number } | null = null;
    canvas.addEventListener('pointerdown', (e) => {
      if (this.state === 'sim') drag = { id: e.pointerId, x: e.clientX };
    });
    canvas.addEventListener('pointermove', (e) => {
      if (this.state !== 'sim' || !drag || drag.id !== e.pointerId) return;
      // full lock at ~10% of the screen width, with a small dead zone; the anchor follows
      // the thumb past full lock so reversing is instant
      const w = Math.max(320, canvas.clientWidth);
      const range = w * 0.1;
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
    this.cam.baseFov = this.rig.camera.fov;
    this.effects.setViewportHeight(this.rig.renderer.domElement.clientHeight * Math.min(2, window.devicePixelRatio || 1));
  }

  private showRestingBoulder() {
    const b = restingBoulder(this.level);
    this.pieces.clear();
    this.pieces.sync([{ id: 1, shape: b.shape, kind: 'stone', pos: b.pos, quat: [0, 0, 0, 1], scale: 1 }]);
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
    this.startRun();
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
    for (const o of this.level.objects) if (o.type === 'soil') this.objects.slump(o.id, false);
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
    this.refreshChanges();
    this.updateGhost();
    this.addGoalMarker();
    if (!this.progress.tutorial.selected) {
      const touch = window.matchMedia('(pointer: coarse)').matches;
      this.ui.tip(
        touch
          ? 'Tap the glowing objects: red ones block the run, orange ones smash it. Swipe to fly down the mountain.'
          : 'Click the glowing objects: red ones block the run, orange ones smash it. Drag to fly down the mountain.',
      );
    } else if (!this.progress.tutorial.released) this.ui.tip('Hit BREAK IT LOOSE and see how far it goes.', 5000);
  }

  /** Fly the planning camera to a stretch of the course. */
  private goZone(id: string) {
    const z = this.level.zones?.find((q) => q.id === id);
    if (!z) return;
    const zc = (z.z[0] + z.z[1]) / 2;
    const course = this.level.terrain.course;
    let x = 0;
    if (course) {
      for (let i = 0; i < course.length - 1; i++)
        if (course[i][1] <= zc && course[i + 1][1] >= zc) {
          const u = (zc - course[i][1]) / (course[i + 1][1] - course[i][1]);
          x = course[i][0] + (course[i + 1][0] - course[i][0]) * u;
        }
    }
    this.audio.click();
    this.cam.focusOn(new Vector3(x, this.data.heightAt(x, zc), zc), Math.max(55, (z.z[1] - z.z[0]) * 0.55));
  }

  private zoneAt(z: number): { id: string; name: string } | null {
    for (const q of this.level.zones ?? []) if (z >= q.z[0] && z < q.z[1]) return q;
    return null;
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
    let kind: 'smash' | 'block' | 'tweak' = 'tweak';
    switch (o.type) {
      case 'rock': {
        const s = st as Extract<ObjectState, { type: 'rock' }>;
        tag = 'Tweak · Drag to move';
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
        tag = s.removed ? 'Blocker · cleared' : 'Blocker';
        kind = 'block';
        acts.push(s.removed ? { key: 'restore', label: 'Put it back', icon: 'undo' } : { key: 'remove', label: o.style === 'logjam' ? 'Blast it clear' : 'Clear it', primary: true, disabled: locked });
        break;
      }
      case 'tree': {
        const s = st as Extract<ObjectState, { type: 'tree' }>;
        tag = 'Tweak · Fell';
        for (const f of o.fellOptions) acts.push({ key: `fell:${f.id}`, label: f.label, active: s.felled === f.id, disabled: locked && s.felled !== f.id, primary: !s.felled && f.id === o.fellOptions[0].id });
        if (s.felled) acts.push({ key: 'restore', label: 'Let it stand', icon: 'undo' });
        break;
      }
      case 'soil': {
        const s = st as Extract<ObjectState, { type: 'soil' }>;
        tag = s.dug ? 'Blocker · cleared' : 'Blocker';
        kind = 'block';
        acts.push(s.dug ? { key: 'restore', label: 'Heap it back', icon: 'undo' } : { key: 'dig', label: 'Dig it out', primary: true, disabled: locked });
        const soaked = o.saturatedBy && activeWater(this.level, this.plan).has(o.saturatedBy);
        if (!s.dug) note = soaked ? 'Water is soaking this bank — it will slump when struck.' : 'Dry and firm. Running water would soften it.';
        break;
      }
      case 'outcrop': {
        const s = st as Extract<ObjectState, { type: 'outcrop' }>;
        tag = s.split ? 'Smasher · in the line' : 'Smasher';
        kind = 'smash';
        acts.push(s.split ? { key: 'restore', label: 'Move it back', icon: 'undo' } : { key: 'split', label: o.actionLabel ?? 'Split it', primary: true, disabled: locked });
        break;
      }
      case 'ice': {
        const s = st as Extract<ObjectState, { type: 'ice' }>;
        tag = 'Tweak · Speed';
        acts.push(s.broken ? { key: 'restore', label: 'Let it freeze', icon: 'undo' } : { key: 'break', label: 'Break the ice', primary: true, disabled: locked });
        break;
      }
      case 'gate': {
        const s = st as Extract<ObjectState, { type: 'gate' }>;
        const blocked = o.options.length && s.option === o.initial;
        tag = blocked ? 'Blocker · water' : 'Water · redirected';
        kind = blocked ? 'block' : 'tweak';
        for (const op of o.options) acts.push({ key: `gate:${op.id}`, label: op.label, active: s.option === op.id, disabled: locked && s.option !== op.id });
        break;
      }
    }
    if (locked) note = `You’ve used all ${this.level.budget} moves. Undo one to free it up.`;
    this.ui.showContext(o.name, tag, text, acts, note, kind);
  }

  private setState(id: string, s: ObjectState, animate = true) {
    this.plan[id] = s;
    this.objects.sync(this.plan, animate);
    this.water.setActive(activeWater(this.level, this.plan));
    this.refreshChanges();
    this.renderContext();
    window.setTimeout(() => {
      if (this.state !== 'plan') return;
      this.clearMarkers();
      this.addGoalMarker();
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
    if ((this.state === 'results' || this.state === 'title') && e.key === 'Enter' && !this.menuOpen) {
      e.preventDefault();
      if (this.state === 'title') this.begin();
      else this.startRun();
    }
    if (this.state === 'sim' && e.key === ' ') this.togglePause();
    if (e.key === 'ArrowLeft' || e.key === 'a') this.steerKeys.left = true;
    if (e.key === 'ArrowRight' || e.key === 'd') this.steerKeys.right = true;
    if (this.state === 'plan' && this.selected && this.obj(this.selected).type === 'log') {
      if (e.key === 'q' || e.key === 'ArrowLeft') this.doAction('rotL');
      if (e.key === 'e' || e.key === 'ArrowRight') this.doAction('rotR');
    }
  }

  // ------------------------------------------------------------------ the run
  private release() {
    if (this.state !== 'plan') return;
    this.startRun();
  }

  /** Straight into a run: the boulder breaks off the summit and you steer. */
  private startRun() {
    this.audio.unlock();
    this.ui.hideResults();
    this.ui.hideReplay();
    this.trails.clear();
    this.steerKeys = { left: false, right: false };
    this.steerTouch = 0;
    this.steerButtons = 0;
    this.props.reset();
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
      this.toTitle();
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
    this.ui.showRun(this.level.zones ?? [], this.sim.nudgesLeft);
    this.audio.release();
    this.audio.startDrums();
    this.hadFirstRelease = true;
    this.lastStage = 0;
  }

  private nudge(dir: number) {
    if (this.state !== 'sim' || !this.sim || this.paused) return;
    if (this.sim.nudge(dir)) {
      this.ui.setNudges(this.sim.nudgesLeft);
      this.audio.whoosh();
      this.cam.shake(0.15);
    }
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
    if (!this.fast && this.now < this.hitStopUntil) scale = 0.06;
    else if (this.now < this.slowUntil && !this.fast) scale = 0.3;
    this.timeScale += (scale - this.timeScale) * Math.min(1, dt * 12);
    this.acc += dt * this.timeScale;
    // live steering: keys, the hold buttons, or a drag anywhere on screen
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
      const size = lead?.size ?? 0;
      const st = stageOf(size);
      const lz = lead?.body.translation().z ?? 0;
      const z0 = this.level.zones?.[0]?.z[0] ?? 0;
      const zEnd = this.level.beach?.z[0] ?? 1000;
      this.ui.setRun({
        score: sim.liveScore,
        combo: sim.liveCombo,
        stage: st,
        best: Math.max(st, this.lastStage),
        size,
        progress: (sim.liveDistance + (restingBoulder(this.level).pos[2] - z0)) / (zEnd - z0),
        distance: sim.liveDistance,
        zone: this.zoneAt(lz)?.name ?? '',
      });
      this.lastStage = Math.max(this.lastStage, st);
    }
    // mist at the foot of the falls when the camera is near
    if (Math.random() < 0.3) this.fallsMist();
    if (sim.done) this.finishRun();
  }
  private lastStage = 0;
  private hitStopUntil = 0;
  private steerKeys = { left: false, right: false };
  private steerTouch = 0;
  private steerButtons = 0;
  private steerSmoothed = 0;

  private fallsMist() {
    const falls = this.level.zones?.find((z) => z.id === 'falls');
    if (!falls) return;
    const p = new Vector3(0.5, 0, falls.z[0] + 14);
    p.y = this.data.heightAt(p.x, p.z) + 1.5;
    if (p.distanceTo(this.rig.camera.position) < 120) this.effects.dust(p, 0.12, new Color(0.92, 0.95, 0.97));
  }

  private followFrom(states: PieceState[], leaderId: number, velOf: (id: number) => Vector3) {
    // follow the leading stone; widen the shot when fragments are close around it
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
    let courseYaw: number | undefined;
    if (this.coursePl) {
      const h = pathDistance(this.coursePl, focus.x, focus.z);
      courseYaw = Math.atan2(h.tx, h.tz);
    }
    this.followInfo = { focus: focus.add(new Vector3(0, r * 0.4, 0)), vel, spread: Math.min(18, spread), small: r < 0.3, size: r, courseYaw };
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
  private followInfo: { focus: Vector3; vel: Vector3; spread: number; small?: boolean; size?: number; courseYaw?: number } | undefined;
  private coursePlCache: ReturnType<typeof makePolyline> | null | undefined;
  private get coursePl() {
    if (this.coursePlCache === undefined) this.coursePlCache = this.level.terrain.course ? makePolyline(this.level.terrain.course) : null;
    return this.coursePlCache;
  }
  private rolling = 0;
  private gravel = 0;

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
    return { x: clamp((v.x * 0.5 + 0.5) * c.clientWidth, 70, c.clientWidth - 70), y: clamp((-v.y * 0.5 + 0.5) * c.clientHeight, 140, c.clientHeight - 160) };
  }

  private handleEvent(e: SimEvent, live: boolean) {
    const pos = new Vector3(...e.pos);
    const pan = this.screenPan(pos);
    const dist = pos.distanceTo(this.rig.camera.position);
    const att = clamp(40 / Math.max(10, dist), 0.3, 1);
    const fx = live || this.replaySpeed >= 1;
    switch (e.type) {
      case 'breakoff':
        this.audio.fracture(1, 0);
        // the crack: grit and a little dust thrown downhill, away from the camera
        this.effects.dust(pos.clone().add(new Vector3(0, -0.5, 4)), 0.35);
        this.effects.grit(pos, 1);
        this.cam.shake(1);
        this.ui.bigBanner('IT\'S LOOSE!', '', 1200);
        if (live) this.slowUntil = this.now + 0.9;
        break;
      case 'fracture': {
        this.squashHero(0.45, live);

        this.audio.fracture(e.intensity * att + 0.3, pan);
        this.effects.dust(pos, 0.6 + e.intensity * 0.6);
        this.effects.grit(pos, 1 + e.intensity);
        this.effects.grit(pos, 0.8);
        this.cam.shake(0.7 + e.intensity * 0.8);
        if (fx) {
          this.ui.doFlash(0.15 + e.intensity * 0.2);
          this.cam.punchIn(this.now);
          if (live) {
            this.hitStopUntil = this.now + 0.12;
            this.slowUntil = this.now + 0.7;
          }
        }
        break;
      }
      case 'crack':
        this.audio.fracture(0.45 * att + 0.15, pan);
        this.effects.grit(pos, 0.7);
        this.effects.dust(pos, 0.3);
        this.cam.shake(0.25);
        break;
      case 'impact':
        if (e.intensity > 0.25) this.squashHero(e.intensity * 0.35, live);
        this.audio.impact(Math.min(1, e.intensity * 1.3) * att, e.material === 'terrain' ? 'granite' : (e.material as 'granite'), pan);
        if (e.intensity > 0.3) this.effects.dust(pos, e.intensity * 0.45, e.material === 'wood' ? new Color(0.5, 0.42, 0.32) : undefined);
        if (e.intensity > 0.35) this.cam.shake(e.intensity * 0.5);
        break;
      case 'chip':
        this.squashHero(0.2 + e.intensity * 0.3, live);
        this.audio.fracture(Math.min(1, e.intensity) * att * 0.8 + 0.15, pan);
        this.effects.grit(pos, 0.5 + e.intensity * 0.6);
        this.effects.dust(pos, 0.25 + e.intensity * 0.3);
        this.cam.shake(0.25 + e.intensity * 0.4);
        if (fx) {
          if (live && e.intensity > 0.6) this.hitStopUntil = this.now + 0.07;
        }
        break;
      case 'splash':
        this.audio.splash(e.intensity * att + 0.2, pan);
        this.effects.splash(pos, e.intensity + 0.2);
        break;
      case 'score': {
        if (!fx) break;
        const sp = this.screenPos(pos);
        const big = (e.points ?? 0) >= 2000;
        // keep the score text short: the label's first word and the points
        const label = (e.label ?? '').split(' ')[0].replace(/!$/, '');
        this.ui.pop(sp.x, sp.y, label, e.points ?? 0, `${big ? 'big' : ''} ${label.startsWith('BIG') ? 'air' : ''}`);
        if ((e.combo ?? 0) >= 2) this.audio.combo(e.combo ?? 2);
        break;
      }
      case 'stage':
        if (fx) {
          this.ui.bigBanner(`${(e.label ?? '').toUpperCase()}!`, `+${(e.points ?? 0).toLocaleString('en-US')}`, 1700);
          this.audio.stageUp(e.intensity);
        }
        break;
      case 'air':
        this.audio.impact(0.6, 'granite', pan);
        break;
      case 'nudge': {
        this.audio.whoosh();
        this.squashHero(0.35, live);

        break;
      }
      case 'tree': {
        const id = Number((e.objectId ?? 'tree:-1').slice(5));
        this.props.fell(id, e.dir ?? [0, 1]);
        this.audio.snap();
        this.audio.impact(0.7 * att, 'wood', pan);
        this.effects.shards(pos, new Color(0.25, 0.45, 0.18), 26);
        this.effects.shards(pos.clone().add(new Vector3(0, -1, 0)), new Color(0.55, 0.36, 0.2), 14);
        this.cam.shake(0.35);
        this.squashHero(0.25, live);
        window.setTimeout(() => {
          this.audio.impact(0.8 * att, 'wood', pan);
          this.effects.dust(pos.clone().add(new Vector3((e.dir?.[0] ?? 0) * 8, -1, (e.dir?.[1] ?? 1) * 8)), 0.5, new Color(0.9, 0.85, 0.72));
        }, 650);
        break;
      }
      case 'bowl':
        this.audio.impact(0.7 * att, 'granite', pan);
        this.effects.dust(pos, 0.4);
        this.effects.grit(pos, 0.5);
        break;
      case 'slump':
        if (e.objectId) this.objects.slump(e.objectId, true);
        this.effects.earth(pos, 1);
        this.audio.dig();
        break;
    }
  }

  private finishRun() {
    const sim = this.sim!;
    const r = sim.result!;
    this.result = r;
    this.recording = sim.recording;
    this.audio.stopDrums();
    const lp = levelProgress(this.progress, this.level.id);
    const isBest = r.score > (lp.bestScore ?? 0);
    if (isBest) {
      lp.bestScore = r.score;
      lp.bestGrade = r.grade;
    }
    lp.bestStage = Math.max(lp.bestStage ?? 0, r.bestStage);
    lp.bestDistance = Math.max(lp.bestDistance ?? 0, r.distance);
    lp.completed = lp.completed || r.landed;
    lp.lastTrail = r.trajectory.map((p) => [round2(p[0]), round2(p[1]), round2(p[2])] as [number, number, number]);
    saveProgress(this.progress);
    this.lastBest = { score: lp.bestScore ?? r.score, isBest };
    const states = this.statesFromSim(sim);
    this.pieces.sync(states);
    const lead = sim.leader ? sim.pose(sim.leader).pos : states[0]?.pos;
    sim.dispose();
    this.sim = null;
    if (r.sand) this.ui.bigBanner('PERFECT EROSION', 'Sand on the beach', 2600);
    else if (r.landed) this.ui.bigBanner('BEACHED!', `${STAGES[r.stage].name} · ${sizeLabel(r.size)}`, 2000);
    window.setTimeout(() => this.showAftermath(lead ? [new Vector3(...lead)] : []), r.landed ? 1400 : 600);
  }
  private lastBest = { score: 0, isBest: false };

  private showAftermath(finalPositions: Vector3[]) {
    const r = this.result!;
    this.state = 'results';
    this.ui.hideRun();
    this.cam.setMode('aftermath');
    // frame the end of the run, with a little of the path that led there
    const tail = r.trajectory.slice(-12).map((p) => new Vector3(...p));
    this.cam.frameAftermath([...finalPositions, ...tail]);
    this.drawTrails();
    this.addFractureMarkers();
    this.ui.showResults(r, explainRun(r, this.level, this.plan), this.lastBest);
    if (!this.progress.tutorial.reviewed) {
      this.progress.tutorial.reviewed = true;
      this.progress.tutorial.released = true;
      saveProgress(this.progress);
    }
  }

  private drawTrails() {
    this.trails.clear();
    const r = this.result;
    if (!r) return;
    this.trails.add(r.trajectory, new Color(1, 0.7, 0.3), 1.2, { opacity: 0.9 });
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
    this.result?.fractures.slice(0, 30).forEach((f, i) => this.addMarker(String(i + 1), new Vector3(...f.pos)));
  }
  private addGoalMarker() {
    if (this.state !== 'plan') return;
    const [bx, bz] = this.level.boulder.position;
    this.addMarker('The boulder', new Vector3(bx, this.data.heightAt(bx, bz) + this.level.boulder.radius * 2 + 2, bz), 'goal stone');
    const beach = this.level.beach;
    if (beach) {
      const z = beach.z[0] + 20;
      this.addMarker('The beach', new Vector3(6, this.data.heightAt(6, z) + 3, z), 'goal');
    }
    // label every active blocker and every smasher waiting on the sidelines
    for (const o of this.level.objects) {
      const st = this.plan[o.id] ?? defaultState(o);
      const a = this.objects.anchorOf(o.id);
      if (!a) continue;
      if ((o.type === 'branches' && st.type === 'branches' && !st.removed) || (o.type === 'soil' && st.type === 'soil' && !st.dug) || (o.type === 'gate' && st.type === 'gate' && st.option === o.initial))
        this.addMarker('Blocker', a.clone().add(new Vector3(0, 2, 0)), 'blocker');
      if (o.type === 'outcrop' && o.hardness && st.type === 'outcrop' && !st.split) this.addMarker('Smasher', a.clone().add(new Vector3(0, o.size[1] * 0.6, 0)), 'smasher');
    }
  }
  private updateMarkers() {
    const c = this.rig.renderer.domElement;
    for (const m of this.markerEls) {
      const v = m.pos.clone().project(this.rig.camera);
      const vis = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 && m.pos.distanceTo(this.rig.camera.position) < 190;
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
    this.props.reset();
    this.replayLastF = 0;
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
    const leader = rec.leader[Math.min(rec.leader.length - 1, Math.max(0, Math.round(f)))] ?? -1;
    this.followFrom(states, leader, (id) => vels.get(id) ?? new Vector3());
    // object changes: soaked banks slump, trees fall
    if (f < this.replayLastF - 0.5) this.props.reset();
    this.replayLastF = f;
    for (const ch of rec.objectChanges) {
      if (ch.change === 'felled') {
        if (f >= ch.frame) this.props.fell(Number(ch.objectId.slice(5)), ch.dir ?? [0, 1], f - ch.frame > 15);
      } else this.objects.slump(ch.objectId, f >= ch.frame);
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
    this.objects.update(dt);
    this.props.update(dt);
    this.pieces.update(dt);
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
      /** test hook: run the rest of the descent instantly */
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

function sampleTrack(t: Track, f: number, frames: number): PieceState | null {
  const n = t.data.length / FRAME;
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
  const a = i * FRAME,
    b = j * FRAME;
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
    smooth: lerp(8),
  };
}

/** What happened, and what to try next — in arcade terms. */
export function explainRun(r: SimResult, level: LevelDef, _plan: Plan): string {
  if (r.unstable) return 'The physics hiccuped. Nothing you did — go again.';
  const stage = STAGES[r.stage].name.toLowerCase();
  if (r.sand) return `A grain of sand on the beach after ${Math.round(r.distance)} m and ${r.smashes + r.chips} hits. The mountain is complete.`;
  let lead: string;
  if (r.landed) lead = `It hit the beach as ${/^[aeiou]/.test(stage) ? 'an' : 'a'} ${stage} — ${sizeLabel(r.size)} across.`;
  else lead = `It ran ${Math.round(r.distance)} m and stopped at ${r.destination}, ${sizeLabel(r.size)} across.`;
  const tips: string[] = [];
  if (!r.landed) {
    const z = r.trajectory[r.trajectory.length - 1]?.[2] ?? 0;
    const near = level.objects.find((o) => o.type === 'branches' && Math.abs(o.position[1] - z) < 18);
    if (near && near.type === 'branches') tips.push(`${near.name} — ${near.hint.split('. ').slice(-1)[0]}`);
    else if (r.destination === 'the marsh') tips.push('The left channel dies in the marsh. Steer right at the delta.');
    else tips.push('Keep it on the line — drag left and right to steer.');
  }
  if (r.stage < STAGES.length - 1) tips.push('Aim straight at the granite teeth and crusher rocks to knock more off, and ride the water to wear it smooth.');
  return [lead, ...tips].join(' ');
}
