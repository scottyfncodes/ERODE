// Controlled performance capture: the same views on a build, per quality tier.
// Usage: node scripts/perf.mjs <url> [low|high]   (prints JSON: boot time, draw calls, triangles, frame time)
// Runs on SwiftShader (CPU) in CI containers, so frame times are only comparable between builds on the same machine.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [url = 'http://localhost:4173/', tier = 'low'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const mobile = tier === 'low';
const ctx = await browser.newContext({ viewport: mobile ? { width: 844, height: 390 } : { width: 1280, height: 720 }, isMobile: mobile, hasTouch: mobile });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(url);
await page.waitForFunction(() => window.patrol, null, { timeout: 180000 });
await page.evaluate(() => localStorage.clear());
const t0 = Date.now();
await page.reload();
await page.waitForFunction(() => window.patrol, null, { timeout: 180000 });
const bootMs = Date.now() - t0;
await page.click('[data-a=new]');
await page.waitForTimeout(1000);
const views = { yard: [30, 254, 0.35], topstation: [586, -320, 0.1], passroad: [-420, -186, 0.05], ridge: [-215, -440, 0.4] };
const out = { tier, bootMs, views: {} };
for (const [name, [x, z, yaw]] of Object.entries(views)) {
  await page.evaluate(([x, z, y]) => { window.patrol.setTime(660); window.patrol.teleport(x, z, y); window.patrol.camYaw(y); window.patrol.camPitch(0.18); }, [x, z, yaw]);
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => new Promise((ok) => {
    const ts = [];
    let last = performance.now();
    const f = () => { const n = performance.now(); ts.push(n - last); last = n; if (ts.length < 90) requestAnimationFrame(f); else ok(ts); };
    requestAnimationFrame(f);
  }));
  r.sort((a, b) => a - b);
  const info = await page.evaluate(() => window.patrol.info());
  out.views[name] = { calls: info.calls, tris: info.tris, medianMs: +r[45].toFixed(1), p90Ms: +r[81].toFixed(1) };
}
out.heapMB = await page.evaluate(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null));
out.errors = errors;
console.log(JSON.stringify(out));
await browser.close();
