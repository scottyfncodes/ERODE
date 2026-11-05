import { RANKS, rankOf } from '../progress/catalog';
import type { Profile } from '../progress/profile';
import { clock } from '../world/weather';

/**
 * The title card. It can go up before the valley has been built (the game builds it behind the card),
 * so it needs nothing from the game: just the save, to offer Continue.
 *
 * A tap that comes before the valley is ready is kept: the button says so, and play starts the moment
 * the valley is up. `onGo` is called inside the tap itself (so iOS lets the sound start there).
 */
export class TitleScreen {
  readonly el: HTMLElement;
  /** what a tap on Start / Continue does; the game takes this over once it is ready */
  onGo: (fresh: boolean) => void = () => {};
  private waiting: HTMLElement | null = null;

  constructor(ui: HTMLElement, p: Profile, base: string) {
    const has = !!p.savedAt && !p.fresh;
    const el = (this.el = document.createElement('div'));
    el.className = 'title-screen';
    const when = has ? `Day ${p.weather.day}, ${clock(p.weather.minute)} · ${RANKS[rankOf(p.rep)].name} · ${p.funds} funds` : '';
    el.innerHTML = `<div class="inner"><img class="emblem" src="${base}icons/icon.svg" alt="" width="72" height="72"><div class="wordmark" role="img" aria-label="ROCKSLIDE"><span class="wm-top" aria-hidden="true">ROCKSLIDE</span><span class="wm-bot" aria-hidden="true">ROCKSLIDE</span></div><div class="subbrand">Mountain Patrol</div><p>The Kessel valley is yours to look after: its slopes, its roads, its people. You have a log station, a snowmobile, a borrowed helicopter, a pair of old skis, and Koda.</p><div class="row">${has ? '<button class="btn red" data-a="cont">Continue</button><button class="btn ghost" data-a="new">New patrol</button>' : '<button class="btn red" data-a="new">Start your patrol</button>'}</div>${has ? `<div class="meta">${when}</div>` : ''}</div>`;
    ui.appendChild(el);
    const btn = el.querySelector('[data-a=new]') as HTMLElement;
    btn.onclick = () => {
      if (this.waiting) return;
      // a new patrol over a save asks twice
      if (has && !btn.dataset.armed) {
        btn.dataset.armed = '1';
        btn.textContent = 'Tap again: this erases your save';
        return;
      }
      this.onGo(true);
    };
    const c = el.querySelector('[data-a=cont]') as HTMLElement | null;
    if (c)
      c.onclick = () => {
        if (!this.waiting) this.onGo(false);
      };
  }

  /** The tap came before the valley was ready: say so on the button that was tapped. */
  wait(fresh: boolean) {
    const b = this.el.querySelector(fresh ? '[data-a=new]' : '[data-a=cont]') as HTMLElement | null;
    if (!b) return;
    this.waiting = b;
    b.setAttribute('aria-busy', 'true');
    b.classList.add('busy');
    b.textContent = 'Getting the valley ready';
  }

  remove() {
    this.el.remove();
  }
}
