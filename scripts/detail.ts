import { loadRapier } from '../src/sim/rapier';
import { Simulation } from '../src/sim/simulation';
import { FIRST_DESCENT } from '../src/levels/firstDescent';
import { defaultPlan } from '../src/sim/plan';
import { SOLUTIONS } from './solutions';
const R = await loadRapier();
const [name, j] = process.argv[2].split('@');
const p = defaultPlan(FIRST_DESCENT);
SOLUTIONS[Object.keys(SOLUTIONS).find(k => k.includes(name))!](p, Number(j ?? 0));
const sim = new Simulation(R, FIRST_DESCENT, p);
sim.debugImpacts = [];
const r = sim.runToEnd();
if (process.env.IMP) console.log(sim.debugImpacts.join('\n'));
console.log(r.success, (r.deliveredFraction*100).toFixed(0)+'%', r.destination, r.reason, r.duration.toFixed(1));
for (const f of r.fractures) console.log(` t=${f.time.toFixed(2)} vs ${f.against} imp=${f.impact.toFixed(1)} n=${f.pieces} g=${f.generation} @(${f.pos.map(v=>v.toFixed(1)).join(',')})`);
for (const p of sim.pieces.values()) if (p.kind==='stone') { const t=p.body.translation(); console.log(`  piece ${p.id} r=${p.shape.radius.toFixed(2)} vol%=${(p.volume/ (r.remainingFraction||1)).toFixed(2)} @(${t.x.toFixed(1)},${t.y.toFixed(1)},${t.z.toFixed(1)}) del=${p.delivered}`); }
