import { FAMILY_LABEL, mission, MISSIONS } from '../missions/catalog';
import { BADGES, GROUP_LABEL, GROUP_SLOTS, item, ITEMS, RANKS, SLOT_LABEL, type Group } from '../progress/catalog';
import { available, blockReason, done, rank, upgradeBlock, type Profile, type Settings } from '../progress/profile';
import { mapUV } from '../render/topoMap';
import { MapView } from './mapView';
import { UPGRADES } from '../world/station';
import { DANGER_LABEL, forecast, SKY_LABEL, type Conditions } from '../world/weather';
import { skyGlyph } from './hud';
import { canVibrate } from '../game/feel';

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

export interface MapMarks {
  me: { x: number; z: number; yaw: number };
  koda?: { x: number; z: number };
  sled?: { x: number; z: number };
  heli?: { x: number; z: number };
  target?: { x: number; z: number; label: string } | null;
  badges?: { x: number; z: number; found: boolean }[];
}

/** Modal screens: the mission board, the outfitters, the map, the pause menu, debriefs. */
export class Panels {
  private wrap: HTMLElement | null = null;
  /** which panel is up: the keys that open one also close it */
  kind = '';
  onClose: (() => void) | null = null;

  /** the live maps on the open panel (pinch, pan) */
  private views: MapView[] = [];
  /** called when the player handles a map (for a soft click) */
  onMapGesture: (() => void) | null = null;

  constructor(private parent: HTMLElement, private topoUrl: string) {}

  /** A sharper copy of the map has been drawn: use it from now on, and on a map that is open. */
  setTopo(url: string) {
    this.topoUrl = url;
    this.wrap?.querySelectorAll<HTMLImageElement>('.mapcontent img').forEach((i) => (i.src = url));
  }

  private dropViews() {
    for (const v of this.views) v.destroy();
    this.views = [];
  }

  /** Bring the maps in a freshly drawn panel to life. `me`: centre on the player at first. */
  private wireMaps(root: HTMLElement, me?: { u: number; v: number }) {
    root.querySelectorAll<HTMLElement>('.mapcard').forEach((card) => {
      const view = new MapView(card.querySelector('.mapview') as HTMLElement, card.querySelector('.mapcontent') as HTMLElement);
      view.onChange = () => {
        card.classList.add('used');
        this.onMapGesture?.();
      };
      card.querySelectorAll<HTMLButtonElement>('[data-z]').forEach((b) => {
        b.onclick = () => {
          const k = b.dataset.z;
          if (k === 'in') view.zoomBy(1.8);
          else if (k === 'out') view.zoomBy(1 / 1.8);
          else if (k === 'me' && me) view.centreOn(me.u, me.v);
          else if (k === 'all') view.zoomBy(1 / 100);
        };
      });
      this.views.push(view);
    });
  }

  get open() {
    return !!this.wrap;
  }

  close() {
    if (!this.wrap) return;
    this.dropViews();
    this.wrap.remove();
    this.wrap = null;
    this.kind = '';
    const f = this.onClose;
    this.onClose = null;
    f?.();
  }

  private shell(title: string, extra = '', kind = ''): { body: HTMLElement; panel: HTMLElement; header: HTMLElement } {
    const again = !!this.wrap;
    this.dropViews();
    if (this.wrap) this.wrap.remove();
    this.kind = kind;
    const wrap = document.createElement('div');
    // re-drawn in place (a tab, a purchase) it stays put; opened fresh it rises in
    wrap.className = again ? 'panel-wrap' : 'panel-wrap enter';
    wrap.innerHTML = `<div class="panel"><header><h2>${title}</h2>${extra}<button class="x" aria-label="Close">✕</button></header><div class="body"></div></div>`;
    wrap.dataset.kind = kind;
    this.parent.appendChild(wrap);
    this.wrap = wrap;
    // keyboard: focus goes into the panel when it opens (onto the panel itself, so a stray Enter or
    // Space presses nothing) and Tab cycles inside it instead of wandering to the HUD behind
    const panelEl = wrap.querySelector('.panel') as HTMLElement;
    panelEl.tabIndex = -1;
    if (!again) panelEl.focus({ preventScroll: true });
    wrap.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const f = [...wrap.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input, select, [tabindex="0"]')].filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      const i = f.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey ? (i <= 0 ? f[f.length - 1] : f[i - 1]) : i === -1 || i === f.length - 1 ? f[0] : f[i + 1];
      e.preventDefault();
      next.focus();
    });
    (wrap.querySelector('.x') as HTMLElement).onclick = () => this.close();
    // the dimmed edge closes the panel on a clean tap only: a thumb that lands there mid-pinch, or a
    // drag that wanders off the map, must not throw the panel away
    let tap: { id: number; x: number; y: number; t: number } | null = null;
    let fingers = 0;
    wrap.addEventListener('pointerdown', (e) => {
      fingers++;
      tap = e.target === wrap && fingers === 1 ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp } : null;
    });
    const lift = (e: PointerEvent) => {
      fingers = Math.max(0, fingers - 1);
      const t = tap;
      tap = null;
      if (e.type === 'pointerup' && t && t.id === e.pointerId && e.target === wrap && Math.hypot(e.clientX - t.x, e.clientY - t.y) < 12 && e.timeStamp - t.t < 500) this.close();
    };
    wrap.addEventListener('pointerup', lift);
    wrap.addEventListener('pointercancel', lift);
    return { body: wrap.querySelector('.body') as HTMLElement, panel: wrap.querySelector('.panel') as HTMLElement, header: wrap.querySelector('header') as HTMLElement };
  }

  private mapCard(marks: MapMarks | null, pins: { x: number; z: number; label: string; sel?: boolean }[]): string {
    const P = (x: number, z: number) => {
      const { u, v } = mapUV(x, z);
      return `left:${(u * 100).toFixed(2)}%;top:${(v * 100).toFixed(2)}%`;
    };
    // the map itself pinches and pans (MapView); pins and markers live on it and keep their size
    let h = `<div class="mapcard"><div class="mapview" role="img" aria-label="Map of the Kessel valley. Pinch or use the buttons to zoom."><div class="mapcontent"><img src="${this.topoUrl}" alt="" draggable="false"/>`;
    for (const p of pins) h += `<div class="pin${p.sel ? ' sel' : ''}" style="${P(p.x, p.z)}"><span>${p.label}</span><b></b></div>`;
    if (marks) {
      for (const b of marks.badges ?? []) h += `<div class="dot" style="${P(b.x, b.z)};background:${b.found ? '#4cc27a' : 'transparent'};border-color:#3a2a1e"></div>`;
      if (marks.sled) h += `<div class="dot" style="${P(marks.sled.x, marks.sled.z)};background:#e0412c"></div>`;
      if (marks.heli) h += `<div class="dot" style="${P(marks.heli.x, marks.heli.z)};background:#f2b33d"></div>`;
      if (marks.koda) h += `<div class="dot" style="${P(marks.koda.x, marks.koda.z)};background:#5f6873"></div>`;
      if (marks.target) h += `<div class="pin sel" style="${P(marks.target.x, marks.target.z)}"><span>${marks.target.label}</span><b></b></div>`;
      const deg = (-marks.me.yaw * 180) / Math.PI;
      h += `<div class="me" style="${P(marks.me.x, marks.me.z)};--rot:${deg.toFixed(1)}deg"></div>`;
    }
    h += '</div></div>';
    h += `<div class="mapctl"><button data-z="in" aria-label="Zoom in">+</button><button data-z="out" aria-label="Zoom out">−</button>${marks ? '<button data-z="me" aria-label="Centre on you"><i class="loc"></i></button>' : ''}</div>`;
    h += '<div class="maphint label">Pinch to zoom</div>';
    if (marks) h += `<div class="legend"><span><i style="background:#e0412c"></i>Sled</span><span><i style="background:#f2b33d"></i>Helicopter</span><span><i style="background:#5f6873"></i>Koda</span>${marks.badges?.length ? '<span><i style="border:2px solid #3a2a1e"></i>Old badge</span>' : ''}</div>`;
    return h + '</div>';
  }

  /** The mission table in the lodge. */
  board(p: Profile, c: Conditions, danger: number, onAccept: (id: string) => void, onBuild: (id: string) => void, tab: 'calls' | 'station' | 'log' = 'calls', sel?: string) {
    const { body, header } = this.shell('Mission table', `<span class="funds">${p.funds} funds</span>`);
    const tabs = document.createElement('div');
    tabs.className = 'tabs';
    tabs.innerHTML = `<button class="tab ${tab === 'calls' ? 'on' : ''}" data-t="calls">Calls and forecast</button><button class="tab ${tab === 'station' ? 'on' : ''}" data-t="station">Build the station</button><button class="tab ${tab === 'log' ? 'on' : ''}" data-t="log">Patrol log</button>`;
    header.after(tabs);
    tabs.querySelectorAll('.tab').forEach((b) => ((b as HTMLElement).onclick = () => this.board(p, c, danger, onAccept, onBuild, (b as HTMLElement).dataset.t as 'calls', sel)));
    if (tab === 'station') {
      let h = `<div class="label" style="margin-bottom:8px">Rank: ${RANKS[rank(p)].name}. Every building opens new gear.</div><div class="upg">`;
      for (const u of UPGRADES) {
        const why = upgradeBlock(p, u.id);
        const built = why === 'Built';
        h += `<button class="item ${built ? 'eq' : why ? 'locked' : ''}" data-u="${u.id}"><div style="flex:1"><div class="nm">${u.name}</div><div class="st">${u.blurb}</div><div class="st" style="color:#cfe6f5">Opens: ${u.opens}</div>${!built && why ? `<div class="st" style="color:#f2b33d">${why}</div>` : ''}</div><div class="pr">${built ? 'Built' : u.cost}</div></button>`;
      }
      body.innerHTML = h + '</div>';
      body.querySelectorAll('[data-u]').forEach((b) => ((b as HTMLElement).onclick = () => onBuild((b as HTMLElement).dataset.u!)));
      return;
    }
    if (tab === 'log') {
      const doneN = MISSIONS.filter((m) => !m.dynamic && done(p, m.id)).length;
      const story = MISSIONS.filter((m) => !m.dynamic).length;
      let h = `<div class="label">Patrol</div><div style="font-size:15px;margin:4px 0 12px">${RANKS[rank(p)].name}. ${p.rep} reputation. Day ${p.weather.day}.</div>`;
      h += `<div class="label">Missions</div><div style="font-size:15px;margin:4px 0 12px">${doneN} of ${story} story missions done. ${Object.entries(p.completed).filter(([id]) => mission(id)?.dynamic).reduce((a, [, n]) => a + n, 0)} callouts answered.</div>`;
      h += `<div class="label">Old patrol badges: ${p.badges.length} of ${BADGES.length}</div><div class="mlist" style="margin-top:6px">`;
      for (const b of BADGES) h += `<div class="mrow ${p.badges.includes(b.id) ? 'done' : 'locked'}"><div class="nm">${p.badges.includes(b.id) ? b.name : 'Not found yet'}</div><div class="tag">${p.badges.includes(b.id) ? 'Found' : ''}</div></div>`;
      body.innerHTML = h + '</div>';
      return;
    }
    const ids = available(p);
    const story = MISSIONS.filter((m) => !m.dynamic);
    const chosen = sel && (ids.includes(sel) || done(p, sel)) ? sel : ids[0];
    const fc = forecast(p.weather.day);
    let fcH = '<div class="forecast">';
    fc.forEach((f, i) => {
      const now = p.weather.minute >= f.from && (!fc[i + 1] || p.weather.minute < fc[i + 1].from);
      fcH += `<div class="fc ${now ? 'now' : ''}"><div class="label">${f.name}</div>${skyGlyph(f.sky)}<div class="t">${SKY_LABEL[f.sky]}</div><div class="t">${f.temp}° · ${f.wind} km/h</div></div>`;
    });
    fcH += '</div>';
    const dl = `<div class="dangerline"><div class="lvl d${danger}">${danger}</div><div><div class="label">Avalanche danger</div>${DANGER_LABEL[danger]}${p.weather.controlled ? ', Kessel Bowl controlled' : `, ${Math.round(p.weather.freshSnow)} cm new snow`}</div></div>`;
    let list = '<div class="mlist">';
    for (const id of ids) {
      const m = mission(id);
      list += `<button class="mrow ${id === chosen ? 'sel' : ''}" data-m="${id}"><div><div class="nm">${m.title}</div><div class="fm">${FAMILY_LABEL[m.family]}${m.dynamic ? ' · callout' : ''}</div></div><div class="tag">+${m.reward.funds}</div></button>`;
    }
    for (const m of story) {
      if (ids.includes(m.id)) continue;
      const d = done(p, m.id);
      // what is coming, and what opens it: something to aim for rather than a row of 'Later'
      const after = m.requires.filter((r) => !done(p, r)).map((r) => mission(r).title);
      list += `<div class="mrow ${d ? 'done' : 'locked'}"><div><div class="nm">${m.title}</div><div class="fm">${FAMILY_LABEL[m.family]}${d ? '' : ` · after ${after.join(' and ')}`}</div></div><div class="tag">${d ? 'Done' : 'Locked'}</div></div>`;
    }
    list += '</div>';
    let detail = '';
    if (chosen) {
      const m = mission(chosen);
      const active = p.active?.id === chosen;
      const block = m.family === 'recon' && c.grounded ? 'The helicopter is grounded in this storm. Try later in the day.' : '';
      detail = `<div class="mdetail"><div class="from">${FAMILY_LABEL[m.family]} · from ${m.from}</div><h3>${m.title}</h3><p>${m.brief}</p><div class="rw">Reward: ${m.reward.funds} funds, ${m.reward.rep} reputation · ${m.steps.length} steps</div>${block ? `<p style="color:#a8321f">${block}</p>` : ''}<div class="row"><button class="btn red" data-go ${block || active ? 'disabled' : ''}>${active ? 'In progress' : p.active ? 'Switch to this' : 'Take this call'}</button><button class="btn ghost" data-free>Free patrol</button></div></div>`;
    } else {
      detail = '<div class="mdetail"><h3>All quiet</h3><p>No calls right now. Ride, fly, ski or walk the valley; calls come in over the radio. Old patrol badges are hidden all over the mountain, and Koda can smell them.</p><div class="row"><button class="btn ghost" data-free>Free patrol</button></div></div>';
    }
    const pins = ids.map((id) => ({ ...mission(id).where, label: mission(id).title, sel: id === chosen }));
    body.innerHTML = `<div class="board"><div>${this.mapCard(null, pins)}</div><div>${fcH}${dl}${list}${detail}</div></div>`;
    this.wireMaps(body);
    body.querySelectorAll('[data-m]').forEach((b) => ((b as HTMLElement).onclick = () => this.board(p, c, danger, onAccept, onBuild, 'calls', (b as HTMLElement).dataset.m)));
    const go = body.querySelector('[data-go]') as HTMLButtonElement | null;
    if (go && chosen) go.onclick = () => onAccept(chosen);
    const free = body.querySelector('[data-free]') as HTMLElement | null;
    if (free) free.onclick = () => this.close();
  }

  /** The outfitters: wardrobe, workbench, hangar, kennel, equipment room. */
  outfit(title: string, groups: Group[], p: Profile, onBuy: (id: string) => void, onEquip: (id: string) => void, tab?: Group) {
    const g = tab ?? groups[0];
    const { body, header } = this.shell(title, `<span class="funds">${p.funds} funds</span>`);
    if (groups.length > 1) {
      const tabs = document.createElement('div');
      tabs.className = 'tabs';
      tabs.innerHTML = groups.map((k) => `<button class="tab ${k === g ? 'on' : ''}" data-g="${k}">${GROUP_LABEL[k]}</button>`).join('');
      header.after(tabs);
      tabs.querySelectorAll('.tab').forEach((b) => ((b as HTMLElement).onclick = () => this.outfit(title, groups, p, onBuy, onEquip, (b as HTMLElement).dataset.g as Group)));
    }
    let h = '';
    for (const slot of GROUP_SLOTS[g]) {
      h += `<div class="label slot-h">${SLOT_LABEL[slot]}</div><div class="items">`;
      for (const it of ITEMS.filter((i) => i.slot === slot)) {
        const owned = p.owned.includes(it.id);
        const eq = p.equip[slot] === it.id;
        const why = owned ? null : blockReason(p, it);
        const sw = it.color !== undefined ? `<div class="sw" style="background:${hex(it.color)}">${it.color2 !== undefined ? `<i style="background:${hex(it.color2)}"></i>` : ''}</div>` : '';
        h += `<button class="item ${eq ? 'eq' : ''} ${why && why !== 'Not enough funds' ? 'locked' : ''}" data-i="${it.id}">${sw}<div><div class="nm">${it.name}</div><div class="st">${eq ? 'Equipped' : owned ? 'Owned: tap to equip' : why ?? (it.note ?? 'Tap to buy')}</div></div><div class="pr">${owned ? '' : it.cost}</div></button>`;
      }
      h += '</div>';
    }
    body.innerHTML = h;
    body.querySelectorAll('[data-i]').forEach((b) => {
      (b as HTMLElement).onclick = () => {
        const id = (b as HTMLElement).dataset.i!;
        if (p.owned.includes(id)) onEquip(id);
        else onBuy(id);
        this.outfit(title, groups, p, onBuy, onEquip, g);
      };
    });
    void item;
  }

  map(p: Profile, marks: MapMarks) {
    const { body, panel } = this.shell('Valley map', '', 'map');
    panel.classList.add('mappanel');
    body.innerHTML = this.mapCard(marks, []);
    const me = mapUV(marks.me.x, marks.me.z);
    this.wireMaps(body, { u: me.u, v: me.v });
    void p;
  }

  pause(s: Settings, apply: (s: Settings) => void, onTitle: () => void, onReset: () => void) {
    const { body, panel } = this.shell('Paused');
    panel.style.width = 'min(520px, 100%)';
    const seg = (key: string, opts: [string, string][], cur: string) => `<div class="seg" data-k="${key}">${opts.map(([v, l]) => `<button class="${v === cur ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}</div>`;
    body.innerHTML = `
      <div class="setrow"><span>Sound</span>${seg('sound', [['1', 'On'], ['0', 'Off']], s.sound ? '1' : '0')}</div>
      <div class="setrow"><span>Music</span>${seg('music', [['1', 'On'], ['0', 'Off']], s.music ? '1' : '0')}</div>
      <div class="setrow"><span>Look speed</span>${seg('look', [['0.6', 'Slow'], ['1', 'Normal'], ['1.5', 'Fast']], String(s.look))}</div>
      <div class="setrow"><span>Look up and down</span>${seg('invertY', [['0', 'Normal'], ['1', 'Inverted']], s.invertY ? '1' : '0')}</div>
      <div class="setrow"><span>Graphics</span>${seg('quality', [['auto', 'Auto'], ['low', 'Light'], ['high', 'Full']], s.quality)}</div>
      ${canVibrate() ? `<div class="setrow"><span>Vibration</span>${seg('vibrate', [['1', 'On'], ['0', 'Off']], s.vibrate ? '1' : '0')}</div>` : ''}
      <div class="label set-h">Assists</div>
      <div class="setrow"><span>Helicopter hover and landing<small>Holds you steady when the stick is centred and sets you down gently</small></span>${seg('heliAssist', [['1', 'On'], ['0', 'Off']], s.heliAssist ? '1' : '0')}</div>
      <div class="setrow"><span>Sled hill hold<small>Stops the sled sliding back on slopes too steep to climb</small></span>${seg('sledAssist', [['1', 'On'], ['0', 'Off']], s.sledAssist ? '1' : '0')}</div>
      <div class="setrow"><span>Route line<small>Dots on the snow along the roads to your objective</small></span>${seg('routeLine', [['1', 'On'], ['0', 'Off']], s.routeLine ? '1' : '0')}</div>
      <div class="label" style="margin-top:12px">Keys: WASD move, Shift run, E act, F fire, R and C climb and descend, J and L turn the camera, M map, Esc pause</div>
      <div class="pause-back"><button class="btn" data-a="back">Back to patrol</button></div><div class="pause-more"><button class="btn ghost" data-a="title">Save and quit to title</button><button class="btn ghost" data-a="reset">Start over</button></div>`;
    body.querySelectorAll('.seg').forEach((g) => {
      g.querySelectorAll('button').forEach((b) => {
        b.onclick = () => {
          const k = (g as HTMLElement).dataset.k!;
          const v = (b as HTMLElement).dataset.v!;
          const next = { ...s } as Settings;
          if (k === 'sound' || k === 'music' || k === 'invertY' || k === 'vibrate' || k === 'heliAssist' || k === 'sledAssist' || k === 'routeLine') (next as unknown as Record<string, boolean>)[k] = v === '1';
          else if (k === 'look') next.look = Number(v);
          else if (k === 'quality') next.quality = v as Settings['quality'];
          apply(next);
          this.pause(next, apply, onTitle, onReset);
        };
      });
    });
    (body.querySelector('[data-a=back]') as HTMLElement).onclick = () => this.close();
    (body.querySelector('[data-a=title]') as HTMLElement).onclick = () => onTitle();
    const reset = body.querySelector('[data-a=reset]') as HTMLElement;
    reset.onclick = () => {
      if (reset.dataset.armed) onReset();
      else {
        reset.dataset.armed = '1';
        reset.textContent = 'Tap again to erase your save';
      }
    };
  }

  debrief(title: string, line: string, funds: number, rep: number, rankUp: string | null, unlocked: string[], extra: string, onDone: () => void) {
    const { body, panel } = this.shell('Mission complete');
    panel.style.width = 'min(520px, 100%)';
    body.innerHTML = `<div class="debrief"><div class="label" style="color:var(--green)">Done</div><h3>${title}</h3><p>${line}</p>${extra ? `<p style="color:#cfe6f5">${extra}</p>` : ''}<div class="rw"><div><b>+${funds}</b>funds</div><div><b>+${rep}</b>reputation</div></div>${rankUp ? `<p><strong>Promoted: ${rankUp}.</strong> New gear and buildings are open.</p>` : ''}${unlocked.length ? `<p>New on the mission table: ${unlocked.join(', ')}</p>` : ''}<button class="btn red" data-a="ok">Back to patrol</button></div>`;
    (body.querySelector('[data-a=ok]') as HTMLElement).onclick = () => {
      this.close();
      onDone();
    };
  }

  /** The morning: a new day's forecast after sleeping. */
  morning(day: number, c: Conditions, danger: number, bonus: number) {
    const { body, panel } = this.shell(`Day ${day}`);
    panel.style.width = 'min(560px, 100%)';
    const fc = forecast(day);
    body.innerHTML = `<div class="forecast">${fc.map((f) => `<div class="fc"><div class="label">${f.name}</div>${skyGlyph(f.sky)}<div class="t">${SKY_LABEL[f.sky]}</div><div class="t">${f.temp}°</div></div>`).join('')}</div><div class="dangerline"><div class="lvl d${danger}">${danger}</div><div><div class="label">Avalanche danger</div>${DANGER_LABEL[danger]}</div></div>${bonus ? `<p>Night shift bonus from the lodge wing: +${bonus} funds.</p>` : ''}<p style="color:#d6e0e8">Koda is waiting by the door.</p><button class="btn red" data-a="ok">Head out</button>`;
    (body.querySelector('[data-a=ok]') as HTMLElement).onclick = () => this.close();
    void c;
  }
}
