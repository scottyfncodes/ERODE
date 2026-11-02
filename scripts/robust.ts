// Robustness check: run each solution with small perturbations and report success rates.
import { loadRapier } from '../src/sim/rapier';
import { Simulation } from '../src/sim/simulation';
import { FIRST_DESCENT } from '../src/levels/firstDescent';
import { defaultPlan } from '../src/sim/plan';
import type { Plan } from '../src/levels/types';
import { SOLUTIONS } from './solutions';

const R = await loadRapier();
const L = FIRST_DESCENT;
const N = Number(process.env.N ?? 6);
const only = process.argv[2];
for (const [name, mod] of Object.entries(SOLUTIONS)) {
  if (only && !name.includes(only)) continue;
  let ok = 0;
  const notes: string[] = [];
  for (let k = 0; k < N; k++) {
    const p: Plan = defaultPlan(L);
    mod(p, k === 0 ? 0 : ((k * 7919) % 13) / 13 - 0.5);
    const sim = new Simulation(R, L, p);
    const r = sim.runToEnd();
    if (r.success) ok++;
    notes.push(`${r.success ? 'OK' : '--'} ${(r.deliveredFraction * 100).toFixed(0)}%/${r.fractures.length}f`);
    sim.dispose();
  }
  console.log(`${name.padEnd(36)} ${ok}/${N}  ${notes.join('  ')}`);
}
