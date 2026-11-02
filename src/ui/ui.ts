import type { LevelDef, Zone } from '../levels/types';
import { STAGES, type SimResult } from '../sim/simulation';
import type { Progress } from '../game/progress';
import './style.css';
import { sizeLabel } from './format';

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
  bolt: '<svg viewBox="0 0 24 24"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>',
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
  begin(): void;
  release(): void;
  reset(): void;
  menu(): void;
  action(key: string): void;
  closeContext(): void;
  replay(): void;
  adjust(): void;
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
  zone(id: string): void;
  nudge(dir: number): void;
  steer(dir: number): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

export { sizeLabel };

export class UI {
  private root: HTMLElement;
  private h: UIHandlers;
  private title!: HTMLElement;
  private plan!: HTMLElement;
  private run!: HTMLElement;
  private results!: HTMLElement;
  private replayBar!: HTMLElement;
  private menuEl!: HTMLElement;
  private context!: HTMLElement;
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
  private scoreEl!: HTMLElement;
  private comboEl!: HTMLElement;
  private chainEl!: HTMLElement;
  private sizeEl!: HTMLElement;
  private distFill!: HTMLElement;
  private distMarker!: HTMLElement;
  private distLabel!: HTMLElement;
  private nudgeDots!: HTMLElement;
  private nudgeBtns: HTMLButtonElement[] = [];
  private popLayer!: HTMLElement;
  private banner!: HTMLElement;
  private flash!: HTMLElement;
  private calloutTimer = 0;
  private tipTimer = 0;
  private bannerTimer = 0;
  private scrubbing = false;
  private shownScore = 0;
  private targetScore = 0;
  private lastStage = -1;

  constructor(root: HTMLElement, handlers: UIHandlers) {
    this.root = root;
    this.h = handlers;
    this.build();
    const tick = () => {
      requestAnimationFrame(tick);
      if (Math.abs(this.targetScore - this.shownScore) > 0.5) {
        this.shownScore += (this.targetScore - this.shownScore) * 0.18;
        this.scoreEl.textContent = fmt(this.shownScore);
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

  private chain(): HTMLElement {
    const c = el('div', 'chain');
    STAGES.forEach((s, i) => {
      if (i) c.append(el('span', 'chain-sep', '›'));
      c.append(el('span', 'chain-item', s.name));
    });
    return c;
  }

  private build() {
    // ---------------- title
    this.title = el('div', 'title hidden');
    const top = el('div', 'title-top');
    top.append(
      el('div', 'arcade-mark', 'ERODE'),
      el('div', 'title-tag', 'Steer it down the mountain. Smash it on the rocks.<br><b>How small can you grind it?</b>'),
    );
    const bottom = el('div', 'title-bottom');
    const best = el('div', 'title-best');
    best.id = 'title-best';
    const begin = this.btn('btn-go interactive', 'Start', () => this.h.begin());
    begin.id = 'begin';
    const ch = this.chain();
    ch.id = 'title-chain';
    bottom.append(ch, best, begin);
    this.title.append(top, bottom);

    // ---------------- planning
    this.plan = el('div', 'hud hidden');
    const card = el('div', 'level-card');
    card.innerHTML = '<div class="stage-label"></div><h1></h1><div class="plan-goal"></div>';
    const changes = el('div', 'changes');
    this.changesLabel = el('span', '', 'Moves');
    this.pipsEl = el('div', 'pips');
    changes.append(this.changesLabel, this.pipsEl);
    card.append(changes);
    const tr = el('div', 'top-right');
    this.ghostBtn = this.btn('icon-btn interactive', ICONS.eye, () => this.h.toggleGhost(), 'Show last path');
    tr.append(this.ghostBtn, this.btn('icon-btn interactive', ICONS.reset, () => this.h.reset(), 'Reset the mountain'), this.btn('icon-btn interactive', ICONS.menu, () => this.h.menu(), 'Menu'));
    this.zonesEl = el('div', 'zones interactive');
    const rw = el('div', 'release-wrap');
    const rel = this.btn('release interactive', 'Break it loose', () => this.h.release());
    rel.id = 'release';
    rw.append(rel);
    this.context = el('div', 'context interactive');
    this.plan.append(card, tr, this.context, this.zonesEl, rw);

    // ---------------- run
    this.run = el('div', 'hud hidden run');
    const scoreBox = el('div', 'score-box');
    this.scoreEl = el('div', 'score', '0');
    this.comboEl = el('div', 'combo');
    scoreBox.append(this.scoreEl, this.comboEl);
    const sizeBox = el('div', 'size-box');
    this.chainEl = this.chain();
    this.sizeEl = el('div', 'size-readout');
    sizeBox.append(this.chainEl, this.sizeEl);
    const rtr = el('div', 'top-right');
    this.pauseBtn = this.btn('icon-btn interactive', ICONS.pause, () => this.h.pause(), 'Pause');
    rtr.append(this.pauseBtn, this.btn('icon-btn interactive', ICONS.ff, () => this.h.skip(), 'Fast forward'));
    const dist = el('div', 'dist');
    const track = el('div', 'dist-track');
    this.distFill = el('div', 'dist-fill');
    this.distMarker = el('div', 'dist-marker');
    track.append(this.distFill, this.distMarker);
    this.distLabel = el('div', 'dist-label');
    dist.append(track, this.distLabel);
    // hold-to-steer buttons (drag anywhere works too)
    const nudge = el('div', 'nudge');
    const hold = (dir: number, label: string, icon: string) => {
      const b = el('button', 'nudge-btn interactive', icon);
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
    const nl = hold(-1, 'Steer left', ICONS.left);
    const nr = hold(1, 'Steer right', ICONS.right);
    this.nudgeBtns = [nl, nr];
    this.nudgeDots = el('div', 'steer-mid');
    this.steerBar = el('div', 'steer-bar');
    this.steerKnob = el('div', 'steer-knob');
    this.steerBar.append(this.steerKnob);
    this.nudgeDots.append(this.steerBar, el('div', 'steer-hint', 'Drag left / right to steer'));
    nudge.append(nl, this.nudgeDots, nr);
    this.calloutEl = el('div', 'callout');
    this.popLayer = el('div', 'pops');
    this.banner = el('div', 'banner');
    this.flash = el('div', 'flash');
    this.run.append(this.flash, scoreBox, sizeBox, rtr, dist, nudge, this.calloutEl, this.banner);

    // ---------------- results / replay / menu / tip
    this.results = el('div', 'results interactive');
    this.results.style.display = 'none';
    this.replayBar = el('div', 'hud hidden');
    const bar = el('div', 'replay-bar interactive');
    this.playBtn = this.btn('icon-btn', ICONS.pause, () => this.h.replayToggle(), 'Play or pause');
    this.range = el('input') as HTMLInputElement;
    this.range.type = 'range';
    this.range.min = '0';
    this.range.max = '1000';
    this.range.value = '0';
    this.range.addEventListener('input', () => {
      this.scrubbing = true;
      this.h.scrub(Number(this.range.value) / 1000);
    });
    this.range.addEventListener('change', () => (this.scrubbing = false));
    this.speedEl = this.btn('speed', '1×', () => this.h.replaySpeed(), 'Replay speed');
    bar.append(this.playBtn, this.range, this.speedEl, this.btn('icon-btn', ICONS.close, () => this.h.exitReplay(), 'Close replay'));
    this.replayBar.append(bar);
    this.menuEl = el('div', 'menu interactive');
    this.menuEl.style.display = 'none';
    this.tipEl = el('div', 'tip');
    this.root.append(this.title, this.plan, this.run, this.popLayer, this.results, this.replayBar, this.tipEl, this.menuEl);
  }

  private lightChain(c: HTMLElement, upTo: number, current = -1) {
    c.querySelectorAll('.chain-item').forEach((n, i) => {
      n.classList.toggle('lit', i <= upTo);
      n.classList.toggle('now', i === current);
    });
  }

  // ---------------------------------------------------------- title
  showTitle(progress: Progress, level: LevelDef) {
    const lp = progress.levels[level.id];
    const best = this.title.querySelector('#title-best')!;
    best.innerHTML = lp?.bestScore
      ? `<span>Best</span> <b>${fmt(lp.bestScore)}</b> <i class="grade g-${lp.bestGrade}">${lp.bestGrade}</i>`
      : '<span>Summit → Sea · 1.1 km of mountain</span>';
    this.lightChain(this.title.querySelector('#title-chain')!, lp?.bestStage ?? -1);
    (this.title.querySelector('#begin') as HTMLElement).textContent = lp?.attempts ? 'Play again' : 'Start';
    this.title.classList.remove('hidden');
    this.title.querySelectorAll('button').forEach((b) => ((b as HTMLElement).style.pointerEvents = ''));
  }
  hideTitle() {
    this.title.classList.add('hidden');
    this.title.querySelectorAll('button').forEach((b) => ((b as HTMLElement).style.pointerEvents = 'none'));
  }

  // ---------------------------------------------------------- planning
  showPlanning(level: LevelDef) {
    this.plan.querySelector('.stage-label')!.textContent = level.stage;
    this.plan.querySelector('h1')!.textContent = level.name;
    this.plan.querySelector('.plan-goal')!.innerHTML = 'Clear the <b class="t-block">blockers</b>. Line up the <b class="t-smash">smashers</b>.';
    this.zonesEl.innerHTML = '';
    for (const z of level.zones ?? []) {
      const b = this.btn('zone-chip', z.name.replace(/^The /, ''), () => this.h.zone(z.id));
      b.dataset.zone = z.id;
      this.zonesEl.append(b);
    }
    this.plan.classList.remove('hidden');
    this.plan.querySelectorAll('button').forEach((b) => ((b as HTMLElement).style.pointerEvents = ''));
  }
  hidePlanning() {
    this.plan.classList.add('hidden');
    this.hideContext();
  }
  setZone(id: string | null) {
    this.zonesEl.querySelectorAll('.zone-chip').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.zone === id));
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

  showContext(title: string, tag: string, text: string, actions: ContextAction[], note?: string, kind: 'smash' | 'block' | 'tweak' = 'tweak') {
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
    this.tip(null);
  }
  hideContext() {
    this.context.classList.remove('show');
    this.tipEl.classList.remove('lift');
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
  showRun(zones: Zone[], nudges: number) {
    this.run.classList.remove('hidden');
    this.run.querySelectorAll('button').forEach((b) => ((b as HTMLElement).style.pointerEvents = ''));
    this.targetScore = 0;
    this.shownScore = 0;
    this.scoreEl.textContent = '0';
    this.lastStage = -1;
    this.comboEl.className = 'combo';
    this.setPaused(false);
    this.setNudges(nudges);
    const hint = this.nudgeDots.querySelector('.steer-hint') as HTMLElement;
    hint.style.animation = 'none';
    void hint.offsetWidth;
    hint.style.animation = '';
    // zone ticks along the distance bar
    const track = this.run.querySelector('.dist-track')!;
    track.querySelectorAll('.dist-tick').forEach((t) => t.remove());
    const z0 = zones[0]?.z[0] ?? 0;
    const z1 = zones[zones.length - 1]?.z[0] ?? 1;
    for (const z of zones.slice(1)) {
      const t = el('div', 'dist-tick');
      t.style.left = `${((z.z[0] - z0) / (z1 - z0)) * 100}%`;
      t.title = z.name;
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
  private steerBar!: HTMLElement;
  private steerKnob!: HTMLElement;
  /** live steering indicator, -1 … 1 */
  setSteer(v: number) {
    this.steerKnob.style.left = `${(50 + v * 50).toFixed(1)}%`;
    this.steerKnob.style.opacity = String(0.45 + Math.abs(v) * 0.55);
  }
  setNudges(_n: number) {
    for (const b of this.nudgeBtns) b.classList.remove('held');
  }
  setRun(s: { score: number; combo: number; stage: number; best: number; size: number; progress: number; distance: number; zone: string }) {
    this.targetScore = s.score;
    if (s.combo >= 2) {
      this.comboEl.textContent = `×${s.combo} combo`;
      this.comboEl.className = `combo show c${Math.min(5, s.combo)}`;
    } else this.comboEl.className = 'combo';
    if (s.stage !== this.lastStage) {
      this.lastStage = s.stage;
      this.lightChain(this.chainEl, s.best, s.stage);
    }
    this.sizeEl.innerHTML = `<b>${sizeLabel(s.size)}</b> ${STAGES[s.stage].name}`;
    const pct = Math.max(0, Math.min(1, s.progress)) * 100;
    this.distFill.style.width = `${pct}%`;
    this.distMarker.style.left = `${pct}%`;
    this.distLabel.innerHTML = `<b>${Math.round(s.distance)} m</b> ${s.zone}`;
  }
  callout(text: string, ms = 2200) {
    window.clearTimeout(this.calloutTimer);
    this.calloutEl.textContent = text;
    this.calloutEl.classList.add('show');
    this.calloutTimer = window.setTimeout(() => this.calloutEl.classList.remove('show'), ms);
  }
  /** Floating arcade score text at a screen position. */
  pop(x: number, y: number, text: string, points: number, kind = '') {
    const p = el('div', `pop ${kind}`, `<span>${text}</span>${points ? `<b>+${fmt(points)}</b>` : ''}`);
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    this.popLayer.append(p);
    window.setTimeout(() => p.remove(), 1500);
    while (this.popLayer.childElementCount > 7) this.popLayer.firstElementChild?.remove();
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
  showResults(r: SimResult, why: string, best: { score: number; isBest: boolean }) {
    const rows = r.breakdown
      .filter((b) => b.points !== 0)
      .map((b) => `<li><span>${b.label}</span><b>${b.points > 0 ? '+' : ''}${fmt(b.points)}</b></li>`)
      .join('');
    const headline = r.unstable
      ? 'Something slipped'
      : r.sand
        ? 'PERFECT EROSION'
        : r.landed
          ? 'Beached!'
          : r.reason === 'lost'
            ? 'Lost to the mountain'
            : 'It stopped';
    this.results.innerHTML = `
      <div class="scroll">
        <div class="res-top">
          <div class="grade big g-${r.grade}">${r.grade}</div>
          <div>
            <div class="verdict">${headline}</div>
            <div class="res-score">${fmt(r.score)}</div>
            ${best.isBest ? '<div class="newbest">New best!</div>' : `<div class="bestline">Best ${fmt(best.score)}</div>`}
          </div>
        </div>
        <p class="why">${why}</p>
        <div class="res-chain"></div>
        <div class="stats">
          <div class="stat"><div class="k">Distance</div><div class="v">${Math.round(r.distance)}<small>m</small></div></div>
          <div class="stat"><div class="k">Final size</div><div class="v">${sizeLabel(r.size)}</div></div>
          <div class="stat"><div class="k">Hits</div><div class="v">${r.smashes + r.chips}</div></div>
          <div class="stat"><div class="k">Best combo</div><div class="v">×${Math.max(1, r.maxCombo)}</div></div>
          <div class="stat"><div class="k">Top speed</div><div class="v">${Math.round(r.topSpeed * 3.6)}<small>km/h</small></div></div>
          <div class="stat"><div class="k">Ended at</div><div class="v small">${cap(r.destination)}</div></div>
        </div>
        <div class="section-label">Score</div>
        <ul class="breakdown">${rows}</ul>
      </div>
      <div class="buttons"></div>`;
    const ch = this.chain();
    this.lightChain(ch, r.bestStage, r.stage);
    this.results.querySelector('.res-chain')!.append(ch);
    const b = this.results.querySelector('.buttons')!;
    b.append(
      this.actBtn('Go again', 'primary', () => this.h.adjust(), 'bolt'),
      this.actBtn('Replay', '', () => this.h.replay(), 'replay'),
      this.actBtn('Title', '', () => this.h.toTitle(), 'menu'),
    );
    this.results.style.display = '';
    requestAnimationFrame(() => this.results.classList.add('show'));
  }
  hideResults() {
    this.results.classList.remove('show');
    window.setTimeout(() => {
      if (!this.results.classList.contains('show')) this.results.style.display = 'none';
    }, 500);
  }
  private actBtn(label: string, cls: string, fn: () => void, icon?: keyof typeof ICONS) {
    const b = el('button', `act ${cls}`, `${icon ? ICONS[icon] : ''}<span>${label}</span>`);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      fn();
    });
    return b;
  }

  // ---------------------------------------------------------- replay
  showReplay() {
    this.replayBar.classList.remove('hidden');
    this.replayBar.querySelectorAll('button,input').forEach((b) => ((b as HTMLElement).style.pointerEvents = ''));
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
      el('h2', '', inRun ? 'Paused' : 'ERODE'),
      this.actBtn(`Sound <b>${sound ? 'On' : 'Off'}</b>`, '', () => this.h.toggleSound()),
      this.actBtn(`Music <b>${music ? 'On' : 'Off'}</b>`, '', () => this.h.toggleMusic()),
      this.actBtn('Back to title', '', () => this.h.toTitle()),
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

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
