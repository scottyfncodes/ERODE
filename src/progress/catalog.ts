import type { UpgradeId } from '../world/station';

/**
 * Everything you can earn and wear: patrol uniform, sled, helicopter, skis and Koda's gear.
 * Colours are what they are on the model; stats are the only numbers that change handling.
 */

export type Slot = 'jacket' | 'hat' | 'goggles' | 'sledPaint' | 'sledEngine' | 'sledTrack' | 'heliPaint' | 'heliScanner' | 'heliLight' | 'skis' | 'skins' | 'collar' | 'harness' | 'bandana';

export const SLOT_LABEL: Record<Slot, string> = {
  jacket: 'Jacket',
  hat: 'Headwear',
  goggles: 'Goggles',
  sledPaint: 'Sled paint',
  sledEngine: 'Sled engine',
  sledTrack: 'Sled track',
  heliPaint: 'Helicopter paint',
  heliScanner: 'Scanner',
  heliLight: 'Searchlight',
  skis: 'Skis',
  skins: 'Climbing skins',
  collar: 'Collar',
  harness: 'Harness',
  bandana: 'Bandana',
};

export type Group = 'patroller' | 'sled' | 'heli' | 'skis' | 'koda';

export const GROUP_SLOTS: Record<Group, Slot[]> = {
  patroller: ['jacket', 'hat', 'goggles'],
  sled: ['sledPaint', 'sledEngine', 'sledTrack'],
  heli: ['heliPaint', 'heliScanner', 'heliLight'],
  skis: ['skis', 'skins'],
  koda: ['collar', 'harness', 'bandana'],
};

export const GROUP_LABEL: Record<Group, string> = { patroller: 'Patroller', sled: 'Snowmobile', heli: 'Helicopter', skis: 'Skis', koda: 'Koda' };

export interface Item {
  id: string;
  slot: Slot;
  name: string;
  cost: number;
  rank: number;
  /** the station building that has to exist to fit it */
  needs?: UpgradeId;
  /** main colour (and a second one) on the model */
  color?: number;
  color2?: number;
  /** handling: engine boost, powder grip, scan range multiplier, ski climbing */
  stat?: number;
  note?: string;
}

export const ITEMS: Item[] = [
  // patroller
  { id: 'jacket-red', slot: 'jacket', name: 'Patrol red', cost: 0, rank: 0, color: 0xd8382a, color2: 0x2b2f38 },
  { id: 'jacket-orange', slot: 'jacket', name: 'Signal orange', cost: 120, rank: 0, color: 0xf07a1a, color2: 0x23313d },
  { id: 'jacket-blue', slot: 'jacket', name: 'Glacier blue', cost: 160, rank: 1, color: 0x2f7fb8, color2: 0x2b2f38 },
  { id: 'jacket-green', slot: 'jacket', name: 'Forest service', cost: 180, rank: 2, color: 0x3c6b4a, color2: 0xe9c46a },
  { id: 'jacket-black', slot: 'jacket', name: 'Night shift', cost: 260, rank: 3, color: 0x262a30, color2: 0xd8382a },
  { id: 'hat-beanie', slot: 'hat', name: 'Wool beanie', cost: 0, rank: 0, color: 0x2b2f38, color2: 0xe0b042 },
  { id: 'hat-helmet', slot: 'hat', name: 'Patrol helmet', cost: 140, rank: 1, needs: 'equipment', color: 0xf3efe6, color2: 0xd8382a },
  { id: 'hat-trapper', slot: 'hat', name: 'Trapper hat', cost: 160, rank: 1, color: 0x7a5233, color2: 0xe8dcc8 },
  { id: 'hat-bobble', slot: 'hat', name: 'Bobble hat', cost: 90, rank: 0, color: 0x2f7fb8, color2: 0xf3efe6 },
  { id: 'goggles-amber', slot: 'goggles', name: 'Amber lens', cost: 0, rank: 0, color: 0xf2a33a },
  { id: 'goggles-mirror', slot: 'goggles', name: 'Mirror lens', cost: 110, rank: 1, color: 0x7fd3e8 },
  { id: 'goggles-rose', slot: 'goggles', name: 'Rose lens', cost: 110, rank: 2, color: 0xe86a8a },
  // sled
  { id: 'sled-red', slot: 'sledPaint', name: 'Patrol red', cost: 0, rank: 0, color: 0xd8382a, color2: 0xf3efe6 },
  { id: 'sled-yellow', slot: 'sledPaint', name: 'Rescue yellow', cost: 150, rank: 0, needs: 'workshop', color: 0xf2c230, color2: 0x23313d },
  { id: 'sled-teal', slot: 'sledPaint', name: 'Glacier teal', cost: 170, rank: 1, needs: 'workshop', color: 0x2a9d8f, color2: 0xf3efe6 },
  { id: 'sled-black', slot: 'sledPaint', name: 'Black diamond', cost: 240, rank: 3, needs: 'workshop', color: 0x23272d, color2: 0xf2a33a },
  { id: 'engine-stock', slot: 'sledEngine', name: 'Stock 600', cost: 0, rank: 0, stat: 1 },
  { id: 'engine-800', slot: 'sledEngine', name: 'Mountain 800', cost: 280, rank: 1, needs: 'workshop', stat: 1.15, note: 'Faster and stronger on the climb' },
  { id: 'engine-850', slot: 'sledEngine', name: 'Turbo 850', cost: 520, rank: 3, needs: 'workshop', stat: 1.3, note: 'Much faster' },
  { id: 'track-trail', slot: 'sledTrack', name: 'Trail track', cost: 0, rank: 0, stat: 1 },
  { id: 'track-powder', slot: 'sledTrack', name: 'Deep lug track', cost: 240, rank: 2, needs: 'workshop', stat: 0.55, note: 'Floats on powder' },
  // heli
  { id: 'heli-red', slot: 'heliPaint', name: 'Rescue red and white', cost: 0, rank: 0, color: 0xd8382a, color2: 0xf3efe6 },
  { id: 'heli-yellow', slot: 'heliPaint', name: 'Alpine yellow', cost: 220, rank: 1, needs: 'hangar', color: 0xf2c230, color2: 0x23313d },
  { id: 'heli-blue', slot: 'heliPaint', name: 'Mountain blue', cost: 240, rank: 2, needs: 'hangar', color: 0x2f5f9e, color2: 0xf3efe6 },
  { id: 'scanner-std', slot: 'heliScanner', name: 'Optical scanner', cost: 0, rank: 0, stat: 1 },
  { id: 'scanner-thermal', slot: 'heliScanner', name: 'Thermal scanner', cost: 380, rank: 2, needs: 'hangar', stat: 1.6, note: 'Reads slopes from further away' },
  { id: 'light-none', slot: 'heliLight', name: 'None', cost: 0, rank: 0 },
  { id: 'light-search', slot: 'heliLight', name: 'Searchlight', cost: 200, rank: 1, needs: 'hangar', note: 'Lights the ground at night' },
  // skis
  { id: 'skis-wood', slot: 'skis', name: 'Old wooden tourers', cost: 0, rank: 0, color: 0xb98a55, stat: 1 },
  { id: 'skis-red', slot: 'skis', name: 'Patrol race', cost: 180, rank: 1, needs: 'equipment', color: 0xd8382a, stat: 1.12, note: 'Quicker edge to edge' },
  { id: 'skis-fat', slot: 'skis', name: 'Powder planks', cost: 240, rank: 2, needs: 'equipment', color: 0x2a9d8f, stat: 1.05, note: 'Float in powder' },
  { id: 'skins-none', slot: 'skins', name: 'No skins', cost: 0, rank: 0, stat: 0 },
  { id: 'skins-mohair', slot: 'skins', name: 'Mohair skins', cost: 160, rank: 1, needs: 'equipment', stat: 0.7, note: 'Walk your skis uphill' },
  // koda
  { id: 'collar-red', slot: 'collar', name: 'Red collar', cost: 0, rank: 0, color: 0xd8382a },
  { id: 'collar-blue', slot: 'collar', name: 'Blue collar', cost: 60, rank: 0, color: 0x2f7fb8 },
  { id: 'collar-yellow', slot: 'collar', name: 'Yellow collar', cost: 60, rank: 0, needs: 'kennel', color: 0xf2c230 },
  { id: 'harness-none', slot: 'harness', name: 'None', cost: 0, rank: 0 },
  { id: 'harness-patrol', slot: 'harness', name: 'Patrol harness', cost: 180, rank: 1, needs: 'kennel', color: 0xd8382a, color2: 0xf3efe6, note: 'With a little cross on the side' },
  { id: 'harness-pack', slot: 'harness', name: 'Saddle pack', cost: 220, rank: 2, needs: 'kennel', color: 0x3c6b4a, color2: 0x7a5233 },
  { id: 'bandana-none', slot: 'bandana', name: 'None', cost: 0, rank: 0 },
  { id: 'bandana-red', slot: 'bandana', name: 'Red bandana', cost: 50, rank: 0, color: 0xd8382a },
  { id: 'bandana-check', slot: 'bandana', name: 'Check bandana', cost: 80, rank: 1, color: 0x2f7fb8 },
];

export const item = (id: string): Item => ITEMS.find((i) => i.id === id)!;

export const DEFAULT_EQUIP: Record<Slot, string> = {
  jacket: 'jacket-red',
  hat: 'hat-beanie',
  goggles: 'goggles-amber',
  sledPaint: 'sled-red',
  sledEngine: 'engine-stock',
  sledTrack: 'track-trail',
  heliPaint: 'heli-red',
  heliScanner: 'scanner-std',
  heliLight: 'light-none',
  skis: 'skis-wood',
  skins: 'skins-none',
  collar: 'collar-red',
  harness: 'harness-none',
  bandana: 'bandana-none',
};

export const RANKS = [
  { name: 'Recruit', rep: 0 },
  { name: 'Patroller', rep: 200 },
  { name: 'Senior patroller', rep: 520 },
  { name: 'Lead patroller', rep: 950 },
  { name: 'Chief of patrol', rep: 1500 },
];

export function rankOf(rep: number): number {
  let r = 0;
  RANKS.forEach((k, i) => {
    if (rep >= k.rep) r = i;
  });
  return r;
}

/** Old patrol badges hidden around the valley (enamel pins from the station's first fifty years). */
export const BADGES: { id: string; x: number; z: number; name: string }[] = [
  { id: 'b-lake', x: -500, z: 560, name: 'Mirror Lake, 1962' },
  { id: 'b-chapel', x: 452, z: 572, name: 'Hollin Chapel bell' },
  { id: 'b-lift', x: 612, z: -352, name: 'Tannberg first chair' },
  { id: 'b-cabin', x: 778, z: -72, name: 'Fernhut stove' },
  { id: 'b-station', x: -668, z: -318, name: 'Grauhorn barometer' },
  { id: 'b-ridge', x: -240, z: -488, name: 'Kessel Ridge cairn' },
  { id: 'b-forest', x: 180, z: 70, name: 'Spruce hollow' },
  { id: 'b-west', x: -620, z: 140, name: 'Westwand hut' },
  { id: 'b-berm', x: -30, z: -186, name: 'Berm builders, 1981' },
  { id: 'b-falls', x: 420, z: -120, name: 'Frozen falls' },
];
