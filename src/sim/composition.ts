export type CompositionId = 'granite' | 'basalt' | 'sandstone' | 'obsidian' | 'limestone';

/**
 * What the boulder is made of. Each stone changes how a run plays:
 * - mass: heavier stones lose less speed to what they smash
 * - integrity: how much punishment (rock, walls, landings) before it shatters
 * - grip: rolling resistance — lower rolls faster
 * - fury: destruction score multiplier
 */
export interface Composition {
  id: CompositionId;
  name: string;
  blurb: string;
  /** tonnes per cubic metre */
  density: number;
  /** integrity multiplier (1 = granite) */
  toughness: number;
  /** rolling resistance multiplier (1 = granite) */
  grip: number;
  /** destruction score multiplier */
  fury: number;
  /** look */
  tint: [number, number, number];
  speck: [number, number, number];
  /** 0 matte … 1 glassy */
  gloss: number;
  traits: string[];
  unlock: { text: string; check: (s: UnlockStats) => boolean };
}

export interface UnlockStats {
  finished: Set<string>;
  silver: number;
  gold: number;
  platinum: number;
}

export const COMPOSITIONS: Composition[] = [
  {
    id: 'granite',
    name: 'Granite',
    blurb: 'Balanced. Heavy enough to bully timber, tough enough for a gorge.',
    density: 2.7,
    toughness: 1,
    grip: 1,
    fury: 1,
    tint: [0.5, 0.45, 0.41],
    speck: [0.74, 0.6, 0.52],
    gloss: 0.1,
    traits: ['Balanced'],
    unlock: { text: 'Available from the start', check: () => true },
  },
  {
    id: 'sandstone',
    name: 'Sandstone',
    blurb: 'Light and quick off the mark — but timber slows it and rock wears it down.',
    density: 2.25,
    toughness: 0.8,
    grip: 0.8,
    fury: 1.05,
    tint: [0.72, 0.52, 0.34],
    speck: [0.86, 0.68, 0.46],
    gloss: 0,
    traits: ['Rolls fast', 'Light: loses speed in timber', 'Fragile'],
    unlock: { text: 'Finish Pine Hollow', check: (s) => s.finished.has('pine-hollow') },
  },
  {
    id: 'basalt',
    name: 'Basalt',
    blurb: 'Dense and durable. Ploughs through anything — once it gets going.',
    density: 3.1,
    toughness: 1.35,
    grip: 1.12,
    fury: 1,
    tint: [0.2, 0.2, 0.21],
    speck: [0.34, 0.33, 0.33],
    gloss: 0.15,
    traits: ['Heavy: barely slows', 'Very tough', 'Slow to build speed'],
    unlock: { text: 'Earn 3 silver medals', check: (s) => s.silver >= 3 },
  },
  {
    id: 'limestone',
    name: 'Limestone',
    blurb: 'Soft and chalky. Everything it hits explodes into dust — it scores, but it wears.',
    density: 2.6,
    toughness: 0.9,
    grip: 0.95,
    fury: 1.15,
    tint: [0.78, 0.76, 0.68],
    speck: [0.9, 0.88, 0.8],
    gloss: 0.05,
    traits: ['+15% destruction', 'Wears in gorges'],
    unlock: { text: 'Finish Whiteout Couloir', check: (s) => s.finished.has('whiteout-couloir') },
  },
  {
    id: 'obsidian',
    name: 'Obsidian',
    blurb: 'Volcanic glass: razor fury, glass jaw. A gorge or a bad landing can end it.',
    density: 2.4,
    toughness: 0.7,
    grip: 0.85,
    fury: 1.35,
    tint: [0.07, 0.06, 0.08],
    speck: [0.22, 0.2, 0.28],
    gloss: 0.9,
    traits: ['+35% destruction', 'Fast', 'Shatters easily'],
    unlock: { text: 'Earn 3 gold medals', check: (s) => s.gold >= 3 },
  },
];

export function composition(id: string | undefined): Composition {
  return COMPOSITIONS.find((c) => c.id === id) ?? COMPOSITIONS[0];
}
