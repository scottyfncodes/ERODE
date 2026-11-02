// ROCKSLIDE brand: name, lines and the two marks the whole UI is built from —
// the fault-split wordmark and the boulder glyph that shows how much of the stone survives.

export const BRAND = {
  name: 'ROCKSLIDE',
  tagline: 'Unleash a geological catastrophe.',
  description: 'Choose the way down. Watch the mountain come apart.',
} as const;

/** Granite density (t/m³): turns the boulder's volume into a mass a player can feel. */
export const GRANITE_T_PER_M3 = 2.7;

/**
 * The wordmark: ROCKSLIDE set heavy and wide, split along a fault line with the lower
 * half slipped downhill. Two stacked copies of the text, each clipped to one side of the fault.
 */
export function wordmark(cls = ''): string {
  const t = BRAND.name;
  return `<div class="wordmark ${cls}" role="img" aria-label="${t}"><span class="wm-top" aria-hidden="true">${t}</span><span class="wm-bot" aria-hidden="true">${t}</span></div>`;
}

// An irregular granite boulder, sitting on its flat base at y = 92.
const BOULDER_PATH =
  'M14 92 L9 70 L15 46 L31 26 L52 15 L72 19 L87 34 L93 56 L90 78 L84 92 Z';
const FACETS = 'M31 26 L44 48 L15 46 M44 48 L72 19 M44 48 L64 62 L93 56 M64 62 L58 92 M44 48 L30 92';

/**
 * The boulder glyph. A dashed outline holds the original boulder; the solid stone inside is
 * scaled so its area is the fraction of mass that survived. `frac` is 0…1.
 */
export function boulderGlyph(frac = 1, cls = ''): string {
  const s = glyphScale(frac);
  return `<svg class="boulder-glyph ${cls}" viewBox="0 0 100 100" aria-hidden="true">
    <path class="bg-ghost" d="${BOULDER_PATH}"/>
    <g class="bg-stone" style="transform: scale(${s.toFixed(3)})">
      <path class="bg-body" d="${BOULDER_PATH}"/>
      <path class="bg-facets" d="${FACETS}"/>
      <path class="bg-light" d="M31 26 L52 15 L72 19 L44 48 Z"/>
    </g>
  </svg>`;
}

/** linear scale so the glyph's area reads as the retained fraction */
export function glyphScale(frac: number): number {
  return Math.sqrt(Math.max(0, Math.min(1, frac)));
}

/** Mass in tonnes, kilograms or grams — whatever reads best. */
export function massLabel(tonnes: number): { v: string; u: string } {
  if (tonnes >= 1) return { v: tonnes >= 10 ? tonnes.toFixed(0) : tonnes.toFixed(1), u: 't' };
  const kg = tonnes * 1000;
  if (kg >= 1) return { v: kg >= 10 ? kg.toFixed(0) : kg.toFixed(1), u: 'kg' };
  const g = kg * 1000;
  return { v: g >= 1 ? g.toFixed(g >= 10 ? 0 : 1) : g.toFixed(2), u: 'g' };
}

/** Retained percentage, with decimals only where they matter. */
export function pctLabel(frac: number): string {
  const p = Math.max(0, Math.min(1, frac)) * 100;
  if (p >= 99.95) return '100';
  if (p >= 10) return p.toFixed(0);
  if (p >= 1) return p.toFixed(1);
  if (p > 0) return p.toFixed(p >= 0.01 ? 2 : 3);
  return '0';
}
