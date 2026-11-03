/**
 * Touch first: a floating stick wherever your left thumb lands, drag anywhere on the right to
 * turn the camera, and big buttons for the rest. Keyboard and mouse do the same on a desktop.
 */

export type Btn = 'action' | 'alt' | 'up' | 'down' | 'boost';

/** Below this share of the stick's throw nothing moves: a resting thumb never creeps. */
export const STICK_DEAD = 0.14;

/**
 * Shape a raw stick vector (each axis -1..1, length up to 1): a radial deadzone, then a gentle
 * curve so small throws are fine control (walking, a slow line on the sled) and a full throw is
 * still full speed. The direction is kept exactly.
 */
export function shape(x: number, y: number): { x: number; y: number } {
  const m = Math.hypot(x, y);
  if (m <= STICK_DEAD) return { x: 0, y: 0 };
  const t = Math.min(1, (m - STICK_DEAD) / (1 - STICK_DEAD));
  const k = (t * (0.45 + 0.55 * t)) / m;
  return { x: x * k, y: y * k };
}

export class Input {
  /** stick: x right, y forward, magnitude 0..1 */
  readonly move = { x: 0, y: 0 };
  private stickId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private stickVec = { x: 0, y: 0 };
  private lookId: number | null = null;
  private lookLast = { x: 0, y: 0 };
  private lookAcc = { x: 0, y: 0 };
  private keys = new Set<string>();
  private btn = new Map<Btn, boolean>();
  private pressedSet = new Set<string>();
  private mouseDown = false;
  /** last time any touch happened: hides keyboard hints on phones */
  touch = false;
  enabled = true;
  readonly stickEl: HTMLElement;
  readonly knobEl: HTMLElement;
  private radius = 56;

  constructor(surface: HTMLElement) {
    this.stickEl = document.createElement('div');
    this.stickEl.className = 'stick';
    this.knobEl = document.createElement('div');
    this.knobEl.className = 'stick-knob';
    this.stickEl.appendChild(this.knobEl);
    document.body.appendChild(this.stickEl);
    surface.addEventListener('pointerdown', (e) => this.down(e));
    window.addEventListener('pointermove', (e) => this.moveP(e));
    window.addEventListener('pointerup', (e) => this.up(e));
    window.addEventListener('pointercancel', (e) => this.up(e));
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (!this.keys.has(e.code)) this.pressedSet.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.btn.clear();
      this.release();
    });
    surface.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private down(e: PointerEvent) {
    if (!this.enabled) return;
    if (e.pointerType === 'touch') this.touch = true;
    const w = window.innerWidth;
    if (e.pointerType === 'mouse') {
      this.mouseDown = true;
      this.lookLast = { x: e.clientX, y: e.clientY };
      return;
    }
    if (e.clientX < w * 0.45 && this.stickId === null) {
      this.stickId = e.pointerId;
      this.stickOrigin = { x: e.clientX, y: e.clientY };
      this.stickVec = { x: 0, y: 0 };
      this.stickEl.style.transform = `translate(${e.clientX - 70}px, ${e.clientY - 70}px)`;
      this.stickEl.classList.add('on');
      this.knobEl.style.transform = 'translate(0px, 0px)';
    } else if (this.lookId === null) {
      this.lookId = e.pointerId;
      this.lookLast = { x: e.clientX, y: e.clientY };
    }
  }

  private moveP(e: PointerEvent) {
    if (e.pointerId === this.stickId) {
      let dx = e.clientX - this.stickOrigin.x;
      let dy = e.clientY - this.stickOrigin.y;
      const d = Math.hypot(dx, dy);
      if (d > this.radius) {
        // the stick follows a thumb that keeps going
        const over = d - this.radius;
        this.stickOrigin.x += (dx / d) * over;
        this.stickOrigin.y += (dy / d) * over;
        dx = (dx / d) * this.radius;
        dy = (dy / d) * this.radius;
        this.stickEl.style.transform = `translate(${this.stickOrigin.x - 70}px, ${this.stickOrigin.y - 70}px)`;
      }
      this.stickVec = shape(dx / this.radius, -dy / this.radius);
      this.knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
    } else if (e.pointerId === this.lookId || (e.pointerType === 'mouse' && this.mouseDown)) {
      this.lookAcc.x += e.clientX - this.lookLast.x;
      this.lookAcc.y += e.clientY - this.lookLast.y;
      this.lookLast = { x: e.clientX, y: e.clientY };
    }
  }

  private up(e: PointerEvent) {
    if (e.pointerType === 'mouse') this.mouseDown = false;
    if (e.pointerId === this.stickId) {
      this.stickId = null;
      this.stickVec = { x: 0, y: 0 };
      this.stickEl.classList.remove('on');
    }
    if (e.pointerId === this.lookId) this.lookId = null;
  }

  /** Drop every held touch (opening a panel). */
  release() {
    this.stickId = null;
    this.lookId = null;
    this.stickVec = { x: 0, y: 0 };
    this.stickEl.classList.remove('on');
    this.mouseDown = false;
  }

  /** Bind a HUD button: held while pressed. */
  bind(el: HTMLElement, b: Btn) {
    const on = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      this.touch = this.touch || (e as PointerEvent).pointerType === 'touch';
      if (!this.btn.get(b)) this.pressedSet.add(`btn:${b}`);
      this.btn.set(b, true);
    };
    const off = (e: Event) => {
      e.preventDefault();
      this.btn.set(b, false);
    };
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointerleave', off);
    el.addEventListener('pointercancel', off);
  }

  key(...codes: string[]) {
    return codes.some((c) => this.keys.has(c));
  }

  held(b: Btn): boolean {
    if (this.btn.get(b)) return true;
    switch (b) {
      case 'action':
        return this.key('KeyE', 'Space', 'Enter');
      case 'alt':
        return this.key('KeyF');
      case 'up':
        return this.key('KeyR', 'ShiftLeft', 'ShiftRight');
      case 'down':
        return this.key('KeyC', 'ControlLeft', 'ControlRight');
      case 'boost':
        return this.key('ShiftLeft', 'ShiftRight');
    }
  }

  /** Pressed this frame (keyboard code or `btn:name`). */
  pressed(code: string): boolean {
    return this.pressedSet.has(code);
  }

  /** Call once per frame: read the stick (keyboard merged), the look drag, and clear edges. */
  frame(): { look: { x: number; y: number } } {
    let kx = 0;
    let ky = 0;
    if (this.key('KeyA', 'ArrowLeft')) kx -= 1;
    if (this.key('KeyD', 'ArrowRight')) kx += 1;
    if (this.key('KeyW', 'ArrowUp')) ky += 1;
    if (this.key('KeyS', 'ArrowDown')) ky -= 1;
    if (kx || ky) {
      const l = Math.hypot(kx, ky);
      // walking pace with the keys, Shift to run
      const k = this.key('ShiftLeft', 'ShiftRight') ? 1 : 0.62;
      this.move.x = (kx / l) * k;
      this.move.y = (ky / l) * k;
    } else {
      this.move.x = this.stickVec.x;
      this.move.y = this.stickVec.y;
    }
    const look = { x: this.lookAcc.x, y: this.lookAcc.y };
    if (this.key('KeyJ')) look.x -= 6;
    if (this.key('KeyL')) look.x += 6;
    if (this.key('KeyI')) look.y -= 4;
    if (this.key('KeyK')) look.y += 4;
    this.lookAcc.x = 0;
    this.lookAcc.y = 0;
    return { look };
  }

  endFrame() {
    this.pressedSet.clear();
  }
}
