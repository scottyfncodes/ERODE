import type { LevelDef, Zone } from '../levels/types';
import type { Medal, SimResult, Severity } from '../sim/simulation';
import type { Composition, CompositionId } from '../sim/composition';
import type { LevelProgress, Records } from '../game/progress';
import './style.css';
import { kg, pct, seconds, sizeLabel } from './format';
import { BRAND, wordmark } from './brand';

export const ICONS = {
  reset: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/></svg>',
  menu: '<svg viewBox="0 0 24 24"><path d="M5 7h14M5 12h14M5 17h14"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M9 6v12M15 6v12"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10-6.5z"/></svg>',
  ff: '<svg viewBox="0 0 24 24"><path d="M5 6l7 6-7 6zM12 6l7 6-7 6z"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  rotL: '<svg viewBox="0 0 24 24"><path d="M5 12a7 7 0 1 0 2-5"/><path d="M5 4v4h4"/></svg>',
  rotR: '<svg viewBox="0 0 24 24"><path d="M19 12a7 7 0 1 1-2-5"/><path d="M19 4v4h-4"/></svg>',
  undo: '<svg viewBox="0 0 24 24"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>',
  hand: '<svg viewBox="0 0 24 24"><path d="M8 13V6a1.5 1.5 0 0 1 3 0v5M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11V6a1.5 1.5 0 0 1 3 0v7a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7L3 13a1.5 1.5 0 0 1 2.5-1.6L8 14"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.5"/></svg>',
  replay: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/><path d="M10 9v6l5-3z"/></svg>',
  left: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
  routes: '<svg viewBox="0 0 24 24"><path d="M6 3v6c0 3 6 3 6 6v6"/><path d="M18 3v6c0 3-6 3-6 6"/></svg>',
  survey: '<svg viewBox="0 0 24 24"><path d="M3 20l6-12 4 7 3-4 5 9z"/><circle cx="17" cy="5" r="1.6"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M14 6l-6 6 6 6"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M5 12h13M13 6l6 6-6 6"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
};

export interface ContextAction {
  key: string;
  label: string;
  icon?: keyof typeof ICONS;
  primary?: boolean;
  active?: boolean;
  disabled?: boolean;
  repeat?: boolean;
}

export interface UIHandlers {
  play(): void;
  pickLevel(id: string): void;
  mountains(): void;
  release(): void;
  reset(): void;
  menu(): void;
  action(key: string): void;
  closeContext(): void;
  replay(): void;
  adjust(): void;
  retry(): void;
  next(): void;
  pause(): void;
  skip(): void;
  scrub(frac: number): void;
  replayToggle(): void;
  replaySpeed(): void;
  exitReplay(): void;
  toggleSound(): void;
  toggleMusic(): void;
  toTitle(): void;
  resumeFromMenu(): void;
  toggleGhost(): void;
  toggleRoutes(): void;
  survey(): void;
  zone(id: string): void;
  composition(id: CompositionId): void;
  steer(dir: number): void;
}

export interface MountainCard {
  level: LevelDef;
  unlocked: boolean;
  lockText: string;
  progress: LevelProgress | undefined;
}

export interface CompositionChoice {
  comp: Composition;
  unlocked: boolean;
  /** starting mass of this level's boulder in this stone */
  mass: number;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

const MEDAL_NAME: Record<Medal, string> = { none: 'No medal', bronze: 'Bronze', silver: 'Silver', gold: 'Gold', platinum: 'Platinum' };

/** Bars start below the silver line so the medal thresholds aren't crammed at the end. */
function barFloor(silver: number): number {
  return Math.max(0, Math.floor((silver - 0.25) * 20) / 20);
}
function barPos(f: number, floor: number): number {
  return Math.max(0, Math.min(1, (f - floor) / (1 - floor)));
}

function medalBadge(m: Medal, size = ''): string {
  return `<span class="medal m-${m} ${size}" aria-label="${MEDAL_NAME[m]}"><i></i></span>`;
}

export { sizeLabel };

export class UI {
  private root: HTMLElement;
  private h: UIHandlers;
  private title!: HTMLElement;
  private mountainsEl!: HTMLElement;
  private plan!: HTMLElement;
  private run!: HTMLElement;
  private results!: HTMLElement;
  private replayBar!: HTMLElement;
  private menuEl!: HTMLElement;
  private context!: HTMLElement;
  private compSheet!: HTMLElement;
  private tipEl!: HTMLElement;
  private calloutEl!: HTMLElement;
  private pipsEl!: HTMLElement;
  private changesLabel!: HTMLElement;
  private zonesEl!: HTMLElement;
  private range!: HTMLInputElement;
  private speedEl!: HTMLElement;
  private playBtn!: HTMLButtonElement;
  private pauseBtn!: HTMLButtonElement;
  private ghostBtn!: HTMLButtonElement;
  private routesBtn!: HTMLButtonElement;
  private massNum!: HTMLElement;
  private massPct!: HTMLElement;
  private massFill!: HTMLElement;
  private massLoss!: HTMLElement;
  private massTicks!: HTMLElement;
  private distFill!: HTMLElement;
  private distLabel!: HTMLElement;
  private steerKnob!: HTMLElement;
  private popLayer!: HTMLElement;
  private banner!: HTMLElement;
  private flash!: HTMLElement;
  private calloutTimer = 0;
  private tipTimer = 0;
  private bannerTimer = 0;
  private scrubbing = false;
  private shownMass = 0;
  private targetMass = 0;
  private lossMass = 0;
  private startMass = 1;
  private runMedals = { silver: 0.6, gold: 0.8, platinum: 0.95 };
  /** the bar shows retention from this floor to 100%, so the medal lines have room */
  private floor = 0;

  constructor(root: HTMLElement, handlers: UIHandlers) {
    this.root = root;
    this.h = handlers;
    this.build();
    const tick = () => {
      requestAnimationFrame(tick);
      if (Math.abs(this.targetMass - this.shownMass) > 0.5) {
        this.shownMass += (this.targetMass - this.shownMass) * 0.22;
        this.paintMass();
      }
      // the red "just lost" sliver drains a moment after a hit
      if (this.lossMass > this.targetMass + 0.5) {
        this.lossMass += (this.targetMass - this.lossMass) * 0.045;
        this.massLoss.style.width = `${(barPos(this.lossMass / this.startMass, this.floor) * 100).toFixed(2)}%`;
      }
    };
    requestAnimationFrame(tick);
  }

  private btn(cls: string, html: string, fn: () => void, label?: string): HTMLButtonElement {
    const b = el('button', cls, html);
    if (label) b.setAttribute('aria-label', label);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      fn();
    });
    return b;
  }

  private actBtn(label: string, cls: string, fn: () => void, icon?: keyof typeof ICONS) {
    return this.btn(`act ${cls}`, `${icon ? ICONS[icon] : ''}<span>${label}</span>`, fn);
  }

  private build() {
    // ---------------- title
    this.title = el('div', 'title hidden');
    this.title.innerHTML = `
      <div class="title-top">
        ${wordmark()}
        <div class="title-tag"><b>${BRAND.tagline}</b><br>You are the boulder. Reach the bottom of the mountain with as much of yourself as you can.</div>
      </div>
      <div class="title-bottom"><div class="title-stats" id="title-stats"></div></div>`;
    const go = this.btn('btn-go interactive', 'Play', () => this.h.play());
    go.id = 'begin';
    this.title.querySelector('.title-bottom')!.append(go);

    // ---------------- mountains (level select)
    this.mountainsEl = el('div', 'mountains interactive');
    this.mountainsEl.style.display = 'none';

    // ---------------- planning
    this.plan = el('div', 'hud hidden');
    const card = el('div', 'level-card interactive');
    card.innerHTML = `
      <div class="lc-row"><span class="stage-label"></span><span class="env"></span></div>
      <h1></h1>
      <button class="comp-pick"></button>
      <div class="targets"></div>
      <div class="lc-foot"><span class="moves-label">Moves</span><div class="pips"></div><button class="obj-toggle"></button></div>
      <ul class="obj-list"></ul>`;
    this.pipsEl = card.querySelector('.pips') as HTMLElement;
    this.changesLabel = card.querySelector('.moves-label') as HTMLElement;
    card.querySelector('.comp-pick')!.addEventListener('click', (e) => {
      e.stopPropagation();
      this.compSheet.classList.toggle('show');
    });
    card.querySelector('.obj-toggle')!.addEventListener('click', (e) => {
      e.stopPropagation();
      card.classList.toggle('open');
    });
    const tr = el('div', 'top-right');
    this.ghostBtn = this.btn('icon-btn interactive', ICONS.eye, () => this.h.toggleGhost(), 'Show last path');
    this.routesBtn = this.btn('icon-btn interactive', ICONS.routes, () => this.h.toggleRoutes(), 'Show routes');
    tr.append(
      this.btn('icon-btn interactive', ICONS.back, () => this.h.mountains(), 'Mountains'),
      this.btn('icon-btn interactive', ICONS.survey, () => this.h.survey(), 'Survey the descent'),
      this.routesBtn,
      this.ghostBtn,
      this.btn('icon-btn interactive', ICONS.reset, () => this.h.reset(), 'Reset the mountain'),
      this.btn('icon-btn interactive', ICONS.menu, () => this.h.menu(), 'Menu'),
    );
    this.zonesEl = el('div', 'zones interactive');
    const rw = el('div', 'release-wrap');
    const rel = this.btn('release interactive', 'Release', () => this.h.release());
    rel.id = 'release';
    rw.append(rel);
    this.context = el('div', 'context interactive');
    this.compSheet = el('div', 'comp-sheet interactive');
    this.plan.append(card, tr, this.context, this.compSheet, this.zonesEl, rw);

    // ---------------- run
    this.run = el('div', 'hud hidden run');
    const massBox = el('div', 'mass-box');
    massBox.innerHTML = `
      <div class="mass-top"><b class="mass-num">0 kg</b><span class="mass-pct">100%</span></div>
      <div class="mass-bar"><div class="mass-loss"></div><div class="mass-fill"></div><div class="mass-ticks"></div></div>`;
    this.massNum = massBox.querySelector('.mass-num') as HTMLElement;
    this.massPct = massBox.querySelector('.mass-pct') as HTMLElement;
    this.massFill = massBox.querySelector('.mass-fill') as HTMLElement;
    this.massLoss = massBox.querySelector('.mass-loss') as HTMLElement;
    this.massTicks = massBox.querySelector('.mass-ticks') as HTMLElement;
    const rtr = el('div', 'top-right');
    this.pauseBtn = this.btn('icon-btn interactive', ICONS.pause, () => this.h.pause(), 'Pause');
    rtr.append(this.pauseBtn, this.btn('icon-btn interactive', ICONS.ff, () => this.h.skip(), 'Fast forward'));
    const dist = el('div', 'dist');
    dist.innerHTML = '<div class="dist-track"><div class="dist-fill"></div></div><div class="dist-label"></div>';
    this.distFill = dist.querySelector('.dist-fill') as HTMLElement;
    this.distLabel = dist.querySelector('.dist-label') as HTMLElement;
    // hold-to-lean buttons (dragging anywhere works too)
    const lean = el('div', 'lean');
    const hold = (dir: number, label: string, icon: string) => {
      const b = el('button', 'lean-btn interactive', icon);
      b.setAttribute('aria-label', label);
      const on = (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
        b.classList.add('held');
        this.h.steer(dir);
      };
      const off = () => {
        b.classList.remove('held');
        this.h.steer(0);
      };
      b.addEventListener('pointerdown', on);
      b.addEventListener('pointerup', off);
      b.addEventListener('pointerleave', off);
      b.addEventListener('pointercancel', off);
      return b;
    };
    const mid = el('div', 'lean-mid');
    const bar = el('div', 'lean-bar');
    this.steerKnob = el('div', 'lean-knob');
    bar.append(this.steerKnob);
    mid.append(bar, el('div', 'lean-hint', 'Drag to lean'));
    lean.append(hold(-1, 'Lean left', ICONS.left), mid, hold(1, 'Lean right', ICONS.right));
    this.calloutEl = el('div', 'callout');
    this.banner = el('div', 'banner');
    this.flash = el('div', 'flash');
    this.run.append(this.flash, massBox, rtr, dist, lean, this.calloutEl, this.banner);
    this.popLayer = el('div', 'pops');

    // ---------------- results / replay / menu / tip
    this.results = el('div', 'results interactive');
    this.results.style.display = 'none';
    this.replayBar = el('div', 'hud hidden');
    const rbar = el('div', 'replay-bar interactive');
    this.playBtn = this.btn('icon-btn', ICONS.pause, () => this.h.replayToggle(), 'Play or pause');
    this.range = el('input') as HTMLInputElement;
    this.range.type = 'range';
    this.range.min = '0';
    this.range.max = '1000';
    this.range.value = '0';
    this.range.setAttribute('aria-label', 'Replay position');
    this.range.addEventListener('input', () => {
      this.scrubbing = true;
      this.h.scrub(Number(this.range.value) / 1000);
    });
    this.range.addEventListener('change', () => (this.scrubbing = false));
    this.speedEl = this.btn('speed', '1×', () => this.h.replaySpeed(), 'Replay speed');
    rbar.append(this.playBtn, this.range, this.speedEl, this.btn('icon-btn', ICONS.close, () => this.h.exitReplay(), 'Close replay'));
    this.replayBar.append(rbar);
    this.menuEl = el('div', 'menu interactive');
    this.menuEl.style.display = 'none';
    this.tipEl = el('div', 'tip');
    this.root.append(this.title, this.mountainsEl, this.plan, this.run, this.popLayer, this.results, this.replayBar, this.tipEl, this.menuEl);
  }

  private enable(node: HTMLElement, on: boolean) {
    node.querySelectorAll('button,input').forEach((b) => ((b as HTMLElement).style.pointerEvents = on ? '' : 'none'));
  }

  // ---------------------------------------------------------- title
  showTitle(stats: { medals: Record<Medal, number>; finished: number; total: number }) {
    const s = this.title.querySelector('#title-stats')!;
    s.innerHTML = stats.finished
      ? `<span>${stats.finished}/${stats.total} mountains</span>${(['platinum', 'gold', 'silver', 'bronze'] as Medal[])
          .filter((m) => stats.medals[m])
          .map((m) => `<span class="ts-medal">${medalBadge(m, 'sm')}${stats.medals[m]}</span>`)
          .join('')}`
      : `<span>${stats.total} mountains · one boulder</span>`;
    (this.title.querySelector('#begin') as HTMLElement).textContent = stats.finished ? 'Continue' : 'Play';
    this.title.classList.remove('hidden');
    this.enable(this.title, true);
  }
  hideTitle() {
    this.title.classList.add('hidden');
    this.enable(this.title, false);
  }

  // ---------------------------------------------------------- mountains
  showMountains(cards: MountainCard[], current: string | null) {
    const m = this.mountainsEl;
    m.innerHTML = '';
    const head = el('div', 'mt-head');
    head.append(this.btn('icon-btn', ICONS.back, () => this.h.toTitle(), 'Back'), el('h2', '', 'The Mountains'), el('span'));
    const list = el('div', 'mt-list');
    for (const c of cards) {
      const lp = c.progress;
      const b = el('button', `mt-card${c.unlocked ? '' : ' locked'}${current === c.level.id ? ' current' : ''}`);
      b.innerHTML = `
        <div class="mt-stage">${c.level.stage}</div>
        <div class="mt-body">
          <div class="mt-env">${c.level.environment}</div>
          <div class="mt-name">${c.level.name}</div>
          <div class="mt-sub">${c.unlocked ? (lp?.finished ? `Best ${pct(lp.bestRetained)} · ${kg(lp.bestMass)}${lp.bestTime ? ` · ${seconds(lp.bestTime)}` : ''}` : c.level.tagline) : c.lockText}</div>
          ${c.unlocked ? `<div class="mt-goals">${(['silver', 'gold', 'platinum'] as const).map((k) => `<span class="${lp && lp.bestRetained >= c.level.medals[k] && lp.finished ? 'hit' : ''}">${medalBadge(k, 'xs')}${Math.round(c.level.medals[k] * 1000) / 10}%</span>`).join('')}<span class="mt-obj">${lp?.objectives.length ?? 0}/${c.level.objectives.length} objectives</span></div>` : ''}
        </div>
        <div class="mt-medal">${c.unlocked ? medalBadge(lp?.medal ?? 'none', 'lg') : ICONS.lock}</div>`;
      if (c.unlocked)
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          this.h.pickLevel(c.level.id);
        });
      list.append(b);
    }
    m.append(head, list);
    m.style.display = '';
    requestAnimationFrame(() => m.classList.add('show'));
  }
  hideMountains() {
    this.mountainsEl.classList.remove('show');
    this.mountainsEl.style.display = 'none';
  }

  // ---------------------------------------------------------- planning
  showPlanning(level: LevelDef, lp: LevelProgress | undefined) {
    const card = this.plan.querySelector('.level-card')!;
    card.querySelector('.stage-label')!.textContent = level.stage;
    card.querySelector('.env')!.textContent = level.environment;
    card.querySelector('h1')!.textContent = level.name;
    card.querySelector('.targets')!.innerHTML = (['silver', 'gold', 'platinum'] as const)
      .map((k) => `<span class="tg">${medalBadge(k, 'xs')}<b>${Math.round(level.medals[k] * 1000) / 10}%</b></span>`)
      .join('') + (lp?.finished && lp.bestRetained > 0 ? `<span class="tg best">Best <b>${pct(lp.bestRetained)}</b></span>` : '');
    const done = new Set(lp?.objectives ?? []);
    card.querySelector('.obj-toggle')!.textContent = `Objectives ${done.size}/${level.objectives.length}`;
    card.querySelector('.obj-list')!.innerHTML =
      level.objectives.map((o) => `<li class="${done.has(o.id) ? 'done' : ''}">${done.has(o.id) ? ICONS.check : '<i></i>'}<span>${o.label}</span></li>`).join('') +
      level.routes.map((r) => `<li class="route ${lp?.routes.includes(r.id) ? 'done' : ''}">${ICONS.routes}<span><b>${r.name}</b> — ${r.hint}</span></li>`).join('');
    this.zonesEl.innerHTML = '';
    for (const z of level.zones ?? []) {
      const b = this.btn('zone-chip', z.name.replace(/^The /, ''), () => this.h.zone(z.id));
      b.dataset.zone = z.id;
      this.zonesEl.append(b);
    }
    this.plan.classList.remove('hidden');
    this.enable(this.plan, true);
  }
  hidePlanning() {
    this.plan.classList.add('hidden');
    this.compSheet.classList.remove('show');
    this.hideContext();
  }
  /** the stone picker: what the boulder is made of, and what that means here */
  setCompositions(choices: CompositionChoice[], current: CompositionId) {
    const cur = choices.find((c) => c.comp.id === current) ?? choices[0];
    const pick = this.plan.querySelector('.comp-pick') as HTMLElement;
    pick.innerHTML = `<span class="swatch s-${cur.comp.id}"></span><b>${cur.comp.name}</b><span class="cp-mass">${kg(cur.mass)}</span><span class="cp-more">Change</span>`;
    this.compSheet.innerHTML = '';
    const head = el('div', 'cs-head');
    head.append(el('h3', '', 'Your stone'), this.btn('close-x', '×', () => this.compSheet.classList.remove('show'), 'Close'));
    this.compSheet.append(head);
    for (const c of choices) {
      const b = el('button', `cs-item${c.comp.id === current ? ' on' : ''}${c.unlocked ? '' : ' locked'}`);
      b.innerHTML = `<span class="swatch s-${c.comp.id}"></span>
        <span class="cs-body"><b>${c.comp.name}</b><span class="cs-mass">${c.unlocked ? kg(c.mass) : ''}</span>
        <span class="cs-blurb">${c.unlocked ? c.comp.blurb : c.comp.unlock.text}</span>
        ${c.unlocked ? `<span class="cs-traits">${c.comp.traits.map((t) => `<i>${t}</i>`).join('')}</span>` : ''}</span>
        ${c.unlocked ? '' : ICONS.lock}`;
      if (c.unlocked)
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          this.h.composition(c.comp.id);
          this.compSheet.classList.remove('show');
        });
      this.compSheet.append(b);
    }
  }
  setChanges(n: number, budget: number) {
    this.pipsEl.innerHTML = '';
    for (let i = 0; i < budget; i++) this.pipsEl.append(el('div', `pip${i < n ? ' used' : ''}`));
    this.changesLabel.textContent = `Moves ${n}/${budget}`;
  }
  setGhost(on: boolean, available: boolean) {
    this.ghostBtn.classList.toggle('on', on && available);
    this.ghostBtn.style.display = available ? '' : 'none';
  }
  setRoutes(on: boolean) {
    this.routesBtn.classList.toggle('on', on);
  }
  setSurveying(on: boolean) {
    this.plan.classList.toggle('surveying', on);
  }

  showContext(title: string, tag: string, text: string, actions: ContextAction[], note?: string, kind: 'hazard' | 'block' | 'tweak' = 'tweak') {
    const c = this.context;
    c.innerHTML = '';
    c.dataset.kind = kind;
    const head = el('div', 'head');
    const left = el('div');
    left.append(el('div', 'tag', tag), el('h2', '', title));
    head.append(left, this.btn('close-x', '×', () => this.h.closeContext(), 'Close'));
    const row = el('div', 'actions');
    for (const a of actions) {
      const b = el('button', `act${a.primary ? ' primary' : ''}${a.active ? ' active' : ''}`, `${a.icon ? ICONS[a.icon] : ''}<span>${a.label}</span>`);
      if (a.disabled) b.setAttribute('disabled', '');
      if (a.repeat) {
        let timer = 0;
        const stop = () => {
          window.clearInterval(timer);
          timer = 0;
        };
        b.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          if (a.disabled) return;
          this.h.action(a.key);
          stop();
          timer = window.setInterval(() => this.h.action(a.key), 170);
        });
        b.addEventListener('pointerup', stop);
        b.addEventListener('pointerleave', stop);
        b.addEventListener('pointercancel', stop);
      } else
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          if (!a.disabled) this.h.action(a.key);
        });
      row.append(b);
    }
    c.append(head, el('p', '', text), row);
    if (note) c.append(el('div', 'note', note));
    c.classList.add('show');
    this.compSheet.classList.remove('show');
    this.tip(null);
  }
  hideContext() {
    this.context.classList.remove('show');
  }

  tip(text: string | null, ms = 0) {
    window.clearTimeout(this.tipTimer);
    if (!text) {
      this.tipEl.classList.remove('show');
      return;
    }
    this.tipEl.textContent = text;
    this.tipEl.classList.add('show');
    if (ms) this.tipTimer = window.setTimeout(() => this.tipEl.classList.remove('show'), ms);
  }

  // ---------------------------------------------------------- run
  showRun(zones: Zone[], startMass: number, medals: { silver: number; gold: number; platinum: number }) {
    this.run.classList.remove('hidden');
    this.enable(this.run, true);
    this.startMass = startMass;
    this.targetMass = this.shownMass = this.lossMass = startMass;
    this.runMedals = medals;
    this.floor = barFloor(medals.silver);
    this.massTicks.innerHTML = (['silver', 'gold', 'platinum'] as const).map((k) => `<i class="t-${k}" style="left:${(barPos(medals[k], this.floor) * 100).toFixed(1)}%"></i>`).join('');
    this.massLoss.style.width = '100%';
    this.paintMass();
    this.setPaused(false);
    const hint = this.run.querySelector('.lean-hint') as HTMLElement;
    hint.style.animation = 'none';
    void hint.offsetWidth;
    hint.style.animation = '';
    const track = this.run.querySelector('.dist-track')!;
    track.querySelectorAll('.dist-tick').forEach((t) => t.remove());
    const z0 = zones[0]?.z[0] ?? 0;
    const z1 = zones[zones.length - 1]?.z[1] ?? 1;
    for (const z of zones.slice(1)) {
      const t = el('div', 'dist-tick');
      t.style.left = `${((z.z[0] - z0) / (z1 - z0)) * 100}%`;
      track.append(t);
    }
  }
  hideRun() {
    this.run.classList.add('hidden');
    this.calloutEl.classList.remove('show');
    this.banner.classList.remove('show');
  }
  setPaused(p: boolean) {
    this.pauseBtn.innerHTML = p ? ICONS.play : ICONS.pause;
  }
  /** live lean indicator, -1 … 1 */
  setSteer(v: number) {
    this.steerKnob.style.left = `${(50 + v * 50).toFixed(1)}%`;
    this.steerKnob.style.opacity = String(0.45 + Math.abs(v) * 0.55);
  }
  private paintMass() {
    const f = this.shownMass / this.startMass;
    this.massNum.textContent = kg(this.shownMass);
    this.massPct.textContent = pct(f);
    this.massFill.style.width = `${(barPos(f, this.floor) * 100).toFixed(2)}%`;
    const m = this.runMedals;
    const tier = f >= m.platinum ? 'platinum' : f >= m.gold ? 'gold' : f >= m.silver ? 'silver' : 'bronze';
    this.massFill.dataset.tier = tier;
    this.massPct.dataset.tier = tier;
  }
  setMass(mass: number) {
    this.targetMass = mass;
    if (mass > this.lossMass) this.lossMass = mass;
  }
  setRun(s: { progress: number; zone: string; speed: number }) {
    const p = Math.max(0, Math.min(1, s.progress)) * 100;
    this.distFill.style.width = `${p}%`;
    this.distLabel.innerHTML = `<b>${Math.round(s.speed * 3.6)} km/h</b> ${s.zone}`;
  }
  callout(text: string, ms = 2200) {
    window.clearTimeout(this.calloutTimer);
    this.calloutEl.textContent = text;
    this.calloutEl.classList.add('show');
    this.calloutTimer = window.setTimeout(() => this.calloutEl.classList.remove('show'), ms);
  }
  /** a hit's cost, floating where it happened */
  damagePop(x: number, y: number, kgLost: number, severity: Severity, label: string) {
    const p = el('div', `pop sev-${severity}`, `<b>−${Math.round(kgLost).toLocaleString('en-US')} kg</b>${severity !== 'minor' ? `<span>${label}</span>` : ''}`);
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    this.popLayer.append(p);
    window.setTimeout(() => p.remove(), 1600);
    while (this.popLayer.childElementCount > 6) this.popLayer.firstElementChild?.remove();
  }
  bigBanner(text: string, sub = '', ms = 1600) {
    window.clearTimeout(this.bannerTimer);
    this.banner.innerHTML = `<div>${text}</div>${sub ? `<small>${sub}</small>` : ''}`;
    this.banner.classList.remove('show');
    void this.banner.offsetWidth;
    this.banner.classList.add('show');
    this.bannerTimer = window.setTimeout(() => this.banner.classList.remove('show'), ms);
  }
  doFlash(strength = 1) {
    this.flash.style.setProperty('--f', String(Math.min(1, strength)));
    this.flash.classList.remove('go');
    void this.flash.offsetWidth;
    this.flash.classList.add('go');
  }

  // ---------------------------------------------------------- results
  showResults(r: SimResult, level: LevelDef, rec: Records, lp: LevelProgress, opts: { hasNext: boolean; nextName?: string; compName: string; routeName: string | null; tip: string }) {
    const m = level.medals;
    const floor = barFloor(m.silver);
    const prevBest = rec.previous.retained;
    const headline = r.finished ? `${r.cause}` : r.cause;
    const worst = [...r.collisions].sort((a, b) => b.kg - a.kg).slice(0, 3);
    const recs: string[] = [];
    if (rec.firstFinish) recs.push('First descent');
    if (rec.bestRetained) recs.push(`New best · ${pct(r.retained)}`);
    if (rec.bestMass && !rec.bestRetained) recs.push(`Most mass · ${kg(r.mass)}`);
    if (rec.bestTime) recs.push(`Fastest · ${seconds(r.duration)}`);
    if (rec.newRoute && opts.routeName) recs.push(`New route · ${opts.routeName}`);
    for (const c of rec.unlockedCompositions) recs.push(`Unlocked · ${c}`);
    if (rec.unlockedLevel) recs.push(`Unlocked · ${rec.unlockedLevel}`);
    const objDone = new Set(lp.objectives);
    const lossParts = [
      { k: 'Impacts', v: r.impactLoss },
      { k: 'Fractures', v: r.splitLoss },
      { k: 'Wear', v: r.abrasionLoss },
    ].filter((x) => x.v >= 1);
    this.results.innerHTML = `
      <div class="scroll">
        <div class="res-head">
          <div class="res-medal">${medalBadge(r.medal, 'xl')}<span>${r.finished ? MEDAL_NAME[r.medal] : 'Did not finish'}</span></div>
          <div class="res-title">
            <div class="res-level">${level.stage} · ${level.name} · ${opts.compName}</div>
            <div class="verdict">${headline}</div>
          </div>
        </div>
        <div class="retain">
          <div class="retain-top"><span class="retain-pct">0%</span><span class="retain-of">of the boulder made it${r.finished ? '' : ' this far'}</span></div>
          <div class="retain-bar"><div class="retain-fill" data-tier="${r.medal}"></div>
            ${(['silver', 'gold', 'platinum'] as const).map((k) => `<i class="t-${k}" style="left:${(barPos(m[k], floor) * 100).toFixed(1)}%"><em>${medalBadge(k, 'xs')}</em></i>`).join('')}
            ${prevBest > 0 ? `<i class="t-best" style="left:${(barPos(prevBest, floor) * 100).toFixed(1)}%"><em>Best</em></i>` : ''}
          </div>
          <div class="retain-masses"><span>${kg(r.startMass)} <small>start</small></span><span>${kg(r.mass)} <small>${r.finished ? 'at the bottom' : 'left'}</small></span></div>
        </div>
        ${recs.length ? `<div class="records">${recs.map((x) => `<span>${x}</span>`).join('')}</div>` : ''}
        <div class="stats">
          <div class="stat"><div class="k">Mass lost</div><div class="v">${kg(r.massLost)}</div><div class="s">${lossParts.map((x) => `${x.k} ${kg(x.v)}`).join(' · ') || '—'}</div></div>
          <div class="stat"><div class="k">Descent</div><div class="v">${seconds(r.duration)}</div><div class="s">top ${Math.round(r.topSpeed * 3.6)} km/h${r.finished ? ` · finish ${Math.round(r.finishSpeed * 3.6)} km/h` : ''}</div></div>
          <div class="stat"><div class="k">Collisions</div><div class="v">${r.counts.major + r.counts.moderate + r.counts.minor}</div><div class="s">${r.counts.major} major · ${r.counts.moderate} moderate · ${r.counts.minor} minor</div></div>
          <div class="stat"><div class="k">Route</div><div class="v sm">${opts.routeName ?? '—'}</div><div class="s">${r.treesFelled ? `${r.treesFelled} trees snapped` : ''}${r.smashed.length ? `${r.treesFelled ? ' · ' : ''}${r.smashed.length} smashed` : ''}</div></div>
        </div>
        ${worst.length ? `<div class="hits"><div class="sect">Hardest hits</div>${worst.map((c) => `<div class="hit sev-${c.severity}"><span>${c.split ? 'Split on' : c.headOn ? 'Head-on into' : 'Struck'} ${c.against}</span><b>−${kg(c.kg)}</b><small>${Math.round(c.speed * 3.6)} km/h · ${seconds(c.time)}</small></div>`).join('')}</div>` : ''}
        <div class="objs"><div class="sect">Objectives</div>${r.objectives.map((o) => `<div class="obj ${o.done ? 'done' : objDone.has(o.id) ? 'had' : ''}">${o.done || objDone.has(o.id) ? ICONS.check : '<i></i>'}<span>${o.label}</span>${o.done && rec.newObjectives.includes(o.id) ? '<em>New</em>' : ''}</div>`).join('')}</div>
        <p class="why">${opts.tip}</p>
      </div>
      <div class="buttons"></div>`;
    const b = this.results.querySelector('.buttons')!;
    if (opts.hasNext && r.finished) b.append(this.actBtn(`Next: ${opts.nextName ?? ''}`, 'primary', () => this.h.next(), 'next'));
    b.append(
      this.actBtn('Try again', opts.hasNext && r.finished ? '' : 'primary', () => this.h.retry(), 'replay'),
      this.actBtn('Re-plan', '', () => this.h.adjust(), 'hand'),
      this.actBtn('Watch replay', '', () => this.h.replay(), 'eye'),
      this.actBtn('Mountains', '', () => this.h.mountains(), 'survey'),
    );
    this.results.style.display = '';
    requestAnimationFrame(() => this.results.classList.add('show'));
    // the retention bar drains from 100% to what's left
    const fill = this.results.querySelector('.retain-fill') as HTMLElement;
    const num = this.results.querySelector('.retain-pct') as HTMLElement;
    const t0 = performance.now() + 350;
    const dur = 1500;
    const animate = (t: number) => {
      const u = Math.max(0, Math.min(1, (t - t0) / dur));
      const e = 1 - Math.pow(1 - u, 3);
      const f = 1 - (1 - r.retained) * e;
      fill.style.width = `${(barPos(f, floor) * 100).toFixed(2)}%`;
      num.textContent = pct(f);
      if (u < 1 && this.results.classList.contains('show')) requestAnimationFrame(animate);
      else this.results.querySelector('.res-medal')?.classList.add('land');
    };
    requestAnimationFrame(animate);
  }
  hideResults() {
    this.results.classList.remove('show');
    window.setTimeout(() => {
      if (!this.results.classList.contains('show')) this.results.style.display = 'none';
    }, 500);
  }

  // ---------------------------------------------------------- replay
  showReplay() {
    this.replayBar.classList.remove('hidden');
    this.enable(this.replayBar, true);
  }
  hideReplay() {
    this.replayBar.classList.add('hidden');
  }
  setReplay(frac: number, playing: boolean, speed: number) {
    if (!this.scrubbing) this.range.value = String(Math.round(frac * 1000));
    this.playBtn.innerHTML = playing ? ICONS.pause : ICONS.play;
    this.speedEl.textContent = `${speed}×`;
  }

  // ---------------------------------------------------------- menu
  showMenu(sound: boolean, music: boolean, inRun: boolean) {
    this.menuEl.innerHTML = '';
    const card = el('div', 'menu-card');
    card.append(
      el('h2', '', inRun ? 'Paused' : BRAND.name),
      this.actBtn(`Sound <b>${sound ? 'On' : 'Off'}</b>`, '', () => this.h.toggleSound()),
      this.actBtn(`Ambience <b>${music ? 'On' : 'Off'}</b>`, '', () => this.h.toggleMusic()),
      this.actBtn('The Mountains', '', () => this.h.mountains()),
      this.actBtn('Title', '', () => this.h.toTitle()),
      this.actBtn('Resume', 'primary', () => this.h.resumeFromMenu()),
    );
    this.menuEl.append(card);
    this.menuEl.style.display = '';
    this.menuEl.onclick = (e) => {
      if (e.target === this.menuEl) this.h.resumeFromMenu();
    };
    requestAnimationFrame(() => this.menuEl.classList.add('show'));
  }
  hideMenu() {
    this.menuEl.classList.remove('show');
    this.menuEl.style.display = 'none';
  }
}
