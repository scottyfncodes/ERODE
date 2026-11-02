import { mulberry32 } from '../sim/noise';
import type { Colliders } from '../world/colliders';
import type { Terrain } from '../world/terrain';

/**
 * Koda: grey and white, a blue-eyed husky with one ear that never stands up.
 * Koda follows at your heel, sits when you stop, lies down when you take your time,
 * sleeps by the fire, noses around, and has opinions. On a search Koda takes the scent and
 * leads, never too far ahead, looking back to check you are coming.
 */

export type DogAnim = 'idle' | 'trot' | 'run' | 'sit' | 'lie' | 'sleep' | 'sniff' | 'happy' | 'bark' | 'ride';

export type DogMode = 'follow' | 'stay' | 'track' | 'ride' | 'bed' | 'point';

export interface Husky {
  x: number;
  y: number;
  z: number;
  yaw: number;
  speed: number;
  anim: DogAnim;
  mode: DogMode;
  /** seconds the owner has been still */
  still: number;
  /** current wander target while idling */
  sniffAt: { x: number; z: number } | null;
  sniffT: number;
  /** happy wiggle timer (petted) */
  happy: number;
  bark: number;
  /** stride cycle */
  stride: number;
  /** scent trail being followed, and progress index */
  trail: { x: number; z: number }[];
  trailI: number;
  /** a point of interest Koda has noticed */
  point: { x: number; z: number; id: string } | null;
  /** ids Koda already pointed out */
  noticed: Set<string>;
  seed: number;
}

export const newHusky = (x: number, z: number, t: Terrain): Husky => ({
  x, y: t.height(x, z), z, yaw: 0, speed: 0, anim: 'idle', mode: 'follow', still: 0, sniffAt: null, sniffT: 0, happy: 0, bark: 0, stride: 0, trail: [], trailI: 0, point: null, noticed: new Set(), seed: 1,
});

export interface DogEvent {
  type: 'bark' | 'found' | 'noticed' | 'trail-lost';
  id?: string;
}

export interface Owner {
  x: number;
  z: number;
  yaw: number;
  speed: number;
}

const DOG_R = 0.4;

function moveToward(d: Husky, tx: number, tz: number, speed: number, dt: number, t: Terrain, solid: Colliders) {
  const dx = tx - d.x;
  const dz = tz - d.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.05) {
    d.speed = 0;
    return;
  }
  const step = Math.min(dist, speed * dt);
  let nx = d.x + (dx / dist) * step;
  let nz = d.z + (dz / dist) * step;
  const r = solid.resolve(nx, nz, DOG_R);
  nx = r.x;
  nz = r.z;
  const moved = Math.hypot(nx - d.x, nz - d.z);
  d.speed = moved / Math.max(dt, 1e-4);
  d.stride += moved;
  d.x = nx;
  d.z = nz;
  const want = Math.atan2(-dx, -dz);
  let a = want - d.yaw;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  d.yaw += a * Math.min(1, dt * 8);
}

/** Interesting things nearby (collectibles, people) Koda can sniff out, within `range`. */
export interface Scent {
  id: string;
  x: number;
  z: number;
}

export function stepHusky(d: Husky, o: Owner, dt: number, t: Terrain, solid: Colliders, scents: readonly Scent[], noseRange = 32, night = false): DogEvent[] {
  const ev: DogEvent[] = [];
  const rng = mulberry32((d.seed = (d.seed * 1664525 + 1013904223) >>> 0));
  d.happy = Math.max(0, d.happy - dt);
  d.bark = Math.max(0, d.bark - dt);
  const ownerMoving = o.speed > 0.4;
  d.still = ownerMoving ? 0 : d.still + dt;

  if (d.mode === 'ride') {
    d.anim = 'ride';
    d.speed = 0;
    return ev;
  }

  const distO = Math.hypot(o.x - d.x, o.z - d.z);
  // left far behind (you drove off on skis, or flew): catch up off-screen
  if (d.mode !== 'stay' && d.mode !== 'bed' && distO > 70) {
    const bx = o.x + Math.sin(o.yaw) * 6;
    const bz = o.z + Math.cos(o.yaw) * 6;
    d.x = bx;
    d.z = bz;
    d.trailI = Math.max(0, d.trailI);
  }

  // noticing things on the way
  if ((d.mode === 'follow' || d.mode === 'point') && !d.point) {
    for (const s of scents) {
      if (d.noticed.has(s.id)) continue;
      if (Math.hypot(s.x - d.x, s.z - d.z) < noseRange) {
        d.point = { x: s.x, z: s.z, id: s.id };
        d.noticed.add(s.id);
        d.mode = 'point';
        ev.push({ type: 'noticed', id: s.id });
        break;
      }
    }
  }

  switch (d.mode) {
    case 'bed': {
      d.speed = 0;
      d.anim = night ? 'sleep' : d.happy > 0 ? 'happy' : 'lie';
      break;
    }
    case 'stay': {
      d.speed = 0;
      d.anim = d.happy > 0 ? 'happy' : 'sit';
      break;
    }
    case 'point': {
      const p = d.point!;
      const dp = Math.hypot(p.x - d.x, p.z - d.z);
      if (dp > 1.6) {
        moveToward(d, p.x, p.z, 6, dt, t, solid);
        d.anim = 'run';
      } else {
        d.speed = 0;
        // dig and bark until you come over
        d.anim = d.bark > 0.6 ? 'bark' : 'sniff';
        if (d.bark <= 0) {
          d.bark = 1.6;
          ev.push({ type: 'bark' });
        }
        if (Math.hypot(o.x - p.x, o.z - p.z) < 3 || distO > 45) {
          d.point = null;
          d.mode = 'follow';
        }
      }
      break;
    }
    case 'track': {
      // lead along the trail, at most ~18 m ahead of you
      if (d.trailI >= d.trail.length) {
        d.speed = 0;
        d.anim = d.bark > 0.6 ? 'bark' : 'sniff';
        if (d.bark <= 0) {
          d.bark = 1.4;
          ev.push({ type: 'bark' });
        }
        break;
      }
      const p = d.trail[d.trailI];
      if (Math.hypot(p.x - d.x, p.z - d.z) < 2.5) {
        d.trailI++;
        if (d.trailI >= d.trail.length) ev.push({ type: 'found' });
        break;
      }
      if (distO > 18) {
        // wait and look back, bark once in a while
        d.speed = 0;
        const want = Math.atan2(-(o.x - d.x), -(o.z - d.z));
        d.yaw += (want - d.yaw) * Math.min(1, dt * 3);
        d.anim = d.bark > 0.6 ? 'bark' : 'idle';
        if (d.bark <= 0 && distO > 28) {
          d.bark = 3;
          ev.push({ type: 'bark' });
        }
      } else {
        moveToward(d, p.x, p.z, distO < 8 ? 6.5 : 4.5, dt, t, solid);
        d.anim = d.speed > 5 ? 'run' : 'sniff';
      }
      break;
    }
    default: {
      if (d.happy > 0 && !ownerMoving) {
        // petted: stay right here, wiggle, look up at you
        d.speed = 0;
        d.anim = 'happy';
        const want = Math.atan2(-(o.x - d.x), -(o.z - d.z));
        let a = want - d.yaw;
        while (a > Math.PI) a -= Math.PI * 2;
        while (a < -Math.PI) a += Math.PI * 2;
        d.yaw += a * Math.min(1, dt * 6);
        break;
      }
      // follow: settle at your side, a little behind
      const side = 1.4;
      const tx = o.x + Math.sin(o.yaw) * 2.0 + Math.cos(o.yaw) * side;
      const tz = o.z + Math.cos(o.yaw) * 2.0 - Math.sin(o.yaw) * side;
      const dt2 = Math.hypot(tx - d.x, tz - d.z);
      if (dt2 > 1.2 || ownerMoving) {
        d.sniffAt = null;
        const sp = Math.min(11, Math.max(2.2, o.speed * 1.05 + Math.max(0, dt2 - 2) * 1.6));
        if (dt2 > 0.4) moveToward(d, tx, tz, sp, dt, t, solid);
        else d.speed = 0;
        d.anim = d.speed > 5.5 ? 'run' : d.speed > 0.3 ? 'trot' : 'idle';
      } else if (d.still > 22) {
        d.speed = 0;
        d.anim = night && d.still > 40 ? 'sleep' : 'lie';
      } else if (d.still > 9 && d.still < 16) {
        // a little nose around
        if (!d.sniffAt) d.sniffAt = { x: o.x + (rng() - 0.5) * 7, z: o.z + (rng() - 0.5) * 7 };
        if (Math.hypot(d.sniffAt.x - d.x, d.sniffAt.z - d.z) > 0.6) {
          moveToward(d, d.sniffAt.x, d.sniffAt.z, 1.6, dt, t, solid);
          d.anim = 'trot';
        } else {
          d.speed = 0;
          d.anim = 'sniff';
        }
      } else {
        d.speed = 0;
        // face the same way you are
        let a = o.yaw - d.yaw;
        while (a > Math.PI) a -= Math.PI * 2;
        while (a < -Math.PI) a += Math.PI * 2;
        d.yaw += a * Math.min(1, dt * 2);
        d.anim = d.still > 3 ? 'sit' : 'idle';
      }
      if (d.happy > 0 && d.speed < 0.3) d.anim = 'happy';
    }
  }
  const gy = t.height(d.x, d.z);
  d.y += (gy - d.y) * Math.min(1, dt * 18);
  if (Math.abs(gy - d.y) > 1.5) d.y = gy;
  return ev;
}

/** Start following a scent trail (a search). */
export function startTrack(d: Husky, trail: { x: number; z: number }[]): void {
  d.mode = 'track';
  d.trail = trail;
  // start from the trail point nearest the dog
  let best = 0;
  let bd = Infinity;
  trail.forEach((p, i) => {
    const dd = Math.hypot(p.x - d.x, p.z - d.z);
    if (dd < bd) {
      bd = dd;
      best = i;
    }
  });
  d.trailI = best;
}

export function pet(d: Husky): void {
  d.happy = 2.4;
}
