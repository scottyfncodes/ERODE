import type { Input } from '../core/input';

/** A handful of drawn glyphs; nothing from an icon font. */
export const ICON = {
  map: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/></svg>',
  paw: '<svg viewBox="0 0 24 24" fill="currentColor"><ellipse cx="12" cy="16" rx="5" ry="4"/><circle cx="6" cy="10" r="2.2"/><circle cx="18" cy="10" r="2.2"/><circle cx="9.3" cy="6" r="2.2"/><circle cx="14.7" cy="6" r="2.2"/></svg>',
  off: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h5v16h-5"/><path d="M10 8l-4 4 4 4M6 12h9"/></svg>',
  skis: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 3l12 17M10 3l9 13"/><path d="M15 20h4"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
};

/** Weather glyphs for the forecast, drawn as instruments would. */
export function skyGlyph(sky: string): string {
  const sun = '<circle cx="12" cy="12" r="4.5" fill="#f2b33d"/><g stroke="#f2b33d" stroke-width="2" stroke-linecap="round"><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/></g>';
  const cloud = (c: string, dy = 0) => `<path transform="translate(0 ${dy})" d="M7 18h10a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.6 1.6A3.3 3.3 0 0 0 7 18z" fill="${c}"/>`;
  const flakes = '<g fill="#eef2f5"><circle cx="8" cy="21" r="1.2"/><circle cx="12.5" cy="22.5" r="1.2"/><circle cx="17" cy="21" r="1.2"/></g>';
  const inner = sky === 'clear' ? sun : sky === 'cloud' ? cloud('#c9d3dc') : sky === 'snow' ? cloud('#c9d3dc', -3) + flakes : cloud('#8c98a4', -3) + flakes + '<path d="M3 10h5M2 14h4" stroke="#eef2f5" stroke-width="1.8" stroke-linecap="round"/>';
  return `<svg viewBox="0 0 24 24">${inner}</svg>`;
}

export interface TaskInfo {
  family: string;
  title: string;
  objective: string;
  steps: number;
  current: number;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

export class Hud {
  readonly root: HTMLElement;
  private task: HTMLElement;
  private compass: HTMLElement;
  private tape: HTMLElement;
  private wp: HTMLElement;
  private wpDist: HTMLElement;
  private time: HTMLElement;
  private wx: HTMLElement;
  private dangerLvl: HTMLElement;
  private dangerTxt: HTMLElement;
  private fundsEl: HTMLElement;
  private act: HTMLButtonElement;
  private actLabel: HTMLElement;
  private ringCircle: SVGCircleElement;
  readonly chips: Record<'off' | 'skis' | 'koda' | 'map', HTMLButtonElement>;
  readonly pause: HTMLButtonElement;
  private lever: HTMLElement;
  private speedo: HTMLElement;
  private radioEl: HTMLElement;
  private radioT = 0;
  private toastEl: HTMLElement;
  private toastT = 0;
  private alertEl: HTMLElement;
  private scanEl: HTMLElement;
  private altEl: HTMLElement;
  private hintEl: HTMLElement;
  private lastTask = '';
  private cond: HTMLElement;
  private compassW = 0;
  private cache = new Map<string, string>();
  private queue: { who: string; text: string; secs: number }[] = [];

  constructor(parent: HTMLElement, input: Input) {
    this.root = el('div', 'hud hidden');
    parent.appendChild(this.root);
    this.task = el('div', 'task housing');
    this.compass = el('div', 'compass housing');
    this.tape = el('div', 'tape');
    this.wp = el('div', 'wp');
    this.compass.append(this.tape, el('div', 'center'), this.wp);
    this.wpDist = el('div', 'wp-dist housing');
    const cond = el('div', 'cond');
    const tbox = el('div', 'box wx');
    this.time = el('div', 'big');
    this.wx = el('div', 'small');
    tbox.append(this.time, this.wx);
    const dbox = el('div', 'box');
    const drow = el('div', 'danger');
    this.dangerLvl = el('div', 'lvl d3', '3');
    this.dangerTxt = el('div', 'small');
    const dcol = el('div');
    dcol.append(el('div', 'label', 'Avalanche'), this.dangerTxt);
    drow.append(this.dangerLvl, dcol);
    dbox.append(drow);
    const fbox = el('div', 'box');
    this.fundsEl = el('div', 'big', '0');
    fbox.append(this.fundsEl, el('div', 'small', 'funds'));
    this.pause = el('button', 'iconbtn', ICON.pause) as HTMLButtonElement;
    this.pause.setAttribute('aria-label', 'Pause');
    // one slim strip of instruments rather than three separate cards
    const strip = el('div', 'strip housing');
    strip.append(tbox, dbox, fbox);
    cond.append(strip, this.pause);

    const actions = el('div', 'actions');
    const side = el('div', 'side');
    const chip = (icon: string, label: string) => {
      const b = el('button', 'chip', `${icon}<span>${label}</span>`) as HTMLButtonElement;
      return b;
    };
    this.chips = { koda: chip(ICON.paw, 'Koda'), skis: chip(ICON.skis, 'Skis on'), off: chip(ICON.off, 'Get off'), map: chip(ICON.map, 'Map') };
    side.append(this.chips.map, this.chips.koda, this.chips.skis, this.chips.off);
    this.lever = el('div', 'lever hidden');
    const up = el('button', 'chip', `${ICON.up}<span>Climb</span>`);
    const down = el('button', 'chip', `${ICON.down}<span>Descend</span>`);
    this.lever.append(up, down);
    input.bind(up, 'up');
    input.bind(down, 'down');
    this.act = el('button', 'act') as HTMLButtonElement;
    this.actLabel = el('span');
    const ring = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    ring.setAttribute('viewBox', '0 0 100 100');
    ring.classList.add('ring');
    this.ringCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    this.ringCircle.setAttribute('cx', '50');
    this.ringCircle.setAttribute('cy', '50');
    this.ringCircle.setAttribute('r', '46');
    this.ringCircle.setAttribute('stroke-dasharray', `${Math.PI * 92}`);
    this.ringCircle.setAttribute('stroke-dashoffset', `${Math.PI * 92}`);
    ring.appendChild(this.ringCircle);
    this.act.append(ring, this.actLabel);
    input.bind(this.act, 'action');
    actions.append(side, this.lever, this.act);

    this.speedo = el('div', 'speedo housing hidden');
    this.radioEl = el('div', 'radio housing');
    this.toastEl = el('div', 'toast housing');
    this.alertEl = el('div', 'alert housing');
    this.scanEl = el('div', 'scan', '<div class="ret"></div><div class="bar housing"><div class="l"></div><div class="p"><i></i></div></div>');
    this.altEl = el('div', 'alt housing hidden');
    this.hintEl = el('div', 'hint', '<div class="ghost"></div><div>Drag on the left to move<br/>Drag on the right to look</div>');
    // the cards that stack under the instruments on a phone held upright (on a landscape screen the
    // stack lays nothing out itself: `display: contents`, each card keeps its own place)
    const stack = el('div', 'stack');
    stack.append(this.task, this.compass, this.wpDist, this.toastEl, this.radioEl);
    this.cond = cond;
    this.root.append(stack, cond, actions, this.speedo, this.alertEl, this.scanEl, this.altEl, this.hintEl);
    window.addEventListener('resize', () => this.layout());
    window.visualViewport?.addEventListener('resize', () => this.layout());
    // compass ticks
    for (let d = 0; d < 360; d += 15) {
      const t = el('div', d % 45 === 0 ? 'tick big' : 'tick');
      t.dataset.deg = String(d);
      this.tape.appendChild(t);
      if (d % 90 === 0) {
        const c = el('div', `card${d === 0 ? ' n' : ''}`, ['N', 'E', 'S', 'W'][d / 90]);
        c.dataset.deg = String(d);
        this.tape.appendChild(c);
      }
    }
  }

  show(on: boolean) {
    this.root.classList.toggle('hidden', !on);
    if (on) requestAnimationFrame(() => this.layout());
  }

  setTask(t: TaskInfo | null, freeHint: string) {
    const key = t ? `${t.title}|${t.objective}|${t.current}` : `free|${freeHint}`;
    if (key === this.lastTask) return;
    this.lastTask = key;
    if (!t) {
      this.task.className = 'task housing free';
      this.task.innerHTML = `<div class="fam label">Free patrol</div><div class="title">The valley is yours</div><div class="obj">${freeHint}</div>`;
      return;
    }
    this.task.className = 'task housing';
    let pips = '';
    for (let i = 0; i < t.steps; i++) pips += `<b class="${i < t.current ? 'done' : i === t.current ? 'now' : ''}"></b>`;
    this.task.innerHTML = `<div class="fam label"><i></i>${t.family}</div><div class="title">${t.title}</div><div class="obj">${t.objective}</div><div class="pips">${pips}</div>`;
    this.layout();
  }

  /**
   * On a landscape phone the compass sits in whatever room the task card and the instruments
   * leave at the top; when there is too little, it drops under them. Measured only when the
   * layout changes, never per frame.
   */
  layout() {
    const c = this.compass.style;
    const d = this.wpDist.style;
    const t = this.toastEl.style;
    const ra = this.radioEl.style;
    const al = this.altEl.style;
    c.left = c.width = c.top = d.left = d.top = t.top = ra.top = al.top = al.transform = '';
    if (this.root.classList.contains('hidden') || window.innerWidth < window.innerHeight) {
      this.compassW = this.compass.clientWidth;
      return;
    }
    const task = this.task.getBoundingClientRect();
    const cond = this.cond.getBoundingClientRect();
    const gap = cond.left - (task.width ? task.right : 0) - 20;
    let bottom = Math.max(task.bottom, cond.bottom);
    if (gap >= 150) {
      // no task card (free patrol): the compass sits in the middle of the screen if it fits there
      const w = Math.min(300, gap);
      const x = task.width ? (cond.left + task.right) / 2 : Math.min(window.innerWidth / 2, cond.left - w / 2 - 16);
      c.left = d.left = `${Math.round(x)}px`;
      c.width = `${w}px`;
    } else {
      // under the instruments, lined up with their right edge
      const w = Math.min(280, cond.width);
      const below = Math.round(cond.bottom + 6);
      c.left = d.left = `${Math.round(cond.right - w / 2)}px`;
      c.width = `${w}px`;
      c.top = `${below}px`;
      d.top = `${below + 42}px`;
      bottom = Math.max(task.bottom, below + 64);
    }
    t.top = `${Math.round(bottom + 8)}px`;
    // the pilot's readout: on the right, under the instruments and the compass
    al.top = `${Math.round(gap >= 150 ? cond.bottom + 10 : bottom + 6)}px`;
    al.transform = 'none';
    // a short landscape screen: the radio sits under the task card, away from both thumbs
    // (with no task card it sits under the compass and its waypoint instead)
    if (window.innerHeight <= 460) ra.top = `${Math.round(task.width ? task.bottom + 8 : Math.max(this.compass.getBoundingClientRect().bottom, this.wpDist.getBoundingClientRect().bottom) + 8)}px`;
    this.compassW = this.compass.clientWidth;
  }

  /** Write text only when it changed: the HUD updates every frame, the DOM should not. */
  private put(key: string, e: HTMLElement, v: string, html = false) {
    if (this.cache.get(key) === v) return;
    this.cache.set(key, v);
    if (html) e.innerHTML = v;
    else e.textContent = v;
  }

  /** Heading in degrees (0 = north), and the bearing to a waypoint. */
  setCompass(heading: number, bearing: number | null, dist: number, label: string) {
    const w = this.compassW || (this.compassW = this.compass.clientWidth) || 300;
    const span = 120;
    const pxPer = w / span;
    for (const c of Array.from(this.tape.children) as HTMLElement[]) {
      let d = Number(c.dataset.deg) - heading;
      while (d > 180) d -= 360;
      while (d < -180) d += 360;
      c.style.display = Math.abs(d) > span / 2 ? 'none' : '';
      c.style.left = `${w / 2 + d * pxPer}px`;
    }
    if (bearing === null) {
      this.wp.style.display = 'none';
      this.wpDist.style.display = 'none';
      return;
    }
    let d = bearing - heading;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    const clamped = Math.max(-span / 2 + 3, Math.min(span / 2 - 3, d));
    this.wp.style.display = '';
    this.wp.style.left = `${w / 2 + clamped * pxPer}px`;
    this.wp.style.opacity = Math.abs(d) > span / 2 ? '0.6' : '1';
    this.wpDist.style.display = '';
    const dtxt = dist >= 1000 ? `${(dist / 1000).toFixed(1)} km` : `${Math.round(dist)} m`;
    this.put('wp', this.wpDist, `${label ? label + '  ' : ''}${dtxt}`);
  }

  setConditions(time: string, wx: string, danger: number, dangerTxt: string, funds: number) {
    this.put('time', this.time, time);
    this.put('wx', this.wx, wx);
    this.put('lvl', this.dangerLvl, String(danger));
    if (this.dangerLvl.className !== `lvl d${danger}`) this.dangerLvl.className = `lvl d${danger}`;
    this.put('dtxt', this.dangerTxt, dangerTxt);
    this.setFunds(funds);
  }

  setAction(label: string | null, red = false, progress = 0, enabled = true) {
    const was = this.actLabel.textContent;
    const hidden = this.act.classList.contains('hidden');
    this.act.classList.toggle('hidden', !label);
    if (!label) return;
    if (was !== label || hidden) {
      this.actLabel.textContent = label;
      // a new thing to do pops in, so you notice the button changed under your thumb
      this.act.classList.remove('pop');
      void this.act.offsetWidth;
      this.act.classList.add('pop');
    }
    this.act.classList.toggle('red', red);
    this.act.classList.toggle('disabled', !enabled);
    const off = (Math.PI * 92 * (1 - progress)).toFixed(1);
    if (this.ringCircle.getAttribute('stroke-dashoffset') !== off) this.ringCircle.setAttribute('stroke-dashoffset', off);
  }

  /** A held job finished: the button flashes. */
  actDone() {
    this.act.classList.remove('done');
    void this.act.offsetWidth;
    this.act.classList.add('done');
  }

  private fundsShown = -1;
  private fundsTarget = 0;
  /** Funds count up when you are paid, with the amount floating off the box. */
  setFunds(funds: number) {
    if (funds === this.fundsTarget && this.fundsShown >= 0) return;
    const gain = funds - this.fundsTarget;
    this.fundsTarget = funds;
    if (this.fundsShown < 0 || gain <= 0 || this.root.classList.contains('hidden')) {
      this.fundsShown = funds;
      this.fundsEl.textContent = String(funds);
      return;
    }
    const f = el('div', 'gain', `+${gain}`);
    this.fundsEl.parentElement!.appendChild(f);
    setTimeout(() => f.remove(), 1600);
    this.fundsEl.parentElement!.classList.add('paid');
  }

  setChips(c: { off?: string | null; skis?: string | null; koda?: string | null; kodaOn?: boolean }) {
    const set = (b: HTMLButtonElement, t: string | null | undefined) => {
      b.classList.toggle('hidden', !t);
      if (t) {
        const s = b.querySelector('span')!;
        if (s.textContent !== t) s.textContent = t;
      }
    };
    set(this.chips.off, c.off);
    set(this.chips.skis, c.skis);
    set(this.chips.koda, c.koda);
    this.chips.koda.classList.toggle('on', !!c.kodaOn);
  }

  setLever(on: boolean) {
    this.lever.classList.toggle('hidden', !on);
  }

  setSpeedo(kmh: number | null, sub: string) {
    this.speedo.classList.toggle('hidden', kmh === null);
    if (kmh === null) return;
    this.put('speedo', this.speedo, `<span class="v">${Math.round(kmh)}</span><span class="u">km/h</span><span class="u">${sub}</span>`, true);
  }

  setAlt(agl: number | null, elev = 0, speed = 0) {
    this.altEl.classList.toggle('hidden', agl === null);
    if (agl === null) return;
    this.put('alt', this.altEl, `<div class="label">Above ground</div><div class="big">${Math.round(agl)} m</div><div class="label" style="margin-top:6px">Altitude</div><div class="big">${elev} m</div><div class="label" style="margin-top:6px">Ground speed</div><div class="big">${Math.round(speed * 3.6)} km/h</div>`, true);
  }

  setScan(label: string | null, progress: number) {
    this.scanEl.classList.toggle('on', !!label);
    if (!label) return;
    (this.scanEl.querySelector('.l') as HTMLElement).textContent = label;
    (this.scanEl.querySelector('.p i') as HTMLElement).style.width = `${Math.round(progress * 100)}%`;
  }

  hint(on: boolean) {
    this.hintEl.classList.toggle('hidden', !on);
  }

  private chapterEl: HTMLElement | null = null;
  /**
   * A title card, square on and centred: the chapter, the mission, who called it in. It fades
   * in and out over the world and never takes a touch.
   */
  chapter(kicker: string, title: string, sub: string, tone: string) {
    this.chapterEl?.remove();
    const c = el('div', `chapter tone-${tone}`, `<div class="frame"><div class="k">${kicker}</div><div class="rule"></div><div class="t">${title}</div><div class="rule"></div><div class="s">${sub}</div></div>`);
    this.root.parentElement!.appendChild(c);
    this.chapterEl = c;
    setTimeout(() => c.classList.add('out'), 2600);
    setTimeout(() => {
      c.remove();
      if (this.chapterEl === c) this.chapterEl = null;
    }, 3300);
  }

  /** someone is on the radio right now */
  get talking() {
    return this.radioT > 0;
  }

  /** A line on the radio, subtitled; lines queue. */
  radio(who: string, text: string, secs = 4.5) {
    this.queue.push({ who, text, secs });
    // never let the radio fall far behind what is happening
    while (this.queue.length > 2) this.queue.shift();
    if (this.radioT <= 0) this.nextRadio();
  }

  private nextRadio(): boolean {
    const n = this.queue.shift();
    if (!n) {
      this.radioEl.classList.remove('on');
      return false;
    }
    this.radioEl.innerHTML = `<span class="who">${n.who}</span>${n.text}`;
    this.radioEl.classList.add('on');
    this.radioT = n.secs;
    return true;
  }

  toast(text: string, kind: 'good' | 'warn' | '' = '', secs = 2.4) {
    this.toastEl.textContent = text;
    this.toastEl.className = `toast housing on ${kind}`;
    this.toastT = secs;
  }

  /** A call coming in: Accept or Later. */
  alert(title: string, desc: string, onAccept: () => void, onLater: () => void) {
    this.alertEl.innerHTML = `<div class="label" style="color:var(--red)">Incoming call</div><div class="t">${title}</div><div class="d">${desc}</div><div class="row"><button class="btn red" data-a="go">Respond</button><button class="btn ghost" data-a="later">Later</button></div>`;
    this.alertEl.classList.add('on');
    (this.alertEl.querySelector('[data-a=go]') as HTMLElement).onclick = () => {
      this.alertEl.classList.remove('on');
      onAccept();
    };
    (this.alertEl.querySelector('[data-a=later]') as HTMLElement).onclick = () => {
      this.alertEl.classList.remove('on');
      onLater();
    };
  }

  clearAlert() {
    this.alertEl.classList.remove('on');
  }

  /** A fresh patrol: no leftover radio, toast, call or held button. */
  reset() {
    this.queue.length = 0;
    this.radioT = 0;
    this.radioEl.classList.remove('on');
    this.toastT = 0;
    this.toastEl.classList.remove('on');
    this.clearAlert();
    this.setScan(null, 0);
    this.chapterEl?.remove();
    this.chapterEl = null;
    this.lastTask = '';
    this.fundsShown = -1;
  }

  update(dt: number) {
    if (this.fundsShown !== this.fundsTarget && this.fundsShown >= 0) {
      const step = Math.max(1, Math.ceil(Math.abs(this.fundsTarget - this.fundsShown) * Math.min(1, dt * 5)));
      this.fundsShown += Math.sign(this.fundsTarget - this.fundsShown) * step;
      this.fundsEl.textContent = String(this.fundsShown);
      if (this.fundsShown === this.fundsTarget) this.fundsEl.parentElement!.classList.remove('paid');
    }
    if (this.radioT > 0) {
      this.radioT -= dt;
      if (this.radioT <= 0) this.nextRadio();
    }
    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0) this.toastEl.classList.remove('on');
    }
  }
}
