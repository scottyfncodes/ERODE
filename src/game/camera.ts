import * as THREE from 'three';
import type { Terrain } from '../world/terrain';

export type CamMode = 'foot' | 'sled' | 'skis' | 'heli' | 'indoor' | 'watch';

const PROFILE: Record<CamMode, { dist: number; pitch: number; lift: number; follow: number; fov?: number }> = {
  foot: { dist: 6.2, pitch: 0.3, lift: 1.5, follow: 0.6 },
  sled: { dist: 8.6, pitch: 0.26, lift: 1.6, follow: 3.2 },
  skis: { dist: 7.2, pitch: 0.3, lift: 1.4, follow: 2.6 },
  heli: { dist: 19, pitch: 0.36, lift: 2.5, follow: 1.4 },
  indoor: { dist: 9.5, pitch: 0.95, lift: 0.8, follow: 0 },
  watch: { dist: 115, pitch: 0.2, lift: 4, follow: 0 },
};

/**
 * The third-person camera: orbits the character, follows vehicles from behind, keeps above the
 * snow and pulls in rather than looking through a hillside. Drag to look; let go and it settles
 * back behind you when you are moving.
 */
export class FollowCamera {
  yaw = 0;
  pitch = 0.3;
  dist = 6.2;
  mode: CamMode = 'foot';
  private target = new THREE.Vector3();
  private idle = 10;
  private shake = 0;
  private readonly tmp = new THREE.Vector3();

  constructor(private cam: THREE.PerspectiveCamera, private terrain: Terrain) {}

  setMode(m: CamMode) {
    if (m === this.mode) return;
    this.mode = m;
    if (m === 'indoor') this.pitch = PROFILE.indoor.pitch;
    if (m === 'heli') this.pitch = Math.max(this.pitch, 0.3);
  }

  kick(amount: number) {
    this.shake = Math.max(this.shake, amount);
  }

  /** Turn by a look drag (pixels). */
  look(dx: number, dy: number, sens: number, invert: boolean) {
    if (dx === 0 && dy === 0) return;
    this.idle = 0;
    this.yaw -= dx * 0.0062 * sens;
    const min = this.mode === 'indoor' ? 0.55 : -0.15;
    const max = this.mode === 'indoor' ? 1.25 : 1.2;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.0045 * sens * (invert ? -1 : 1), min, max);
  }

  /**
   * Follow `pos`. `heading`: the way the character or vehicle faces; `speed` m/s.
   */
  update(dt: number, pos: THREE.Vector3, heading: number, speed: number) {
    const p = PROFILE[this.mode];
    this.idle += dt;
    // settle behind the heading when moving and not being steered by hand
    if (p.follow > 0 && this.idle > 1.6 && speed > 1.2) {
      let d = heading - this.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      const k = Math.min(1, dt * p.follow * Math.min(1, speed / 8));
      this.yaw += d * k;
      this.pitch += (p.pitch - this.pitch) * k * 0.5;
    }
    const wantDist = p.dist * (this.mode === 'sled' ? 1 + Math.min(0.25, speed / 120) : 1);
    this.dist += (wantDist - this.dist) * Math.min(1, dt * 3);
    // target: smoothed, a little ahead of fast vehicles
    const lead = this.mode === 'sled' || this.mode === 'skis' ? Math.min(3, speed * 0.12) : 0;
    this.tmp.set(pos.x - Math.sin(heading) * lead, pos.y + p.lift, pos.z - Math.cos(heading) * lead);
    if (this.target.lengthSq() === 0 || this.target.distanceToSquared(this.tmp) > 400) this.target.copy(this.tmp);
    this.target.lerp(this.tmp, Math.min(1, dt * (this.mode === 'heli' ? 6 : 12)));
    // pull in rather than sit inside a slope
    let dist = this.dist;
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    for (let i = 0; i < 6; i++) {
      const f = (i + 1) / 6;
      const x = this.target.x + Math.sin(this.yaw) * cp * dist * f;
      const z = this.target.z + Math.cos(this.yaw) * cp * dist * f;
      const y = this.target.y + sp * dist * f;
      if (this.mode !== 'indoor' && this.terrain.height(x, z) + 0.8 > y) {
        dist = Math.max(2.5, dist * f * 0.95);
        break;
      }
    }
    const cx = this.target.x + Math.sin(this.yaw) * cp * dist;
    const cz = this.target.z + Math.cos(this.yaw) * cp * dist;
    let cy = this.target.y + sp * dist;
    cy = Math.max(cy, this.terrain.height(cx, cz) + 1.0);
    this.cam.position.set(cx, cy, cz);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 1.5);
      const s = this.shake * 0.4;
      this.cam.position.x += (Math.random() - 0.5) * s;
      this.cam.position.y += (Math.random() - 0.5) * s;
    }
    this.cam.lookAt(this.target);
  }

  /** The camera's ground-plane forward, for camera-relative movement. */
  forward(): { x: number; z: number } {
    return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) };
  }

  snapBehind(heading: number) {
    this.yaw = heading;
    this.idle = 10;
    this.target.set(0, 0, 0);
  }
}
