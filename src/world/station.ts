import { Colliders, roomWalls } from './colliders';
import { VILLAGE } from './places';

/**
 * Kessel Patrol Station: the home base. It starts as a log lodge, a garage, a helipad and a
 * dog house, and grows as the operation does. Every upgrade is a building you can walk up to.
 */

export const HQ = { x: 0, z: 250 };

export const LODGE = { x: -30, z: 245, w: 16, d: 12, wallH: 3.1 };
export const GARAGE = { x: 24, z: 226, w: 12, d: 10, wallH: 3.6 };
export const PAD = { x: -24, z: 292, r: 8 };
export const HANGAR = { x: -1, z: 292, w: 14, d: 16, wallH: 6 };
export const EQUIP = { x: 25, z: 211, w: 9, d: 6, wallH: 3 };
export const WING = { x: -30, z: 231, w: 12, d: 8, wallH: 3 };
export const KENNEL = { x: -8, z: 272 };
export const MAST = { x: -52, z: 220 };

/** Where things are inside and around the station. */
export const SPOTS = {
  bed: { x: -35.2, z: 240.8 },
  fireplace: { x: -37, z: 247.5 },
  table: { x: -29, z: 246 },
  wardrobe: { x: -24.5, z: 240.3 },
  badges: { x: -30.5, z: 250.6 },
  dogBed: { x: -35, z: 250 },
  lodgeDoor: { x: -21.5, z: 245 },
  lodgeInside: { x: -27, z: 245 },
  sled: { x: 23, z: 226, yaw: Math.PI / 2 },
  workbench: { x: 28.6, z: 222 },
  locker: { x: 28.6, z: 230.2 },
  crate: { x: 12, z: 236 },
  bowl: { x: -5.5, z: 274.5 },
  kennel: { x: -8, z: 272 },
  heli: { x: PAD.x, z: PAD.z, yaw: Math.PI / 2 },
  equipDoor: { x: 25, z: 214.6 },
  hangarDoor: { x: -8, z: 292 },
  mast: { x: MAST.x, z: MAST.z },
};

export type UpgradeId = 'workshop' | 'hangar' | 'equipment' | 'kennel' | 'mast' | 'wing' | 'lights';

export interface Upgrade {
  id: UpgradeId;
  name: string;
  blurb: string;
  cost: number;
  /** patrol rank needed */
  rank: number;
  /** what it opens */
  opens: string;
}

export const UPGRADES: Upgrade[] = [
  { id: 'kennel', name: 'Kennel run', blurb: 'A fenced run and a proper house for Koda.', cost: 150, rank: 0, opens: 'Husky gear, and Koda tracks scent further' },
  { id: 'workshop', name: 'Garage workshop', blurb: 'A bench, a hoist and real tools.', cost: 220, rank: 1, opens: 'Sled engines, tracks and paint' },
  { id: 'equipment', name: 'Equipment room', blurb: 'Racks for skis, ropes and rescue packs.', cost: 260, rank: 1, opens: 'Ski and uniform gear' },
  { id: 'hangar', name: 'Helicopter hangar', blurb: 'A home for the helicopter out of the weather.', cost: 400, rank: 2, opens: 'Thermal scanner, searchlight, paint' },
  { id: 'mast', name: 'Radio mast', blurb: 'Hear calls from every corner of the valley.', cost: 300, rank: 2, opens: 'Old patrol badges show on the map' },
  { id: 'wing', name: 'Lodge wing', blurb: 'A bunk room and a wall for everything you have found.', cost: 450, rank: 3, opens: 'Sleeping pays a night shift bonus' },
  { id: 'lights', name: 'Yard lights and flags', blurb: 'Lanterns along the yard and the patrol flag on a pole.', cost: 120, rank: 0, opens: 'The station glows at night' },
];

export const upgradeDef = (id: UpgradeId) => UPGRADES.find((u) => u.id === id)!;

/** Every solid thing in the valley that is not a tree. */
export function buildColliders(): Colliders {
  const c = new Colliders();
  for (const b of roomWalls(LODGE.x, LODGE.z, LODGE.w, LODGE.d, { side: 'e', width: 2.4 })) c.add(b);
  // inside the lodge: the table, the bed, the hearth
  c.add({ x: SPOTS.table.x, z: SPOTS.table.z, hw: 1.5, hd: 1, rot: 0 });
  c.add({ x: -35.6, z: 240.2, hw: 1.9, hd: 1.0, rot: 0 });
  c.add({ x: -37.6, z: 247.5, hw: 0.4, hd: 1.4, rot: 0 });
  for (const b of roomWalls(GARAGE.x, GARAGE.z, GARAGE.w, GARAGE.d, { side: 'w', width: 5.5 })) c.add(b);
  c.add({ x: SPOTS.workbench.x + 1.2, z: SPOTS.workbench.z, hw: 0.6, hd: 1.4, rot: 0, tag: 'workshop' });
  c.add({ x: HANGAR.x + 2, z: HANGAR.z - HANGAR.d / 2, hw: HANGAR.w / 2 - 2, hd: 0.3, rot: 0, tag: 'hangar' });
  c.add({ x: HANGAR.x + 2, z: HANGAR.z + HANGAR.d / 2, hw: HANGAR.w / 2 - 2, hd: 0.3, rot: 0, tag: 'hangar' });
  c.add({ x: HANGAR.x + HANGAR.w / 2, z: HANGAR.z, hw: 0.3, hd: HANGAR.d / 2, rot: 0, tag: 'hangar' });
  c.add({ x: EQUIP.x, z: EQUIP.z, hw: EQUIP.w / 2, hd: EQUIP.d / 2, rot: 0, tag: 'equipment' });
  c.add({ x: WING.x, z: WING.z, hw: WING.w / 2, hd: WING.d / 2, rot: 0, tag: 'wing' });
  c.add({ x: KENNEL.x, z: KENNEL.z, hw: 1.1, hd: 1.3, rot: 0 });
  c.add({ x: MAST.x, z: MAST.z, hw: 1.2, hd: 1.2, rot: 0, tag: 'mast' });
  for (const v of VILLAGE) {
    const size = v.kind === 'lodge' ? [9, 7] : v.kind === 'chapel' ? [5, 8] : v.kind === 'clinic' ? [7, 6] : [5.5, 5];
    c.add({ x: v.x, z: v.z, hw: size[0] / 2, hd: size[1] / 2, rot: v.rot });
  }
  return c;
}

/** Inside the lodge (for the roof cutaway and the warm light). */
export function inLodge(x: number, z: number): boolean {
  return Math.abs(x - LODGE.x) < LODGE.w / 2 && Math.abs(z - LODGE.z) < LODGE.d / 2;
}
export function inGarage(x: number, z: number): boolean {
  return Math.abs(x - GARAGE.x) < GARAGE.w / 2 && Math.abs(z - GARAGE.z) < GARAGE.d / 2;
}
