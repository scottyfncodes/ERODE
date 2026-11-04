// Film the gait lab: a contact sheet of frames at a fixed speed, and the foot-slide numbers.
// Usage: node tools/gaitlab/capture.mjs <url> <outdir> <speed> [cam] [frames] [dt]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [url = 'http://127.0.0.1:5173/tools/gaitlab/', out = 'out/gait', speed = '5.8', camv = 'side', n = '12', dt = '0.04'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 360, height: 420 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await page.goto(`${url}?manual&cam=${camv}&speed=${speed}`);
await page.waitForFunction(() => window.lab?.ready, null, { timeout: 60000 });
// get up to speed and settle into the cycle, then measure over a long stretch
await page.evaluate(() => window.lab.advance(4));
await page.evaluate(() => window.lab.resetMetrics());
await page.evaluate(() => window.lab.advance(6));
const m = await page.evaluate(() => window.lab.metrics());
for (let i = 0; i < Number(n); i++) {
  await page.evaluate((d) => window.lab.advance(d), Number(dt));
  await page.screenshot({ path: `${out}-${String(i).padStart(2, '0')}.png` });
}
console.log(JSON.stringify({ speed: Number(speed), slideL_cm: +(m.slideL * 100).toFixed(1), slideR_cm: +(m.slideR * 100).toFixed(1), lowestAnkle: +m.lowestAnkle.toFixed(3), detail: m.detail, errs }));
await browser.close();
