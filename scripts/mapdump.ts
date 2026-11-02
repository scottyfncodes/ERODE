// Dump heightfield + trajectories as JSON for a top-down debug image.
import { writeFileSync } from 'node:fs';
import { loadRapier } from '../src/sim/rapier';
import { Simulation } from '../src/sim/simulation';
import { FIRST_DESCENT } from '../src/levels/firstDescent';
import { defaultPlan } from '../src/sim/plan';
import { loadLevelData } from '../src/sim/levelData';
import { resolveObjects } from '../src/sim/objects';

const deg = Math.PI / 180;
const R = await loadRapier();
const L = FIRST_DESCENT;
const p = defaultPlan(L);
import { SOLUTIONS } from './solutions';
const [solName, jStr] = (process.argv[2] ?? '').split('@');
if (solName) SOLUTIONS[Object.keys(SOLUTIONS).find(k => k.includes(solName))!](p, Number(jStr ?? 0));
void deg;
const d = loadLevelData(L);
const sim = new Simulation(R, L, p);
sim.runToEnd();
const tracks = sim.recording.tracks.filter(t => t.kind === 'stone').map(t => { const pts = []; for (let i = 0; i < t.data.length; i += 8 * 3) pts.push([t.data[i], t.data[i + 2]]); return pts; });
const objs = resolveObjects(L, p, d.heightAt).flatMap(o => o.parts.map(pp => (pp.part as any).pos ? [(pp.part as any).pos[0], (pp.part as any).pos[2], o.id] : null).filter(Boolean));
writeFileSync(process.argv[3] ?? '/tmp/map.json', JSON.stringify({ grid: { nx: d.grid.nx, nz: d.grid.nz, x0: d.grid.x0, z0: d.grid.z0, cell: d.grid.cell, h: Array.from(d.grid.heights) }, tracks, objs, res: sim.result }));
console.log(sim.result!.success, sim.result!.deliveredFraction, sim.result!.fractures.length, sim.result!.destination);
