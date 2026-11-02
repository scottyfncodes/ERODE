import type { LevelDef, SegmentKind } from '../levels/types';
import type { Composition, CompositionId } from '../sim/composition';
import type { LevelProgress, Medal, Records } from '../game/progress';
import type { Decision, RunResult } from '../run/runner';
import { CATEGORY_LABEL } from '../run/runner';
import './style.css';
import { kg, seconds } from './format';
import { BRAND, wordmark } from './brand';

export const ICONS = {
  menu: '<svg viewBox="0 0 24 24"><path d="M5 7h14M5 12h14M5 17h14"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M9 6v12M15 6v12"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10-6.5z"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  replay: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/></svg>',
  left: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M14 6l-6 6 6 6"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M5 12h13M13 6l6 6-6 6"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  mountains: '<svg viewBox="0 0 24 24"><path d="M3 20l6-12 4 7 3-4 5 9z"/></svg>',
};

/** each kind of ground: an icon and what it's good (and bad) for */
export const KIND_UI: Record<SegmentKind, { icon: string; up: string[]; down: string[] }> = {
  summit: { icon: '<svg viewBox="0 0 24 24"><path d="M3 20l9-15 9 15z"/></svg>', up: [], down: [] },
  forest: { icon: '<svg viewBox="0 0 24 24"><path d="M12 3l-6 8h4l-5 7h14l-5-7h4z"/><path d="M12 18v3"/></svg>', up: ['Timber'], down: ['Speed'] },
  scree: { icon: '<svg viewBox="0 0 24 24"><path d="M2 19l5-8 3 3 4-8 8 13z"/></svg>', up: ['Speed', 'Jumps'], down: [] },
  ravine: { icon: '<svg viewBox="0 0 24 24"><path d="M3 4h5l2 8-2 8"/><path d="M21 4h-5l-2 8 2 8"/></svg>', up: ['Chains'], down: ['Danger'] },
  camp: { icon: '<svg viewBox="0 0 24 24"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/></svg>', up: ['Buildings'], down: ['Speed'] },
  loose: { icon: '<svg viewBox="0 0 24 24"><path d="M3 5c7 0 10 7 18 14"/><circle cx="8" cy="13" r="1.7"/><circle cx="13" cy="17" r="1.5"/><circle cx="5" cy="9.5" r="1.2"/></svg>', up: ['Slides', 'Speed'], down: [] },
  finale: { icon: '<svg viewBox="0 0 24 24"><path d="M6 21V4"/><path d="M6 4h11l-3 4 3 4H6"/></svg>', up: [], down: [] },
};

export interface UIHandlers {
  play(): void;
  pickLevel(id: string): void;
  mountains(): void;
  release(): void;
  menu(): void;
  retry(): void;
  next(): void;
  pause(): void;
  toggleSound(): void;
  toggleMusic(): void;
  toTitle(): void;
  resumeFromMenu(): void;
  composition(id: CompositionId): void;
  choose(side: 'left' | 'right' | 'centre'): void;
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
  mass: number;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

const MEDAL_NAME: Record<Medal, string> = { none: 'No medal', bronze: 'Bronze', silver: 'Silver', gold: 'Gold', platinum: 'Platinum' };

function medalBadge(m: Medal, size = ''): string {
  return `<span class="medal m-${m} ${size}" aria-label="${MEDAL_NAME[m]}"><i></i></span>`;
}

export const pts = (n: number) => Math.round(n).toLocaleString('en-US');

/** ways down (route stretches between forks) the player has ridden, of all there are */
function waysFound(level: LevelDef, lp: LevelProgress | undefined): [number, number] {
  const ways = level.segments.filter((s) => s.kind !== 'summit' && s.kind !== 'finale');
  return [ways.filter((s) => lp?.found.includes(s.id)).length, ways.length];
}
const short = (n: number) => (n >= 10000 ? `${Math.round(n / 1000)}k` : pts(n));

export class UI {
  private root: HTMLElement;
  private h: UIHandlers;
  private title!: HTMLElement;
  private mountainsEl!: HTMLElement;
  private ready!: HTMLElement;
  private run!: HTMLElement;
  private results!: HTMLElement;
  private menuEl!: HTMLElement;
  private compSheet!: HTMLElement;
  private tipEl!: HTMLElement;
  private scoreNum!: HTMLElement;
  private chainEl!: HTMLElement;
  private speedNum!: HTMLElement;
  private integrityFill!: HTMLElement;
  private integrityBox!: HTMLElement;
  private progressFill!: HTMLElement;
  private progressTrack!: HTMLElement;
  private segName!: HTMLElement;
  private pauseBtn!: HTMLButtonElement;
  private decisionEl!: HTMLElement;
  private decisionTimer!: HTMLElement;
  private popLayer!: HTMLElement;
  private banner!: HTMLElement;
  private flash!: HTMLElement;
  private bannerTimer = 0;
  private tipTimer = 0;
  private chainTimer = 0;
  private shownScore = 0;
  private targetScore = 0;
  private decisionKey = '';
  /** a fork whose prompt has been dismissed (committed) */
  private dismissed = '';

  constructor(root: HTMLElement, handlers: UIHandlers) {
    this.root = root;
    this.h = handlers;
    this.build();
    const tick = () => {
      requestAnimationFrame(tick);
      if (this.targetScore !== this.shownScore) {
        const d = this.targetScore - this.shownScore;
        this.shownScore = Math.abs(d) < 2 ? this.targetScore : this.shownScore + d * 0.18;
        this.scoreNum.textContent = pts(this.shownScore);
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
        <div class="title-tag"><b>Unleash a geological catastrophe.</b><br>You don't steer the boulder. You decide where it goes — then watch the mountain come apart.</div>
      </div>
      <div class="title-bottom"><div class="title-stats" id="title-stats"></div></div>`;
    const go = this.btn('btn-go interactive', 'Play', () => this.h.play());
    go.id = 'begin';
    this.title.querySelector('.title-bottom')!.append(go);

    // ---------------- mountains
    this.mountainsEl = el('div', 'mountains interactive');
    this.mountainsEl.style.display = 'none';

    // ---------------- ready (the summit)
    this.ready = el('div', 'hud hidden ready');
    const card = el('div', 'level-card interactive');
    card.innerHTML = `
      <div class="lc-row"><span class="stage-label"></span><span class="env"></span></div>
      <h1></h1>
      <p class="lc-tag"></p>
      <button class="comp-pick"></button>
      <div class="targets"></div>
      <div class="lc-found"></div>`;
    card.querySelector('.comp-pick')!.addEventListener('click', (e) => {
      e.stopPropagation();
      this.compSheet.classList.toggle('show');
    });
    const corner = el('div', 'corner');
    corner.append(this.btn('icon-btn interactive', ICONS.back, () => this.h.mountains(), 'Mountains'), this.btn('icon-btn interactive', ICONS.menu, () => this.h.menu(), 'Menu'));
    const rw = el('div', 'release-wrap');
    const rel = this.btn('release interactive', 'Release', () => this.h.release());
    rel.id = 'release';
    rw.append(rel, el('div', 'release-hint', 'Choose your way down at each fork — <b>tap left or right</b>.'));
    this.compSheet = el('div', 'comp-sheet interactive');
    this.ready.append(card, corner, this.compSheet, rw);

    // ---------------- run
    this.run = el('div', 'hud hidden run');
    const top = el('div', 'run-top');
    top.innerHTML = `<div class="score-box"><div class="score-num">0</div><div class="score-k">Destruction</div><div class="chain"></div></div>`;
    this.scoreNum = top.querySelector('.score-num') as HTMLElement;
    this.chainEl = top.querySelector('.chain') as HTMLElement;
    const prog = el('div', 'run-progress', '<div class="rp-track"><div class="rp-fill"></div></div><div class="rp-seg"></div>');
    this.progressTrack = prog.querySelector('.rp-track') as HTMLElement;
    this.progressFill = prog.querySelector('.rp-fill') as HTMLElement;
    this.segName = prog.querySelector('.rp-seg') as HTMLElement;
    const rc = el('div', 'corner');
    this.pauseBtn = this.btn('icon-btn interactive', ICONS.pause, () => this.h.pause(), 'Pause');
    rc.append(this.pauseBtn);
    const bottom = el('div', 'run-bottom');
    bottom.innerHTML = `
      <div class="speedo"><b class="speed-num">0</b><span>km/h</span></div>
      <div class="integrity"><div class="int-k">Integrity</div><div class="int-bar"><div class="int-fill"></div></div></div>`;
    this.speedNum = bottom.querySelector('.speed-num') as HTMLElement;
    this.integrityFill = bottom.querySelector('.int-fill') as HTMLElement;
    this.integrityBox = bottom.querySelector('.integrity') as HTMLElement;
    this.decisionEl = el('div', 'decision');
    this.decisionTimer = el('div', 'dec-timer', '<i></i>');
    this.banner = el('div', 'banner');
    this.flash = el('div', 'flash');
    this.run.append(this.flash, top, prog, rc, bottom, this.decisionEl, this.banner);
    this.popLayer = el('div', 'pops');

    // ---------------- results / menu / tip
    this.results = el('div', 'results interactive');
    this.results.style.display = 'none';
    this.menuEl = el('div', 'menu interactive');
    this.menuEl.style.display = 'none';
    this.tipEl = el('div', 'tip');
    this.root.append(this.title, this.mountainsEl, this.ready, this.run, this.popLayer, this.results, this.tipEl, this.menuEl);
  }

  private enable(node: HTMLElement, on: boolean) {
    node.querySelectorAll('button,input').forEach((b) => ((b as HTMLElement).style.pointerEvents = on ? '' : 'none'));
  }

  // ---------------------------------------------------------- title
  showTitle(stats: { medals: Record<Medal, number>; finished: number; total: number; best: number }) {
    const s = this.title.querySelector('#title-stats')!;
    s.innerHTML = stats.finished
      ? `<span>${stats.finished}/${stats.total} mountains</span>${(['platinum', 'gold', 'silver', 'bronze'] as Medal[])
          .filter((m) => stats.medals[m])
          .map((m) => `<span class="ts-medal">${medalBadge(m, 'sm')}${stats.medals[m]}</span>`)
          .join('')}`
      : `<span>${stats.total} mountains · one boulder</span>`;
    (this.title.querySelector('#begin') as HTMLElement).textContent = stats.finished || stats.best ? 'Continue' : 'Play';
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
      const [found, total] = waysFound(c.level, lp);
      const b = el('button', `mt-card${c.unlocked ? '' : ' locked'}${current === c.level.id ? ' current' : ''}`);
      b.innerHTML = `
        <div class="mt-stage">${c.level.stage}</div>
        <div class="mt-body">
          <div class="mt-env">${c.level.environment}</div>
          <div class="mt-name">${c.level.name}</div>
          <div class="mt-sub">${c.unlocked ? (lp?.bestScore ? `Best <b>${pts(lp.bestScore)}</b>${lp.bestChain ? ` · chain ×${lp.bestChain}` : ''}` : c.level.tagline) : c.lockText}</div>
          ${c.unlocked ? `<div class="mt-goals">${(['silver', 'gold', 'platinum'] as const).map((k) => `<span class="${lp && lp.finished && lp.bestScore >= c.level.medals[k] ? 'hit' : ''}">${medalBadge(k, 'xs')}${short(c.level.medals[k])}</span>`).join('')}<span class="mt-obj">${found}/${total} ways found</span></div>` : ''}
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

  // ---------------------------------------------------------- ready
  showReady(level: LevelDef, lp: LevelProgress | undefined, firstTime: boolean) {
    const card = this.ready.querySelector('.level-card')!;
    card.querySelector('.stage-label')!.textContent = level.stage;
    card.querySelector('.env')!.textContent = level.environment;
    card.querySelector('h1')!.textContent = level.name;
    card.querySelector('.lc-tag')!.textContent = level.tagline;
    card.querySelector('.targets')!.innerHTML =
      (['silver', 'gold', 'platinum'] as const).map((k) => `<span class="tg">${medalBadge(k, 'xs')}<b>${short(level.medals[k])}</b></span>`).join('') +
      (lp?.bestScore ? `<span class="tg best">Best <b>${pts(lp.bestScore)}</b></span>` : '');
    const [found, total] = waysFound(level, lp);
    card.querySelector('.lc-found')!.innerHTML = `<span>${found}/${total} ways down found</span>${lp?.medal && lp.medal !== 'none' ? medalBadge(lp.medal, 'xs') : ''}`;
    (this.ready.querySelector('.release-hint') as HTMLElement).style.display = firstTime ? '' : 'none';
    this.ready.classList.remove('hidden');
    this.enable(this.ready, true);
  }
  hideReady() {
    this.ready.classList.add('hidden');
    this.compSheet.classList.remove('show');
  }
  setCompositions(choices: CompositionChoice[], current: CompositionId) {
    const cur = choices.find((c) => c.comp.id === current) ?? choices[0];
    const pick = this.ready.querySelector('.comp-pick') as HTMLElement;
    pick.innerHTML = `<span class="swatch s-${cur.comp.id}"></span><b>${cur.comp.name}</b><span class="cp-mass">${kg(cur.mass)}</span><span class="cp-more">Change</span>`;
    this.compSheet.innerHTML = '';
    const head = el('div', 'cs-head');
    head.append(el('h3', '', 'Your boulder'), this.btn('close-x', '×', () => this.compSheet.classList.remove('show'), 'Close'));
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

  tip(text: string | null, ms = 0) {
    window.clearTimeout(this.tipTimer);
    if (!text) {
      this.tipEl.classList.remove('show');
      return;
    }
    this.tipEl.innerHTML = text;
    this.tipEl.classList.add('show');
    if (ms) this.tipTimer = window.setTimeout(() => this.tipEl.classList.remove('show'), ms);
  }

  // ---------------------------------------------------------- run
  showRun(forkFractions: number[]) {
    this.run.classList.remove('hidden');
    this.enable(this.run, true);
    this.shownScore = this.targetScore = 0;
    this.scoreNum.textContent = '0';
    this.chainEl.classList.remove('show');
    this.setPaused(false);
    this.progressTrack.querySelectorAll('.rp-tick').forEach((t) => t.remove());
    for (const f of forkFractions) {
      const t = el('div', 'rp-tick');
      t.style.left = `${(f * 100).toFixed(1)}%`;
      this.progressTrack.append(t);
    }
    this.hideDecision();
  }
  hideRun() {
    this.run.classList.add('hidden');
    this.banner.classList.remove('show');
    this.hideDecision();
  }
  setPaused(p: boolean) {
    this.pauseBtn.innerHTML = p ? ICONS.play : ICONS.pause;
  }
  setRun(s: { score: number; speed: number; integrity: number; progress: number; segment: string }) {
    this.targetScore = s.score;
    this.speedNum.textContent = String(Math.round(s.speed * 3.6));
    this.integrityFill.style.width = `${(Math.max(0, s.integrity) * 100).toFixed(1)}%`;
    this.integrityBox.dataset.level = s.integrity < 0.25 ? 'low' : s.integrity < 0.5 ? 'mid' : 'ok';
    this.progressFill.style.width = `${(Math.max(0, Math.min(1, s.progress)) * 100).toFixed(1)}%`;
    if (this.segName.textContent !== s.segment) this.segName.textContent = s.segment;
  }
  hurt() {
    this.integrityBox.classList.remove('hit');
    void this.integrityBox.offsetWidth;
    this.integrityBox.classList.add('hit');
  }
  chain(n: number) {
    window.clearTimeout(this.chainTimer);
    this.chainEl.innerHTML = `Chain <b>×${n}</b>`;
    this.chainEl.classList.remove('show');
    void this.chainEl.offsetWidth;
    this.chainEl.classList.add('show');
    this.chainTimer = window.setTimeout(() => this.chainEl.classList.remove('show'), 1800);
  }

  /** The fork: the ways down, one per side of the screen, and the time left. */
  showDecision(d: Decision, firstTime: boolean) {
    const key = `${d.from}`;
    if (this.dismissed === key) return;
    if (this.decisionKey !== key) {
      this.decisionKey = key;
      this.decisionEl.innerHTML = '';
      this.decisionEl.className = `decision n${d.options.length}`;
      d.options.forEach((o, i) => {
        const k = KIND_UI[o.kind];
        const b = el('button', `dec-opt side-${o.side}${i === d.fallback ? ' fall' : ''}`);
        b.dataset.i = String(i);
        b.innerHTML = `
          <span class="dec-arrow">${o.side === 'left' ? ICONS.left : o.side === 'right' ? ICONS.right : '<svg viewBox="0 0 24 24"><path d="M5 9l7 7 7-7"/></svg>'}</span>
          <span class="dec-body"><span class="dec-icon">${k.icon}</span><b>${o.name}</b>
          <span class="dec-tags">${k.up.map((t) => `<i class="up">${t}</i>`).join('')}${k.down.map((t) => `<i class="down">${t}</i>`).join('')}</span></span>`;
        b.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.h.choose(o.side);
        });
        this.decisionEl.append(b);
      });
      this.decisionEl.append(this.decisionTimer);
      if (firstTime) this.decisionEl.append(el('div', 'dec-hint', 'Tap a side to commit'));
      requestAnimationFrame(() => this.decisionEl.classList.add('show'));
    }
    const frac = d.window > 0 ? d.timeLeft / d.window : 0;
    (this.decisionTimer.firstElementChild as HTMLElement).style.transform = `scaleX(${Math.max(0, Math.min(1, frac)).toFixed(3)})`;
    if (d.chosen !== null) this.decisionEl.classList.add('locked');
    this.decisionEl.querySelectorAll('.dec-opt').forEach((b) => {
      const i = Number((b as HTMLElement).dataset.i);
      b.classList.toggle('chosen', d.chosen === i);
      b.classList.toggle('dropped', d.chosen !== null && d.chosen !== i);
    });
  }
  /** the commitment lands: the chosen way stays a moment, then the prompt clears */
  committed(auto: boolean, name: string) {
    const key = this.decisionKey;
    this.decisionEl.classList.add('locked');
    if (auto) {
      this.decisionEl.querySelectorAll('.dec-opt').forEach((b) => b.classList.toggle('chosen', (b.querySelector('b')?.textContent ?? '') === name));
      this.decisionEl.querySelectorAll('.dec-opt:not(.chosen)').forEach((b) => b.classList.add('dropped'));
    }
    window.setTimeout(() => {
      this.dismissed = key;
      this.hideDecision();
    }, auto ? 900 : 650);
  }
  hideDecision() {
    this.decisionKey = '';
    this.decisionEl.classList.remove('show', 'locked');
    window.setTimeout(() => {
      if (!this.decisionKey) this.decisionEl.innerHTML = '';
    }, 300);
  }

  /** points floating where it happened */
  scorePop(x: number, y: number, points: number, label: string, big: boolean) {
    const p = el('div', `pop score${big ? ' big' : ''}`, `<b>+${pts(points)}</b>${label ? `<span>${label}</span>` : ''}`);
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    this.popLayer.append(p);
    window.setTimeout(() => p.remove(), 1600);
    while (this.popLayer.childElementCount > 5) this.popLayer.firstElementChild?.remove();
  }
  bigBanner(text: string, sub = '', ms = 1600, cls = '') {
    window.clearTimeout(this.bannerTimer);
    this.banner.className = `banner ${cls}`;
    this.banner.innerHTML = `<div>${text}</div>${sub ? `<small>${sub}</small>` : ''}`;
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
  showResults(
    r: RunResult,
    level: LevelDef,
    rec: Records,
    lp: LevelProgress,
    opts: { hasNext: boolean; nextName?: string; compName: string; tip: string },
  ) {
    const seg = (id: string) => level.segments.find((s) => s.id === id)!;
    const route = r.route.filter((id) => seg(id).kind !== 'summit');
    const s = r.stats;
    const recs: string[] = [];
    if (rec.firstFinish) recs.push('First descent');
    if (rec.bestScore) recs.push('New best');
    if (rec.bestChain) recs.push(`Longest chain · ×${s.longestChain}`);
    if (rec.newSegments.length && lp.found.length > rec.newSegments.length) recs.push(`${rec.newSegments.length} new way${rec.newSegments.length > 1 ? 's' : ''} found`);
    for (const c of rec.unlockedCompositions) recs.push(`Unlocked · ${c}`);
    if (rec.unlockedLevel) recs.push(`Unlocked · ${rec.unlockedLevel}`);
    const rows: [string, number, string][] = [
      ['Destruction', r.score.destruction, `${r.categories.map((c) => CATEGORY_LABEL[c]).join(' · ') || '—'}`],
      ['Chain reactions', r.score.chain, s.chains ? `${s.chains} chain${s.chains > 1 ? 's' : ''} · longest ×${s.longestChain}` : 'none'],
      ['Variety', r.score.variety, `${r.categories.length} kinds of destruction`],
      ['Speed', r.score.speed, s.milestones.length ? s.milestones.map((m) => `${m} km/h`).join(' · ') : `top ${Math.round(s.topSpeed * 3.6)} km/h`],
      ['Distance', r.score.distance, `${Math.round(s.distance)} m`],
      ['Completion', r.score.completion, r.finished ? (s.finaleFlattened ? `${level.finale.name} at ${Math.round(s.finaleSpeed * 3.6)} km/h` : 'reached the bottom') : 'did not finish'],
    ];
    this.results.innerHTML = `
      <div class="scroll">
        <div class="res-head">
          <div class="res-medal">${medalBadge(rec.medal, 'xl')}<span>${r.finished ? MEDAL_NAME[rec.medal] : 'Did not finish'}</span></div>
          <div class="res-title">
            <div class="res-level">${level.stage} · ${level.name} · ${opts.compName}</div>
            <div class="verdict">${r.cause}</div>
          </div>
        </div>
        <div class="total"><span class="total-num">0</span><span class="total-k">points${rec.previous.score > 0 ? ` · best ${pts(Math.max(rec.previous.score, r.score.total))}` : ''}</span></div>
        ${recs.length ? `<div class="records">${recs.map((x) => `<span>${x}</span>`).join('')}</div>` : ''}
        <div class="route-ribbon">${route
          .map((id) => {
            const q = seg(id);
            return `<span class="rr k-${q.kind}">${KIND_UI[q.kind].icon}<b>${q.name}</b></span>`;
          })
          .join('<i></i>')}</div>
        <div class="breakdown">${rows.map(([k, v, sub]) => `<div class="bd-row${v ? '' : ' zero'}"><span><b>${k}</b><small>${sub}</small></span><em>${v ? `+${pts(v)}` : '—'}</em></div>`).join('')}</div>
        <div class="stats">
          <div class="stat"><div class="k">Trees felled</div><div class="v">${s.trees}</div><div class="s">${s.treesChain} by falling timber & debris${s.cracked ? ` · ${s.cracked} cracked` : ''}</div></div>
          <div class="stat"><div class="k">Buildings</div><div class="v">${s.structures}</div><div class="s">${s.parts} timbers sent flying</div></div>
          <div class="stat"><div class="k">Rock</div><div class="v">${s.rocks + s.pillars}</div><div class="s">${s.rocks} shattered${s.pillars ? ` · ${s.pillars} pillars` : ''}${s.slides ? ` · ${s.slides} slides (${s.slideRocks} rocks)` : ''}</div></div>
          <div class="stat"><div class="k">The run</div><div class="v sm">${seconds(r.duration)}</div><div class="s">top ${Math.round(s.topSpeed * 3.6)} km/h${s.airTime > 0.5 ? ` · ${s.airTime.toFixed(1)} s airborne` : ''} · ${Math.round(r.integrity * 100)}% intact</div></div>
        </div>
        ${r.highlights.length ? `<div class="sect">Biggest moments</div><div class="moments">${r.highlights.map((m) => `<div><span>${m.label}</span><b>+${pts(m.points)}</b></div>`).join('')}</div>` : ''}
        <p class="why">${opts.tip}</p>
      </div>
      <div class="buttons"></div>`;
    const b = this.results.querySelector('.buttons')!;
    if (opts.hasNext && r.finished) b.append(this.actBtn(`Next: ${opts.nextName ?? ''}`, 'primary', () => this.h.next(), 'next'));
    b.append(this.actBtn('Run it again', opts.hasNext && r.finished ? '' : 'primary', () => this.h.retry(), 'replay'), this.actBtn('Mountains', '', () => this.h.mountains(), 'mountains'));
    this.results.style.display = '';
    requestAnimationFrame(() => this.results.classList.add('show'));
    // the total counts up, row by row
    const num = this.results.querySelector('.total-num') as HTMLElement;
    const t0 = performance.now() + 450;
    const dur = 1700;
    const animate = (t: number) => {
      const u = Math.max(0, Math.min(1, (t - t0) / dur));
      const e = 1 - Math.pow(1 - u, 3);
      num.textContent = pts(r.score.total * e);
      if (u < 1 && this.results.classList.contains('show')) requestAnimationFrame(animate);
      else this.results.querySelector('.res-medal')?.classList.add('land');
    };
    requestAnimationFrame(animate);
    this.results.querySelectorAll('.bd-row').forEach((row, i) => ((row as HTMLElement).style.animationDelay = `${0.35 + i * 0.12}s`));
  }
  hideResults() {
    this.results.classList.remove('show');
    window.setTimeout(() => {
      if (!this.results.classList.contains('show')) this.results.style.display = 'none';
    }, 500);
  }

  // ---------------------------------------------------------- menu
  showMenu(sound: boolean, music: boolean, inRun: boolean) {
    this.menuEl.innerHTML = '';
    const card = el('div', 'menu-card');
    card.append(
      el('h2', '', inRun ? 'Paused' : BRAND.name),
      this.actBtn(`Sound <b>${sound ? 'On' : 'Off'}</b>`, '', () => this.h.toggleSound()),
      this.actBtn(`Ambience <b>${music ? 'On' : 'Off'}</b>`, '', () => this.h.toggleMusic()),
      ...(inRun ? [this.actBtn('Restart run', '', () => this.h.retry())] : []),
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
