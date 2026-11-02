// Headless balancing: ride every route through a mountain and report speed, destruction and score.
// npx tsx scripts/balance.ts [mountain-id] [stone]
import { LEVELS } from '../src/levels/index';
import { loadLevelData } from '../src/sim/levelData';
import { RunSim, type Decision } from '../src/run/runner';
import type { CompositionId } from '../src/sim/composition';

const id = process.argv[2];
const comp = (process.argv[3] ?? 'granite') as CompositionId;
for (const level of LEVELS.filter((l) => !id || l.id === id)) {
  const t0 = Date.now();
  const data = loadLevelData(level);
  console.log(`\n${level.name}  (terrain ${Date.now() - t0} ms)`);
  const scores: number[] = [];
  for (let mask = 0; mask < 8; mask++) {
    const sim = new RunSim(level, data, { composition: comp });
    let k = 0;
    const speeds: string[] = [];
    const t1 = Date.now();
    let sim2 = sim;
    const r = sim2.runToEnd((d: Decision) => {
      speeds.push(`${Math.round(sim.speed * 3.6)}`);
      const bit = (mask >> k++) & 1;
      return bit ? d.options.length - 1 : 0;
    });
    scores.push(r.score.total);
    const s = r.stats;
    console.log(
      `${r.route.slice(1, -1).map((x) => level.segments.find((q) => q.id === x)!.name).join(' > ').padEnd(64)} ${r.reason.padEnd(9)} ${String(r.score.total).padStart(6)}  t=${r.duration.toFixed(0)}s top=${Math.round(s.topSpeed * 3.6)} fin=${Math.round(s.finaleSpeed * 3.6)} fork@${speeds.join('/')} int=${Math.round(r.integrity * 100)}% trees=${s.trees}(${s.treesChain}) rocks=${s.rocks} pil=${s.pillars} bld=${s.structures} parts=${s.parts} slides=${s.slides} chain=${s.longestChain} [${Date.now() - t1}ms]`,
    );
    console.log(`   dmg ${Object.entries(sim.damage).map(([k, v]) => `${k}:${Math.round(v)}`).join(' ')}  destr=${r.score.destruction} chain=${r.score.chain} var=${r.score.variety} dist=${r.score.distance} speed=${r.score.speed} done=${r.score.completion}`);
  }
  scores.sort((a, b) => a - b);
  console.log(`scores: min ${scores[0]} median ${scores[4]} max ${scores[7]}`);
}
