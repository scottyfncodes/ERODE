// Headless level evaluation: run the simulation for a set of plans and print outcomes.
import { loadRapier } from '../src/sim/rapier';
import { Simulation } from '../src/sim/simulation';
import { FIRST_DESCENT } from '../src/levels/firstDescent';
import { defaultPlan } from '../src/sim/plan';
import type { Plan } from '../src/levels/types';

const deg = Math.PI / 180;
const R = await loadRapier();
const L = FIRST_DESCENT;

function plan(mod: (p: Plan) => void): Plan {
  const p = defaultPlan(L);
  mod(p);
  return p;
}

const plans: Record<string, Plan> = {
  default: plan(() => {}),
  'log open': plan((p) => { (p['log-a'] as any).yaw = 90 * deg; }),
  'log open + branches': plan((p) => { (p['log-a'] as any).yaw = 90 * deg; (p['branches'] as any).removed = true; }),
  'log open + branches + logB': plan((p) => { (p['log-a'] as any).yaw = 90 * deg; (p['branches'] as any).removed = true; (p['log-b'] as any).yaw = 90 * deg; }),
  'log deflect left': plan((p) => { Object.assign(p['log-a'], { yaw: -45 * deg, z: -18.5, x: 1.5 }); }),
  'log deflect left + dig': plan((p) => { Object.assign(p['log-a'], { yaw: -45 * deg, z: -18.5, x: 1.5 }); (p['soil'] as any).dug = true; }),
  'log deflect left + water': plan((p) => { Object.assign(p['log-a'], { yaw: -45 * deg, z: -18.5, x: 1.5 }); (p['gate'] as any).option = 'left'; }),
  'log open + tree across + dig': plan((p) => { (p['log-a'] as any).yaw = 90 * deg; (p['tree'] as any).felled = 'across'; (p['soil'] as any).dug = true; }),
  'log open + spur + dig': plan((p) => { (p['log-a'] as any).yaw = 90 * deg; (p['spur'] as any).split = true; (p['soil'] as any).dug = true; }),
};

const only = process.argv[2];
for (const [name, p] of Object.entries(plans)) {
  if (only && !name.includes(only)) continue;
  const t0 = performance.now();
  const sim = new Simulation(R, L, p);
  const speeds: string[] = [];
  while (!sim.done) {
    sim.stepOnce();
    if (sim.step % 45 === 0 && sim.primary) {
      const v = sim.primary.body.linvel(); const t = sim.primary.body.translation();
      speeds.push(`${t.z.toFixed(0)}:${Math.hypot(v.x, v.y, v.z).toFixed(1)}`);
    }
  }
  const res = sim.result!;
  const ms = performance.now() - t0;
  const traj = res.trajectory.filter((_, i) => i % 10 === 0).map((q) => `(${q[0].toFixed(0)},${q[2].toFixed(0)})`).join(' ');
  console.log(`\n== ${name}  [${ms.toFixed(0)}ms, ${res.duration.toFixed(1)}s sim, ${res.reason}]`);
  console.log(`  success=${res.success} delivered=${(res.deliveredFraction*100).toFixed(0)}% fractures=${res.fractures.length} stones=${res.stoneCount} dest=${res.destination} stars=${res.stars} lost=${(res.lostFraction*100).toFixed(0)}%`);
  for (const f of res.fractures) console.log(`   fracture t=${f.time.toFixed(1)} vs ${f.against} impact=${f.impact.toFixed(1)} pieces=${f.pieces} gen=${f.generation} at (${f.pos.map(v=>v.toFixed(1)).join(',')})`);
  console.log('  path', traj);
  if (process.env.SPEED) console.log('  speed', speeds.join(' '));
  sim.dispose();
}
