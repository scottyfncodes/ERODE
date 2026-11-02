export interface GestureHandlers {
  tap(x: number, y: number): void;
  /** return true if this drag grabs an object (otherwise the camera pans) */
  grab(x: number, y: number): boolean;
  dragObject(x: number, y: number): void;
  release(): void;
  pan(dx: number, dy: number): void;
  orbit(dx: number, dy: number): void;
  zoom(factor: number): void;
  hover(x: number, y: number): void;
  enabled(): boolean;
}

/** Unified touch + mouse gestures on the canvas. */
export function attachGestures(el: HTMLElement, h: GestureHandlers) {
  const pts = new Map<number, { x: number; y: number; sx: number; sy: number; t: number }>();
  let mode: 'none' | 'pending' | 'object' | 'pan' | 'orbit' | 'pinch' = 'none';
  let lastPinch = { d: 0, a: 0, cx: 0, cy: 0 };
  let button = 0;

  const local = (e: PointerEvent) => {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const pinchInfo = () => {
    const [a, b] = [...pts.values()];
    return {
      d: Math.hypot(a.x - b.x, a.y - b.y),
      a: Math.atan2(b.y - a.y, b.x - a.x),
      cx: (a.x + b.x) / 2,
      cy: (a.y + b.y) / 2,
    };
  };

  el.addEventListener('pointerdown', (e) => {
    if (!h.enabled()) return;
    el.setPointerCapture(e.pointerId);
    const p = local(e);
    pts.set(e.pointerId, { x: p.x, y: p.y, sx: p.x, sy: p.y, t: performance.now() });
    button = e.button;
    if (pts.size === 2) {
      if (mode === 'object') h.release();
      mode = 'pinch';
      lastPinch = pinchInfo();
    } else if (pts.size === 1) {
      mode = 'pending';
    }
  });

  el.addEventListener('pointermove', (e) => {
    const p = local(e);
    const rec = pts.get(e.pointerId);
    if (!rec) {
      if (e.pointerType === 'mouse' && h.enabled()) h.hover(p.x, p.y);
      return;
    }
    const dx = p.x - rec.x,
      dy = p.y - rec.y;
    rec.x = p.x;
    rec.y = p.y;
    if (mode === 'pinch' && pts.size >= 2) {
      const now = pinchInfo();
      if (lastPinch.d > 0) h.zoom(lastPinch.d / Math.max(10, now.d));
      let da = now.a - lastPinch.a;
      if (da > Math.PI) da -= Math.PI * 2;
      if (da < -Math.PI) da += Math.PI * 2;
      // two-finger: twist rotates, vertical drag tilts, midpoint drag pans
      h.orbit(-da * 160, (now.cy - lastPinch.cy) * 0.6);
      h.pan(now.cx - lastPinch.cx, 0);
      lastPinch = now;
      return;
    }
    if (mode === 'pending') {
      if (Math.hypot(p.x - rec.sx, p.y - rec.sy) < 8) return;
      if (button === 2 || e.shiftKey) mode = 'orbit';
      else mode = h.grab(rec.sx, rec.sy) ? 'object' : 'pan';
    }
    if (mode === 'object') h.dragObject(p.x, p.y);
    else if (mode === 'pan') h.pan(dx, dy);
    else if (mode === 'orbit') h.orbit(dx, dy);
  });

  const end = (e: PointerEvent) => {
    const rec = pts.get(e.pointerId);
    pts.delete(e.pointerId);
    if (!rec) return;
    if (mode === 'pending' && performance.now() - rec.t < 450) h.tap(rec.sx, rec.sy);
    if (mode === 'object') h.release();
    if (pts.size === 0) mode = 'none';
    else if (pts.size === 1) {
      // lifting one finger of a pinch: continue as a pan without a jump
      const r = [...pts.values()][0];
      r.sx = r.x;
      r.sy = r.y;
      mode = 'pan';
    }
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener(
    'wheel',
    (e) => {
      if (!h.enabled()) return;
      e.preventDefault();
      h.zoom(Math.exp(e.deltaY * 0.0012));
    },
    { passive: false },
  );
  // Safari: stop page-level pinch zoom on the canvas
  el.addEventListener('gesturestart', (e) => e.preventDefault());
}
