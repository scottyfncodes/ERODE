// Headless balancing:
//   npx tsx scripts/balance.ts <level-id | path/to/level.ts> [composition] [test-name-filter] [-v]
// A level module exports its LevelDef and a `*_TESTS` array of candidate plans.
import { loadRapier } from '../src/sim/rapier';
import { Simulation } from '../src/sim/simulation';
import { LEVELS, LEVEL_TESTS } from '../src/levels/index';
import { sanitizePlan } from '../src/sim/plan';
import { makeAutopilot } from '../src/sim/autopilot';
import type { CompositionId } from '../src/sim/composition';

const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const verbose = process.argv.includes('-v');
const R = await loadRapier();
import type { LevelDef, Plan } from '../src/levels/types';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
let level: LevelDef = LEVELS.find((l) => l.id === args[0]) ?? LEVELS[0];
let moduleTests: { name: string; route: string; plan: Plan }[] | undefined;
if (args[0]?.endsWith('.ts')) {
  const mod = (await import(pathToFileURL(resolve(args[0])).href)) as Record<string, unknown>;
  for (const [k, v] of Object.entries(mod)) {
    if (k.endsWith('_TESTS')) moduleTests = v as typeof moduleTests;
    else if (v && typeof v === 'object' && 'terrain' in v) level = v as LevelDef;
  }
}
const comp = (args[1] ?? 'granite') as CompositionId;
const tests = (moduleTests ?? LEVEL_TESTS[level.id] ?? [{ name: 'as found', route: level.routes[0]?.id ?? '', plan: {} }]).filter((t) => !args[2] || t.name.includes(args[2]));
const kg = (n: number) => `${Math.round(n).toLocaleString('en-US')}kg`;
for (const t of tests) {
  const t0 = performance.now();
  const sim = new Simulation(R, level, sanitizePlan(level, t.plan), { composition: comp });
  sim.debugImpacts = [];
  const pilot = makeAutopilot(sim, t.route);
  const trace: string[] = [];
  while (!sim.done) {
    sim.steer = pilot();
    sim.stepOnce();
    if (sim.step % 120 === 0 && sim.hero) {
      const p = sim.hero.body.translation();
      const v = sim.hero.body.linvel();
      trace.push(`${p.z.toFixed(0)}/${p.x.toFixed(0)}:${Math.hypot(v.x, v.y, v.z).toFixed(0)}`);
    }
  }
  const r = sim.result!;
  console.log(`\n== ${t.name} [${comp}] ${(performance.now() - t0).toFixed(0)}ms sim ${r.duration.toFixed(1)}s — ${r.cause} · route=${r.route ?? '-'}`);
  console.log(`  ${kg(r.startMass)} → ${kg(r.mass)}  retained ${(r.retained * 100).toFixed(1)}%  medal=${r.medal}  impacts=${kg(r.impactLoss)} wear=${kg(r.abrasionLoss)} splits=${kg(r.splitLoss)}  top ${(r.topSpeed * 3.6).toFixed(0)}km/h  trees felled ${r.treesFelled} hit ${r.treeHits}  smashed [${r.smashed.join(',')}]`);
  console.log(`  objectives: ${r.objectives.map((o) => `${o.done ? '✓' : '·'} ${o.label}`).join(' | ')}`);
  if (verbose) {
    console.log('  ' + trace.join(' '));
    for (const l of sim.debugImpacts) console.log('   ' + l);
  }
  sim.dispose();
}
