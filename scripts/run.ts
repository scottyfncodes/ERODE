// Headless runs of the course: no steering, following the line, and aiming for rocks.
import { loadRapier } from '../src/sim/rapier';
import { Simulation, STAGES } from '../src/sim/simulation';
import { SUMMIT_TO_SEA as L } from '../src/levels/summitToSea';
import { defaultPlan } from '../src/sim/plan';
import { makeAutopilot } from '../src/sim/autopilot';
import { sizeLabel } from '../src/ui/format';

const R = await loadRapier();
for (const mode of ['none', 'line', 'aim'] as const) {
  if (process.argv[2] && mode !== process.argv[2]) continue;
  const t0 = performance.now();
  const sim = new Simulation(R, L, defaultPlan(L));
  const pilot = mode === 'none' ? null : makeAutopilot(sim, mode);
  const trace: string[] = [];
  while (!sim.done) {
    if (pilot) sim.steer = pilot();
    sim.stepOnce();
    if (sim.step % 180 === 0 && sim.hero) {
      const t = sim.hero.body.translation(); const v = sim.hero.body.linvel();
      trace.push(`${t.z.toFixed(0)}:${Math.hypot(v.x, v.y, v.z).toFixed(0)}:${sizeLabel(sim.hero.size)}`);
    }
  }
  const r = sim.result!;
  console.log(`\n== ${mode} [${(performance.now() - t0).toFixed(0)}ms, ${r.duration.toFixed(0)}s] ${r.reason} @ ${r.destination}`);
  console.log(`  score=${r.score} grade=${r.grade} dist=${r.distance.toFixed(0)}m size=${sizeLabel(r.size)} stage=${STAGES[r.stage].name} smashes=${r.smashes} chips=${r.chips} combo=${r.maxCombo} top=${r.topSpeed.toFixed(0)}m/s water=${r.waterTime.toFixed(0)}s`);
  console.log('  ' + trace.join(' '));
  sim.dispose();
}
