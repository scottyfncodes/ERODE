import { loadRapier } from '../src/sim/rapier';
import { Simulation } from '../src/sim/simulation';
import { sanitizePlan } from '../src/sim/plan';
import { makeAutopilot } from '../src/sim/autopilot';
const R = await loadRapier();
const mod = await import('../src/levels/cinderCone');
const L = mod.CINDER_CONE, T = mod.CINDER_CONE_TESTS;
const comp = (process.argv[2] ?? 'granite') as any;
const filt = process.argv[3];
for (const t of T) {
  if (filt && !t.name.includes(filt)) continue;
  const res: string[] = [];
  let sum = 0, fin = 0;
  for (const gain of (process.env.GAINS ?? "0.8,0.9,1,1.1,1.25").split(",").map(Number)) {
    const sim = new Simulation(R, L, sanitizePlan(L, t.plan), { composition: comp });
    const pilot = makeAutopilot(sim, t.route, gain);
    while (!sim.done) { sim.steer = pilot(); sim.stepOnce(); }
    const r = sim.result!;
    const ok = r.reason === 'finished';
    if (ok) { sum += r.retained; fin++; }
    res.push(ok ? `${(r.retained * 100).toFixed(0)}${r.route === t.route ? '' : '?'}` : `X(${r.cause.slice(0, 38)})`);
    sim.dispose();
  }
  console.log(`${t.name.padEnd(40)} avg ${fin ? ((sum / fin) * 100).toFixed(1) : '--'} [${fin}/5]  ${res.join(' | ')}`);
}
