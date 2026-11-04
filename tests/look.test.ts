import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { grade } from '../src/render/kit';
import palette from '../art/rockslide-palette.json';

const hsl = (hex: number) => {
  const o = { h: 0, s: 0, l: 0 };
  new THREE.Color().setHex(hex, THREE.SRGBColorSpace).getHSL(o, THREE.SRGBColorSpace);
  return o;
};
const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 1 - Math.abs(a - b));

describe('the high-country grade', () => {
  it('keeps every colour in its own family (browns stay brown, reds stay red)', () => {
    for (const c of [0xa77a4c, 0x8a603a, 0x6b4428, 0xa63a2c, 0xd8382a, 0x2f5f9e, 0xe9c46a, 0x7a4f2e]) expect(hueGap(hsl(c).h, hsl(grade(c)).h)).toBeLessThan(0.04);
  });

  it('has no pure blacks and no neon', () => {
    for (const c of [0x000000, 0x111111, 0x1a1512, 0x262a30]) expect(hsl(grade(c)).l).toBeGreaterThan(0.09);
    for (const c of [0xff0000, 0x00ff00, 0x0000ff, 0xff7a1a]) expect(hsl(grade(c)).s).toBeLessThanOrEqual(0.71);
  });

  it('the palette file lists the storybook roles the kit and the game use', () => {
    for (const k of ['Granite', 'Kessel Snow', 'Snow Shade', 'Patrol Red', 'Cross White', 'Slate Ink', 'Painted Timber', 'Burgundy Roof', 'Powder Blue', 'Blush', 'Mint', 'Mustard'])
      expect((palette as Record<string, string>)[k]).toMatch(/^#[0-9A-F]{6}$/);
  });
});

describe('the art manifest', () => {
  // paths in art/MANIFEST.json are relative to art/; resolve them from the repo root (the test cwd)
  const resolve = (p: string) => {
    const parts = ['art'];
    for (const seg of p.split('/')) {
      if (seg === '..') parts.pop();
      else if (seg !== '.') parts.push(seg);
    }
    return parts.join('/');
  };
  it('every file it lists exists and matches its recorded hash', async () => {
    const m = JSON.parse(new TextDecoder().decode(readFileSync('art/MANIFEST.json'))) as { items: { path: string; sha256?: string }[] };
    expect(m.items.length).toBeGreaterThan(10);
    for (const it of m.items) {
      const f = resolve(it.path);
      expect(existsSync(f), it.path).toBe(true);
      if (!it.sha256) continue;
      const bytes = readFileSync(f);
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)));
      expect([...digest].map((b) => b.toString(16).padStart(2, '0')).join(''), it.path).toBe(it.sha256);
    }
  });
});
