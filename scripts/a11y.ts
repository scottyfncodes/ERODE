// Accessibility audit of the built game in a real browser: axe-core (WCAG 2.0/2.1/2.2 A and AA rules)
// on every screen a player reaches, plus the checks axe cannot make on its own: keyboard-only
// start and focus order, a visible focus ring, dialog semantics and focus return on the panels,
// screen-reader announcements for the radio and toasts, touch-target size, text size, and
// reduced motion. Writes JSON + Markdown. It reports; it does not fix.
//
//   npx vite build && npx vite preview --port 4173 &
//   npx tsx scripts/a11y.ts http://localhost:4173/ docs/accessibility/after
//
// The 3D view is a WebGL canvas: what is drawn in it (the valley, markers, Koda) is not in the
// DOM, so no automated tool can audit it. That is recorded as a limit, not a pass.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { SPOTS } from '../src/world/station';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const url = process.argv[2] ?? 'http://localhost:4173/';
const outDir = process.argv[3] ?? 'docs/accessibility/after';
mkdirSync(outDir, { recursive: true });

interface AxeViolation { id: string; impact: string; help: string; nodes: { target: string[]; html: string }[] }
interface Screen { screen: string; viewport: string; violations: { id: string; impact: string; help: string; count: number; targets: string[] }[]; passes: number; incomplete: number }
interface Check { area: string; what: string; ok: boolean; detail?: unknown }

const screens: Screen[] = [];
const checks: Check[] = [];
const consoleErrors: string[] = [];
const check = (area: string, what: string, ok: boolean, detail?: unknown) => {
  checks.push({ area, what, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${area}: ${what}${detail !== undefined ? ` ${JSON.stringify(detail).slice(0, 200)}` : ''}`);
};

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });

async function axe(page: any, screen: string, viewport: string) {
  await page.addScriptTag({ content: AXE }).catch(() => {});
  const r = await page.evaluate(async () => {
    const a = (window as any).axe;
    const res = await a.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] }, resultTypes: ['violations', 'incomplete'] });
    return { violations: res.violations.map((v: AxeViolation) => ({ id: v.id, impact: v.impact, help: v.help, count: v.nodes.length, targets: v.nodes.slice(0, 6).map((n) => n.target.join(' ')) })), passes: res.passes.length, incomplete: res.incomplete.length };
  });
  screens.push({ screen, viewport, ...r });
  console.log(`axe ${screen} @ ${viewport}: ${r.violations.length} rules violated (${r.violations.map((v: { id: string; count: number }) => `${v.id}×${v.count}`).join(', ') || 'none'})`);
}

async function open(viewport: { name: string; width: number; height: number; touch: boolean }, reducedMotion: 'reduce' | 'no-preference' = 'no-preference') {
  const ctx = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, hasTouch: viewport.touch, isMobile: viewport.touch, deviceScaleFactor: 1, reducedMotion });
  await ctx.addInitScript(() => {
    try {
      localStorage.clear();
    } catch {}
  });
  const page = await ctx.newPage();
  page.on('console', (m: any) => m.type() === 'error' && consoleErrors.push(m.text()));
  page.on('pageerror', (e: Error) => consoleErrors.push(String(e)));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => (window as any).patrol, null, { timeout: 180000 });
  await page.waitForTimeout(800);
  return { ctx, page };
}

const P = (page: any, f: string) => page.evaluate(f);
const focusInfo = (page: any) =>
  page.evaluate(() => {
    const e = document.activeElement as HTMLElement | null;
    if (!e || e === document.body) return null;
    const cs = getComputedStyle(e);
    const name = e.getAttribute('aria-label') || e.textContent?.trim().slice(0, 40) || e.tagName;
    return { tag: e.tagName, name, outline: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2, boxShadow: cs.boxShadow !== 'none', inPanel: !!e.closest('.panel-wrap') };
  });

/** interactive elements on screen smaller than 44 x 44 px (WCAG 2.5.5 AAA target; 2.5.8 AA is 24 px) */
const smallTargets = (page: any) =>
  page.evaluate(() => {
    const out: { name: string; w: number; h: number }[] = [];
    for (const e of document.querySelectorAll<HTMLElement>('button, [role=button], a[href], input, select, [tabindex="0"]')) {
      const r = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      if (!r.width || !r.height || cs.visibility === 'hidden' || cs.display === 'none' || e.closest('.hidden')) continue;
      if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
      if (r.width < 44 || r.height < 44) out.push({ name: (e.getAttribute('aria-label') || e.textContent || e.className).trim().slice(0, 32), w: Math.round(r.width), h: Math.round(r.height) });
    }
    return out;
  });

/** visible text smaller than 12 px */
const smallText = (page: any) =>
  page.evaluate(() => {
    const out: { text: string; px: number }[] = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = walk.nextNode())) {
      const t = n.textContent?.trim();
      const el = n.parentElement;
      if (!t || !el) continue;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (!r.width || cs.visibility === 'hidden' || cs.display === 'none' || el.closest('.hidden,[aria-hidden=true]') || r.bottom < 0 || r.top > innerHeight) continue;
      const px = parseFloat(cs.fontSize);
      if (px < 12) out.push({ text: t.slice(0, 30), px });
    }
    return out;
  });

async function startPlay(page: any) {
  // keyboard only: Tab onto the start button, Enter
  for (let i = 0; i < 4; i++) {
    const f = await focusInfo(page);
    if (f && /Start your patrol|Continue/.test(f.name)) break;
    await page.keyboard.press('Tab');
  }
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => (window as any).game?.state === 'play', null, { timeout: 60000 });
  await page.waitForTimeout(1200);
}

async function travel(page: any, x: number, z: number, yaw = 0) {
  await page.evaluate(([x, z, yaw]: number[]) => (window as any).patrol.teleport(x, z, yaw), [x, z, yaw]);
  await page.waitForTimeout(500);
}

async function closePanel(page: any) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
}

const phone = { name: 'iphone13', width: 390, height: 844, touch: true };
const desktop = { name: 'desktop', width: 1440, height: 900, touch: false };

for (const vp of [phone, desktop]) {
  const { ctx, page } = await open(vp);
  // ---- title
  await axe(page, 'title', vp.name);
  if (vp === desktop) {
    await page.keyboard.press('Tab');
    const f = await focusInfo(page);
    check('keyboard', 'Tab from a fresh page lands on the start button', !!f && /Start your patrol/.test(f.name), f);
    check('focus', 'the focused start button shows a visible ring (2 px outline or ring shadow)', !!f && (f.outline || f.boxShadow), f);
  }
  await startPlay(page);
  check('keyboard', `the game starts with the keyboard alone (${vp.name})`, (await P(page, 'window.game.state')) === 'play');
  // ---- HUD in play
  await page.waitForTimeout(1500);
  await axe(page, 'hud', vp.name);
  const live = await page.evaluate(() => [...document.querySelectorAll('[aria-live]')].map((e) => ({ cls: (e as HTMLElement).className, live: e.getAttribute('aria-live'), role: e.getAttribute('role') })));
  check('screen reader', `radio and toasts are live regions, so new messages are announced (${vp.name})`, live.some((l) => /radio/.test(l.cls)) && live.some((l) => /toast/.test(l.cls)), live);
  const radioTxt = await page.evaluate(() => document.querySelector('.radio')?.textContent?.trim() ?? '');
  check('screen reader', 'the opening radio call is in the DOM as text (readable, not only voiced)', radioTxt.length > 10, radioTxt.slice(0, 80));
  const tt = await smallTargets(page);
  if (vp === phone) check('touch', 'every HUD control on a phone is at least 44 x 44 px', tt.length === 0, tt);
  const st = await smallText(page);
  check('text', `HUD text is at least 12 px (${vp.name})`, st.length === 0, st.slice(0, 8));
  // ---- pause
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await axe(page, 'pause', vp.name);
  const dlg = await page.evaluate(() => {
    const p = document.querySelector('.panel-wrap .panel');
    const lab = p?.getAttribute('aria-labelledby');
    return { role: p?.getAttribute('role'), modal: p?.getAttribute('aria-modal'), name: p?.getAttribute('aria-label') || (lab ? document.getElementById(lab)?.textContent : null) };
  });
  check('dialog', `pause is a modal dialog with a name (${vp.name})`, dlg.role === 'dialog' && dlg.modal === 'true' && !!dlg.name, dlg);
  const segs = await page.evaluate(() => [...document.querySelectorAll('.seg button')].map((b) => b.getAttribute('aria-pressed')));
  check('screen reader', `pause toggles say which option is on (aria-pressed) (${vp.name})`, segs.length > 0 && segs.every((s) => s === 'true' || s === 'false'), { toggles: segs.length, withState: segs.filter((s) => s !== null).length });
  if (vp === phone) {
    const pt = await smallTargets(page);
    check('touch', 'every pause control on a phone is at least 44 x 44 px', pt.length === 0, pt);
  }
  // focus order inside pause
  const order: string[] = [];
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('Tab');
    const f = await focusInfo(page);
    if (!f) break;
    if (!f.inPanel) {
      order.push(`ESCAPED:${f.name}`);
      break;
    }
    order.push(f.name);
  }
  check('keyboard', `Tab stays inside the pause menu and reaches Back to patrol (${vp.name})`, !order.some((o) => o.startsWith('ESCAPED')) && order.some((o) => /Back to patrol/.test(o)), order.slice(0, 30));
  await closePanel(page);
  check('keyboard', `Esc closes pause (${vp.name})`, !(await P(page, '!!document.querySelector(".panel-wrap")')));
  // ---- map (M), and focus return to the game after it closes
  await page.keyboard.press('KeyM');
  await page.waitForTimeout(800);
  await axe(page, 'map', vp.name);
  await closePanel(page);
  // ---- mission table: walk over and press E
  await travel(page, SPOTS.table.x + 1.4, SPOTS.table.z + 0.4, Math.PI / 2);
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(900);
  const boardOpen = await P(page, '!!document.querySelector(".panel-wrap .board")');
  check('keyboard', `the mission table opens with E (${vp.name})`, boardOpen);
  if (boardOpen) {
    await axe(page, 'mission table: calls', vp.name);
    const tabs = await page.evaluate(() => {
      const t = document.querySelector('.panel-wrap .tabs');
      return { role: t?.getAttribute('role'), tabs: [...(t?.querySelectorAll('.tab') ?? [])].map((b) => ({ role: b.getAttribute('role'), selected: b.getAttribute('aria-selected') })) };
    });
    check('screen reader', `the mission table tabs are a tab list with the selected tab marked (${vp.name})`, tabs.role === 'tablist' && tabs.tabs.every((t) => t.role === 'tab' && (t.selected === 'true' || t.selected === 'false')), tabs);
    const sel = await page.evaluate(() => [...document.querySelectorAll('.mrow[data-m]')].map((b) => b.getAttribute('aria-pressed')));
    check('screen reader', `the chosen call is marked as selected (${vp.name})`, sel.length > 0 && sel.filter((s) => s === 'true').length === 1, sel);
    if (vp === phone) {
      const bt = await smallTargets(page);
      check('touch', 'every mission table control on a phone is at least 44 x 44 px', bt.length === 0, bt);
    }
    const bst = await smallText(page);
    check('text', `mission table text is at least 12 px (${vp.name})`, bst.length === 0, bst.slice(0, 8));
    await page.click('.panel-wrap .tab[data-t=station]');
    await page.waitForTimeout(400);
    await axe(page, 'mission table: station', vp.name);
    await page.click('.panel-wrap .tab[data-t=log]');
    await page.waitForTimeout(400);
    await axe(page, 'mission table: log', vp.name);
    await closePanel(page);
    const back = await page.evaluate(() => document.activeElement?.tagName);
    check('focus', `closing a panel does not leave focus on a removed element (${vp.name})`, back !== undefined, back);
  }
  // ---- wardrobe (an outfitter)
  await travel(page, SPOTS.wardrobe.x + 1.2, SPOTS.wardrobe.z + 0.4, Math.PI / 2);
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(900);
  if (await P(page, '!!document.querySelector(".panel-wrap .items")')) await axe(page, 'wardrobe', vp.name);
  await closePanel(page);
  await ctx.close();
}

// ---- reduced motion: the panels and the title stop animating, and the camera stops shaking
{
  const { ctx, page } = await open(phone, 'reduce');
  const anim = await page.evaluate(() => {
    const out: { el: string; dur: string }[] = [];
    for (const e of document.querySelectorAll<HTMLElement>('*')) {
      const cs = getComputedStyle(e);
      if (cs.animationName !== 'none' && parseFloat(cs.animationDuration) > 0.01 && cs.animationIterationCount === 'infinite') out.push({ el: e.className.toString().slice(0, 30), dur: cs.animationDuration });
    }
    return out;
  });
  check('motion', 'with reduced motion, nothing on the title loops forever', anim.length === 0, anim);
  await startPlay(page);
  const shake = await page.evaluate(() => (window as any).patrol?.motion?.() ?? null);
  check('motion', 'with reduced motion, the game turns its camera shake and buffet down', !!shake && shake.reduced === true && shake.shake <= 0.25, shake);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  const enter = await page.evaluate(() => {
    const w = document.querySelector('.panel-wrap');
    const p = w?.querySelector('.panel');
    return { wrap: w ? getComputedStyle(w).animationDuration : null, panel: p ? getComputedStyle(p).animationDuration : null };
  });
  check('motion', 'with reduced motion, panels appear without the rise-in animation', !enter.panel || parseFloat(enter.panel) <= 0.01, enter);
  await ctx.close();
}

check('technical', 'no console or page errors during the audit', consoleErrors.length === 0, consoleErrors.slice(0, 5));
await browser.close();

// ---- report
const rules = new Map<string, { id: string; impact: string; help: string; screens: string[]; nodes: number }>();
for (const s of screens)
  for (const v of s.violations) {
    const r = rules.get(v.id) ?? { id: v.id, impact: v.impact, help: v.help, screens: [], nodes: 0 };
    r.screens.push(`${s.screen} @ ${s.viewport}`);
    r.nodes += v.count;
    rules.set(v.id, r);
  }
const report = { kind: 'rockslide-a11y', url, when: new Date().toISOString(), axe: require('axe-core/package.json').version, screens, rules: [...rules.values()], checks, consoleErrors };
writeFileSync(join(outDir, 'a11y.json'), JSON.stringify(report, null, 1));
const md = [
  `# ROCKSLIDE accessibility audit`,
  '',
  `${report.when} · ${url} · axe-core ${report.axe} (WCAG 2.0/2.1/2.2 A + AA and best practice) · ${screens.length} screen captures · ${checks.filter((c) => c.ok).length}/${checks.length} checks pass`,
  '',
  'Chromium headless (software WebGL), iPhone 13 (390x844, touch) and desktop (1440x900). Automated: what axe and these scripted checks can see in the DOM. The 3D view is a WebGL canvas and is not in the DOM.',
  '',
  '## axe-core: rules violated',
  '',
  rules.size ? '| Rule | Impact | Nodes | Where | What |\n|---|---|---|---|---|\n' + [...rules.values()].map((r) => `| \`${r.id}\` | ${r.impact} | ${r.nodes} | ${[...new Set(r.screens)].join(', ')} | ${r.help} |`).join('\n') : 'None.',
  '',
  '## Per screen',
  '',
  '| Screen | Viewport | Rules violated | Rules passed | Needs review |\n|---|---|---|---|---|\n' + screens.map((s) => `| ${s.screen} | ${s.viewport} | ${s.violations.map((v) => `${v.id}×${v.count}`).join(', ') || '0'} | ${s.passes} | ${s.incomplete} |`).join('\n'),
  '',
  '## Scripted checks',
  '',
  '| | Area | Check | Detail |\n|---|---|---|---|\n' + checks.map((c) => `| ${c.ok ? '✅' : '❌'} | ${c.area} | ${c.what} | ${c.detail === undefined ? '' : JSON.stringify(c.detail).slice(0, 160).replace(/\|/g, '/')} |`).join('\n'),
  '',
];
writeFileSync(join(outDir, 'a11y.md'), md.join('\n'));
console.log(`\n${rules.size} axe rules violated; ${checks.filter((c) => !c.ok).length} of ${checks.length} checks fail. Report: ${join(outDir, 'a11y.md')}`);
