/**
 * A map you can handle like a map on a phone: two fingers pinch to zoom about the point between them
 * (and pan as they move), one finger pans, a double tap zooms in, the wheel zooms about the pointer, and
 * a flick carries on and slows. Zoom stops softly at its limits and the map never leaves the frame.
 *
 * The map is a square `content` element inside a `viewport` that clips it. At zoom 1 the whole valley
 * fits the viewport; pins and markers inside the content keep their size on screen (they read the
 * inverse zoom from the `--iz` custom property).
 *
 * Pure numbers (`fitPan`, `zoomAbout`) are exported for the tests; the class wires them to pointers.
 */

export interface View {
  /** content scale (1 = the whole map fits) */
  z: number;
  /** where the content's top-left corner sits in the viewport, px */
  x: number;
  y: number;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 6;

/** Zoom to `z` keeping the content point under viewport point (px, py) where it is. */
export function zoomAbout(v: View, z: number, px: number, py: number): View {
  const cx = (px - v.x) / v.z;
  const cy = (py - v.y) / v.z;
  return { z, x: px - cx * z, y: py - cy * z };
}

/**
 * Keep the map in the frame: along an axis where it is smaller than the viewport it is centred; where
 * it is larger, no edge comes inside the frame. `give` (0..1) lets it stretch past by that share of the
 * overshoot, for the rubber band under a finger.
 */
export function fitPan(v: View, size: number, w: number, h: number, give = 0): View {
  const s = size * v.z;
  const axis = (p: number, span: number) => {
    let lo: number;
    let hi: number;
    if (s <= span) lo = hi = (span - s) / 2;
    else {
      lo = span - s;
      hi = 0;
    }
    if (p < lo) return lo + (p - lo) * give;
    if (p > hi) return hi + (p - hi) * give;
    return p;
  };
  return { z: v.z, x: axis(v.x, w), y: axis(v.y, h) };
}

/** Past a zoom limit the pinch meets resistance instead of a wall. */
export function softZoom(z: number, min = MIN_ZOOM, max = MAX_ZOOM): number {
  if (z < min) return min * Math.pow(z / min, 0.35);
  if (z > max) return max * Math.pow(z / max, 0.35);
  return z;
}

interface Pt {
  x: number;
  y: number;
}

export class MapView {
  private v: View = { z: 1, x: 0, y: 0 };
  /** the content's side at zoom 1 (px) */
  private size = 0;
  private w = 0;
  private h = 0;
  private pts = new Map<number, Pt>();
  /** the gesture's anchor: the content point under the fingers and the zoom when it began */
  private anchor: { cx: number; cy: number; z: number; d: number } | null = null;
  private vel = { x: 0, y: 0 };
  private lastMove = 0;
  private raf = 0;
  private tap: { t: number; x: number; y: number } | null = null;
  private downAt: { t: number; x: number; y: number; moved: boolean } | null = null;
  private ro: ResizeObserver | null = null;
  /** gestures (and the buttons) report what they did, for the click sound and the tests */
  onChange: ((v: View) => void) | null = null;

  constructor(private viewport: HTMLElement, private content: HTMLElement) {
    viewport.addEventListener('pointerdown', this.down, { passive: false });
    viewport.addEventListener('pointermove', this.move, { passive: false });
    viewport.addEventListener('pointerup', this.up);
    viewport.addEventListener('pointercancel', this.up);
    viewport.addEventListener('lostpointercapture', this.up);
    viewport.addEventListener('wheel', this.wheel, { passive: false });
    // Safari's own pinch (gesture events) would zoom the whole page: the map has it instead
    for (const e of ['gesturestart', 'gesturechange', 'gestureend']) viewport.addEventListener(e, (ev) => ev.preventDefault(), { passive: false });
    viewport.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    viewport.addEventListener('dblclick', (e) => e.preventDefault());
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.layout());
      this.ro.observe(viewport);
    }
    this.layout();
  }

  get view(): View {
    return { ...this.v };
  }

  /** Re-measure (the viewport changed size: a rotation, a panel re-laid out). */
  layout() {
    // layout sizes, not the on-screen box: a panel rising in is briefly scaled, and the map must not
    // take that as its size
    const r = { width: this.viewport.clientWidth, height: this.viewport.clientHeight };
    if (!r.width || !r.height) return;
    const was = this.size;
    // keep the map point at the middle of the frame in the middle
    const mid = was ? { cx: (this.w / 2 - this.v.x) / (this.v.z * was), cy: (this.h / 2 - this.v.y) / (this.v.z * was) } : { cx: 0.5, cy: 0.5 };
    this.w = r.width;
    this.h = r.height;
    this.size = Math.min(this.w, this.h);
    this.content.style.width = this.content.style.height = `${this.size}px`;
    this.v = fitPan({ z: this.v.z, x: this.w / 2 - mid.cx * this.size * this.v.z, y: this.h / 2 - mid.cy * this.size * this.v.z }, this.size, this.w, this.h);
    this.apply();
  }

  /** Zoom by a factor about a viewport point (defaults to the middle), eased. */
  zoomBy(f: number, px = this.w / 2, py = this.h / 2) {
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.v.z * f));
    this.animateTo(fitPan(zoomAbout(this.v, z, px, py), this.size, this.w, this.h));
  }

  /** Centre on a map position (0..1 across, 0..1 down), zooming in to at least `z`. */
  centreOn(u: number, v: number, z = Math.max(2.5, this.v.z)) {
    this.animateTo(fitPan({ z, x: this.w / 2 - u * this.size * z, y: this.h / 2 - v * this.size * z }, this.size, this.w, this.h));
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
  }

  // ---- pointers

  private local(e: PointerEvent): Pt {
    const r = this.viewport.getBoundingClientRect();
    // the frame's on-screen box over its layout size: 1, unless the panel is still easing in
    const k = this.w ? r.width / this.w : 1;
    return { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k };
  }

  private rebase() {
    // a new anchor for whatever fingers are down now, so adding or lifting one never jumps the map
    const ps = [...this.pts.values()];
    if (!ps.length) {
      this.anchor = null;
      return;
    }
    const a = ps[0];
    const b = ps[1] ?? a;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    this.anchor = { cx: (mx - this.v.x) / this.v.z, cy: (my - this.v.y) / this.v.z, z: this.v.z, d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
  }

  private down = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // the map's buttons are their own
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    // a new touch sequence starts with its primary finger: anything still held from before was never
    // released (iOS can drop a pointerup when a call or an alert takes the screen) and must not pinch
    if (e.pointerType === 'touch' && e.isPrimary) this.pts.clear();
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    try {
      // keep the finger's moves even if it strays off the map
      this.viewport.setPointerCapture?.(e.pointerId);
    } catch {
      /* not a live pointer (synthetic, or already gone): moves still arrive while it is over the map */
    }
    const p = this.local(e);
    this.pts.set(e.pointerId, p);
    this.vel = { x: 0, y: 0 };
    this.lastMove = e.timeStamp;
    this.downAt = this.pts.size === 1 ? { t: e.timeStamp, x: p.x, y: p.y, moved: false } : null;
    this.rebase();
    this.viewport.classList.add('grab');
  };

  private move = (e: PointerEvent) => {
    if (!this.pts.has(e.pointerId) || !this.anchor) return;
    e.preventDefault();
    const p = this.local(e);
    this.pts.set(e.pointerId, p);
    if (this.downAt && Math.hypot(p.x - this.downAt.x, p.y - this.downAt.y) > 8) this.downAt.moved = true;
    const ps = [...this.pts.values()];
    const a = ps[0];
    const b = ps[1] ?? a;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    let z = this.anchor.z;
    if (ps.length >= 2) z = softZoom(this.anchor.z * (Math.hypot(a.x - b.x, a.y - b.y) / this.anchor.d));
    const next = fitPan({ z, x: mx - this.anchor.cx * z, y: my - this.anchor.cy * z }, this.size, this.w, this.h, 0.3);
    // finger speed from the events' own times (a late frame must not read as a slow finger)
    const now = e.timeStamp;
    const dt = Math.max(4, now - this.lastMove);
    if (ps.length === 1) {
      // a smoothed finger speed for the flick (px per ms)
      this.vel.x = this.vel.x * 0.6 + ((next.x - this.v.x) / dt) * 0.4;
      this.vel.y = this.vel.y * 0.6 + ((next.y - this.v.y) / dt) * 0.4;
    } else this.vel = { x: 0, y: 0 };
    this.lastMove = now;
    this.v = next;
    this.apply();
  };

  private up = (e: PointerEvent) => {
    if (!this.pts.has(e.pointerId)) return;
    const p = this.local(e);
    this.pts.delete(e.pointerId);
    if (this.pts.size) {
      // one finger still down: carry on panning from where it is, no jump
      this.vel = { x: 0, y: 0 };
      this.downAt = null;
      this.rebase();
      return;
    }
    this.anchor = null;
    this.viewport.classList.remove('grab');
    // a tap, and a second one soon after near the first: zoom in there (out again at the top)
    const d = this.downAt;
    this.downAt = null;
    // (event times, not handler times: a busy frame must not turn a double tap into two single ones)
    this.viewport.dataset.tap = d ? `${d.moved ? 'moved' : 'still'} ${Math.round(e.timeStamp - d.t)}ms${this.tap ? ` gap ${Math.round(e.timeStamp - this.tap.t)}ms` : ''}` : 'no-down';
    if (d && !d.moved && e.timeStamp - d.t < 350) {
      const t = this.tap;
      if (t && e.timeStamp - t.t < 350 && Math.hypot(p.x - t.x, p.y - t.y) < 30) {
        this.tap = null;
        if (this.v.z >= MAX_ZOOM - 0.01) this.animateTo(fitPan({ z: 1, x: 0, y: 0 }, this.size, this.w, this.h));
        else this.zoomBy(2, p.x, p.y);
        return;
      }
      this.tap = { t: e.timeStamp, x: p.x, y: p.y };
    }
    // a finger that stopped before lifting does not fling
    if (e.timeStamp - this.lastMove > 80) this.vel = { x: 0, y: 0 };
    this.settle();
  };

  private wheel = (e: WheelEvent) => {
    e.preventDefault();
    const p = this.local(e as unknown as PointerEvent);
    // trackpad pinches arrive as ctrl+wheel with small deltas; mouse wheels as larger steps
    const k = e.ctrlKey ? 0.012 : 0.0018;
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.v.z * Math.exp(-e.deltaY * k)));
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.v = fitPan(zoomAbout(this.v, z, p.x, p.y), this.size, this.w, this.h);
    this.apply();
  };

  // ---- motion

  /** After the fingers lift: coast with the flick, ease back inside the limits. */
  private settle() {
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(48, now - last);
      last = now;
      let { z, x, y } = this.v;
      // back inside the zoom limits, about the middle of the frame
      const zc = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
      if (Math.abs(zc - z) > 1e-4) {
        const nz = z + (zc - z) * Math.min(1, dt * 0.018);
        ({ z, x, y } = zoomAbout(this.v, Math.abs(nz - zc) < 1e-3 ? zc : nz, this.w / 2, this.h / 2));
      }
      // the flick: friction of a sheet of paper on a table
      x += this.vel.x * dt;
      y += this.vel.y * dt;
      const decay = Math.exp(-dt * 0.0045);
      this.vel.x *= decay;
      this.vel.y *= decay;
      // back inside the frame, springing rather than stopping dead
      const fit = fitPan({ z, x, y }, this.size, this.w, this.h);
      const k = Math.min(1, dt * 0.016);
      if (fit.x !== x) {
        x += (fit.x - x) * k;
        this.vel.x *= 0.5;
      }
      if (fit.y !== y) {
        y += (fit.y - y) * k;
        this.vel.y *= 0.5;
      }
      this.v = { z, x, y };
      this.apply();
      const moving = Math.hypot(this.vel.x, this.vel.y) > 0.01 || Math.abs(fit.x - x) > 0.3 || Math.abs(fit.y - y) > 0.3 || Math.abs(zc - z) > 1e-3;
      if (moving) this.raf = requestAnimationFrame(step);
      else {
        this.v = fitPan({ z: zc, x, y }, this.size, this.w, this.h);
        this.raf = 0;
        this.apply();
        this.onChange?.(this.view);
      }
    };
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(step);
  }

  private animateTo(to: View) {
    const from = { ...this.v };
    const t0 = performance.now();
    const dur = 260;
    cancelAnimationFrame(this.raf);
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - t, 3);
      // zoom eases in log space so it feels even, and the pan follows the same curve
      const z = from.z * Math.pow(to.z / from.z, e);
      this.v = { z, x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e };
      this.apply();
      if (t < 1) this.raf = requestAnimationFrame(step);
      else {
        this.raf = 0;
        this.apply();
        this.onChange?.(this.view);
      }
    };
    this.raf = requestAnimationFrame(step);
  }

  private apply() {
    const { x, y, z } = this.v;
    this.content.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) scale(${z.toFixed(4)})`;
    this.content.style.setProperty('--iz', (1 / z).toFixed(4));
    this.viewport.dataset.zoom = z.toFixed(2);
    this.viewport.dataset.fingers = String(this.pts.size);
    // whether the map is still easing or coasting (for tests and anything that waits on it)
    this.viewport.dataset.moving = this.raf ? '1' : '0';
    this.viewport.classList.toggle('zoomed', z > 1.02);
  }
}
