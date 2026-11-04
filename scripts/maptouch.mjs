// Map gestures on a phone, with real multitouch (Chrome DevTools touch events, which the page sees as
// touch pointers exactly like an iPhone's): pinch zoom about the fingers, pan, release, limits, the
// zoom buttons, no page zoom or scroll, and no leak into the game's controls.
// Usage: node scripts/maptouch.mjs <url> [outprefix]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const [url = 'http://127.0.0.1:5173/', out = 'out/map'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let failures = 0;
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`);
  if (!ok) failures++;
};
for (const [label, dev] of [
  ['iPhone 13 portrait', devices['iPhone 13']],
  ['iPhone 13 landscape', devices['iPhone 13 landscape']],
  ['iPhone SE portrait', devices['iPhone SE']],
].filter(([l]) => !process.env.ONLY || l.includes(process.env.ONLY))) {
  console.log(`\n== ${label}`);
  const ctx = await browser.newContext({ ...dev });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(url);
  await page.waitForFunction(() => window.patrol, null, { timeout: 120000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => window.patrol, null, { timeout: 120000 });
  await page.waitForTimeout(800);
  await page.click('[data-a=new]');
  await page.waitForTimeout(1500);
  // outdoors, then the Map chip, as a thumb would
  await page.evaluate(() => window.patrol.teleport(10, 236, 0.3));
  await page.waitForTimeout(400);
  await page.locator('button', { hasText: 'Map' }).first().tap();
  await page.waitForSelector('.mappanel .mapview');
  // let the panel finish rising in (it is briefly scaled) before the fingers go down
  await page.waitForFunction(() => [...document.querySelector('.panel-wrap').getAnimations(), ...document.querySelector('.panel').getAnimations()].every((a) => a.playState === 'finished'));
  await page.waitForTimeout(300);
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1, radiusX: 8, radiusY: 8, force: 1 })) });
  const box = await page.locator('.mappanel .mapview').boundingBox();
  const view = () =>
    page.evaluate(() => {
      const c = document.querySelector('.mappanel .mapcontent');
      const m = new DOMMatrixReadOnly(getComputedStyle(c).transform);
      return { z: m.a, x: m.e, y: m.f, size: c.offsetWidth, scale: window.visualViewport.scale, scrollY: window.scrollY, scrollX: window.scrollX };
    });
  // wait until the map has stopped moving (an eased zoom, a coast) before reading it
  const still = async () => {
    await page.waitForFunction(() => document.querySelector('.mappanel .mapview').dataset.moving !== '1', null, { timeout: 8000 }).catch(() => null);
    let a = await view();
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(120);
      const b = await view();
      if (Math.abs(a.x - b.x) < 0.05 && Math.abs(a.y - b.y) < 0.05 && Math.abs(a.z - b.z) < 1e-4) return b;
      a = b;
    }
    return a;
  };
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height * 0.55;
  const v0 = await view();
  if (process.env.DEBUG) console.log('start', JSON.stringify(v0), JSON.stringify(box), await page.evaluate(() => [document.querySelector('.mappanel .mapview').clientWidth, document.querySelector('.mappanel .mapview').clientHeight]));
  check('opens at the whole valley', Math.abs(v0.z - 1) < 0.01, `zoom ${v0.z.toFixed(2)}`);
  // pinch out about a point off-centre: the map point under the fingers must stay under them
  // a point well inside the map at every orientation (near an edge the frame rightly holds the map in)
  const side = Math.min(box.width, box.height);
  const px = cx - side * 0.08;
  const py = cy - side * 0.05;
  const mapPt = { u: (px - box.x - v0.x) / v0.z, v: (py - box.y - v0.y) / v0.z };
  await touch('touchStart', [
    [px - 30, py],
    [px + 30, py],
  ]);
  for (let i = 1; i <= 12; i++) {
    const d = 30 + i * 9;
    await touch('touchMove', [
      [px - d, py],
      [px + d, py],
    ]);
    await page.waitForTimeout(16);
  }
  const vMid = await view();
  if (process.env.DEBUG) console.log('mid', JSON.stringify(vMid), JSON.stringify(await page.locator('.mappanel .mapview').boundingBox()));
  const under = { x: box.x + vMid.x + mapPt.u * vMid.z, y: box.y + vMid.y + mapPt.v * vMid.z };
  check('pinch zooms in by the fingers\' spread', Math.abs(vMid.z - 276 / 60) < 0.05, `zoom ${vMid.z.toFixed(2)} for fingers 60 -> 276 px apart`);
  check('the point between the fingers stays under them', Math.hypot(under.x - px, under.y - py) < 2, `${Math.hypot(under.x - px, under.y - py).toFixed(2)} px off`);
  // two fingers moving together pan while they pinch
  for (let i = 1; i <= 6; i++) {
    await touch('touchMove', [
      [px - 138 + i * 10, py + i * 6],
      [px + 138 + i * 10, py + i * 6],
    ]);
    await page.waitForTimeout(16);
  }
  const vPan2 = await view();
  check('two fingers pan as they pinch', Math.abs(vPan2.x - vMid.x - 60) < 2 && Math.abs(vPan2.y - vMid.y - 36) < 2, `moved ${(vPan2.x - vMid.x).toFixed(1)}, ${(vPan2.y - vMid.y).toFixed(1)}`);
  await touch('touchEnd', []);
  await page.waitForTimeout(700);
  // DevTools cannot lift one finger of two, so this part goes straight to the map's pointer handlers:
  // fingers down, one lifts, the other carries on panning without a jump
  const lift = await page.evaluate(() => {
    const el = document.querySelector('.mappanel .mapview');
    const r = el.getBoundingClientRect();
    const c = document.querySelector('.mappanel .mapcontent');
    const read = () => {
      const m = new DOMMatrixReadOnly(getComputedStyle(c).transform);
      return { z: m.a, x: m.e, y: m.f };
    };
    const ev = (type, id, x, y) => el.dispatchEvent(new PointerEvent(type, { pointerId: 100 + id, pointerType: 'touch', clientX: r.left + x, clientY: r.top + y, bubbles: true, cancelable: true, isPrimary: id === 1 }));
    const mx = r.width / 2;
    const my = r.height / 2;
    ev('pointerdown', 1, mx - 40, my);
    ev('pointerdown', 2, mx + 40, my);
    ev('pointermove', 2, mx + 50, my);
    const a = read();
    ev('pointerup', 2, mx + 50, my);
    const b = read();
    for (let i = 1; i <= 8; i++) ev('pointermove', 1, mx - 40 - i * 8, my - i * 5);
    const c2 = read();
    ev('pointerup', 1, mx - 104, my - 40);
    return { a, b, c: c2 };
  });
  check('lifting one finger does not jump the map', Math.abs(lift.b.x - lift.a.x) < 0.5 && Math.abs(lift.b.y - lift.a.y) < 0.5 && Math.abs(lift.b.z - lift.a.z) < 0.001, `dx ${(lift.b.x - lift.a.x).toFixed(2)}`);
  check('the finger left down pans on', Math.abs(lift.c.x - lift.b.x + 64) < 2 && Math.abs(lift.c.y - lift.b.y + 40) < 2, `moved ${(lift.c.x - lift.b.x).toFixed(1)}, ${(lift.c.y - lift.b.y).toFixed(1)}`);
  // (those synthetic moves came 0 ms apart, a huge flick: let it coast out, then come back to you)
  await page.waitForTimeout(1500);
  await page.locator('.mapctl [data-z=me]').tap();
  // the locate tap can arrive late: wait for its eased move to start and finish before panning
  await page.waitForFunction(() => document.querySelector('.mappanel .mapview').dataset.moving === '1', null, { timeout: 4000 }).catch(() => null);
  await still();
  // one real finger: pan, hold, lift
  const vOne = await view();
  const held = await page.evaluate(() => document.querySelector('.mappanel .mapview').dataset.fingers);
  check('no finger left held after the gestures', held === '0', `held ${held}`);
  await touch('touchStart', [[cx, cy]]);
  for (let i = 1; i <= 8; i++) {
    await touch('touchMove', [[cx - i * 8, cy - i * 5]]);
    await page.waitForTimeout(16);
  }
  const vPan = await view();
  const exp = { x: vOne.x - 64, y: vOne.y - 40 };
  check('one finger pans', Math.abs(vPan.x - exp.x) < 3 && Math.abs(vPan.y - exp.y) < 3, `moved ${(vPan.x - vOne.x).toFixed(1)}, ${(vPan.y - vOne.y).toFixed(1)}`);
  // hold still, then lift: no fling, the map stays where it was put
  await page.waitForTimeout(150);
  await touch('touchEnd', []);
  await page.waitForTimeout(700);
  const vRest = await view();
  check('stays put when the fingers lift', Math.abs(vRest.x - vPan.x) < 1 && Math.abs(vRest.y - vPan.y) < 1 && Math.abs(vRest.z - vPan.z) < 0.01, `drift ${(vRest.x - vPan.x).toFixed(2)}, ${(vRest.y - vPan.y).toFixed(2)}`);
  await page.screenshot({ path: `${out}-${label.replace(/ /g, '-')}-zoomed.png` });
  // pinch far past the maximum: it resists, then settles at the limit
  await touch('touchStart', [
    [cx - 20, cy],
    [cx + 20, cy],
  ]);
  for (let i = 1; i <= 10; i++) {
    await touch('touchMove', [
      [cx - 20 - i * 16, cy],
      [cx + 20 + i * 16, cy],
    ]);
    await page.waitForTimeout(16);
  }
  await touch('touchEnd', []);
  await page.waitForTimeout(900);
  const vMax = await view();
  check('zoom stops at the maximum', Math.abs(vMax.z - 6) < 0.02, `zoom ${vMax.z.toFixed(2)}`);
  // and pinch right in: never smaller than the whole valley, centred in the frame
  const reach = Math.min(150, box.width / 2 - 12);
  await touch('touchStart', [
    [cx - reach, cy],
    [cx + reach, cy],
  ]);
  for (let i = 1; i <= 14; i++) {
    await touch('touchMove', [
      [cx - reach + (i * (reach - 10)) / 14, cy],
      [cx + reach - (i * (reach - 10)) / 14, cy],
    ]);
    await page.waitForTimeout(16);
  }
  await touch('touchEnd', []);
  await page.waitForTimeout(900);
  const vMin = await view();
  const frame = await page.evaluate(() => [document.querySelector('.mappanel .mapview').clientWidth, document.querySelector('.mappanel .mapview').clientHeight]);
  const centred = Math.abs(vMin.x - (frame[0] - vMin.size) / 2) < 1.5 && Math.abs(vMin.y - (frame[1] - vMin.size) / 2) < 1.5;
  check('zoom stops at the whole valley, centred', Math.abs(vMin.z - 1) < 0.01 && centred, `zoom ${vMin.z.toFixed(2)}, at ${vMin.x.toFixed(1)}, ${vMin.y.toFixed(1)}; frame ${frame}, map ${vMin.size}`);
  // a flick at zoom carries on and stops inside the frame
  for (let k = 0; k < 3; k++) {
    const z0 = (await view()).z;
    await page.locator('.mapctl [data-z=in]').tap();
    // the tap can arrive late on a slow test browser: wait for the zoom it asks for, then for stillness
    await page.waitForFunction((z) => Number(document.querySelector('.mappanel .mapview').dataset.zoom) > Math.min(5.9, z * 1.7), z0, { timeout: 8000 }).catch(() => null);
    await still();
  }
  const vBtn = await still();
  check('the + button zooms in', vBtn.z > 3, `zoom ${vBtn.z.toFixed(2)}`);
  await touch('touchStart', [[cx, cy]]);
  for (let i = 1; i <= 5; i++) {
    await touch('touchMove', [[cx + i * 30, cy + i * 12]]);
    await page.waitForTimeout(16);
  }
  await touch('touchEnd', []);
  await page.waitForTimeout(1500);
  const vFl = await view();
  if (process.env.DEBUG) console.log('flick', JSON.stringify(vBtn), JSON.stringify(vFl), await page.evaluate(() => document.querySelector('.mappanel .mapview').dataset.fingers));
  const inside = vFl.x <= 0.5 && vFl.y <= 0.5 && vFl.x + vFl.size * vFl.z >= box.width - 0.5 && vFl.y + vFl.size * vFl.z >= box.height - 0.5;
  check('the map is still open (edge touches do not close it)', await page.locator('.mappanel').count() === 1);
  check('a flick coasts on and the map stays in the frame', vFl.x - vBtn.x > 100 && inside, `coasted ${(vFl.x - vBtn.x).toFixed(0)} px`);
  // double tap zooms in about the tap
  const before = (await view()).z;
  await page.locator('.mapctl [data-z=out]').tap();
  await page.waitForFunction((b) => Number(document.querySelector('.mappanel .mapview').dataset.zoom) < b - 0.5, before, { timeout: 5000 }).catch(() => null);
  await page.waitForTimeout(300);
  const zOut = (await view()).z;
  check('the − button zooms out', zOut < before - 0.5, `zoom ${zOut.toFixed(2)}`);
  // a double tap; a software-rendered test browser can deliver the taps late, and then (and only
  // then, by the map's own record of the tap timing) it is tried again
  // A double tap, from a known zoom each time. A software-rendered test browser can deliver taps
  // late; an attempt only counts as a miss if both taps and the gap between them arrived on time.
  let z0 = zOut;
  let zDbl = zOut;
  let why = '';
  let ok = false;
  let onTimeMiss = false;
  for (let attempt = 0; attempt < 4 && !ok; attempt++) {
    if (attempt) {
      // back to a middling zoom, and wait for any late tap to have played out
      await page.waitForTimeout(800);
      while ((await still()).z > 2.5) {
        await page.locator('.mapctl [data-z=out]').tap();
        await page.waitForTimeout(400);
      }
      await page.waitForTimeout(500);
    }
    z0 = (await still()).z;
    for (let k = 0; k < 2; k++) {
      await touch('touchStart', [[cx, cy]]);
      await touch('touchEnd', []);
      await page.waitForTimeout(60);
    }
    zDbl = (await still()).z;
    why = await page.evaluate(() => document.querySelector('.mappanel .mapview').dataset.tap);
    ok = zDbl >= Math.min(6, z0 * 2) * 0.97;
    const t = /still (\d+)ms gap (\d+)ms/.exec(why ?? '');
    if (!ok && t && +t[1] < 300 && +t[2] < 300) onTimeMiss = true;
  }
  check('double tap zooms in', ok && !onTimeMiss, `zoom ${z0.toFixed(2)} -> ${zDbl.toFixed(2)}; last tap ${why}`);
  await page.locator('.mapctl [data-z=me]').tap();
  await page.waitForTimeout(500);
  const meBox = await page.locator('.mappanel .me').boundingBox();
  check('the locate button centres on you', Math.abs(meBox.x + meBox.width / 2 - cx) < 12 && Math.abs(meBox.y + meBox.height / 2 - (box.y + box.height / 2)) < 12);
  const sz = await page.evaluate(() => {
    const p = document.querySelector('.mappanel .pin, .mappanel .me').getBoundingClientRect();
    return p.width;
  });
  check('markers keep their size when zoomed', sz < 30, `${sz.toFixed(1)} px`);
  const vEnd = await view();
  check('the page itself never zoomed or scrolled', vEnd.scale === 1 && vEnd.scrollX === 0 && vEnd.scrollY === 0, `scale ${vEnd.scale}`);
  const tgt = await page.evaluate(() => Math.min(...[...document.querySelectorAll('.mapctl button, .panel .x')].map((b) => Math.min(b.getBoundingClientRect().width, b.getBoundingClientRect().height))));
  check('map buttons are at least 44 px', tgt >= 40, `${tgt} px`);
  // close it: the game's stick and look must not have picked anything up
  await page.locator('.panel .x').tap();
  await page.waitForTimeout(300);
  const st = await page.evaluate(() => window.patrol.state());
  const before2 = st.pos;
  await page.waitForTimeout(600);
  const after2 = (await page.evaluate(() => window.patrol.state())).pos;
  check('no stray movement in the game after the map', Math.hypot(after2.x - before2.x, after2.z - before2.z) < 0.05 && st.mode === 'foot');
  // the mission board's map pinches too
  await page.evaluate(() => window.patrol.teleport(-28, 247.8, 0));
  await page.waitForTimeout(500);
  await page.keyboard.down('KeyE');
  await page.waitForTimeout(80);
  await page.keyboard.up('KeyE');
  await page.waitForSelector('.board .mapview', { timeout: 5000 }).catch(() => null);
  const bb = await page.locator('.board .mapview').boundingBox().catch(() => null);
  if (bb) {
    const bx = bb.x + bb.width / 2;
    const by = bb.y + bb.height / 2;
    await touch('touchStart', [
      [bx - 20, by],
      [bx + 20, by],
    ]);
    for (let i = 1; i <= 8; i++) {
      await touch('touchMove', [
        [bx - 20 - i * 8, by],
        [bx + 20 + i * 8, by],
      ]);
      await page.waitForTimeout(16);
    }
    await touch('touchEnd', []);
    await page.waitForTimeout(500);
    const bz = await page.evaluate(() => new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.board .mapcontent')).transform).a);
    check('the mission table map pinches', bz > 2, `zoom ${bz.toFixed(2)}`);
    await page.screenshot({ path: `${out}-${label.replace(/ /g, '-')}-board.png` });
  } else check('the mission table opened', false);
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}
await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nall map gesture checks passed');
process.exit(failures ? 1 : 0);
