// Captures the share card's hero shots from a running build (npx vite preview --port 4173), with the HTML UI hidden.
// Usage: node art/pipeline/4_share_card_capture.mjs <outdir>   (2400x1260: 1200x630 at 2x; slow under SwiftShader)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = process.argv[2];
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 });
const page = await ctx.newPage(); page.setDefaultTimeout(300000);
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:4173/');
await page.waitForFunction(() => window.patrol, null, { timeout: 180000 });
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => window.patrol, null, { timeout: 180000 });
await page.waitForTimeout(4000);
await page.addStyleTag({ content: '#ui,#loading{visibility:hidden!important}' });
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/title-clean.png` });
await page.addStyleTag({ content: '#ui,#loading{visibility:visible!important}' });
await page.click('[data-a=new]');
await page.waitForTimeout(1500);
await page.addStyleTag({ content: '#ui{visibility:hidden!important}' });
const at = async (name, m, x, z, y, p) => {
  const f = ([m, x, z, y, p]) => { window.patrol.closePanel(); window.patrol.setTime(m); window.patrol.teleport(x, z, y); window.patrol.camYaw(y); window.patrol.camPitch(p); };
  await page.evaluate(f, [m, x, z, y, p]); await page.waitForTimeout(2600);
  await page.evaluate(f, [m, x, z, y, p]); await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${name}.png` });
};
await at('yard', 9 * 60, 30, 254, 0.35, 0.2);
await at('dusk', 18 * 60 + 40, -12, 258, 0.74, 0.18);
await at('topstation', 11 * 60, 586, -320, 0.1, 0.16);
await browser.close();
