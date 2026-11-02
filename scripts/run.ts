// Headless runs of the long course: prints score, distance, size and where it stopped.
import { loadRapier } from '../src/sim/rapier';
import { Simulation, STAGES } from '../src/sim/simulation';
import { SUMMIT_TO_SEA as L } from '../src/levels/summitToSea';
import { defaultPlan } from '../src/sim/plan';
import type { Plan } from '../src/levels/types';

const R = await loadRapier();
const set = (p: Plan, id: string, v: object) => Object.assign(p[id], v);
const clear = (p: Plan) => {
  set(p, 'logjam', { removed: true });
  set(p, 'debris', { removed: true });
  set(p, 'beaver', { removed: true });
  set(p, 'sandbar', { dug: true });
  set(p, 'weir', { option: 'right' });
};
const plans: Record<string, (p: Plan) => void> = {
  default: () => {},
  'clear logjam': (p) => set(p, 'logjam', { removed: true }),
  'clear all': clear,
  'clear + teeth': (p) => { clear(p); set(p, 'tooth-1', { split: true }); set(p, 'tooth-2', { split: true }); },
  'clear + teeth + crushers': (p) => { clear(p); for (const id of ['tooth-1', 'tooth-2', 'crusher-1']) set(p, id, { split: true }); },
  'clear + all breakers': (p) => { clear(p); for (const id of ['tooth-1', 'tooth-2', 'crusher-1', 'crusher-2']) set(p, id, { split: true }); },
};
const only = process.argv[2];
for (const [name, mod] of Object.entries(plans)) {
  if (only && !name.includes(only)) continue;
  const p = defaultPlan(L);
  mod(p);
  const t0 = performance.now();
  const sim = new Simulation(R, L, p);
  const speeds: string[] = [];
  while (!sim.done) {
    sim.stepOnce();
    if (sim.step % 120 === 0 && sim.leader) {
      const t = sim.leader.body.translation(); const v = sim.leader.body.linvel();
      speeds.push(`${t.z.toFixed(0)}:${Math.hypot(v.x, v.y, v.z).toFixed(0)}:${STAGES[ Math.max(0, STAGES.findIndex((s) => sim.leader!.size >= s.min))].name[0]}`);
    }
  }
  const r = sim.result!;
  console.log(`\n== ${name} [${(performance.now() - t0).toFixed(0)}ms, ${r.duration.toFixed(0)}s] ${r.reason} @ ${r.destination}`);
  console.log(`  score=${r.score} grade=${r.grade} dist=${r.distance.toFixed(0)}m size=${(r.size * 100).toFixed(1)}cm stage=${STAGES[r.stage].name} smashes=${r.smashes} combo=${r.maxCombo} air=${r.airTime.toFixed(1)} water=${r.waterTime.toFixed(0)}s`);
  console.log("  " + speeds.join(" ")); if (sim.leader) { const t = sim.leader.body.translation(); console.log("  final leader", t.x.toFixed(1), t.y.toFixed(1), t.z.toFixed(1), "r", sim.leader.shape.radius.toFixed(2), "ground", sim.data.heightAt(t.x,t.z).toFixed(1)); }
  if (process.env.FR) for (const f of r.fractures) console.log(`   ${f.time.toFixed(1)}s vs ${f.against} n=${f.pieces} imp=${f.impact.toFixed(1)} z=${f.pos[2].toFixed(0)}`);
  sim.dispose();
}
