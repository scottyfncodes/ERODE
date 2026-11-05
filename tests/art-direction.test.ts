import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PAL, grade } from '../src/render/kit';

/**
 * The art bible (art/kessel-art-bible.pdf, built from art/bible/) is the canonical visual reference.
 * These checks keep the game and the bible from drifting apart, and keep edition 1's retired
 * dark-slate language (slate ink, Inter, JetBrains Mono) out of what ships.
 */
const read = (f: string) => new TextDecoder().decode(readFileSync(f));
const join = (a: string, b: string) => `${a}/${b}`;
const tokens = JSON.parse(read('art/bible/tokens.json')) as {
  ui: Record<string, string>;
  world: Record<string, { source: string; rendered: string }>;
};
const hex = (n: number) => '#' + n.toString(16).padStart(6, '0').toUpperCase();

function files(dir: string, ext: RegExp, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) files(p, ext, out);
    else if (ext.test(f)) out.push(p);
  }
  return out;
}
// what the player gets: the code, the page, the stylesheet, the install manifest (the emblem's own
// artwork under public/icons keeps its patch colours and is not checked)
const shipped = [...files('src', /\.(ts|css)$/), 'index.html', 'public/manifest.webmanifest'];

describe('the art bible stays in step with the game', () => {
  it('the interface tokens in the bible are the stylesheet :root', () => {
    const css = read('src/ui/style.css');
    const root = css.slice(css.indexOf(':root'), css.indexOf('}', css.indexOf(':root')));
    const now: Record<string, string> = {};
    for (const m of root.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) now[m[1]] = m[2].trim();
    expect(now, 'style.css changed: rebuild the bible (art/bible/build_bible.py)').toEqual(tokens.ui);
  });

  it('the world colours in the bible are what grade() renders', () => {
    for (const [k, v] of Object.entries(PAL)) {
      expect(tokens.world[k], `kit.ts PAL.${k} is new: rebuild the bible`).toBeDefined();
      expect(tokens.world[k].rendered, `PAL.${k}`).toBe(hex(grade(v)));
    }
    expect(Object.keys(tokens.world).sort()).toEqual(Object.keys(PAL).sort());
  });

  it('the bible, its layout and its captures are in the repository', () => {
    for (const f of ['art/kessel-art-bible.pdf', 'art/bible/kessel-art-bible.designcraft', 'art/bible/captures/shots.json', 'art/bible/fonts.json', 'art/bible/QA.md']) expect(existsSync(f), f).toBe(true);
    const shots = JSON.parse(read('art/bible/captures/shots.json')) as { shots: { name: string; kind: string }[] };
    expect(shots.shots.length).toBeGreaterThan(30);
    for (const s of shots.shots) {
      expect(['env', 'ui']).toContain(s.kind);
      expect(existsSync(`art/bible/captures/${s.name}.jpg`), s.name).toBe(true);
    }
  });
});

describe('the retired dark-slate language does not come back', () => {
  const RETIRED_COLOURS = ['#141c24', '#1d2731', '#f1ece1', '#9fb0bf'];
  const RETIRED_FONTS = [/['"]Inter( Display)?['"]/, /JetBrains/i, /Archivo/];

  it('no retired colour in anything that ships', () => {
    for (const f of shipped) {
      const s = read(f).toLowerCase();
      for (const c of RETIRED_COLOURS) expect(s.includes(c), `${c} in ${f} (retired in art bible edition 2, see page 19)`).toBe(false);
    }
  });

  it('no retired typeface, and the page loads exactly the three faces', () => {
    for (const f of shipped) {
      const s = read(f);
      for (const re of RETIRED_FONTS) expect(re.test(s), `${re} in ${f}`).toBe(false);
    }
    const html = read('index.html');
    const fams = [...html.matchAll(/family=([A-Za-z+]+)/g)].map((m) => m[1].replace(/\+/g, ' ')).sort();
    expect(fams).toEqual(['Courier Prime', 'IBM Plex Mono', 'Jost']);
  });

  it('the theme colours are the card stock, not slate', () => {
    const man = JSON.parse(read('public/manifest.webmanifest')) as { theme_color: string; background_color: string };
    expect(man.theme_color.toLowerCase()).toBe(tokens.ui.slate.toLowerCase());
    expect(read('index.html')).toContain(`name="theme-color" content="${tokens.ui.slate.toLowerCase()}"`);
  });
});
