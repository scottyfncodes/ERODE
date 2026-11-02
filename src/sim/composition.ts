import type { RockKind } from '../levels/types';
import type { Material } from './objects';

export type CompositionId = 'granite' | 'basalt' | 'sandstone' | 'obsidian' | 'limestone';

export interface Composition {
  id: CompositionId;
  name: string;
  /** one line for the selector */
  blurb: string;
  /** tonnes per cubic metre */
  density: number;
  /** resistance to losing mass in an impact (1 = granite) */
  toughness: number;
  /** how hard a knock must be before it costs anything (1 = granite) */
  threshold: number;
  /** wear while rolling and in water (1 = granite) */
  abrasion: number;
  /** fraction of mass a single hit must take before the stone splits (lower = more brittle) */
  splitAt: number;
  /** damage multipliers by what it hits */
  against: Partial<Record<Material['kind'] | 'terrain', number>>;
  /** extra wear in water (limestone dissolves) */
  water: number;
  /** look */
  tint: [number, number, number];
  speck: [number, number, number];
  /** 0 matte … 1 glassy */
  gloss: number;
  /** strengths and weaknesses for the selector */
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
    blurb: 'Balanced. Tough enough for most knocks, heavy enough to bully timber.',
    density: 2.7,
    toughness: 1,
    threshold: 1,
    abrasion: 1,
    splitAt: 0.14,
    against: {},
    water: 1,
    tint: [0.5, 0.45, 0.41],
    speck: [0.74, 0.6, 0.52],
    gloss: 0.1,
    traits: ['Balanced'],
    unlock: { text: 'Available from the start', check: () => true },
  },
  {
    id: 'sandstone',
    name: 'Sandstone',
    blurb: 'Light and nimble — steers easily, but grinds away on rough ground.',
    density: 2.3,
    toughness: 0.8,
    threshold: 0.9,
    abrasion: 3.2,
    splitAt: 0.16,
    against: { soil: 0.7, branches: 0.8 },
    water: 2,
    tint: [0.72, 0.52, 0.34],
    speck: [0.86, 0.68, 0.46],
    gloss: 0,
    traits: ['Light · steers well', 'Wears fast on rock & water', 'Weak against timber'],
    unlock: { text: 'Finish Pine Hollow', check: (s) => s.finished.has('pine-hollow') },
  },
  {
    id: 'basalt',
    name: 'Basalt',
    blurb: 'Dense and durable. Smashes through timber, but carves wide and slow.',
    density: 3.0,
    toughness: 1.25,
    threshold: 1.15,
    abrasion: 0.7,
    splitAt: 0.17,
    against: {},
    water: 0.8,
    tint: [0.2, 0.2, 0.21],
    speck: [0.34, 0.33, 0.33],
    gloss: 0.15,
    traits: ['Heavy · breaks timber', 'Durable', 'Steers wide'],
    unlock: { text: 'Earn 3 silver medals', check: (s) => s.silver >= 3 },
  },
  {
    id: 'limestone',
    name: 'Limestone',
    blurb: 'Shrugs off soft ground but dreads hard rock — and water slowly dissolves it.',
    density: 2.6,
    toughness: 1.1,
    threshold: 1,
    abrasion: 0.9,
    splitAt: 0.15,
    against: { granite: 1.7, terrain: 1.15, soil: 0.5, branches: 0.6, wood: 0.7 },
    water: 3.5,
    tint: [0.78, 0.76, 0.68],
    speck: [0.9, 0.88, 0.8],
    gloss: 0.05,
    traits: ['Soft hits barely mark it', 'Hard rock hurts', 'Dissolves in water'],
    unlock: { text: 'Finish Whiteout Couloir', check: (s) => s.finished.has('whiteout-couloir') },
  },
  {
    id: 'obsidian',
    name: 'Obsidian',
    blurb: 'Volcanic glass. Glancing knocks skate off — a hard hit shatters it.',
    density: 2.4,
    toughness: 0.75,
    threshold: 1.55,
    abrasion: 0.35,
    splitAt: 0.045,
    against: {},
    water: 0.4,
    tint: [0.07, 0.06, 0.08],
    speck: [0.22, 0.2, 0.28],
    gloss: 0.9,
    traits: ['Hardly wears', 'Small knocks bounce off', 'Brittle: big hits shatter'],
    unlock: { text: 'Earn 3 gold medals', check: (s) => s.gold >= 3 },
  },
];

export function composition(id: string | undefined): Composition {
  return COMPOSITIONS.find((c) => c.id === id) ?? COMPOSITIONS[0];
}

/** Material hardness of the rock formations, by what they're made of. */
export const ROCK_HARDNESS: Record<RockKind, number> = {
  granite: 1.8,
  basalt: 2.0,
  obsidian: 2.3,
  sandstone: 1.2,
  limestone: 1.4,
  ice: 0.7,
};

export const ROCK_LABEL: Record<RockKind, string> = {
  granite: 'granite',
  basalt: 'basalt',
  obsidian: 'obsidian',
  sandstone: 'sandstone',
  limestone: 'limestone',
  ice: 'ice',
};

/** Collision severity bands by mass lost (fraction of current mass). */
export function severityOf(kg: number, mass: number): 'minor' | 'moderate' | 'major' {
  const f = kg / Math.max(1, mass);
  if (f >= 0.05) return 'major';
  if (f >= 0.015) return 'moderate';
  return 'minor';
}
