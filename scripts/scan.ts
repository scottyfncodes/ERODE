import { loadRapier } from '../src/sim/rapier';
import { Simulation } from '../src/sim/simulation';
import { FIRST_DESCENT } from '../src/levels/firstDescent';
import { defaultPlan } from '../src/sim/plan';
const R = await loadRapier();
const deg = Math.PI / 180;
const extra = JSON.parse(process.argv[2] ?? '{}');
for (const x of [1.5, 3, 4.5]) for (const z of [-19, -17]) {
  const row: string[] = [];
  for (const yaw of [-30, -45, -60]) {
    const p = defaultPlan(FIRST_DESCENT);
    Object.assign(p['log-a'], { x, z, yaw: yaw * deg });
    for (const [k, v] of Object.entries(extra)) Object.assign(p[k], v);
    const sim = new Simulation(R, FIRST_DESCENT, p);
    const r = sim.runToEnd();
    const fr = r.fractures.map(f => f.against.replace('the ', '').slice(0, 6)).join(',');
    row.push(`${yaw}:${r.success ? 'OK' : '--'}${(r.deliveredFraction * 100).toFixed(0)}% [${fr}] ${r.destination.replace('the ', '')}`);
    sim.dispose();
  }
  console.log(`x=${x} z=${z}  ` + row.join(' | '));
}
