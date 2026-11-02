import type { LevelDef } from '../levels/types';
import type { SimResult } from '../sim/simulation';
import type { Progress } from '../game/progress';
import './style.css';

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
  sound: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
  replay: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/><path d="M10 9v6l5-3z"/></svg>',
};

const STAR = '<svg class="star" viewBox="0 0 24 24"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z"/></svg>';

export interface ContextAction {
  key: string;
  label: string;
  icon?: keyof typeof ICONS;
  primary?: boolean;
  active?: boolean;
  disabled?: boolean;
  /** repeat while held (rotation) */
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
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

const pct = (v: number) => `${Math.round(v * 100)}`;

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
  private runStatus!: HTMLElement;
  private range!: HTMLInputElement;
  private speedEl!: HTMLElement;
  private playBtn!: HTMLButtonElement;
  private pauseBtn!: HTMLButtonElement;
  private ghostBtn!: HTMLButtonElement;
  private objectivesEl!: HTMLElement;
  private calloutTimer = 0;
  private tipTimer = 0;
  private scrubbing = false;

  constructor(root: HTMLElement, handlers: UIHandlers) {
    this.root = root;
    this.h = handlers;
    this.build();
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

  private build() {
    // title
    this.title = el('div', 'title hidden');
    const top = el('div');
    top.append(
      el('div', 'wordmark', 'ERODE'),
      el(
        'div',
        'journey',
        '<span>Boulder → Fragments → Rocks →</span> <span>Pebbles → Gravel → Sand</span>',
      ),
    );
    const bottom = el('div', 'title-bottom');
    const begin = this.btn('btn-primary interactive', 'Begin', () => this.h.begin());
    begin.id = 'begin';
    const stages = el('div', 'stages');
    stages.id = 'stages';
    bottom.append(begin, stages);
    this.title.append(top, bottom);

    // planning HUD
    this.plan = el('div', 'hud hidden');
    const card = el('div', 'level-card');
    card.innerHTML = '<div class="stage-label"></div><h1></h1>';
    this.objectivesEl = el('ul', 'objectives');
    const changes = el('div', 'changes');
    this.changesLabel = el('span', '', 'Changes');
    this.pipsEl = el('div', 'pips');
    changes.append(this.changesLabel, this.pipsEl);
    card.append(this.objectivesEl, changes);
    const tr = el('div', 'top-right');
    this.ghostBtn = this.btn('icon-btn interactive', ICONS.eye, () => this.h.toggleGhost(), 'Show last path');
    tr.append(
      this.ghostBtn,
      this.btn('icon-btn interactive', ICONS.reset, () => this.h.reset(), 'Reset the mountain'),
      this.btn('icon-btn interactive', ICONS.menu, () => this.h.menu(), 'Menu'),
    );
    const rw = el('div', 'release-wrap');
    const rel = this.btn('release interactive', 'Release', () => this.h.release());
    rel.id = 'release';
    rw.append(rel);
    this.context = el('div', 'context interactive');
    this.plan.append(card, tr, this.context, rw);

    // live run HUD
    this.run = el('div', 'hud hidden');
    this.runStatus = el('div', 'run-status');
    const rtr = el('div', 'top-right');
    this.pauseBtn = this.btn('icon-btn interactive', ICONS.pause, () => this.h.pause(), 'Pause');
    rtr.append(this.pauseBtn, this.btn('icon-btn interactive', ICONS.ff, () => this.h.skip(), 'Fast forward'));
    this.calloutEl = el('div', 'callout');
    this.run.append(this.runStatus, rtr, this.calloutEl);

    // results
    this.results = el('div', 'results interactive');

    // replay bar
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

    // menu
    this.menuEl = el('div', 'menu interactive');
    this.menuEl.style.display = 'none';

    this.tipEl = el('div', 'tip');

    this.root.append(this.title, this.plan, this.run, this.results, this.replayBar, this.tipEl, this.menuEl);
  }

  // ---------------------------------------------------------- title
  showTitle(progress: Progress, level: LevelDef) {
    const stages = ['The Mountain', 'The Foothills', 'The River', 'The Gorge', 'The Valley', 'The Delta', 'The Beach'];
    const lp = progress.levels[level.id];
    const s = this.title.querySelector('#stages')!;
    s.innerHTML = '';
    stages.forEach((name, i) => {
      const d = el('div', `stage${i === 0 ? ' open' : ''}`, `${name}${i === 0 && lp?.stars ? `<span class="stars">${'★'.repeat(lp.stars)}</span>` : ''}`);
      if (i > 0) d.title = 'Further down the mountain — coming in time';
      s.append(d);
    });
    (this.title.querySelector('#begin') as HTMLElement).textContent = lp?.attempts ? 'Continue' : 'Begin';
    this.title.classList.remove('hidden');
    this.title.style.pointerEvents = '';
  }
  hideTitle() {
    this.title.classList.add('hidden');
    this.title.querySelectorAll('button').forEach((b) => ((b as HTMLElement).style.pointerEvents = 'none'));
  }

  // ---------------------------------------------------------- planning
  showPlanning(level: LevelDef) {
    this.plan.querySelector('.stage-label')!.textContent = `${level.stage} · I`;
    this.plan.querySelector('h1')!.textContent = level.name;
    this.objectivesEl.innerHTML = `
      <li data-k="fracture"><span class="dot"></span><span>Break the boulder at least once</span></li>
      <li data-k="mass"><span class="dot"></span><span>Deliver ${pct(level.objective.minMassFraction)}% of its stone to the stream</span></li>`;
    this.plan.classList.remove('hidden');
    this.plan.querySelectorAll('button').forEach((b) => ((b as HTMLElement).style.pointerEvents = ''));
  }
  hidePlanning() {
    this.plan.classList.add('hidden');
    this.hideContext();
  }
  setObjectives(fracture: boolean, mass: boolean) {
    for (const li of this.objectivesEl.querySelectorAll('li')) {
      const k = (li as HTMLElement).dataset.k;
      li.classList.toggle('met', k === 'fracture' ? fracture : mass);
    }
  }
  setChanges(n: number, budget: number) {
    this.pipsEl.innerHTML = '';
    for (let i = 0; i < budget; i++) this.pipsEl.append(el('div', `pip${i < n ? ' used' : ''}`));
    this.changesLabel.textContent = `Changes ${n}/${budget}`;
  }
  setGhost(on: boolean, available: boolean) {
    this.ghostBtn.classList.toggle('on', on && available);
    this.ghostBtn.style.display = available ? '' : 'none';
  }

  showContext(title: string, tag: string, text: string, actions: ContextAction[], note?: string) {
    const c = this.context;
    c.innerHTML = '';
    const head = el('div', 'head');
    const left = el('div');
    left.append(el('div', 'tag', tag), el('h2', '', title));
    head.append(left, this.btn('close-x', '×', () => this.h.closeContext(), 'Close'));
    const p = el('p', '', text);
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
      } else {
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          if (!a.disabled) this.h.action(a.key);
        });
      }
      row.append(b);
    }
    c.append(head, p, row);
    if (note) c.append(el('div', 'note', note));
    c.classList.add('show');
    this.tipEl.classList.add('lift');
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

  // ---------------------------------------------------------- live run
  showRun() {
    this.run.classList.remove('hidden');
    this.run.querySelectorAll('button').forEach((b) => ((b as HTMLElement).style.pointerEvents = ''));
    this.setPaused(false);
  }
  hideRun() {
    this.run.classList.add('hidden');
    this.calloutEl.classList.remove('show');
  }
  setPaused(p: boolean) {
    this.pauseBtn.innerHTML = p ? ICONS.play : ICONS.pause;
  }
  setRunStatus(time: number, fractures: number, delivered: number, pieces: number) {
    this.runStatus.innerHTML = `
      <div><b>${time.toFixed(1)}s</b>time</div>
      <div><b>${fractures}</b>fractures</div>
      <div><b>${pieces}</b>pieces</div>
      <div><b>${pct(delivered)}%</b>in stream</div>`;
  }
  callout(text: string, ms = 2200) {
    window.clearTimeout(this.calloutTimer);
    this.calloutEl.textContent = text;
    this.calloutEl.classList.add('show');
    this.calloutTimer = window.setTimeout(() => this.calloutEl.classList.remove('show'), ms);
  }

  // ---------------------------------------------------------- results
  showResults(r: SimResult, level: LevelDef, why: string, best: { stars: number; delivered: number }) {
    const verdict = r.unstable ? 'The mountain shrugged' : r.success ? 'Objective complete' : 'Not yet';
    const title = r.unstable
      ? 'Something slipped'
      : r.success
        ? r.stars === 3
          ? 'A perfect descent'
          : 'The stream has it'
        : r.fractureGoalMet
          ? 'Broken, but stranded'
          : r.deliveredFraction > 0
            ? 'Whole, but unbroken'
            : 'The mountain held';
    const stars = [0, 1, 2].map((i) => STAR.replace('class="star"', `class="star${i < r.stars ? ' on' : ''}"`)).join('');
    const resting = Math.max(0, r.remainingFraction - (r.deliveredFraction - r.sedimentFraction));
    const fr = r.fractures
      .map(
        (f, i) =>
          `<li><span class="n">${i + 1}</span><span>${f.time.toFixed(1)}s — against ${f.against}, ${f.pieces} pieces</span></li>`,
      )
      .join('');
    this.results.innerHTML = `
      <div class="scroll">
        <div class="verdict">${verdict}</div>
        <h2>${title}</h2>
        <div class="star-row">${stars}</div>
        <p class="why">${why}</p>
        <div class="section-label">Where the stone went</div>
        <div class="mass-bar">
          <div class="delivered" style="width:${pct(r.deliveredFraction)}%"></div>
          <div class="resting" style="width:${pct(resting)}%"></div>
          <div class="lost" style="width:${pct(r.lostFraction)}%"></div>
        </div>
        <div class="mass-legend">
          <span><i style="background:var(--water)"></i>Stream ${pct(r.deliveredFraction)}%</span>
          <span><i style="background:rgba(244,239,230,.55)"></i>On the slope ${pct(resting)}%</span>
          <span><i style="background:var(--bad)"></i>Dust & chips ${pct(r.lostFraction)}%</span>
        </div>
        <div class="stats">
          <div class="stat"><div class="k">Distance</div><div class="v">${r.distance.toFixed(0)}<small>m</small></div></div>
          <div class="stat"><div class="k">Fragments</div><div class="v">${r.stoneCount}</div></div>
          <div class="stat"><div class="k">Remaining mass</div><div class="v">${pct(r.remainingFraction)}<small>%</small></div></div>
          <div class="stat"><div class="k">Largest piece</div><div class="v">${pct(r.largestFraction)}<small>%</small></div></div>
          <div class="stat"><div class="k">Water exposure</div><div class="v">${r.waterExposure.toFixed(1)}<small>s</small></div></div>
          <div class="stat"><div class="k">Changes made</div><div class="v">${r.interventions}<small>/ ${level.budget}</small></div></div>
          <div class="stat" style="grid-column:1/-1"><div class="k">Final destination</div><div class="v" style="font-size:19px">${cap(r.destination)}</div></div>
        </div>
        ${r.fractures.length ? `<div class="section-label">Fracture history</div><ul class="fractures">${fr}</ul>` : ''}
        <div class="section-label">Best</div>
        <div style="font-size:12.5px;color:var(--ink-dim)">${'★'.repeat(best.stars)}${'☆'.repeat(3 - best.stars)} · ${pct(best.delivered)}% delivered · 3★ needs ${pct(level.stars.deliveredFraction)}% with ≤${level.stars.maxInterventions} changes</div>
      </div>
      <div class="buttons"></div>`;
    const b = this.results.querySelector('.buttons')!;
    b.append(
      this.actBtn('Adjust the mountain', 'primary', () => this.h.adjust(), 'hand'),
      this.actBtn('Replay', '', () => this.h.replay(), 'replay'),
      this.actBtn('Reset level', '', () => this.h.reset(), 'reset'),
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
