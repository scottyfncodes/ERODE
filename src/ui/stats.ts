import type { WebGLRenderer } from 'three';

/**
 * A small performance readout for checking the game on a real device: frame rate, frame time (median
 * and 90th percentile over the last two seconds), draw calls, triangles, the quality tier and the
 * render scale. The scale matters: when frames run slow the game lowers its resolution (Rig.adapt)
 * rather than its frame rate, so a struggling phone shows up there first.
 *
 * Off unless asked for. Open the game with `?stats` once to turn it on (it stays on, in this browser),
 * and `?stats=0` to turn it off again.
 */
const KEY = 'rockslide.stats';

export function statsWanted(search = location.search): boolean {
  const q = new URLSearchParams(search);
  try {
    if (q.has('stats')) {
      const on = q.get('stats') !== '0';
      localStorage.setItem(KEY, on ? '1' : '0');
      return on;
    }
    return localStorage.getItem(KEY) === '1';
  } catch {
    return q.has('stats') && q.get('stats') !== '0';
  }
}

export interface StatsSource {
  renderer: WebGLRenderer;
  tier: string;
  /** current render scale (1 = full resolution; Rig.adapt lowers it toward 0.6 when frames are slow) */
  scale: number;
}

export class StatsOverlay {
  readonly el = document.createElement('div');
  private times = new Float32Array(120);
  private n = 0;
  private i = 0;
  private wait = 0;

  constructor(parent: HTMLElement) {
    this.el.className = 'stats';
    this.el.setAttribute('aria-hidden', 'true');
    parent.appendChild(this.el);
  }

  /** Call once per frame, after rendering. `ms` is the wall-clock time since the last frame. */
  frame(ms: number, src: StatsSource) {
    this.times[this.i] = ms;
    this.i = (this.i + 1) % this.times.length;
    this.n = Math.min(this.n + 1, this.times.length);
    this.wait -= ms;
    if (this.wait > 0) return;
    this.wait = 500;
    const t = Array.from(this.times.subarray(0, this.n)).sort((a, b) => a - b);
    const med = t[Math.floor(t.length * 0.5)];
    const p90 = t[Math.min(t.length - 1, Math.floor(t.length * 0.9))];
    const r = src.renderer.info.render;
    const c = src.renderer.domElement;
    this.el.textContent =
      `${Math.round(1000 / med)} fps  ${med.toFixed(1)} ms  p90 ${p90.toFixed(1)}\n` +
      `${r.calls} calls  ${(r.triangles / 1000).toFixed(0)}k tris\n` +
      `${src.tier}  scale ${src.scale.toFixed(1)}  ${c.width}x${c.height}`;
  }
}
