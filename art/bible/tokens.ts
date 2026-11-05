// Dumps the art bible's colour tokens from the code that renders the game, so the document cannot
// drift from it: the interface tokens from src/ui/style.css :root, the world colours as they render
// (src/render/kit.ts PAL passed through grade(), the high-country grade every material goes through)
// and the sky colours from src/render/rig.ts.   npx tsx art/bible/tokens.ts > art/bible/tokens.json
import { readFileSync } from 'node:fs';
import { PAL, grade } from '../../src/render/kit';
const hex = (n: number) => '#' + n.toString(16).padStart(6, '0').toUpperCase();
const css = readFileSync(new URL('../../src/ui/style.css', import.meta.url), 'utf8');
const root = css.slice(css.indexOf(':root'), css.indexOf('}', css.indexOf(':root')));
const ui: Record<string, string> = {};
for (const m of root.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) ui[m[1]] = m[2].trim();
const world: Record<string, { source: string; rendered: string }> = {};
for (const [k, v] of Object.entries(PAL)) world[k] = { source: hex(v as number), rendered: hex(grade(v as number)) };
const rig = readFileSync(new URL('../../src/render/rig.ts', import.meta.url), 'utf8');
const pick = (re: RegExp) => { const m = rig.match(re); return m ? m.slice(1).map((s) => '#' + s.toUpperCase()) : null; };
const sky = {
  zenith: pick(/const zen = lerpC\(0x([0-9a-f]{6}), 0x([0-9a-f]{6}), day\)\.lerp\(new THREE\.Color\(0x([0-9a-f]{6})\)/),
  horizon: pick(/const hor = lerpC\(0x([0-9a-f]{6}), 0x([0-9a-f]{6}), day\)\.lerp\(new THREE\.Color\(0x([0-9a-f]{6})\)/),
  sun: pick(/const sunCol = lerpC\(0x([0-9a-f]{6}), 0x([0-9a-f]{6}), day\)\.lerp\(new THREE\.Color\(0x([0-9a-f]{6})\)/),
  note: 'zenith/horizon/sun: [night, day, golden-hour tint]',
};
// colours picked outside PAL that the bible quotes (source -> rendered through the same grade)
const picked: Record<string, [number, string]> = {
  vinceHair: [0xe6c27a, 'src/game/game.ts VINCE_HAIR'],
  jacketRed: [0xd8382a, 'src/progress/catalog.ts jacket-red (default)'],
  jacketTrim: [0x2b2f38, 'src/progress/catalog.ts jacket-red color2'],
  beanie: [0x2b2f38, 'src/progress/catalog.ts hat-beanie (default)'],
  beanieBand: [0xe0b042, 'src/progress/catalog.ts hat-beanie color2'],
  goggles: [0xf2a33a, 'src/progress/catalog.ts goggles-amber (default)'],
  skisWood: [0xb98a55, 'src/progress/catalog.ts skis-wood (default)'],
  kodaCollar: [0xd8382a, 'src/progress/catalog.ts collar-red (default)'],
  kodaGrey: [0x5f6873, 'src/render/huskyMesh.ts GREY'],
  kodaWhite: [0xf4f2ee, 'src/render/huskyMesh.ts WHITE'],
  kodaDark: [0x3a4048, 'src/render/huskyMesh.ts DARK'],
  kodaIris: [0x8fd0f0, 'src/render/huskyMesh.ts iris'],
  kodaTag: [0xf2c230, 'src/render/huskyMesh.ts tag'],
  bandana: [0xd8382a, 'src/render/huskyMesh.ts bandana'],
  gretaJacket: [0x3c6b4a, 'src/render/missionProps.ts greta'],
  gretaHat: [0xe9c46a, 'src/render/missionProps.ts greta'],
  nilsJacket: [0x2f7fb8, 'src/render/missionProps.ts nils'],
  nilsTrim: [0xf2c230, 'src/render/missionProps.ts nils'],
  driverJacket: [0xf07a1a, 'src/render/missionProps.ts driver'],
  poleShaft: [0x262a30, 'src/render/worldView.ts snow poles'],
  poleTip: [0xff7a1a, 'src/render/worldView.ts snow poles'],
};
const extra: Record<string, { source: string; rendered: string; from: string }> = {};
for (const [k, [v, from]] of Object.entries(picked)) extra[k] = { source: hex(v), rendered: hex(grade(v)), from };
// unlit, so never graded: the mission beacon (src/render/markers.ts)
const unlit = { beaconActive: '#5AD1FF', beaconWaiting: '#F2C230' };
console.log(JSON.stringify({ generatedFrom: ['src/ui/style.css', 'src/render/kit.ts', 'src/render/rig.ts', 'src/render/huskyMesh.ts', 'src/render/missionProps.ts', 'src/game/game.ts'], ui, world, extra, unlit, sky }, null, 1));
